import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  animatedOutputSha256,
  rgbaPixelSha256FromImage,
  rgb565PixelSha256FromImage,
  staticOutputFileSha256,
  validateScreenManifestV2,
} from "../scripts/screen-workspace-vocabulary.ts";
import { walnutWidgetCatalogFromPixelSpec } from "../scripts/walnut-lvgl-widget-catalog.ts";
import { createWidgetAppWorkspace } from "./widget-app-workspace.ts";
import { createScreenWorkspaceWorkflows } from "./screen-workspace-workflows.ts";

const FreeformGenerateRequestSchema = z.object({
  prompt: z.string().optional(),
  text: z.string().optional(),
  screenId: z.string().optional(),
  sourceId: z.string().optional(),
  templateId: z.string().optional(),
  title: z.string().optional(),
  outputType: z.enum(["static", "animated"]).optional(),
  preset: z.enum(["fit-cover:480x320", "fit-contain:480x320", "pixel-grid:120x80@4x", "pixel-grid:240x160@2x"]).optional(),
  playlist: z.union([z.literal(false), z.string()]).optional(),
  durationMs: z.number().optional(),
  repeat: z.number().optional(),
  loop: z.boolean().optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
});
type FreeformGenerateRequest = z.infer<typeof FreeformGenerateRequestSchema>;
type JsonObject = Record<string, any>;

const WORKSPACE_IMPORT_EXTENSION_BY_MEDIA_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

const WORKSPACE_IMPORT_EXTENSION_ALIASES = {
  ".png": ".png",
  ".jpg": ".jpg",
  ".jpeg": ".jpg",
  ".gif": ".gif",
  ".webp": ".webp",
  ".mp4": ".mp4",
  ".webm": ".webm",
  ".mov": ".mov",
};

const WORKSPACE_OUTPUT_TYPES = new Set(["static", "animated"]);
const WORKSPACE_PRESETS = new Set([
  "fit-cover:480x320",
  "fit-contain:480x320",
  "pixel-grid:120x80@4x",
  "pixel-grid:240x160@2x",
]);
const WORKSPACE_PLAYLIST_MODES = new Set(["replace", "append"]);
const PIXEL_ELEMENT_NUMBER_FIELDS = {
  x: { min: 0, max: 119, fallback: 0 },
  y: { min: 0, max: 79, fallback: 0 },
  width: { min: 1, max: 120, fallback: 1, optional: true },
  height: { min: 1, max: 80, fallback: 1, optional: true },
};

const PixelMetricSchema = z.object({
  label: z.string().min(1).max(8),
  value: z.string().min(1).max(12),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bar: z.number().int().min(0).max(34),
});

const PixelRectSchema = z.object({
  rect: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
  fill: z.string().min(1).max(32),
});

const PixelGeneratorTemplateSchema = z.object({
  schema: z.literal("walnutpi.pixelGeneratorTemplate.v1"),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  canvas: z.object({
    logicalWidth: z.literal(120),
    logicalHeight: z.literal(80),
    scale: z.literal(4),
  }),
  palette: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  layout: z.object({
    title: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    primaryLabel: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    primaryValue: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    footer: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    metric: z.object({
      x: z.number().int(),
      valueX: z.number().int(),
      y: z.number().int(),
      gapY: z.number().int(),
      markerX: z.number().int(),
      markerOffsetY: z.number().int(),
      markerWidth: z.number().int(),
      markerHeight: z.number().int(),
    }),
    wifi: z.object({ x: z.number().int(), y: z.number().int() }),
    progress: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
    shell: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
    board: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
  }),
  defaults: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    darkBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    lightBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    footer: z.string().min(1).max(16),
    progress: z.number().int().min(0).max(96),
    batteryProgress: z.number().int().min(0).max(96),
    metrics: z.array(PixelMetricSchema).min(1).max(3),
  }),
  sprites: z.object({
    board: z.array(PixelRectSchema),
    wifi: z.array(PixelRectSchema),
  }),
});

const PixelScreenSpecSchema = z.object({
  schema: z.literal("walnutpi.pixelScreenSpec.v1"),
  template: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  logicalWidth: z.literal(120),
  logicalHeight: z.literal(80),
  scale: z.literal(4),
  title: z.string().min(1).max(12),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  progress: z.number().int().min(0).max(96),
  primaryLabel: z.string().min(1).max(12),
  primaryValue: z.string().min(1).max(16),
  footer: z.string().min(1).max(16),
  metrics: z.array(PixelMetricSchema).min(1).max(3),
  elements: z.array(z.object({
    type: z.enum(["text", "rect", "bar", "arc"]),
    x: z.number().int().min(0).max(119),
    y: z.number().int().min(0).max(79),
    width: z.number().int().min(1).max(120).optional(),
    height: z.number().int().min(1).max(80).optional(),
    text: z.string().max(24).optional(),
    fill: z.string().min(1).max(32).optional(),
    scale: z.number().int().min(1).max(2).optional(),
    value: z.number().int().min(0).max(100).optional(),
    required: z.boolean().optional(),
  })).max(40).optional(),
});

export function createScreenWorkspaceApi({
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow,
  readJsonRequest,
  json,
  workspaceErrorResponse,
  webMetricsLedger,
  processSourceAssetToScreenOutput,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
  generateLvglScreenWorkspaceRuntimeAssets,
  persistScreenSyncResult,
  runLocal,
  runRemote,
  runRemoteWithInput,
  shellQuote,
  findWindowsCommand,
  sha256,
  projectRoot,
  screenWorkspaceRoot,
  screenSourceImportMaxBytes,
  screenLvglPreviewOutputDir,
  generateWidgetCatalog,
}) {
  const PROJECT_ROOT = projectRoot;
  const SCREEN_WORKSPACE_ROOT = screenWorkspaceRoot;
  const SCREEN_SOURCE_IMPORT_MAX_BYTES = screenSourceImportMaxBytes;
  const SCREEN_LVGL_PREVIEW_OUTPUT_DIR = screenLvglPreviewOutputDir;
  const PIXEL_GENERATORS_ROOT = path.join(SCREEN_WORKSPACE_ROOT, "generators");
  const WIDGET_RUNTIME_ROOT = path.join(SCREEN_WORKSPACE_ROOT, "widget-runtime");
  const LVGL_APP_REGISTRY_PATH = path.join(SCREEN_WORKSPACE_ROOT, "lvgl-apps", "registry.json");
  let lvglPreviewQueue: Promise<any> = Promise.resolve();
  const widgetAppWorkspace = createWidgetAppWorkspace({
    projectRoot,
    screenWorkspaceRoot,
    runLocal,
    runRemote,
    runRemoteWithInput,
    shellQuote,
    json,
    workspaceErrorResponse,
  });
  const screenWorkspaceWorkflows = createScreenWorkspaceWorkflows({
    workspaceRoot: SCREEN_WORKSPACE_ROOT,
    readSourceAsset: readWorkspaceSourceAsset,
    processSourceAssetToScreenOutput,
    appendScreenPlaylistItem,
    writeDefaultScreenPlaylist,
    cleanId: cleanScreenWorkspaceId,
    cleanSourcePath: cleanWorkspaceSourcePath,
    cleanOutputType: cleanWorkspaceOutputType,
    cleanPreset: cleanWorkspacePreset,
    cleanAnimation: cleanWorkspaceAnimation,
    cleanPlaylistMode: cleanWorkspacePlaylistMode,
    cleanInteger: cleanWorkspaceInteger,
  });

  async function handleScreenWorkspacePlaylist(url) {
    try {
      const playlistId = url.searchParams.get("id") || "default";
      return json(await screenWorkspaceStore.readPlaylistEnvelope(playlistId));
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleScreenWorkspaceManifest(manifestId) {
    try {
      const envelope = await screenWorkspaceStore.readManifest(manifestId);
      return json({
        ok: true,
        schema: "walnutpi.screenWorkspaceManifestEnvelope.v1",
        manifest: envelope.manifest,
        manifestHash: envelope.manifestHash,
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleScreenWorkspaceAsset(url) {
    try {
      const asset = await screenWorkspaceStore.assetResponse(url.pathname);
      if (!asset) return json({ ok: false, error: "asset route not found" }, 404);
      return new Response(Bun.file(asset.filePath), {
        headers: asset.headers,
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }


  async function handleLvglAppList() {
    try {
      const officialApps = (await readLvglAppRegistry()).map((entry) => {
        const app = walnutLvglAppFromRegistryEntry(entry);
        return {
          ...app,
          preview: `/api/screen/lvgl-demo-preview?demo=${encodeURIComponent(entry.upstream.name)}`,
          download: `/api/screen/lvgl-apps/${encodeURIComponent(entry.id)}/download`,
        };
      });
      const widgetApps = await widgetAppWorkspace.readWidgetAppCards();
      return json({ ok: true, schema: "walnutpi.lvgl-app-list.v1", apps: [...officialApps, ...widgetApps] });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleLvglAppDownload(appId) {
    try {
      const app = await readLvglDemoApp(appId);
      const archive = await createTarArchive(await lvglDemoArchiveFiles(app.id));
      return new Response(archive, {
        headers: {
          "content-type": "application/gzip",
          "content-disposition": `attachment; filename="${app.id}.lvgl-app.tar.gz"`,
        },
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleLvglAppActivate(req) {
    try {
      const body = req ? await readJsonRequest(req).catch(() => ({})) : {};
      const appId = cleanScreenWorkspaceId(body.appId || body.id || "", "appId");
      const registryEntry = (await readLvglAppRegistry()).find((entry) => entry.id === appId);
      if (!registryEntry) throw new Error("unsupported LVGL app");
      const app = walnutLvglAppFromRegistryEntry(registryEntry);
      const preview = await renderLvglDemoPng(registryEntry.upstream.name);
      const result = await processSourceAssetToScreenOutput({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        plan: {
          id: `${app.id}-plan`,
          screenId: app.id,
          title: app.title,
          description: `LVGL app from ${app.source}`,
          animation: { fps: 1, maxSeconds: 1, maxFrames: 1 },
        },
        sourceAsset: {
          id: `${app.id}-source`,
          path: preview.pngPath,
          selected: true,
          mediaType: "image/png",
          license: "lvgl-demo-local",
          origin: app.source,
        },
        outputType: "static",
        preset: "fit-contain:480x320",
      });
      const playlist = await writeDefaultScreenPlaylist({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        playlistId: "default",
        manifestId: result.screenId,
        durationMs: 8000,
        repeat: 1,
        loop: true,
      });
      return json({
        ok: true,
        schema: "walnutpi.lvgl-app-activation.v1",
        app,
        screenId: result.screenId,
        manifest: result.manifest,
        output: result.output,
        playlist: playlist.playlist,
        playlistHash: playlist.playlistHash,
        preview: preview.png,
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleScreenWorkspaceImport(req) {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    try {
      const sourceId = cleanScreenWorkspaceId(body.sourceId || body.id || `source-${Date.now()}`, "sourceId");
      const sourceUrl = cleanWorkspaceSourceUrl(body.url || body.sourceUrl);
      const imported = await importWorkspaceSourceUrl({
        sourceId,
        sourceUrl,
        license: body.license || "unknown-personal-sync",
        title: body.title,
      });

      await webMetricsLedger.append({
        kind: "screen.workspace.import",
        operation: "screen.workspace.import",
        ok: true,
        sourceId,
        mediaType: imported.mediaType,
        bytes: imported.bytes,
      });

      return json({
        ok: true,
        schema: "walnutpi.screenWorkspaceImportResult.v1",
        source: imported.sourceRecord,
        sourceAssetId: sourceId,
      });
    } catch (error) {
      await webMetricsLedger.append({
        kind: "screen.workspace.import",
        operation: "screen.workspace.import",
        ok: false,
        error: error.message,
      });
      return json({
        ok: false,
        error: "screen workspace import failed",
        output: error.message,
      }, error.status || 400);
    }
  }

  async function handleScreenWorkspaceProcess(req) {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    try {
      const { result, playlist } = await screenWorkspaceWorkflows.processSourceRequest(body);

      await webMetricsLedger.append({
        kind: "screen.workspace.process",
        operation: "screen.workspace.process",
        ok: true,
        outputType: result.output.type,
        screenId: result.screenId,
        preset: body.preset || "fit-cover:480x320",
      });

      return json({
        ok: true,
        schema: "walnutpi.screenWorkspaceProcessResult.v1",
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        screenId: result.screenId,
        manifest: result.manifest,
        output: result.output,
        playlist: playlist?.playlist || null,
      });
    } catch (error) {
      await webMetricsLedger.append({
        kind: "screen.workspace.process",
        operation: "screen.workspace.process",
        ok: false,
        error: error.message,
      });
      return json({
        ok: false,
        error: "screen workspace processing failed",
        output: error.message,
      }, 400);
    }
  }

  async function handleScreenWorkspaceGenerate(req) {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    const result = await generateScreenWorkspace(body);
    return json(result.body, result.status);
  }

  async function generateScreenWorkspace(body) {
    const startedAt = Date.now();
    try {
      const request: FreeformGenerateRequest = FreeformGenerateRequestSchema.parse(body);
      const prompt = cleanFreeformPrompt(request.prompt || request.text);
      const screenId = cleanScreenWorkspaceId(request.screenId || `agent-freeform-${Date.now()}`, "screenId");
      const sourceId = cleanScreenWorkspaceId(request.sourceId || `${screenId}-source`, "sourceId");
      const plan = buildScreenGenerationPlan(prompt, { templateId: request.templateId });
      const facts = await collectScreenFacts(plan);
      const template = await readPixelGeneratorTemplate(plan.template);
      let screenSpec = buildFreeformPixelScreenSpec({
        prompt,
        title: request.title || freeformTitle(prompt),
        template,
        plan,
        facts,
      });
      screenSpec = PixelScreenSpecSchema.parse(widgetAppWorkspace.repairLvglWidgetLayout(screenSpec));
      const generatedCatalog = plan.widgetApp ? generateWidgetCatalog
        ? await generateWidgetCatalog({
          prompt,
          sessionId: request.sessionId,
          turnId: request.turnId,
        })
        : null : null;
      if (cleanWorkspaceOutputType(request.outputType || "static") === "animated") {
        const result = await writeGeneratedAnimatedScreenOutput({
          screenId,
          sourceId,
          prompt,
          screenSpec,
          template,
          generatedCatalog,
          facts,
        });
        let playlist = null;
        if (request.playlist !== false) {
          playlist = await writeDefaultScreenPlaylist({
            workspaceRoot: SCREEN_WORKSPACE_ROOT,
            playlistId: typeof request.playlist === "string" ? request.playlist : "default",
            manifestId: result.screenId,
            durationMs: cleanWorkspaceInteger(request.durationMs || 8000, "durationMs", 1, 86400000),
            repeat: cleanWorkspaceInteger(request.repeat || 1, "repeat", 1, 1000),
            loop: request.loop === undefined ? true : Boolean(request.loop),
          });
        }
        await webMetricsLedger.append({
          kind: "screen.workspace.generate",
          operation: "screen.workspace.generate",
          ok: true,
          latencyMs: Date.now() - startedAt,
          inputChars: prompt.length,
          screenId: result.screenId,
          template: screenSpec.template,
          sessionId: request.sessionId,
          turnId: request.turnId,
        });
        return {
          status: 200,
          body: {
          ok: true,
          schema: "walnutpi.screenWorkspaceGenerateResult.v1",
          workspaceRoot: SCREEN_WORKSPACE_ROOT,
          screenId: result.screenId,
          plan,
          screenSpec,
          widgetApp: result.manifest.provenance.widgetApp || null,
          facts,
          source: result.source,
          manifest: result.manifest,
          output: result.output,
          playlist: playlist?.playlist || null,
          },
        };
      }
      const source = await writeGeneratedPromptSource({
        sourceId,
        prompt,
        screenSpec,
        template,
      });
      const result = await processSourceAssetToScreenOutput({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        plan: {
          id: `${screenId}-plan`,
          screenId,
          title: screenSpec.title,
          description: prompt,
        },
        sourceAsset: {
          id: sourceId,
          title: screenSpec.title,
          path: source.originalPath,
          selected: true,
          mediaType: source.mediaType,
          license: source.license,
          origin: source.origin,
        },
        outputType: cleanWorkspaceOutputType(request.outputType || "static"),
        preset: cleanWorkspacePreset(request.preset || "fit-cover:480x320"),
      });
      if (facts.widgetApp !== false) {
        const widgetApp = await widgetAppWorkspace.writeFromPixelSpec({
          screenId,
          prompt,
          screenSpec,
          catalog: generatedCatalog,
          sourcePath: source.originalPath,
        });
        result.manifest.provenance.widgetApp = widgetApp.provenance;
        await writeFile(result.manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8");
      }

      let playlist = null;
      if (request.playlist !== false) {
        playlist = await writeDefaultScreenPlaylist({
          workspaceRoot: SCREEN_WORKSPACE_ROOT,
          playlistId: typeof request.playlist === "string" ? request.playlist : "default",
          manifestId: result.screenId,
          durationMs: cleanWorkspaceInteger(request.durationMs || 8000, "durationMs", 1, 86400000),
          repeat: cleanWorkspaceInteger(request.repeat || 1, "repeat", 1, 1000),
          loop: request.loop === undefined ? true : Boolean(request.loop),
        });
      }

      await webMetricsLedger.append({
        kind: "screen.workspace.generate",
        operation: "screen.workspace.generate",
        ok: true,
        latencyMs: Date.now() - startedAt,
        inputChars: prompt.length,
        screenId: result.screenId,
        template: screenSpec.template,
        sessionId: request.sessionId,
        turnId: request.turnId,
      });

      return {
        status: 200,
        body: {
        ok: true,
        schema: "walnutpi.screenWorkspaceGenerateResult.v1",
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        screenId: result.screenId,
        plan,
        screenSpec,
        widgetApp: result.manifest.provenance.widgetApp || null,
        facts,
        source,
        manifest: result.manifest,
        output: result.output,
        playlist: playlist?.playlist || null,
        },
      };
    } catch (error) {
      await webMetricsLedger.append({
        kind: "screen.workspace.generate",
        operation: "screen.workspace.generate",
        ok: false,
        latencyMs: Date.now() - startedAt,
        sessionId: body?.sessionId,
        turnId: body?.turnId,
        error: error.message,
      });
      return {
        status: 400,
        body: {
          ok: false,
          error: "screen workspace freeform generation failed",
          output: error.message,
        },
      };
    }
  }

  async function handleScreenWorkspaceLvglPreview(req) {
    return runExclusiveLvglPreview(async () => {
      const body = req ? await readJsonRequest(req).catch(() => ({})) : {};
      await mkdir(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, { recursive: true });
      const widgetMode = body.mode === "widget";
      const widgetCurrent = widgetMode && existsSync(path.join(WIDGET_RUNTIME_ROOT, "current.json"))
        ? await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "current.json")).catch(() => null)
        : null;
      const widgetPreviewStem = widgetCurrent?.appId
        ? `widget-${cleanScreenWorkspaceId(widgetCurrent.appId, "appId")}-lvgl`
        : "widget-lvgl";
      const envelope = widgetMode ? null : await screenWorkspaceStore.readPlaylistEnvelope("default");
      const runtimeIndexPath = widgetMode
        ? path.join(WIDGET_RUNTIME_ROOT, "current.txt")
        : (await generateLvglScreenWorkspaceRuntimeAssets({
            workspaceRoot: SCREEN_WORKSPACE_ROOT,
            playlistId: "default",
          })).indexPath;

      const build = await runLvglPreviewBuild();
      if (!build.ok) {
        return json({
          ok: false,
          error: "LVGL preview build failed",
          output: build.output,
        }, 500);
      }

      const exePath = lvglPreviewExePath();
      if (!existsSync(exePath)) {
        return json({
          ok: false,
          error: "LVGL preview executable is missing",
          output: exePath,
        }, 500);
      }

      const advanceMs = widgetMode ? [0, 450, 900, 1350] : lvglPreviewAdvanceTimes(envelope);
      const frames = [];
      for (const ms of advanceMs) {
        const stem = `${widgetMode ? widgetPreviewStem : "lvgl"}-${String(ms).padStart(5, "0")}ms`;
        const bmpPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.bmp`);
        const pngPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.png`);
        const rendered = await runLocal(exePath, [bmpPath, "--advance-ms", String(ms), "--runtime", runtimeIndexPath], {
          timeoutMs: 30_000,
          outputLimit: 12_000,
        });
        if (!rendered.ok) {
          return json({
            ok: false,
            error: "LVGL preview render failed",
            output: rendered.output,
            advanceMs: ms,
          }, 500);
        }
        await ensurePreviewPng(bmpPath, pngPath);
        frames.push({
          advanceMs: ms,
          bmp: screenWorkspaceAssetUrl(bmpPath),
          png: screenWorkspaceAssetUrl(pngPath),
        });
      }

      return json({
        ok: true,
        schema: "walnutpi.screenWorkspaceLvglPreview.v1",
        mode: widgetMode ? "widget" : "playlist",
        playlistHash: envelope?.playlistHash || null,
        runtimeIndex: screenWorkspaceAssetUrl(runtimeIndexPath),
        itemCount: envelope?.items.length || 1,
        frameCount: frames.length,
        frames,
        buildOutput: build.output,
      });
    }).catch((error) => json({
      ok: false,
      error: "LVGL preview failed",
      output: error.message,
    }, 500));
  }

  async function handleLvglDemoPreview(url) {
    try {
      const demo = cleanLvglDemoId(url.searchParams.get("demo") || "music");
      const preview = await renderLvglDemoPng(demo);
      return json({
        ok: true,
        schema: "walnutpi.lvgl-demo-preview.v1",
        demo,
        png: preview.png,
        bmp: preview.bmp,
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function renderLvglDemoPng(demo): Promise<{ bmp: string; bmpPath: string; png: string; pngPath: string }> {
    return runExclusiveLvglPreview(async () => {
      demo = cleanLvglDemoId(demo);
      await mkdir(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, { recursive: true });
      const build = await runLvglPreviewBuild();
      if (!build.ok) {
        throw new Error(`LVGL preview build failed: ${build.output}`);
      }
      const exePath = lvglPreviewExePath();
      const stem = `lvgl-demo-${demo}`;
      const bmpPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.bmp`);
      const pngPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.png`);
      const rendered = await runLocal(exePath, [bmpPath, "--demo", demo, "--advance-ms", "1800"], {
        timeoutMs: 30_000,
        outputLimit: 12_000,
      });
      if (!rendered.ok) {
        throw new Error(`LVGL demo preview render failed: ${rendered.output}`);
      }
      await ensurePreviewPng(bmpPath, pngPath);
      return {
        png: screenWorkspaceAssetUrl(pngPath),
        bmp: screenWorkspaceAssetUrl(bmpPath),
        pngPath,
        bmpPath,
      };
    });
  }

  function runExclusiveLvglPreview<T>(task: () => Promise<T>): Promise<T> {
    const run = lvglPreviewQueue.then(task, task);
    lvglPreviewQueue = run.catch(() => {});
    return run;
  }

  function cleanLvglDemoId(value) {
    const text = String(value || "").trim();
    if (text === "music" || text === "widgets") return text;
    throw new Error("unsupported LVGL demo");
  }

  function readLvglDemoApp(appId) {
    const id = cleanScreenWorkspaceId(appId || "", "appId");
    return readLvglAppRegistry()
      .then((registry) => registry.find((entry) => entry.id === id))
      .then((registryEntry) => {
        if (!registryEntry) throw new Error("unsupported LVGL app");
        return walnutLvglAppFromRegistryEntry(registryEntry);
      });
  }

  async function readWorkspaceSourceAsset(sourceAssetId) {
    const cleanId = cleanScreenWorkspaceId(sourceAssetId, "sourceAssetId");
    const sourceJsonPath = path.resolve(SCREEN_WORKSPACE_ROOT, "sources", cleanId, "source.json");
    const sourceRoot = path.resolve(SCREEN_WORKSPACE_ROOT, "sources");
    const relativeToSources = path.relative(sourceRoot, sourceJsonPath);
    if (relativeToSources.startsWith("..") || path.isAbsolute(relativeToSources)) {
      throw new Error("sourceAssetId must stay inside the Screen Workspace sources");
    }
    const sourceRecord = JSON.parse(await readFile(sourceJsonPath, "utf8"));
    if (!sourceRecord || typeof sourceRecord !== "object" || Array.isArray(sourceRecord)) {
      throw new Error("source asset record must be an object");
    }
    if (sourceRecord.selected === false) {
      throw new Error("source asset must be selected before processing");
    }
    const original = String(sourceRecord.original || "").trim();
    if (!original) throw new Error("source asset original is missing");
    const originalPath = path.resolve(path.dirname(sourceJsonPath), original);
    const relativeToWorkspace = path.relative(SCREEN_WORKSPACE_ROOT, originalPath);
    if (relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
      throw new Error("source asset original must stay inside the Screen Workspace");
    }
    return {
      ...sourceRecord,
      id: cleanId,
      sourceJsonPath,
      originalPath,
    };
  }

  async function importWorkspaceSourceUrl({
    sourceId,
    sourceUrl,
    license,
    title,
  }) {
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(30_000)
        : undefined,
      headers: {
        "user-agent": "WalnutPi Screen Workspace source importer",
        accept: "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,*/*;q=0.2",
      },
    });
    if (!response.ok) {
      throw new Error(`source download failed with HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > SCREEN_SOURCE_IMPORT_MAX_BYTES) {
      throw new Error(`source is too large; max ${SCREEN_SOURCE_IMPORT_MAX_BYTES} bytes`);
    }

    const mediaType = cleanWorkspaceImportMediaType(response.headers.get("content-type"));
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error("source download was empty");
    if (bytes.length > SCREEN_SOURCE_IMPORT_MAX_BYTES) {
      throw new Error(`source is too large; max ${SCREEN_SOURCE_IMPORT_MAX_BYTES} bytes`);
    }

    const sourceDir = path.join(SCREEN_WORKSPACE_ROOT, "sources", sourceId);
    const extension = workspaceImportExtension(mediaType, sourceUrl);
    const originalFileName = `original${extension}`;
    const originalPath = path.join(sourceDir, originalFileName);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(originalPath, bytes);

    const sourceRecord = {
      schema: "walnutpi.screen-source-asset.v1",
      id: sourceId,
      ...(title ? { title: String(title).replace(/\s+/g, " ").trim().slice(0, 80) } : {}),
      selected: true,
      importedAt: new Date().toISOString(),
      original: originalFileName,
      fileSha256: sha256(bytes),
      mediaType,
      license: String(license || "unknown-personal-sync").replace(/\s+/g, " ").trim().slice(0, 120),
      origin: sourceUrl,
    };
    await writeFile(path.join(sourceDir, "source.json"), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");

    return {
      sourceRecord,
      mediaType,
      bytes: bytes.length,
    };
  }

  async function writeGeneratedPromptSource({ sourceId, prompt, screenSpec, template }) {
    const sourceDir = path.join(SCREEN_WORKSPACE_ROOT, "sources", sourceId);
    const originalFileName = "original.png";
    const originalPath = path.join(sourceDir, originalFileName);
    const mediaType = "image/png";
    const license = "local-freeform-generation";
    const bytes = await renderPixelScreenSpecPng(screenSpec, template);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(originalPath, bytes);
    const sourceRecord = {
      schema: "walnutpi.screen-source-asset.v1",
      id: sourceId,
      title: screenSpec.title,
      selected: true,
      importedAt: new Date().toISOString(),
      original: originalFileName,
      fileSha256: sha256(bytes),
      width: 480,
      height: 320,
      mediaType,
      license,
      origin: {
        kind: "agent-freeform",
        prompt,
        screenSpec,
      },
    };
    await writeFile(path.join(sourceDir, "source.json"), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
    return {
      ...sourceRecord,
      originalPath,
    };
  }

  async function writeGeneratedAnimatedScreenOutput({ screenId, sourceId, prompt, screenSpec, template, generatedCatalog, facts }: JsonObject) {
    const generatedAt = new Date().toISOString();
    const outputDir = path.join(SCREEN_WORKSPACE_ROOT, "outputs", screenId);
    const framesDir = path.join(outputDir, "frames");
    const sourceDir = path.join(SCREEN_WORKSPACE_ROOT, "sources", sourceId);
    const planPath = path.join(SCREEN_WORKSPACE_ROOT, "plans", `${screenId}-plan.json`);
    const manifestPath = path.join(SCREEN_WORKSPACE_ROOT, "manifests", `${screenId}.json`);
    await mkdir(framesDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    const frames = [];
    for (let index = 0; index < 4; index += 1) {
      const framePath = path.join(framesDir, `frame-${String(index).padStart(3, "0")}.png`);
      await writeFile(framePath, await renderPixelScreenSpecPng(animatedPixelSpec(screenSpec, index), template));
      frames.push({
        path: `../outputs/${screenId}/frames/frame-${String(index).padStart(3, "0")}.png`,
        width: 480,
        height: 320,
        durationMs: 160,
        fileSha256: await staticOutputFileSha256(framePath),
        rgbaPixelSha256: await rgbaPixelSha256FromImage(framePath),
        rgb565PixelSha256: await rgb565PixelSha256FromImage(framePath),
      });
    }
    const sourceRecord = {
      schema: "walnutpi.screen-source-asset.v1",
      id: sourceId,
      title: screenSpec.title,
      selected: true,
      importedAt: generatedAt,
      original: "scene.json",
      fileSha256: sha256(JSON.stringify(screenSpec)),
      width: 480,
      height: 320,
      mediaType: "application/json",
      license: "local-freeform-generation",
      origin: { kind: "agent-freeform", prompt, screenSpec },
    };
    await writeFile(path.join(sourceDir, "scene.json"), `${JSON.stringify(screenSpec, null, 2)}\n`, "utf8");
    await writeFile(path.join(sourceDir, "source.json"), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
    const output = {
      type: "animated",
      path: `../outputs/${screenId}/output.json`,
      width: 480,
      height: 320,
      frameCount: frames.length,
      frames,
      animatedOutputSha256: animatedOutputSha256(frames),
    };
    await writeFile(path.join(outputDir, "output.json"), `${JSON.stringify({ schema: "walnutpi.screen-output.v1", id: screenId, generatedAt, manifest: `../../manifests/${screenId}.json`, output }, null, 2)}\n`, "utf8");
    const widgetApp = facts?.widgetApp === false ? null : (await widgetAppWorkspace.writeFromPixelSpec({
      screenId,
      prompt,
      screenSpec,
      catalog: generatedCatalog,
      sourcePath: path.join(sourceDir, "scene.json"),
    })).provenance;
    const manifest = await validateScreenManifestV2({
      schema: "walnutpi.screen-manifest.v2",
      id: screenId,
      title: screenSpec.title,
      description: prompt,
      output,
      provenance: {
        plan: `../plans/${screenId}-plan.json`,
        sourceAssets: [{
          id: sourceId,
          source: `../sources/${sourceId}/source.json`,
          original: `../sources/${sourceId}/scene.json`,
          width: 480,
          height: 320,
          mediaType: "application/json",
          license: "local-freeform-generation",
          selected: true,
        }],
        ...(widgetApp ? { widgetApp } : {}),
        processing: { preset: "pixel-grid:120x80@4x", tools: [{ name: "sharp", version: sharp.versions.sharp }] },
      },
    }, { manifestPath, workspaceRoot: SCREEN_WORKSPACE_ROOT });
    await writeFile(path.join(outputDir, "output.json"), `${JSON.stringify({ schema: "walnutpi.screen-output.v1", id: screenId, generatedAt, manifest: `../../manifests/${screenId}.json`, output: manifest.output }, null, 2)}\n`, "utf8");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(planPath, `${JSON.stringify({ schema: "walnutpi.screen-plan.v1", id: `${screenId}-plan`, screenId, outputType: "animated", selectedSourceAsset: `../sources/${sourceId}/source.json`, processing: { preset: "pixel-grid:120x80@4x", animation: { fps: 6, maxSeconds: 1, maxFrames: 4 } }, requestedAt: generatedAt, executedAt: generatedAt }, null, 2)}\n`, "utf8");
    return { screenId, source: { ...sourceRecord, originalPath: path.join(sourceDir, "scene.json") }, manifest, output: manifest.output };
  }

  async function readPixelGeneratorTemplate(templateId) {
    const cleanId = cleanScreenWorkspaceId(templateId, "templateId");
    const templatePath = path.join(PIXEL_GENERATORS_ROOT, `${cleanId}.json`);
    const relativeToGenerators = path.relative(PIXEL_GENERATORS_ROOT, templatePath);
    if (relativeToGenerators.startsWith("..") || path.isAbsolute(relativeToGenerators)) {
      throw new Error("templateId must stay inside screen generators");
    }
    return PixelGeneratorTemplateSchema.parse(JSON.parse(await readFile(templatePath, "utf8")));
  }

  function selectPixelGeneratorTemplate({ templateId }: { templateId?: string } = {}) {
    return templateId ? cleanScreenWorkspaceId(templateId, "templateId") : "pixel-ops";
  }

  function buildScreenGenerationPlan(prompt, options: JsonObject = {}) {
    const template = selectPixelGeneratorTemplate({ templateId: options.templateId });
    return {
      schema: "walnutpi.screen-generation-plan.v1",
      prompt,
      template,
      needs: [],
      composition: "template-default",
      widgetApp: true,
    };
  }

  async function collectScreenFacts(plan) {
    return {
      schema: "walnutpi.screen-fact-pack.v1",
      facts: [],
      cards: [],
      widgetApp: plan.widgetApp,
    };
  }

  function buildFreeformPixelScreenSpec({ prompt, title, template, plan, facts }) {
    const defaults = template.defaults;
    const metrics = defaults.metrics.map((metric) => ({ ...metric }));
    let primaryLabel = "DEVICE";
    let primaryValue = "ready";
    let footer = defaults.footer;
    const card = facts?.cards?.[0];
    if (plan?.composition === "fact-card" && card) {
      primaryLabel = card.title;
      primaryValue = card.value;
      footer = card.footer;
      for (const [index, item] of card.items.entries()) {
        if (!metrics[index]) break;
        metrics[index].label = item.label;
        metrics[index].value = item.value;
        metrics[index].bar = item.bar ?? metrics[index].bar;
      }
    } else if (template.id === "pixel-message") {
      primaryLabel = "MESSAGE";
      primaryValue = compactDisplayText(prompt, template.layout.primaryValue.maxChars);
      footer = defaults.footer;
    }
    return PixelScreenSpecSchema.parse({
      schema: "walnutpi.pixelScreenSpec.v1",
      template: template.id,
      logicalWidth: template.canvas.logicalWidth,
      logicalHeight: template.canvas.logicalHeight,
      scale: template.canvas.scale,
      title: compactText(title, template.layout.title.maxChars),
      background: defaults.lightBackground,
      accent: defaults.accent,
      progress: defaults.progress,
      primaryLabel,
      primaryValue,
      footer,
      metrics,
      ...(card ? { elements: factCardPixelElements(card) } : {}),
    });
  }

  function factCardPixelElements(card) {
    return [
      { type: "rect", x: 3, y: 3, width: 114, height: 1, fill: "panelBorder", required: false },
      { type: "rect", x: 3, y: 76, width: 114, height: 1, fill: "panelBorder", required: false },
      { type: "rect", x: 3, y: 4, width: 1, height: 72, fill: "panelBorder", required: false },
      { type: "rect", x: 116, y: 4, width: 1, height: 72, fill: "panelBorder", required: false },
      { type: "text", x: 7, y: 14, text: card.title, fill: "text", scale: 1, required: true },
      { type: "text", x: 7, y: 36, text: card.value, fill: "accent", scale: 2, required: true },
      { type: "text", x: 7, y: 50, text: card.subtitle, fill: "muted2", scale: 1, required: true },
      { type: "text", x: 7, y: 63, text: card.footer, fill: "green", scale: 1, required: true },
      { type: "text", x: 72, y: 24, text: `${card.items[0]?.label || "A"} ${card.items[0]?.value || "--"}`, fill: "cyan", scale: 1, required: true },
      { type: "text", x: 72, y: 42, text: `${card.items[1]?.label || "B"} ${card.items[1]?.value || "--"}`, fill: "text", scale: 1, required: true },
      { type: "text", x: 72, y: 60, text: `${card.items[2]?.label || "C"} ${card.items[2]?.value || "--"}`, fill: "green", scale: 1, required: true },
      { type: "bar", x: 72, y: 67, width: 38, height: 3, fill: "accent", value: Math.max(0, Math.min(100, Number(card.items[0]?.bar || 0) * 3)), required: true },
    ];
  }

  function cleanAiPixelSceneSpec(spec) {
    if (!Array.isArray(spec.elements)) return spec;
    return {
      ...spec,
      title: compactText(spec.title, 12),
      background: /^#[0-9a-fA-F]{6}$/.test(String(spec.background || "")) ? spec.background : "#101412",
      accent: /^#[0-9a-fA-F]{6}$/.test(String(spec.accent || "")) ? spec.accent : "#78c58a",
      elements: spec.elements.slice(0, 24).map(cleanAiPixelElement),
    };
  }

  function cleanAiPixelElement(element) {
    const cleaned = { ...element };
    for (const field of Object.keys(PIXEL_ELEMENT_NUMBER_FIELDS)) {
      const value = cleanPixelElementNumber(element, field);
      if (value === undefined) delete cleaned[field];
      else cleaned[field] = value;
    }
    cleaned.scale = element.scale === 2 ? 2 : 1;
    return cleaned;
  }

  function cleanPixelElementNumber(element, field) {
    const rule = PIXEL_ELEMENT_NUMBER_FIELDS[field];
    if (rule.optional && element[field] === undefined) return undefined;
    const number = Math.round(Number(element[field]) || rule.fallback);
    return Math.max(rule.min, Math.min(rule.max, number));
  }


  async function renderPixelScreenSpecPng(screenSpec, template) {
    const spec = PixelScreenSpecSchema.parse(screenSpec);
    const resolvedTemplate = template || await readPixelGeneratorTemplate(spec.template);
    const svg = renderPixelScreenSpecSvg(spec, resolvedTemplate);
    return sharp(Buffer.from(svg, "utf8"))
      .resize(spec.logicalWidth * spec.scale, spec.logicalHeight * spec.scale, { kernel: "nearest" })
      .png()
      .toBuffer();
  }

  function renderPixelScreenSpecSvg(spec, template) {
    const palette = resolvePalette(template.palette, spec);
    const layout = template.layout;
    if (Array.isArray(spec.elements) && spec.elements.length) {
      return renderFreePixelSceneSvg(spec, palette);
    }
    const protectedRects = protectedPixelRects(spec, layout);
    const rows = spec.metrics.map((metric, index) => {
      const y = layout.metric.y + index * layout.metric.gapY;
      return [
        rect(layout.metric.markerX, y + layout.metric.markerOffsetY, layout.metric.markerWidth, layout.metric.markerHeight, metric.color),
        pxText(layout.metric.x, y, metric.label, palette.muted, 1),
        pxText(layout.metric.valueX, y, metric.value, metric.color, 2),
      ].join("");
    }).join("");
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.logicalWidth}" height="${spec.logicalHeight}" viewBox="0 0 ${spec.logicalWidth} ${spec.logicalHeight}" shape-rendering="crispEdges">`,
      rect(0, 0, 120, 80, spec.background),
      pixelDither(palette),
      drawShell(layout.shell, palette),
      pxText(layout.title.x, layout.title.y, spec.title, palette.text, layout.title.scale),
      drawFreeElements(template.sprites.board, 0, 0, palette, protectedRects),
      pxText(layout.primaryLabel.x, layout.primaryLabel.y, spec.primaryLabel, palette.muted, layout.primaryLabel.scale),
      pxText(layout.primaryValue.x, layout.primaryValue.y, spec.primaryValue, palette.cyan, layout.primaryValue.scale),
      pxText(layout.footer.x, layout.footer.y, spec.footer, palette.muted2, layout.footer.scale),
      drawFreeElements(template.sprites.wifi, layout.wifi.x, layout.wifi.y, palette, protectedRects),
      rows,
      rect(layout.progress.x, layout.progress.y, layout.progress.width, layout.progress.height, palette.barTrack),
      rect(layout.progress.x, layout.progress.y, Math.min(spec.progress, layout.progress.width), layout.progress.height, spec.accent),
      `</svg>`,
    ].join("");
  }

  function rect(x, y, width, height, fill) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;
  }

  function pxText(x, y, text, fill, scale = 1) {
    const size = scale === 2 ? 7 : 4;
    return `<text x="${x}" y="${y}" fill="${fill}" font-family="monospace" font-size="${size}" font-weight="700">${escapeSvg(String(text).toUpperCase())}</text>`;
  }

  function renderFreePixelSceneSvg(spec, palette) {
    const occupied = [];
    const nodes = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.logicalWidth}" height="${spec.logicalHeight}" viewBox="0 0 ${spec.logicalWidth} ${spec.logicalHeight}" shape-rendering="crispEdges">`,
      rect(0, 0, 120, 80, spec.background),
      pixelDither(palette),
    ];
    for (const element of spec.elements) {
      const drawn = drawFreeSceneElement(element, palette, occupied);
      if (drawn) nodes.push(drawn);
    }
    nodes.push(`</svg>`);
    return nodes.join("");
  }

  function animatedPixelSpec(spec, frame) {
    if (!Array.isArray(spec.elements)) return spec;
    return {
      ...spec,
      elements: spec.elements.map((element, index) => {
        if (element.required || element.type !== "rect") return element;
        const dx = ((frame + index) % 3) - 1;
        const dy = ((frame + index) % 2);
        return {
          ...element,
          x: Math.max(0, Math.min(119, element.x + dx)),
          y: Math.max(0, Math.min(79, element.y + dy)),
        };
      }),
    };
  }

  function drawFreeSceneElement(element, palette, occupied) {
    const geometry = pixelElementGeometry[element.type] || pixelElementGeometry.rect;
    const renderer = pixelElementRenderers[element.type] || pixelElementRenderers.rect;
    const box = geometry(element);
    const placed = element.required ? (rectInsideCanvas(box) && !occupied.some((item) => rectsOverlap(box, item)) ? box : null) : placeFreeRect(box, occupied);
    if (!placed) return "";
    occupied.push(placed);
    return renderer(element, placed, palette);
  }

  const pixelElementGeometry = {
    text: (element) => textRect(element.x, element.y, element.text || "", element.scale || 1),
    rect: (element) => ({ x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 }),
    bar: (element) => ({ x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 }),
    arc: (element) => ({ x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 }),
  };

  const pixelElementRenderers = {
    text: (element, placed, palette) => {
      const scale = element.scale || 1;
      return pxText(placed.x + 1, placed.y + (scale === 2 ? 8 : 5), element.text || "", pixelElementFill(palette, element.fill, "text"), scale);
    },
    rect: (element, placed, palette) => rect(placed.x, placed.y, placed.width, placed.height, pixelElementFill(palette, element.fill, "accent")),
    bar: (element, placed, palette) => rect(placed.x, placed.y, placed.width, placed.height, pixelElementFill(palette, element.fill, "accent")),
    arc: (element, placed, palette) => rect(placed.x, placed.y, placed.width, placed.height, pixelElementFill(palette, element.fill, "accent")),
  };

  function pixelElementFill(palette, fill, fallbackKey) {
    return palette[fill || fallbackKey] || fill || palette[fallbackKey];
  }

  function compactText(text, maxChars) {
    const compacted = String(text || "WALNUT").toUpperCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
    return Array.from(compacted || "WALNUT").slice(0, maxChars).join("");
  }

  function compactDisplayText(text, maxChars) {
    const compacted = String(text || "HELLO").replace(/\s+/g, " ").trim();
    return Array.from(compacted || "HELLO").slice(0, maxChars).join("");
  }

  function pixelDither(palette) {
    const dots = [];
    for (let y = 8; y < 74; y += 8) {
      for (let x = 8; x < 114; x += 8) {
        if ((x + y) % 16 === 0) dots.push(rect(x, y, 1, 1, palette.dither));
      }
    }
    return dots.join("");
  }

  function drawShell(shell, palette) {
    return [
      rect(shell.x, shell.y, shell.width, shell.height, palette.panel),
      rect(shell.x, shell.y, shell.width, 1, palette.panelBorder),
      rect(shell.x, shell.y + shell.height - 1, shell.width, 1, palette.panelBorder),
      rect(shell.x, shell.y, 1, shell.height, palette.panelBorder),
      rect(shell.x + shell.width - 1, shell.y, 1, shell.height, palette.panelBorder),
    ].join("");
  }

  function drawFreeElements(items, offsetX, offsetY, palette, protectedRects = []) {
    const occupiedRects = [...protectedRects];
    return items.map((item) => {
      const [x, y, width, height] = item.rect;
      const placed = placeFreeRect({ x: offsetX + x, y: offsetY + y, width, height }, occupiedRects);
      if (!placed) return "";
      occupiedRects.push(placed);
      return rect(placed.x, placed.y, width, height, palette[item.fill] || item.fill);
    }).join("");
  }

  function placeFreeRect(candidate, occupiedRects) {
    const offsets = [
      [0, 0], [0, -6], [0, 6], [-6, 0], [6, 0],
      [-6, -6], [6, -6], [-6, 6], [6, 6],
      [0, -12], [0, 12], [-12, 0], [12, 0],
    ];
    for (const [dx, dy] of offsets) {
      const next = { ...candidate, x: candidate.x + dx, y: candidate.y + dy };
      if (!rectInsideCanvas(next) || occupiedRects.some((occupied) => rectsOverlap(next, occupied))) continue;
      return next;
    }
    return null;
  }

  function protectedPixelRects(spec, layout) {
    const rects = [
      { x: layout.shell.x, y: layout.shell.y, width: layout.shell.width, height: 1 },
      { x: layout.shell.x, y: layout.shell.y + layout.shell.height - 1, width: layout.shell.width, height: 1 },
      { x: layout.shell.x, y: layout.shell.y, width: 1, height: layout.shell.height },
      { x: layout.shell.x + layout.shell.width - 1, y: layout.shell.y, width: 1, height: layout.shell.height },
      textRect(layout.title.x, layout.title.y, spec.title, layout.title.scale),
      textRect(layout.primaryLabel.x, layout.primaryLabel.y, spec.primaryLabel, layout.primaryLabel.scale),
      textRect(layout.primaryValue.x, layout.primaryValue.y, spec.primaryValue, layout.primaryValue.scale),
      textRect(layout.footer.x, layout.footer.y, spec.footer, layout.footer.scale),
      { x: layout.progress.x - 1, y: layout.progress.y - 1, width: layout.progress.width + 2, height: layout.progress.height + 2 },
    ];
    for (const [index, metric] of spec.metrics.entries()) {
      const y = layout.metric.y + index * layout.metric.gapY;
      rects.push(textRect(layout.metric.x, y, metric.label, 1));
      rects.push(textRect(layout.metric.valueX, y, metric.value, 2));
      rects.push({
        x: layout.metric.markerX - 1,
        y: y + layout.metric.markerOffsetY - 1,
        width: layout.metric.markerWidth + 2,
        height: layout.metric.markerHeight + 2,
      });
    }
    return rects;
  }

  function textRect(x, y, text, scale = 1) {
    const size = scale === 2 ? 7 : 4;
    const width = String(text || "").length * size * 0.66;
    return { x: x - 1, y: y - size - 1, width: Math.ceil(width) + 2, height: size + 3 };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function rectInsideCanvas(rect) {
    return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 120 && rect.y + rect.height <= 80;
  }

  function resolvePalette(templatePalette, spec) {
    return {
      ...templatePalette,
      accent: spec.accent,
      background: spec.background,
    };
  }

  function cleanFreeformPrompt(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length < 4) throw new Error("prompt is too short");
    return text.slice(0, 600);
  }

  function freeformTitle(prompt) {
    return "WalnutPi Screen";
  }

  function escapeSvg(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cleanScreenWorkspaceId(value, field) {
    const text = String(value || "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) {
      throw new Error(`${field} must be a simple slug`);
    }
    return text;
  }

  function cleanWorkspaceSourceUrl(value) {
    const text = String(value || "").trim();
    if (!text) throw new Error("sourceUrl is required");
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      throw new Error("sourceUrl must be a valid URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("sourceUrl must use http or https");
    }
    parsed.hash = "";
    return parsed.toString();
  }

  function cleanWorkspaceImportMediaType(value) {
    const mediaType = String(value || "").split(";")[0].trim().toLowerCase();
    if (!(mediaType in WORKSPACE_IMPORT_EXTENSION_BY_MEDIA_TYPE)) {
      throw new Error("source URL must point to a PNG, JPEG, GIF, WebP, MP4, WebM, or MOV file");
    }
    return mediaType;
  }

  function workspaceImportExtension(mediaType, sourceUrl) {
    const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    return WORKSPACE_IMPORT_EXTENSION_ALIASES[extension] || WORKSPACE_IMPORT_EXTENSION_BY_MEDIA_TYPE[mediaType] || ".bin";
  }

  function lvglPreviewExePath() {
    return process.platform === "win32"
      ? path.join(PROJECT_ROOT, "build", "lvgl_app-windows", "walnut-lvgl-preview.exe")
      : path.join(PROJECT_ROOT, "build", "lvgl_app", "walnut-lvgl-preview");
  }

  async function runLvglPreviewBuild() {
    if (process.platform === "win32") {
      const pwsh = findWindowsCommand("pwsh.exe") || findWindowsCommand("powershell.exe") || "pwsh";
      return runLocal(pwsh, ["./scripts/build-lvgl-app.ps1", "-WorkspaceLvgl", "1"], {
        timeoutMs: 120_000,
        outputLimit: 24_000,
      });
    }
    return runLocal("bash", ["./scripts/build-lvgl-app.sh"], {
      timeoutMs: 120_000,
      outputLimit: 24_000,
    });
  }

  function lvglPreviewAdvanceTimes(envelope) {
    const first = envelope?.items?.[0];
    const output = first?.output;
    if (!output || output.type === "static") return [0];
    const frames = Array.isArray(output.frames) ? output.frames : [];
    const duration = frames.reduce((sum, frame) => sum + Math.max(1, Number(frame.durationMs || 100)), 0);
    if (duration <= 0) return [0];
    const count = Math.min(24, Math.max(1, frames.length));
    if (count === 1) return [0];
    return [...new Set(Array.from({ length: count }, (_, index) => (
      Math.floor(index * (duration - 1) / (count - 1))
    )))];
  }

  async function ensurePreviewPng(bmpPath, pngPath) {
    if (process.platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Drawing",
        `$bmp = [System.Drawing.Image]::FromFile('${escapePowershellSingleQuoted(bmpPath)}')`,
        "try {",
        `  $bmp.Save('${escapePowershellSingleQuoted(pngPath)}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        "} finally {",
        "  $bmp.Dispose()",
        "}",
      ].join("\n");
      const pwsh = findWindowsCommand("pwsh.exe") || findWindowsCommand("powershell.exe") || "pwsh";
      const converted = await runLocal(pwsh, ["-NoProfile", "-Command", script], {
        timeoutMs: 30_000,
        outputLimit: 8_000,
      });
      if (!converted.ok) throw new Error(`LVGL preview PNG conversion failed: ${converted.output}`);
      return;
    }
    await copyFile(bmpPath, pngPath);
  }

  function screenWorkspaceAssetUrl(filePath) {
    const resolved = path.resolve(filePath);
    const relative = path.relative(SCREEN_WORKSPACE_ROOT, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("LVGL preview output must stay inside the Screen Workspace");
    }
    return `/api/screen/workspace/assets/${encodeURIComponent(relative.replaceAll("\\", "/"))}`;
  }

  function escapePowershellSingleQuoted(value) {
    return String(value).replace(/'/g, "''");
  }

  function cleanWorkspaceSourcePath(value) {
    const text = String(value || "").trim();
    if (!text) throw new Error("sourcePath is required");
    const resolved = path.resolve(text);
    const relativeToProject = path.relative(PROJECT_ROOT, resolved);
    if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
      throw new Error("sourcePath must stay inside the WalnutPi project");
    }
    return resolved;
  }

  function cleanWorkspaceOutputType(value) {
    const text = String(value || "static").trim();
    if (!WORKSPACE_OUTPUT_TYPES.has(text)) throw new Error("outputType must be static or animated");
    return text;
  }

  function cleanWorkspacePreset(value) {
    const text = String(value || "").trim();
    if (!WORKSPACE_PRESETS.has(text)) throw new Error("preset is not supported");
    return text;
  }

  function cleanWorkspaceAnimation(value) {
    const animation = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      fps: cleanWorkspaceInteger(animation.fps || 6, "animation.fps", 1, 60),
      maxSeconds: cleanWorkspaceInteger(animation.maxSeconds || 8, "animation.maxSeconds", 1, 60),
      maxFrames: cleanWorkspaceInteger(animation.maxFrames || 24, "animation.maxFrames", 1, 80),
    };
  }

  function cleanWorkspacePlaylistMode(value) {
    const text = String(value || "replace").trim();
    if (!WORKSPACE_PLAYLIST_MODES.has(text)) throw new Error("playlistMode must be replace or append");
    return text;
  }

  function cleanWorkspaceInteger(value, field, low, high) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${field} must be a number`);
    const rounded = Math.round(number);
    if (rounded !== number || rounded < low || rounded > high) {
      throw new Error(`${field} must be an integer between ${low} and ${high}`);
    }
    return rounded;
  }



  async function readJsonFile(filePath) {
    return JSON.parse(await readFile(filePath, "utf8"));
  }









  async function lvglDemoArchiveFiles(appId) {
    const registryEntry = (await readLvglAppRegistry()).find((entry) => entry.id === appId);
    if (!registryEntry) throw new Error("unsupported LVGL app");
    const app = walnutLvglAppFromRegistryEntry(registryEntry);
    const tmp = await mkTempDir();
    const manifestPath = path.join(tmp, `${app.id}.json`);
    await writeFile(manifestPath, `${JSON.stringify(app, null, 2)}\n`, "utf8");
    const files = [
      { absolutePath: manifestPath, archivePath: `screen/lvgl-apps/${app.id}/app.json` },
      { absolutePath: LVGL_APP_REGISTRY_PATH, archivePath: "screen/lvgl-apps/registry.json" },
      { absolutePath: path.join(PROJECT_ROOT, "lvgl_app", "src", "preview_main.c"), archivePath: "lvgl_app/src/preview_main.c" },
      { absolutePath: path.join(PROJECT_ROOT, "lvgl_app", "src", "main.c"), archivePath: "lvgl_app/src/main.c" },
      { absolutePath: path.join(PROJECT_ROOT, "lvgl_app", "CMakeLists.txt"), archivePath: "lvgl_app/CMakeLists.txt" },
      { absolutePath: path.join(PROJECT_ROOT, "lvgl_app", "lv_conf.h"), archivePath: "lvgl_app/lv_conf.h" },
      { absolutePath: path.join(PROJECT_ROOT, "scripts", "build-lvgl-app.sh"), archivePath: "scripts/build-lvgl-app.sh" },
    ];
    files.push(...await collectFiles(path.join(PROJECT_ROOT, registryEntry.upstream.source), registryEntry.upstream.source));
    const pngPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${app.id}.png`);
    if (existsSync(pngPath)) files.push({ absolutePath: pngPath, archivePath: `screen/lvgl-apps/${app.id}/preview.png` });
    return files;
  }

  async function readLvglAppRegistry() {
    const registry = await readJsonFile(LVGL_APP_REGISTRY_PATH);
    if (registry.schema !== "walnutpi.lvgl-app-registry.v1" || !Array.isArray(registry.apps)) {
      throw new Error("invalid LVGL app registry");
    }
    return registry.apps.map(cleanLvglAppRegistryEntry);
  }

  function cleanLvglAppRegistryEntry(entry) {
    const upstream = entry?.upstream || {};
    const id = cleanScreenWorkspaceId(entry?.id || "", "appId");
    const name = cleanLvglDemoId(upstream.name || "");
    const source = String(upstream.source || "").replaceAll("\\", "/");
    if (source !== `third_party/lvgl/demos/${name}`) throw new Error("LVGL demo source does not match registry entry");
    return {
      id,
      title: String(entry.title || id).slice(0, 80),
      type: entry.type === "official-demo" ? "official-demo" : "local-lvgl-app",
      upstream: {
        kind: upstream.kind === "lvgl-demo" ? "lvgl-demo" : "local-c-entry",
        name,
        source,
        entry: String(upstream.entry || `lv_demo_${name}`).replace(/[^A-Za-z0-9_]/g, ""),
      },
    };
  }

  function walnutLvglAppFromRegistryEntry(entry) {
    return {
      schema: "walnutpi.lvgl-app.v1",
      id: entry.id,
      title: entry.title,
      type: entry.type,
      upstream: entry.upstream,
      source: entry.upstream.source,
      render: {
        executable: "build/lvgl_app/walnut-lvgl-preview",
        args: ["--demo", entry.upstream.name],
        entry: entry.upstream.entry,
        size: { width: 480, height: 320 },
      },
      package: {
        include: [entry.upstream.source],
      },
    };
  }

  async function collectFiles(root, archiveRoot) {
    const entries = await readdir(root, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const absolutePath = path.join(root, entry.name);
      const archivePath = `${archiveRoot}/${entry.name}`;
      if (entry.isDirectory()) files.push(...await collectFiles(absolutePath, archivePath));
      else if (entry.isFile()) files.push({ absolutePath, archivePath });
    }
    return files;
  }

  async function createTarArchive(files) {
    const tmp = await mkTempDir();
    const listPath = path.join(tmp, "files.txt");
    const archivePath = path.join(tmp, "widget-sync.tar.gz");
    await writeFile(listPath, files.map((file) => file.archivePath).join("\n"), "utf8");
    for (const file of files) {
      const target = path.join(tmp, file.archivePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.absolutePath, target);
    }
    await runLocalCommand("tar", ["-czf", archivePath, "-C", tmp, "-T", listPath], tmp, 60_000);
    return await readFile(archivePath);
  }

  async function mkTempDir() {
    const dir = path.join(tmpdir(), `walnut-widget-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async function runLocalCommand(command, args, cwd, timeoutMs) {
    return await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`${command} timed out`));
      }, timeoutMs);
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr || `${command} failed with ${code}`));
      });
    });
  }





  async function handleScreenWorkspaceSync(req, mode = "remote") {
    const startedAt = Date.now();
    const outcome = await screenWorkspaceSyncWorkflow.run({
      requestJson: () => req.json(),
      mode,
    });
    const latencyMs = Date.now() - startedAt;
    const remoteExecution = outcome.result?.remoteExecution || {};
    await webMetricsLedger.append({
      kind: "screen.workspace.sync",
      operation: "screen.workspace.sync",
      ok: Boolean(outcome.result?.ok),
      status: outcome.status,
      latencyMs,
      mode: outcome.result?.mode,
      stage: outcome.result?.failedStage || "complete",
      buildId: outcome.result?.buildId,
      playlistHash: outcome.result?.playlistHash,
      remoteTransport: remoteExecution.remoteTransport,
      connectionReused: remoteExecution.connectionReused,
      segments: {
        workspaceSyncMs: latencyMs,
        deliveryMs: outcome.result?.segments?.deliveryMs,
        preflightMs: remoteExecution.segments?.preflightMs,
        remoteMs: remoteExecution.segments?.remoteMs,
      },
      error: outcome.result?.ok ? null : outcome.result?.summary || outcome.result?.output,
    });
    return persistScreenSyncResult(outcome.result, outcome.commandResults, outcome.status);
  }



  return {
    handleScreenWorkspacePlaylist,
    handleScreenWorkspaceManifest,
    handleScreenWorkspaceAsset,
    handleScreenWorkspaceImport,
    handleScreenWorkspaceGenerate,
    generateScreenWorkspace,
    handleScreenWorkspaceProcess,
    handleScreenWorkspaceLvglPreview,
    handleLvglDemoPreview,
    handleLvglAppList,
    handleLvglAppDownload,
    handleLvglAppActivate,
    handleScreenWorkspaceSync,
    widgetAppWorkspace,
    __test: {
      compactText,
      compactDisplayText,
      buildScreenGenerationPlan,
      buildFreeformPixelScreenSpec,
    },
  };
}

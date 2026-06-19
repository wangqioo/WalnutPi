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
} from "../scripts/screen-workspace-vocabulary.js";
import { walnutWidgetCatalogFromPixelSpec } from "../scripts/walnut-lvgl-widget-catalog.js";
import { createWidgetAppWorkspace } from "./widget-app-workspace.js";
import { createScreenWorkspaceWorkflows } from "./screen-workspace-workflows.js";

const FreeformGenerateRequestSchema = z.object({
  prompt: z.string().optional(),
  text: z.string().optional(),
  screenId: z.string().optional(),
  sourceId: z.string().optional(),
  title: z.string().optional(),
  outputType: z.enum(["static", "animated"]).optional(),
  preset: z.enum(["fit-cover:480x320", "fit-contain:480x320", "pixel-grid:120x80@4x", "pixel-grid:240x160@2x"]).optional(),
  playlist: z.union([z.literal(false), z.string()]).optional(),
  durationMs: z.number().optional(),
  repeat: z.number().optional(),
  loop: z.boolean().optional(),
});

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
  let lvglPreviewQueue = Promise.resolve();
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
  const IOCCC_ROOT = path.join(SCREEN_WORKSPACE_ROOT, "ioccc-apps");
  const IOCCC_FUN_ENTRIES = [
    ["1984", "mullender", "Mullender"],
    ["1986", "marshall", "Marshall"],
    ["1988", "applin", "Applin"],
    ["1989", "roemer", "Roemer"],
    ["1990", "tbr", "TBR"],
    ["1994", "smr", "SMR"],
    ["1998", "banks", "Banks"],
    ["2000", "natori", "Natori"],
    ["2001", "anonymous", "Anonymous"],
    ["2004", "omoikane", "Omoikane"],
    ["2005", "toledo", "Toledo"],
    ["2006", "birken", "Birken"],
    ["2011", "akari", "Akari"],
    ["2013", "endoh1", "Endoh"],
    ["2014", "endoh1", "Endoh"],
    ["2015", "dogon", "Dogon"],
    ["2018", "endoh1", "Endoh"],
    ["2019", "endoh", "Endoh"],
    ["2020", "endoh1", "Endoh"],
    ["2024", "tompng", "Tompng"],
    ["2025", "endoh1", "Nixie clock"],
    ["2025", "cable", "Pong boot image"],
    ["2025", "ferguson", "Flat earth"],
    ["2025", "tompng", "Tompng"],
  ];

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

  async function handleIocccAppGet(appId) {
    try {
      const app = await readIocccFunApp(appId);
      const sourcePath = firstExistingPath(app.entryDir, ["prog.c", "prog.orig.c", "prog.alt.c"]);
      const readmePath = firstExistingPath(app.entryDir, ["README.md", "README"]);
      return json({
        ok: true,
        app,
        source: sourcePath ? await readFile(sourcePath, "utf8") : "",
        readme: readmePath ? (await readFile(readmePath, "utf8")).slice(0, 1600) : "",
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleIocccAppPage(appId) {
    try {
      const app = await readIocccFunApp(appId);
      const sourcePath = firstExistingPath(app.entryDir, ["prog.c", `${app.name}.c`, `${app.name}.alt.c`, `${app.name}.orig.c`]);
      const readmePath = firstExistingPath(app.entryDir, ["README.md", "README"]);
      const source = sourcePath ? await readFile(sourcePath, "utf8") : "";
      const readme = readmePath ? await readFile(readmePath, "utf8") : "";
      return new Response(iocccAppHtml(app, readme, source), { headers: { "content-type": "text/html; charset=utf-8" } });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleIocccAppAsset(appId, assetPath) {
    try {
      const app = await readIocccFunApp(appId);
      const cleanAssetPath = String(assetPath || "").replaceAll("\\", "/").split("/").filter(Boolean).join("/");
      const filePath = path.join(IOCCC_ROOT, cleanAssetPath);
      const relative = path.relative(IOCCC_ROOT, filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(filePath)) {
        return json({ ok: false, error: "IOCCC asset not found" }, 404);
      }
      return new Response(Bun.file(filePath), { headers: { "content-type": iocccAssetContentType(filePath) } });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }








  async function handleLvglAppDownload(appId) {
    try {
      const app = readLvglDemoApp(appId);
      const archive = await createTarArchive(await lvglDemoArchiveFiles(app));
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

  async function handleIocccAppDownload(appId) {
    try {
      const app = await readIocccFunApp(appId);
      const archive = await createTarArchive(await collectFiles(app.entryDir, `ioccc/${app.year}/${app.name}`));
      return new Response(archive, {
        headers: {
          "content-type": "application/gzip",
          "content-disposition": `attachment; filename="${app.id}.tar.gz"`,
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
      const request = FreeformGenerateRequestSchema.parse(body);
      const prompt = cleanFreeformPrompt(request.prompt || request.text);
      const screenId = cleanScreenWorkspaceId(request.screenId || `agent-freeform-${Date.now()}`, "screenId");
      const sourceId = cleanScreenWorkspaceId(request.sourceId || `${screenId}-source`, "sourceId");
      const plan = buildScreenGenerationPlan(prompt);
      const facts = await collectScreenFacts(plan);
      const template = await readPixelGeneratorTemplate(plan.template);
      let screenSpec = buildFreeformPixelScreenSpec({
        prompt,
        title: request.title || freeformTitle(prompt),
        template,
        plan,
        facts,
      });
      screenSpec = PixelScreenSpecSchema.parse(plan.composition === "fact-card" ? screenSpec : widgetAppWorkspace.repairLvglWidgetLayout(screenSpec));
      const generatedCatalog = plan.widgetApp ? generateWidgetCatalog
        ? await generateWidgetCatalog({
          prompt,
          fallbackCatalog: walnutWidgetCatalogFromPixelSpec({ ...screenSpec, id: screenId }),
        }).catch(() => null)
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
        facts,
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

  async function renderLvglDemoPng(demo) {
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

  function runExclusiveLvglPreview(task) {
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
    return id;
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

  async function writeGeneratedAnimatedScreenOutput({ screenId, sourceId, prompt, screenSpec, template, generatedCatalog, facts }) {
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

  function selectPixelGeneratorTemplate(prompt) {
    const text = String(prompt || "").toLowerCase();
    if (/天气|weather|雨|晴|阴|温度|气温/.test(text) && !/(cpu|负载|wlan|wifi|wi-fi|ip)/i.test(text)) return "pixel-weather";
    if (/公告|消息|留言|提醒|倒计时|message|notice|quote/.test(text)) return "pixel-message";
    return "pixel-ops";
  }

  function buildScreenGenerationPlan(prompt) {
    const template = selectPixelGeneratorTemplate(prompt);
    const needs = [];
    const weatherLocation = extractWeatherCity(prompt);
    if (weatherLocation) {
      needs.push({ kind: "weather.current", location: weatherLocation });
    }
    return {
      schema: "walnutpi.screen-generation-plan.v1",
      prompt,
      template,
      needs,
      composition: needs.length ? "fact-card" : "prompt-template",
      widgetApp: needs.length ? false : true,
    };
  }

  async function collectScreenFacts(plan) {
    const cards = [];
    const facts = [];
    for (const need of plan.needs) {
      if (need.kind === "weather.current") {
        const fact = await collectWeatherFact(need);
        facts.push(fact);
        cards.push(weatherFactCard(fact));
      }
    }
    return {
      schema: "walnutpi.screen-fact-pack.v1",
      facts,
      cards,
      widgetApp: plan.widgetApp,
    };
  }

  async function collectWeatherFact(need) {
    try {
      const weather = await fetchCurrentWeather(need.location);
      return {
        kind: "weather.current",
        source: "wttr.in",
        ...weather,
        location: need.location,
        station: weather.city,
      };
    } catch (error) {
      return {
        kind: "weather.current",
        source: "fallback",
        location: need.location,
        condition: "UNKNOWN",
        temperatureC: null,
        humidity: null,
        windKph: null,
        precipMm: null,
        observedAt: new Date().toISOString(),
        advice: "天气查询失败",
        error: error.message,
      };
    }
  }

  function extractWeatherCity(prompt) {
    const text = String(prompt || "");
    const match = text.match(/(?:把|查询|获取|显示|生成|做(?:一个)?|看)?\s*([\p{Script=Han}A-Za-z]{2,24})(?:的)?(?:今天|现在|当前|实时)?(?:天气|气温|温度)/u)
      || text.match(/(?:天气|气温|温度).{0,8}([\p{Script=Han}A-Za-z]{2,24})/u);
    return match?.[1]?.replace(/^(当前|实时|今天|现在|一个|小屏|核桃派)+/u, "") || "";
  }

  async function fetchCurrentWeather(city) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "WalnutPi-Agent-Console/1.0" },
      });
      if (!response.ok) throw new Error(`weather HTTP ${response.status}`);
      const data = await response.json();
      const current = data.current_condition?.[0] || {};
      const area = data.nearest_area?.[0] || {};
      const condition = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || "UNKNOWN";
      const temperatureC = numberOrNull(current.temp_C);
      const humidity = numberOrNull(current.humidity);
      const windKph = numberOrNull(current.windspeedKmph);
      const precipMm = numberOrNull(current.precipMM);
      return {
        city: area.areaName?.[0]?.value || city,
        country: area.country?.[0]?.value || "",
        condition,
        temperatureC,
        humidity,
        windKph,
        precipMm,
        observedAt: new Date().toISOString(),
        advice: weatherAdvice({ condition, precipMm, temperatureC }),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function weatherAdvice({ condition, precipMm, temperatureC }) {
    const text = String(condition || "");
    if ((precipMm || 0) > 0 || /雨|rain|shower/i.test(text)) return "带伞出门";
    if (temperatureC !== null && temperatureC >= 32) return "注意防晒";
    if (temperatureC !== null && temperatureC <= 8) return "注意保暖";
    return "适合出行";
  }

  function buildFreeformPixelScreenSpec({ prompt, title, template, plan, facts }) {
    const text = prompt.toLowerCase();
    const defaults = template.defaults;
    const temp = text.includes("温") || text.includes("temp") ? "42.6C" : "OK";
    const cpu = text.includes("cpu") || text.includes("负载") ? "31%" : "LIVE";
    const ip = text.includes("ip") || text.includes("wlan") || text.includes("wi-fi") || text.includes("wifi") ? "192.168.1.24" : "ready";
    const power = text.includes("电") || text.includes("battery") ? "86%" : "8.0S";
    const metrics = defaults.metrics.map((metric) => ({ ...metric }));
    let primaryLabel = ip === "ready" ? "DEVICE" : "WLAN0 / IP";
    let primaryValue = ip;
    let footer = text.includes("walnutpi live") ? "WalnutPi live" : defaults.footer;
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
      primaryValue = compactDisplayText(screenMessageText(prompt), template.layout.primaryValue.maxChars);
      footer = defaults.footer;
    } else {
      metrics[0].value = cpu;
      metrics[1].value = temp;
      metrics[2].value = power;
    }
    return PixelScreenSpecSchema.parse({
      schema: "walnutpi.pixelScreenSpec.v1",
      template: template.id,
      logicalWidth: template.canvas.logicalWidth,
      logicalHeight: template.canvas.logicalHeight,
      scale: template.canvas.scale,
      title: compactText(title, template.layout.title.maxChars),
      background: text.includes("深色") || text.includes("dark") ? defaults.darkBackground : defaults.lightBackground,
      accent: text.includes("警") || text.includes("红") ? template.palette.red : defaults.accent,
      progress: text.includes("电") || text.includes("battery") ? defaults.batteryProgress : defaults.progress,
      primaryLabel,
      primaryValue,
      footer,
      metrics,
      ...(card ? { elements: factCardPixelElements(card) } : {}),
    });
  }

  function weatherFactCard(fact) {
    const temp = fact.temperatureC === null || fact.temperatureC === undefined ? "--C" : `${Math.round(fact.temperatureC)}C`;
    const humidity = fact.humidity === null || fact.humidity === undefined ? "--%" : `${Math.round(fact.humidity)}%`;
    const wind = fact.windKph === null || fact.windKph === undefined ? "--K" : `${Math.round(fact.windKph)}KPH`;
    const rain = fact.precipMm === null || fact.precipMm === undefined ? "--MM" : `${fact.precipMm}MM`;
    return {
      kind: "fact-card",
      sourceKind: fact.kind,
      title: compactDisplayText(fact.location || "WEATHER", 12),
      value: temp,
      subtitle: compactDisplayText(fact.condition || "UNKNOWN", 14),
      footer: compactDisplayText(fact.advice || "WEATHER", 14),
      items: [
        { label: "HUM", value: humidity, bar: Math.max(0, Math.min(34, Math.round(Number(fact.humidity || 0) / 3))) },
        { label: "WIND", value: wind },
        { label: "RAIN", value: rain, bar: Math.max(0, Math.min(34, Math.round(Number(fact.precipMm || 0) * 6))) },
      ],
    };
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

  function screenMessageText(prompt) {
    const text = String(prompt || "").trim();
    const afterColon = text.match(/[：:]\s*([^。.!！?？；;]+)/);
    if (afterColon?.[1]?.trim()) return afterColon[1].trim();
    return text
      .replace(/^(?:自由生成|生成|创建|设计|做|做个|来一个)?\s*(?:一个|一张)?\s*(?:像素风)?\s*(?:480x320)?\s*(?:小屏|屏幕|公告|消息|提醒)?[：:，,\s]*/i, "")
      .replace(/[。.!！?？；;].*$/g, "")
      .trim() || "HELLO";
  }

  function cleanAiPixelSceneSpec(spec) {
    if (!Array.isArray(spec.elements)) return spec;
    return {
      ...spec,
      title: compactText(spec.title, 12),
      background: /^#[0-9a-fA-F]{6}$/.test(String(spec.background || "")) ? spec.background : "#101412",
      accent: /^#[0-9a-fA-F]{6}$/.test(String(spec.accent || "")) ? spec.accent : "#78c58a",
      elements: spec.elements.slice(0, 24).map((element) => ({
        ...element,
        x: Math.max(0, Math.min(119, Math.round(Number(element.x) || 0))),
        y: Math.max(0, Math.min(79, Math.round(Number(element.y) || 0))),
        width: element.width === undefined ? undefined : Math.max(1, Math.min(120, Math.round(Number(element.width) || 1))),
        height: element.height === undefined ? undefined : Math.max(1, Math.min(80, Math.round(Number(element.height) || 1))),
        scale: element.scale === 2 ? 2 : 1,
      })),
    };
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
    const scale = element.scale || 1;
    const box = element.type === "text"
      ? textRect(element.x, element.y, element.text || "", scale)
      : { x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 };
    const placed = element.required ? (rectInsideCanvas(box) && !occupied.some((item) => rectsOverlap(box, item)) ? box : null) : placeFreeRect(box, occupied);
    if (!placed) return "";
    occupied.push(placed);
    if (element.type === "text") {
      return pxText(placed.x + 1, placed.y + (scale === 2 ? 8 : 5), element.text || "", palette[element.fill || "text"] || element.fill || palette.text, scale);
    }
    return rect(placed.x, placed.y, placed.width, placed.height, palette[element.fill || "accent"] || element.fill || palette.accent);
  }

  function compactText(text, maxChars) {
    return String(text || "WALNUT").toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, maxChars);
  }

  function compactDisplayText(text, maxChars) {
    return Array.from(String(text || "HELLO").replace(/\s+/g, " ").trim()).slice(0, maxChars).join("");
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
    if (/天气|weather|晴|雨|阴/i.test(prompt)) return "Weather";
    if (/公告|消息|提醒|message|notice/i.test(prompt)) return "Message";
    if (/ops/i.test(prompt)) return "WalnutPi Ops";
    if (/live/i.test(prompt)) return "WalnutPi live";
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
    const allowed = new Set([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ]);
    if (!allowed.has(mediaType)) {
      throw new Error("source URL must point to a PNG, JPEG, GIF, WebP, MP4, WebM, or MOV file");
    }
    return mediaType;
  }

  function workspaceImportExtension(mediaType, sourceUrl) {
    const byType = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "video/webm": ".webm",
      "video/quicktime": ".mov",
    };
    const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm", ".mov"].includes(extension)) {
      return extension === ".jpeg" ? ".jpg" : extension;
    }
    return byType[mediaType] || ".bin";
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
    if (text !== "static" && text !== "animated") throw new Error("outputType must be static or animated");
    return text;
  }

  function cleanWorkspacePreset(value) {
    const text = String(value || "").trim();
    const allowed = new Set([
      "fit-cover:480x320",
      "fit-contain:480x320",
      "pixel-grid:120x80@4x",
      "pixel-grid:240x160@2x",
    ]);
    if (!allowed.has(text)) throw new Error("preset is not supported");
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
    if (text !== "replace" && text !== "append") throw new Error("playlistMode must be replace or append");
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

  async function readIocccFunApps() {
    const apps = [];
    for (const [year, name, title] of IOCCC_FUN_ENTRIES) {
      const entryDir = path.join(IOCCC_ROOT, year, name);
      if (!existsSync(entryDir)) continue;
      const app = iocccFunApp(year, name, title, entryDir);
      apps.push(stripLocalIocccPath(app));
    }
    return apps;
  }


  async function readIocccFunApp(appId) {
    const app = IOCCC_FUN_ENTRIES
      .map(([year, name, title]) => iocccFunApp(year, name, title, path.join(IOCCC_ROOT, year, name)))
      .find((entry) => entry.id === appId);
    if (!app || !existsSync(app.entryDir)) throw new Error("unsupported IOCCC app");
    const relative = path.relative(IOCCC_ROOT, app.entryDir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("invalid IOCCC app path");
    return app;
  }

  function iocccFunApp(year, name, title, entryDir) {
    const id = `ioccc-${year}-${name}`.replace(/[^a-zA-Z0-9_-]/g, "-");
    return {
      schema: "walnutpi.ioccc-app.v1",
      id,
      title: `${year} ${title}`,
      type: "ioccc-c-toy",
      year,
      name,
      entryDir,
      source: path.relative(PROJECT_ROOT, entryDir).replaceAll("\\", "/"),
      page: `/api/screen/ioccc-apps/${encodeURIComponent(id)}/page`,
      download: `/api/screen/ioccc-apps/${encodeURIComponent(id)}/download`,
    };
  }

  function stripLocalIocccPath(app) {
    const { entryDir, ...publicApp } = app;
    return publicApp;
  }

  function firstExistingPath(root, names) {
    for (const name of names) {
      const filePath = path.join(root, name);
      if (existsSync(filePath)) return filePath;
    }
    return "";
  }

  function iocccAppHtml(app, readme, source) {
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(app.title)}</title>
    <style>
      body { margin: 0 auto; max-width: 960px; padding: 24px; background: #070808; color: #f4f1e8; font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.55; }
      a { color: #ff9f0a; }
      .meta { color: #a9aaa6; }
      pre { overflow: auto; padding: 16px; background: #111314; border: 1px solid rgba(240,236,226,.14); }
      code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    </style>
  </head>
  <body>
    <p><a href="/apps.html">返回 App Gallery</a></p>
    <h1>${escapeHtml(app.title)}</h1>
    <p class="meta">IOCCC ${escapeHtml(app.year)} / ${escapeHtml(app.name)}</p>
    <h2>README</h2>
    <pre><code>${escapeHtml(readme || "No README found.")}</code></pre>
    <h2>Source</h2>
    <pre><code>${escapeHtml(source || "No source file found.")}</code></pre>
  </body>
</html>`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function iocccAssetContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") return "text/html; charset=utf-8";
    if (ext === ".css") return "text/css; charset=utf-8";
    if (ext === ".js") return "text/javascript; charset=utf-8";
    if (ext === ".md" || ext === ".txt" || ext === ".c" || ext === ".h" || ext === ".sh") return "text/plain; charset=utf-8";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".gif") return "image/gif";
    if (ext === ".svg") return "image/svg+xml";
    return "application/octet-stream";
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
    return await new Promise((resolve, reject) => {
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
      fallbackRemoteTransport: remoteExecution.fallbackRemoteTransport,
      fallbackConnectionReused: remoteExecution.fallbackConnectionReused,
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
    handleIocccAppGet,
    handleIocccAppPage,
    handleIocccAppAsset,
    handleIocccAppDownload,
    handleScreenWorkspaceSync,
    widgetAppWorkspace,
  };
}

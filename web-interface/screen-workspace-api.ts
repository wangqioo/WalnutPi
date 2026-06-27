import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  animatedOutputSha256,
  rgbaFrameSha256FromImage,
  rgb565FrameSha256FromImage,
  staticOutputFileSha256,
  validateScreenManifestV2,
} from "../scripts/screen-workspace-vocabulary.ts";
import { createWidgetAppWorkspace } from "./widget-app-workspace.ts";
import { createScreenWorkspaceWorkflows } from "./screen-workspace-workflows.ts";

import {
  type FreeformGenerateRequest,
  FreeformGenerateRequestSchema,
  buildFreeformTerminalPrintSource,
  buildWallpaperGenerationPlan,
  cleanFreeformPrompt,
  collectWallpaperFacts,
  compactDisplayText,
  compactText,
  freeformTitle,
  readTerminalPrintTemplate,
} from "./terminal-print-screen-source.ts";

export function createScreenWorkspaceApi({
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow,
  readJsonRequest,
  json,
  workspaceErrorResponse,
  webMetricsLedger,
  wallpaperRenderer,
  terminalPrintRenderer,
  widgetAppRenderer,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
  runtimeAssetRenderer,
  persistScreenSyncResult,
  runRemote,
  runRemoteWithInput,
  shellQuote,
  lvglRuntimePreviewRenderer,
  sha256,
  projectRoot,
  screenWorkspaceRoot,
  screenSourceImportMaxBytes,
  generateWidgetCatalog,
}) {
  if (!wallpaperRenderer || typeof wallpaperRenderer.renderWallpaper !== "function") {
    throw new Error("Screen Workspace API requires a WallpaperRenderer");
  }
  if (!terminalPrintRenderer || typeof terminalPrintRenderer.writePromptSource !== "function" || typeof terminalPrintRenderer.writeAnimatedScreenOutput !== "function") {
    throw new Error("Screen Workspace API requires a TerminalPrintRenderer");
  }
  if (!widgetAppRenderer || typeof widgetAppRenderer.writeFromCatalog !== "function" || typeof widgetAppRenderer.writeRuntimeFiles !== "function") {
    throw new Error("Screen Workspace API requires a WidgetAppRenderer");
  }
  if (!runtimeAssetRenderer || typeof runtimeAssetRenderer.renderRuntimeAssets !== "function") {
    throw new Error("Screen Workspace API requires a RuntimeAssetRenderer");
  }

  const PROJECT_ROOT = projectRoot;
  const SCREEN_WORKSPACE_ROOT = screenWorkspaceRoot;
  const SCREEN_SOURCE_IMPORT_MAX_BYTES = screenSourceImportMaxBytes;
  const TERMINAL_PRINT_TEMPLATES_ROOT = path.join(SCREEN_WORKSPACE_ROOT, "generators");
  const LVGL_APP_REGISTRY_PATH = path.join(SCREEN_WORKSPACE_ROOT, "lvgl-apps", "registry.json");
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
  ]);
  const WORKSPACE_PLAYLIST_MODES = new Set(["replace", "append"]);
  let lvglPreviewQueue: Promise<any> = Promise.resolve();
  const widgetAppWorkspace = createWidgetAppWorkspace({
    projectRoot,
    screenWorkspaceRoot,
    readJsonRequest,
    runRemote,
    runRemoteWithInput,
    shellQuote,
    json,
    workspaceErrorResponse,
    webMetricsLedger,
    generateWidgetCatalog,
    lvglRuntimePreviewRenderer,
    widgetAppRenderer,
  });
  const screenWorkspaceWorkflows = createScreenWorkspaceWorkflows({
    workspaceRoot: SCREEN_WORKSPACE_ROOT,
    readSourceAsset: readWorkspaceSourceAsset,
    wallpaperRenderer,
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
      const preview = await runExclusiveLvglPreview(() => lvglRuntimePreviewRenderer.renderDemo({
        demo: registryEntry.upstream.name,
        stem: `lvgl-demo-${registryEntry.upstream.name}`,
      }));
      const result = await wallpaperRenderer.renderWallpaper({
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
      const plan = buildWallpaperGenerationPlan(prompt, { templateId: request.templateId });
      const facts = await collectWallpaperFacts(plan);
      const template = await readTerminalPrintTemplate(plan.template, { generatorsRoot: TERMINAL_PRINT_TEMPLATES_ROOT });
      const screenSpec = buildFreeformTerminalPrintSource({
        prompt,
        title: request.title || freeformTitle(prompt),
        template,
        plan,
        facts,
      });
      if (cleanWorkspaceOutputType(request.outputType || "static") === "animated") {
        const result = await terminalPrintRenderer.writeAnimatedScreenOutput({
          workspaceRoot: SCREEN_WORKSPACE_ROOT,
          screenId,
          sourceId,
          prompt,
          screenSpec,
          template,
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
          facts,
          source: result.source,
          manifest: result.manifest,
          output: result.output,
          playlist: playlist?.playlist || null,
          },
        };
      }
      const source = await terminalPrintRenderer.writePromptSource({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        sourceId,
        prompt,
        screenSpec,
        template,
      });
      const result = await wallpaperRenderer.renderWallpaper({
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
      if (req) await readJsonRequest(req).catch(() => ({}));
      const envelope = await screenWorkspaceStore.readPlaylistEnvelope("default");
      const runtimeAssets = await runtimeAssetRenderer.renderRuntimeAssets({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        playlistId: "default",
      });
      const preview = await lvglRuntimePreviewRenderer.renderRuntime({
        runtimeIndexPath: runtimeAssets.indexPath,
        stemPrefix: "playlist-lvgl",
        advanceMs: lvglPreviewAdvanceTimes(envelope),
      });

      return json({
        ok: true,
        schema: "walnutpi.screenWorkspaceLvglPreview.v1",
        mode: "playlist",
        playlistHash: envelope.playlistHash,
        runtimeIndex: screenWorkspaceAssetUrl(runtimeAssets.indexPath),
        itemCount: envelope.items.length,
        frameCount: preview.frames.length,
        frames: preview.frames,
        buildOutput: preview.buildOutput,
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
      const preview: any = await runExclusiveLvglPreview(() => lvglRuntimePreviewRenderer.renderDemo({
        demo,
        stem: `lvgl-demo-${demo}`,
      }));
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

  function runExclusiveLvglPreview(task: () => Promise<any>): Promise<any> {
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

  function screenWorkspaceAssetUrl(filePath) {
    const resolved = path.resolve(filePath);
    const relative = path.relative(SCREEN_WORKSPACE_ROOT, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("LVGL preview output must stay inside the Screen Workspace");
    }
    return `/api/screen/workspace/assets/${encodeURIComponent(relative.replaceAll("\\", "/"))}`;
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
    const pngPath = path.join(SCREEN_WORKSPACE_ROOT, "outputs", "lvgl-preview", `${app.id}.png`);
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
      buildWallpaperGenerationPlan,
      buildFreeformTerminalPrintSource,
    },
  };
}

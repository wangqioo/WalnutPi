import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
  findWindowsCommand,
  sha256,
  projectRoot,
  screenWorkspaceRoot,
  screenSourceImportMaxBytes,
  screenLvglPreviewOutputDir,
}) {
  const PROJECT_ROOT = projectRoot;
  const SCREEN_WORKSPACE_ROOT = screenWorkspaceRoot;
  const SCREEN_SOURCE_IMPORT_MAX_BYTES = screenSourceImportMaxBytes;
  const SCREEN_LVGL_PREVIEW_OUTPUT_DIR = screenLvglPreviewOutputDir;

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
      const sourceAssetRecord = body.sourceAssetId
        ? await readWorkspaceSourceAsset(body.sourceAssetId)
        : null;
      const sourcePath = sourceAssetRecord?.originalPath || cleanWorkspaceSourcePath(body.sourcePath || body.path);
      const screenId = cleanScreenWorkspaceId(body.screenId || body.id, "screenId");
      const sourceId = body.sourceId
        ? cleanScreenWorkspaceId(body.sourceId, "sourceId")
        : sourceAssetRecord?.id || `${screenId}-source`;
      const outputType = cleanWorkspaceOutputType(body.outputType || body.type || "static");
      const preset = cleanWorkspacePreset(body.preset || "fit-cover:480x320");
      const animation = cleanWorkspaceAnimation(body.animation || {});
      const result = await processSourceAssetToScreenOutput({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        plan: {
          id: body.planId,
          screenId,
          title: body.title,
          description: body.description,
          animation,
        },
        sourceAsset: {
          id: sourceId,
          path: sourcePath,
          selected: true,
          mediaType: body.mediaType || sourceAssetRecord?.mediaType,
          license: body.license || sourceAssetRecord?.license || "unknown-personal-sync",
          origin: body.origin || sourceAssetRecord?.origin || null,
        },
        outputType,
        preset,
      });

      let playlist = null;
      if (body.playlist !== false) {
        const playlistMode = cleanWorkspacePlaylistMode(body.playlistMode || body.playlistAction || "replace");
        const writePlaylist = playlistMode === "append" ? appendScreenPlaylistItem : writeDefaultScreenPlaylist;
        playlist = await writePlaylist({
          workspaceRoot: SCREEN_WORKSPACE_ROOT,
          playlistId: typeof body.playlist === "string" ? body.playlist : "default",
          manifestId: result.screenId,
          durationMs: cleanWorkspaceInteger(body.durationMs || 8000, "durationMs", 1, 86400000),
          repeat: cleanWorkspaceInteger(body.repeat || 1, "repeat", 1, 1000),
          loop: body.loop === undefined ? true : Boolean(body.loop),
        });
      }

      await webMetricsLedger.append({
        kind: "screen.workspace.process",
        operation: "screen.workspace.process",
        ok: true,
        outputType: result.output.type,
        screenId: result.screenId,
        preset,
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

  async function handleScreenWorkspaceLvglPreview() {
    try {
      const envelope = await screenWorkspaceStore.readPlaylistEnvelope("default");
      await mkdir(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, { recursive: true });
      const runtimeAssets = await generateLvglScreenWorkspaceRuntimeAssets({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        playlistId: "default",
      });

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

      const advanceMs = lvglPreviewAdvanceTimes(envelope);
      const frames = [];
      for (const ms of advanceMs) {
        const stem = `lvgl-${String(ms).padStart(5, "0")}ms`;
        const bmpPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.bmp`);
        const pngPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.png`);
        const rendered = await runLocal(exePath, [bmpPath, "--advance-ms", String(ms), "--runtime", runtimeAssets.indexPath], {
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
        playlistHash: envelope.playlistHash,
        runtimeIndex: screenWorkspaceAssetUrl(runtimeAssets.indexPath),
        itemCount: envelope.items.length,
        frameCount: frames.length,
        frames,
        buildOutput: build.output,
      });
    } catch (error) {
      return json({
        ok: false,
        error: "LVGL preview failed",
        output: error.message,
      }, 500);
    }
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

  async function handleScreenWorkspaceSync(req, mode = "remote") {
    const startedAt = Date.now();
    const outcome = await screenWorkspaceSyncWorkflow.run({
      requestJson: () => req.json(),
      mode,
    });
    await webMetricsLedger.append({
      kind: "screen.workspace.sync",
      operation: "screen.workspace.sync",
      ok: Boolean(outcome.result?.ok),
      status: outcome.status,
      latencyMs: Date.now() - startedAt,
      mode: outcome.result?.mode,
      stage: outcome.result?.failedStage || "complete",
      buildId: outcome.result?.buildId,
      playlistHash: outcome.result?.playlistHash,
      error: outcome.result?.ok ? null : outcome.result?.summary || outcome.result?.output,
    });
    return persistScreenSyncResult(outcome.result, outcome.commandResults, outcome.status);
  }



  return {
    handleScreenWorkspacePlaylist,
    handleScreenWorkspaceManifest,
    handleScreenWorkspaceAsset,
    handleScreenWorkspaceImport,
    handleScreenWorkspaceProcess,
    handleScreenWorkspaceLvglPreview,
    handleScreenWorkspaceSync,
  };
}
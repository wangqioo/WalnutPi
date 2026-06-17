import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";

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
  const PIXEL_GENERATORS_ROOT = path.join(SCREEN_WORKSPACE_ROOT, "generators");
  const pixelTemplateCache = new Map();

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

  async function handleScreenWorkspaceGenerate(req) {
    const startedAt = Date.now();
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    try {
      const request = FreeformGenerateRequestSchema.parse(body);
      const prompt = cleanFreeformPrompt(request.prompt || request.text);
      const screenId = cleanScreenWorkspaceId(request.screenId || `agent-freeform-${Date.now()}`, "screenId");
      const sourceId = cleanScreenWorkspaceId(request.sourceId || `${screenId}-source`, "sourceId");
      const template = await readPixelGeneratorTemplate(selectPixelGeneratorTemplate(prompt));
      const screenSpec = buildFreeformPixelScreenSpec({
        prompt,
        title: request.title || freeformTitle(prompt),
        template,
      });
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

      return json({
        ok: true,
        schema: "walnutpi.screenWorkspaceGenerateResult.v1",
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        screenId: result.screenId,
        screenSpec,
        source,
        manifest: result.manifest,
        output: result.output,
        playlist: playlist?.playlist || null,
      });
    } catch (error) {
      await webMetricsLedger.append({
        kind: "screen.workspace.generate",
        operation: "screen.workspace.generate",
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error.message,
      });
      return json({
        ok: false,
        error: "screen workspace freeform generation failed",
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

  async function readPixelGeneratorTemplate(templateId) {
    const cleanId = cleanScreenWorkspaceId(templateId, "templateId");
    if (pixelTemplateCache.has(cleanId)) return pixelTemplateCache.get(cleanId);
    const templatePath = path.join(PIXEL_GENERATORS_ROOT, `${cleanId}.json`);
    const relativeToGenerators = path.relative(PIXEL_GENERATORS_ROOT, templatePath);
    if (relativeToGenerators.startsWith("..") || path.isAbsolute(relativeToGenerators)) {
      throw new Error("templateId must stay inside screen generators");
    }
    const parsed = PixelGeneratorTemplateSchema.parse(JSON.parse(await readFile(templatePath, "utf8")));
    pixelTemplateCache.set(cleanId, parsed);
    return parsed;
  }

  function selectPixelGeneratorTemplate(prompt) {
    const text = String(prompt || "").toLowerCase();
    if (/天气|weather|雨|晴|阴|温度|气温/.test(text) && !/(cpu|负载|wlan|wifi|wi-fi|ip)/i.test(text)) return "pixel-weather";
    if (/公告|消息|留言|提醒|倒计时|message|notice|quote/.test(text)) return "pixel-message";
    return "pixel-ops";
  }

  function buildFreeformPixelScreenSpec({ prompt, title, template }) {
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
    if (template.id === "pixel-weather") {
      primaryLabel = "WEATHER";
      primaryValue = text.includes("晴") || text.includes("sun") ? "SUN 26C" : (text.includes("雨") || text.includes("rain") ? "RAIN 24C" : "SKY 24C");
      footer = "LOCAL SKY";
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
    });
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
      drawSprite(template.sprites.board, 0, 0, palette),
      pxText(layout.primaryLabel.x, layout.primaryLabel.y, spec.primaryLabel, palette.muted, layout.primaryLabel.scale),
      pxText(layout.primaryValue.x, layout.primaryValue.y, spec.primaryValue, palette.cyan, layout.primaryValue.scale),
      pxText(layout.footer.x, layout.footer.y, spec.footer, palette.muted2, layout.footer.scale),
      drawSprite(template.sprites.wifi, layout.wifi.x, layout.wifi.y, palette),
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

  function drawSprite(items, offsetX, offsetY, palette) {
    return items.map((item) => {
      const [x, y, width, height] = item.rect;
      return rect(offsetX + x, offsetY + y, width, height, palette[item.fill] || item.fill);
    }).join("");
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
    handleScreenWorkspaceProcess,
    handleScreenWorkspaceLvglPreview,
    handleScreenWorkspaceSync,
  };
}

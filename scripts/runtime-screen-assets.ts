import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  type ScreenManifestV2,
  type ScreenPlaylistItemV1,
  rgb565BufferFromRgba,
  screenManifestV2EnvelopeHash,
  screenPlaylistV1Hash,
  validateScreenManifestV2,
  validateScreenPlaylistV1,
} from "./screen-workspace-vocabulary.ts";
import {
  runtimeWidgetsFromWalnutCatalog,
  validateWalnutLvglWidgetCatalog,
} from "./walnut-lvgl-widget-catalog.ts";

export const RUNTIME_WIDTH = 480;
export const RUNTIME_HEIGHT = 320;
export const RUNTIME_STRIDE = RUNTIME_WIDTH * 2;

type JsonRecord = Record<string, any>;
type RuntimeFrame = {
  rgb565: Buffer;
  fileSha256: string;
  rgbaPixelSha256: string;
  rgb565PixelSha256: string;
  durationMs: number;
};
type RuntimeItem = {
  manifestId: string;
  manifestHash: string;
  outputType: string;
  firstFrame: number;
  frameCount: number;
  durationMs: number;
  repeat: number;
  transition: string;
};
type RuntimeWidget = {
  type: string;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  value: number;
  color: string;
  action?: string;
};
type RuntimeScreenAssets = {
  playlistId: string;
  playlistHash: string;
  loop: boolean;
  frames: RuntimeFrame[];
  items: RuntimeItem[];
  widgets: RuntimeWidget[];
};

export async function buildRuntimeScreenAssets({ workspace, playlistId }: { workspace: string; playlistId: string }): Promise<RuntimeScreenAssets> {
  const playlistPath = path.join(workspace, "playlists", `${playlistId}.json`);
  const playlist = JSON.parse(await readFile(playlistPath, "utf8"));
  const normalizedPlaylist = await validateScreenPlaylistV1(playlist, {
    playlistPath,
    workspaceRoot: workspace,
  });

  const frames: RuntimeFrame[] = [];
  const items: RuntimeItem[] = [];
  const widgets: RuntimeWidget[] = [];
  for (const [index, item] of normalizedPlaylist.items.entries()) {
    const manifestPath = resolveWorkspaceReference(item.manifest, path.dirname(playlistPath), workspace, `items[${index}].manifest`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const normalizedManifest = await validateScreenManifestV2(manifest, {
      manifestPath,
      workspaceRoot: workspace,
    });
    const firstFrame = frames.length;
    const outputFrames = await imageFramesForManifest({
      manifest: normalizedManifest,
      manifestPath,
      item,
      workspaceRoot: workspace,
    });
    widgets.push(...await widgetsForManifest({
      manifest: normalizedManifest,
      manifestPath,
      workspaceRoot: workspace,
    }));
    frames.push(...outputFrames);
    items.push({
      manifestId: normalizedManifest.id,
      manifestHash: screenManifestV2EnvelopeHash(normalizedManifest),
      outputType: normalizedManifest.output.type,
      firstFrame,
      frameCount: outputFrames.length,
      durationMs: item.durationMs,
      repeat: item.repeat,
      transition: item.transition,
    });
  }

  return {
    playlistId: normalizedPlaylist.id,
    playlistHash: screenPlaylistV1Hash(normalizedPlaylist),
    loop: normalizedPlaylist.loop,
    frames,
    items,
    widgets,
  };
}

export async function writeRuntimeScreenAssets(config: RuntimeScreenAssets, { runtimeDir }: { runtimeDir: string }): Promise<{ indexPath: string; framePaths: string[] }> {
  const framesDir = path.join(runtimeDir, "frames");
  await mkdir(framesDir, { recursive: true });
  const lines = runtimeIndexLines(config);
  const framePaths = [];
  for (const [index, frame] of config.frames.entries()) {
    const fileName = `frame-${String(index).padStart(3, "0")}.rgb565`;
    const framePath = path.join(framesDir, fileName);
    await writeFile(framePath, frame.rgb565);
    framePaths.push(framePath);
  }
  const indexPath = path.join(runtimeDir, "default.txt");
  await writeFile(indexPath, `${lines.join("\n")}\n`, "utf8");
  return { indexPath, framePaths };
}

export function runtimeIndexLines(config: RuntimeScreenAssets): string[] {
  const lines = [
    "schema walnutpi.lvgl-runtime-assets.v1",
    `playlistId ${field(config.playlistId)}`,
    `playlistHash ${field(config.playlistHash)}`,
    `loop ${config.loop ? 1 : 0}`,
    `width ${RUNTIME_WIDTH}`,
    `height ${RUNTIME_HEIGHT}`,
    `stride ${RUNTIME_STRIDE}`,
    `frameCount ${config.frames.length}`,
    `itemCount ${config.items.length}`,
  ];
  for (const widget of config.widgets) {
    lines.push([
      "widget",
      field(widget.type),
      field(widget.id),
      widget.x,
      widget.y,
      widget.w,
      widget.h,
      field(widget.text || "-"),
      widget.value || 0,
      field(widget.color || "ffffff"),
    ].join(" "));
  }
  for (const [index, frame] of config.frames.entries()) {
    const fileName = `frame-${String(index).padStart(3, "0")}.rgb565`;
    lines.push([
      "frame",
      index,
      frame.durationMs,
      field(frame.fileSha256),
      field(frame.rgbaPixelSha256),
      field(frame.rgb565PixelSha256),
      field(`frames/${fileName}`),
    ].join(" "));
  }
  for (const [index, item] of config.items.entries()) {
    lines.push([
      "item",
      index,
      field(item.manifestId),
      field(item.manifestHash),
      field(item.outputType),
      item.firstFrame,
      item.frameCount,
      item.durationMs,
      item.repeat,
      field(item.transition),
    ].join(" "));
  }
  return lines;
}

async function widgetsForManifest({ manifest, manifestPath, workspaceRoot }: { manifest: ScreenManifestV2; manifestPath: string; workspaceRoot: string }): Promise<RuntimeWidget[]> {
  const widgetApp = manifest.provenance?.widgetApp;
  if (widgetApp?.catalog) {
    const catalogPath = resolveWorkspaceReference(widgetApp.catalog, path.dirname(manifestPath), workspaceRoot, "provenance.widgetApp.catalog");
    const catalog = validateWalnutLvglWidgetCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
    return runtimeWidgetsFromWalnutCatalog(catalog).map(cleanRuntimeWidget);
  }
  const widgets = manifest.provenance?.runtimeWidgets;
  if (!Array.isArray(widgets)) return [];
  return widgets.slice(0, 24).map(cleanRuntimeWidget);
}

function cleanRuntimeWidget(widget: JsonRecord, index = 0): RuntimeWidget {
  return {
    type: cleanWidgetField(widget.type || "label", "label"),
    id: cleanWidgetField(widget.id || `w${index}`, `w${index}`),
    x: clampInt(widget.x, 0, RUNTIME_WIDTH - 1),
    y: clampInt(widget.y, 0, RUNTIME_HEIGHT - 1),
    w: clampInt(widget.w || 80, 1, RUNTIME_WIDTH),
    h: clampInt(widget.h || 24, 1, RUNTIME_HEIGHT),
    text: cleanWidgetField(widget.text || "-", "-"),
    value: clampInt(widget.value || 0, 0, 100),
    color: cleanWidgetField(String(widget.color || "ffffff").replace(/^#/, ""), "ffffff"),
  };
}

function cleanWidgetField(value: any, defaultValue: string): string {
  const text = String(value || defaultValue).replace(/\s+/g, "_").replace(/[^A-Za-z0-9._:+-]/g, "").slice(0, 64);
  return text || defaultValue;
}

function clampInt(value: any, low: number, high: number): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return low;
  return Math.max(low, Math.min(high, number));
}

async function imageFramesForManifest({ manifest, manifestPath, item, workspaceRoot }: { manifest: ScreenManifestV2; manifestPath: string; item: ScreenPlaylistItemV1; workspaceRoot: string }): Promise<RuntimeFrame[]> {
  const manifestDir = path.dirname(manifestPath);
  if (manifest.output.type === "static") {
    return [
      await imageFrame({
        imagePath: resolveWorkspaceReference(manifest.output.path, manifestDir, workspaceRoot, "output.path"),
        fileSha256: manifest.output.fileSha256,
        rgbaPixelSha256: manifest.output.rgbaPixelSha256,
        rgb565PixelSha256: manifest.output.rgb565PixelSha256,
        durationMs: item.durationMs,
      }),
    ];
  }

  return Promise.all(
    manifest.output.frames.map((frame, index) =>
      imageFrame({
        imagePath: resolveWorkspaceReference(frame.path, manifestDir, workspaceRoot, `output.frames[${index}].path`),
        fileSha256: frame.fileSha256,
        rgbaPixelSha256: frame.rgbaPixelSha256,
        rgb565PixelSha256: frame.rgb565PixelSha256,
        durationMs: frame.durationMs,
      }),
    ),
  );
}

async function imageFrame({ imagePath, fileSha256, rgbaPixelSha256, rgb565PixelSha256, durationMs }: { imagePath: string; fileSha256: string; rgbaPixelSha256: string; rgb565PixelSha256: string; durationMs: number }): Promise<RuntimeFrame> {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== RUNTIME_WIDTH || info.height !== RUNTIME_HEIGHT || info.channels !== 4) {
    throw new Error(`runtime frame must decode to ${RUNTIME_WIDTH}x${RUNTIME_HEIGHT} RGBA pixels: ${imagePath}`);
  }
  return {
    rgb565: rgb565BufferFromRgba(data, info),
    fileSha256,
    rgbaPixelSha256,
    rgb565PixelSha256,
    durationMs,
  };
}

function resolveWorkspaceReference(relativePath: string, baseDir: string, workspaceRoot: string, field: string): string {
  const resolved = path.resolve(baseDir, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${field} must stay inside the screen workspace`);
  }
  return resolved;
}

function field(value: any): string {
  const text = String(value || "");
  if (!/^[A-Za-z0-9._:/@+-]+$/.test(text)) {
    throw new Error(`runtime field contains unsupported characters: ${text}`);
  }
  return text;
}

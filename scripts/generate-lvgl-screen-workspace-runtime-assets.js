#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  rgb565BufferFromRgba,
  screenManifestV2EnvelopeHash,
  screenPlaylistV1Hash,
  validateScreenManifestV2,
  validateScreenPlaylistV1,
} from "./screen-workspace-vocabulary.js";
import {
  runtimeWidgetsFromWalnutCatalog,
  validateWalnutLvglWidgetCatalog,
} from "./walnut-lvgl-widget-catalog.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_WORKSPACE_ROOT = process.env.WALNUT_SCREEN_WORKSPACE_ROOT
  ? path.resolve(process.env.WALNUT_SCREEN_WORKSPACE_ROOT)
  : path.join(ROOT_DIR, "screen");
const DEFAULT_PLAYLIST_ID = process.env.WALNUT_SCREEN_WORKSPACE_PLAYLIST || "default";
const WIDTH = 480;
const HEIGHT = 320;
const STRIDE = WIDTH * 2;

export async function generateLvglScreenWorkspaceRuntimeAssets({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  playlistId = DEFAULT_PLAYLIST_ID,
  outputDir = path.join(path.resolve(workspaceRoot), "runtime"),
} = {}) {
  const workspace = path.resolve(workspaceRoot);
  const runtimeDir = path.resolve(outputDir);
  const framesDir = path.join(runtimeDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const config = await runtimeConfigFromWorkspace({ workspace, playlistId });

  const lines = [
    "schema walnutpi.lvgl-runtime-assets.v1",
    `playlistId ${field(config.playlistId)}`,
    `playlistHash ${field(config.playlistHash)}`,
    `loop ${config.loop ? 1 : 0}`,
    `width ${WIDTH}`,
    `height ${HEIGHT}`,
    `stride ${STRIDE}`,
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
    await writeFile(path.join(framesDir, fileName), frame.rgb565);
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

  const indexPath = path.join(runtimeDir, "default.txt");
  await writeFile(indexPath, `${lines.join("\n")}\n`, "utf8");
  return {
    runtimeDir,
    indexPath,
    frames: config.frames.map((_, index) => path.join(framesDir, `frame-${String(index).padStart(3, "0")}.rgb565`)),
    playlistHash: config.playlistHash,
  };
}

async function runtimeConfigFromWorkspace({ workspace, playlistId }) {
  const playlistPath = path.join(workspace, "playlists", `${playlistId}.json`);
  const playlist = JSON.parse(await readFile(playlistPath, "utf8"));
  const normalizedPlaylist = await validateScreenPlaylistV1(playlist, {
    playlistPath,
    workspaceRoot: workspace,
  });

  const frames = [];
  const items = [];
  const widgets = [];
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

async function widgetsForManifest({ manifest, manifestPath, workspaceRoot }) {
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

function cleanRuntimeWidget(widget, index = 0) {
  return {
    type: cleanWidgetField(widget.type || "label", "label"),
    id: cleanWidgetField(widget.id || `w${index}`, `w${index}`),
    x: clampInt(widget.x, 0, WIDTH - 1),
    y: clampInt(widget.y, 0, HEIGHT - 1),
    w: clampInt(widget.w || 80, 1, WIDTH),
    h: clampInt(widget.h || 24, 1, HEIGHT),
    text: cleanWidgetField(widget.text || "-", "-"),
    value: clampInt(widget.value || 0, 0, 100),
    color: cleanWidgetField(String(widget.color || "ffffff").replace(/^#/, ""), "ffffff"),
  };
}

function cleanWidgetField(value, fallback) {
  const text = String(value || fallback).replace(/\s+/g, "_").replace(/[^A-Za-z0-9._:+-]/g, "").slice(0, 64);
  return text || fallback;
}

function clampInt(value, low, high) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return low;
  return Math.max(low, Math.min(high, number));
}

async function imageFramesForManifest({ manifest, manifestPath, item, workspaceRoot }) {
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

async function imageFrame({ imagePath, fileSha256, rgbaPixelSha256, rgb565PixelSha256, durationMs }) {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== WIDTH || info.height !== HEIGHT || info.channels !== 4) {
    throw new Error(`runtime frame must decode to ${WIDTH}x${HEIGHT} RGBA pixels: ${imagePath}`);
  }
  return {
    rgb565: rgb565BufferFromRgba(data, info),
    fileSha256,
    rgbaPixelSha256,
    rgb565PixelSha256,
    durationMs,
  };
}

function resolveWorkspaceReference(relativePath, baseDir, workspaceRoot, field) {
  const resolved = path.resolve(baseDir, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${field} must stay inside the screen workspace`);
  }
  return resolved;
}

function field(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9._:/@+-]+$/.test(text)) {
    throw new Error(`runtime field contains unsupported characters: ${text}`);
  }
  return text;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }
    if (!raw.startsWith("--")) throw new Error(`unexpected argument: ${raw}`);
    const [keyPart, inlineValue] = raw.slice(2).split(/=(.*)/s, 2);
    const key = keyPart.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/generate-lvgl-screen-workspace-runtime-assets.js [options]

Options:
  --workspace <dir>  Screen Workspace root. Default: screen
  --playlist <id>    Playlist id. Default: default
  --output-dir <dir> Runtime output dir. Default: screen/runtime`);
    return;
  }
  const result = await generateLvglScreenWorkspaceRuntimeAssets({
    workspaceRoot: args.workspace || DEFAULT_WORKSPACE_ROOT,
    playlistId: args.playlist || DEFAULT_PLAYLIST_ID,
    outputDir: args.outputDir,
  });
  console.log(JSON.stringify({
    ok: true,
    indexPath: path.relative(process.cwd(), result.indexPath).replaceAll("\\", "/"),
    frameCount: result.frames.length,
    playlistHash: result.playlistHash,
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

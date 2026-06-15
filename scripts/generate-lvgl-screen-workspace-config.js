#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_WORKSPACE_ROOT = process.env.WALNUT_SCREEN_WORKSPACE_ROOT
  ? path.resolve(process.env.WALNUT_SCREEN_WORKSPACE_ROOT)
  : path.join(ROOT_DIR, "screen");
const DEFAULT_PLAYLIST_ID = process.env.WALNUT_SCREEN_WORKSPACE_PLAYLIST || "default";
const DEFAULT_HEADER_PATH = path.join(ROOT_DIR, "lvgl_app", "generated", "screen_workspace_config.h");
const DEFAULT_SOURCE_PATH = path.join(ROOT_DIR, "lvgl_app", "generated", "screen_workspace_config.c");
const WIDTH = 480;
const HEIGHT = 320;
const STRIDE = WIDTH * 2;

export async function generateLvglScreenWorkspaceConfig({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  playlistId = DEFAULT_PLAYLIST_ID,
  enabled = process.env.WALNUT_SCREEN_WORKSPACE_LVGL ?? "auto",
} = {}) {
  const workspace = path.resolve(workspaceRoot);
  const cleanPlaylistId = cleanSlug(playlistId, "playlist");
  if (workspaceLvglDisabled({ enabled })) {
    return emptyConfig({
      playlistId: cleanPlaylistId,
      reason: "Screen Workspace LVGL playback disabled for this build",
    });
  }

  const playlistPath = path.join(workspace, "playlists", `${cleanPlaylistId}.json`);
  if (!(await fileExists(playlistPath))) {
    return emptyConfig({
      playlistId: cleanPlaylistId,
      reason: `Screen Workspace playlist not found: ${path.relative(ROOT_DIR, playlistPath).replaceAll("\\", "/")}`,
    });
  }

  const vocabulary = await import("./screen-workspace-vocabulary.js");
  const sharp = (await import("sharp")).default;
  const playlist = JSON.parse(await readFile(playlistPath, "utf8"));
  const normalizedPlaylist = await vocabulary.validateScreenPlaylistV1(playlist, {
    playlistPath,
    workspaceRoot: workspace,
  });

  const frames = [];
  const items = [];
  for (const [index, item] of normalizedPlaylist.items.entries()) {
    const manifestPath = resolveWorkspaceReference(item.manifest, path.dirname(playlistPath), workspace, `items[${index}].manifest`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const normalizedManifest = await vocabulary.validateScreenManifestV2(manifest, {
      manifestPath,
      workspaceRoot: workspace,
    });
    const firstFrame = frames.length;
    const outputFrames = await imageFramesForManifest({
      manifest: normalizedManifest,
      manifestPath,
      item,
      workspaceRoot: workspace,
      sharp,
      rgb565BufferFromRgba: vocabulary.rgb565BufferFromRgba,
    });
    frames.push(...outputFrames);
    items.push({
      manifestId: normalizedManifest.id,
      manifestHash: vocabulary.screenManifestV2EnvelopeHash(normalizedManifest),
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
    playlistHash: vocabulary.screenPlaylistV1Hash(normalizedPlaylist),
    loop: normalizedPlaylist.loop,
    frames,
    items,
    reason: "",
  };
}

export function renderLvglScreenWorkspaceConfig(config) {
  return {
    header: renderHeader(config),
    source: renderSource(config),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const workspaceRoot = path.resolve(args.workspace || DEFAULT_WORKSPACE_ROOT);
  const playlistId = cleanSlug(args.playlist || DEFAULT_PLAYLIST_ID, "playlist");
  const playlistPath = path.join(workspaceRoot, "playlists", `${playlistId}.json`);
  const headerPath = path.resolve(args.header || args.outputHeader || DEFAULT_HEADER_PATH);
  const sourcePath = path.resolve(args.source || args.outputSource || DEFAULT_SOURCE_PATH);
  const config = await generateLvglScreenWorkspaceConfig({
    workspaceRoot,
    playlistId,
    enabled: args.enabled,
  });
  await writeConfig({
    headerPath,
    sourcePath,
    config,
  });
  console.log(`${headerPath}\n${sourcePath}`);
}

async function imageFramesForManifest({
  manifest,
  manifestPath,
  item,
  workspaceRoot,
  sharp,
  rgb565BufferFromRgba,
}) {
  const manifestDir = path.dirname(manifestPath);
  if (manifest.output.type === "static") {
    return [
      await imageFrame({
        imagePath: resolveWorkspaceReference(manifest.output.path, manifestDir, workspaceRoot, "output.path"),
        fileSha256: manifest.output.fileSha256,
        rgbaPixelSha256: manifest.output.rgbaPixelSha256,
        rgb565PixelSha256: manifest.output.rgb565PixelSha256,
        durationMs: item.durationMs,
        sharp,
        rgb565BufferFromRgba,
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
        sharp,
        rgb565BufferFromRgba,
      }),
    ),
  );
}

async function imageFrame({
  imagePath,
  fileSha256,
  rgbaPixelSha256,
  rgb565PixelSha256,
  durationMs,
  sharp,
  rgb565BufferFromRgba,
}) {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== WIDTH || info.height !== HEIGHT || info.channels !== 4) {
    throw new Error(`LVGL workspace frame must decode to ${WIDTH}x${HEIGHT} RGBA pixels: ${imagePath}`);
  }
  return {
    rgb565: rgb565BufferFromRgba(data, info),
    fileSha256,
    rgbaPixelSha256,
    rgb565PixelSha256,
    durationMs,
  };
}

async function writeConfig({ headerPath, sourcePath, config }) {
  await mkdir(path.dirname(headerPath), { recursive: true });
  await mkdir(path.dirname(sourcePath), { recursive: true });
  const rendered = renderLvglScreenWorkspaceConfig(config);
  await writeFile(headerPath, rendered.header, "utf8");
  await writeFile(sourcePath, rendered.source, "utf8");
}

function emptyConfig({ playlistId, reason }) {
  return {
    playlistId,
    playlistHash: "",
    loop: true,
    frames: [],
    items: [],
    reason,
  };
}

function renderHeader(config) {
  const itemCount = config.items.length;
  const frameCount = config.frames.length;
  return `/* Generated by scripts/generate-lvgl-screen-workspace-config. Do not edit by hand. */
#ifndef WALNUT_SCREEN_WORKSPACE_CONFIG_H
#define WALNUT_SCREEN_WORKSPACE_CONFIG_H

#include "lvgl.h"

#define WALNUT_SCREEN_WORKSPACE_PLAYLIST_ID ${cString(config.playlistId)}
#define WALNUT_SCREEN_WORKSPACE_PLAYLIST_HASH ${cString(config.playlistHash)}
#define WALNUT_SCREEN_WORKSPACE_PLAYLIST_LOOP ${config.loop ? 1 : 0}
#define WALNUT_SCREEN_WORKSPACE_ITEM_COUNT ${itemCount}
#define WALNUT_SCREEN_WORKSPACE_FRAME_COUNT ${frameCount}
#define WALNUT_SCREEN_WORKSPACE_ITEM_ARRAY_COUNT ${Math.max(itemCount, 1)}
#define WALNUT_SCREEN_WORKSPACE_FRAME_ARRAY_COUNT ${Math.max(frameCount, 1)}
#define WALNUT_SCREEN_WORKSPACE_GENERATION_NOTE ${cString(config.reason)}

typedef struct {
    const lv_image_dsc_t * image;
    const char * file_sha256;
    const char * rgba_pixel_sha256;
    const char * rgb565_pixel_sha256;
    int duration_ms;
} walnut_screen_workspace_frame_config_t;

typedef struct {
    const char * manifest_id;
    const char * manifest_hash;
    const char * output_type;
    int first_frame;
    int frame_count;
    int duration_ms;
    int repeat;
    const char * transition;
} walnut_screen_workspace_item_config_t;

extern const walnut_screen_workspace_frame_config_t walnut_screen_workspace_frames[WALNUT_SCREEN_WORKSPACE_FRAME_ARRAY_COUNT];
extern const walnut_screen_workspace_item_config_t walnut_screen_workspace_items[WALNUT_SCREEN_WORKSPACE_ITEM_ARRAY_COUNT];
const char * walnut_screen_workspace_config_playlist_hash(void);

#endif
`;
}

function renderSource(config) {
  const imageBlocks = config.frames.map((frame, index) => renderImageBlock(frame, index)).join("\n");
  const frames = config.frames.length
    ? config.frames.map((frame, index) => [
      "    {",
      `        &walnut_screen_workspace_frame_${index}_image,`,
      `        ${cString(frame.fileSha256)},`,
      `        ${cString(frame.rgbaPixelSha256)},`,
      `        ${cString(frame.rgb565PixelSha256)},`,
      `        ${cNumber(frame.durationMs)}`,
      "    }",
    ].join("\n")).join(",\n")
    : [
      "    {",
      "        NULL,",
      "        \"\",",
      "        \"\",",
      "        \"\",",
      "        0",
      "    }",
    ].join("\n");
  const items = config.items.length
    ? config.items.map((item) => [
      "    {",
      `        ${cString(item.manifestId)},`,
      `        ${cString(item.manifestHash)},`,
      `        ${cString(item.outputType)},`,
      `        ${cNumber(item.firstFrame)},`,
      `        ${cNumber(item.frameCount)},`,
      `        ${cNumber(item.durationMs)},`,
      `        ${cNumber(item.repeat)},`,
      `        ${cString(item.transition)}`,
      "    }",
    ].join("\n")).join(",\n")
    : [
      "    {",
      "        \"\",",
      "        \"\",",
      "        \"\",",
      "        0,",
      "        0,",
      "        0,",
      "        0,",
      "        \"cut\"",
      "    }",
    ].join("\n");

  return `/* Generated by scripts/generate-lvgl-screen-workspace-config. Do not edit by hand. */
#include "generated/screen_workspace_config.h"

#include <stddef.h>

static const char walnut_screen_workspace_config_playlist_hash_value[] = WALNUT_SCREEN_WORKSPACE_PLAYLIST_HASH;

const char * walnut_screen_workspace_config_playlist_hash(void)
{
    return walnut_screen_workspace_config_playlist_hash_value;
}

${imageBlocks}
const walnut_screen_workspace_frame_config_t walnut_screen_workspace_frames[WALNUT_SCREEN_WORKSPACE_FRAME_ARRAY_COUNT] = {
${frames}
};

const walnut_screen_workspace_item_config_t walnut_screen_workspace_items[WALNUT_SCREEN_WORKSPACE_ITEM_ARRAY_COUNT] = {
${items}
};
`;
}

function renderImageBlock(frame, index) {
  const dataName = `walnut_screen_workspace_frame_${index}_data`;
  return `static const uint8_t ${dataName}[] = {
${cByteArray(frame.rgb565)}
};

static const lv_image_dsc_t walnut_screen_workspace_frame_${index}_image = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_RGB565,
        .flags = 0,
        .w = ${WIDTH},
        .h = ${HEIGHT},
        .stride = ${STRIDE},
        .reserved_2 = 0,
    },
    .data_size = sizeof(${dataName}),
    .data = ${dataName},
    .reserved = NULL,
};
`;
}

function cByteArray(buffer) {
  const lines = [];
  for (let offset = 0; offset < buffer.length; offset += 16) {
    const chunk = buffer.subarray(offset, offset + 16);
    lines.push(`    ${[...chunk].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")},`);
  }
  return lines.join("\n");
}

function cString(value) {
  return JSON.stringify(String(value || "")).replace(/[^\x00-\x7f]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function cNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function resolveWorkspaceReference(relativePath, baseDir, workspaceRoot, field) {
  const resolved = path.resolve(baseDir, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${field} must stay inside the screen workspace`);
  }
  return resolved;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cleanSlug(value, field) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) {
    throw new Error(`${field} must be a simple slug`);
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

function workspaceLvglDisabled(args) {
  const value = String(args.enabled ?? process.env.WALNUT_SCREEN_WORKSPACE_LVGL ?? "auto").toLowerCase();
  return value === "0" || value === "false" || value === "no" || value === "off" || value === "disabled";
}

function printHelp() {
  console.log(`Usage:
  node scripts/generate-lvgl-screen-workspace-config.js [options]

Options:
  --workspace <dir>       Screen Workspace root. Default: screen
  --playlist <id>         Playlist id. Default: default
  --header <file>         Generated header path
  --source <file>         Generated C source path
  --enabled <0|1>         Disable with 0/false/off, or use WALNUT_SCREEN_WORKSPACE_LVGL`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`screen workspace LVGL config generation failed: ${error.stack || error.message}`);
    process.exit(1);
  });
}

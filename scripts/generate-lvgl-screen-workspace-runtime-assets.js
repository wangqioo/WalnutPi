#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateLvglScreenWorkspaceConfig } from "./generate-lvgl-screen-workspace-config.js";

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

  const config = await generateLvglScreenWorkspaceConfig({
    workspaceRoot: workspace,
    playlistId,
    enabled: "1",
  });

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

#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeScreenAssets,
  writeRuntimeScreenAssets,
} from "./runtime-screen-assets.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_WORKSPACE_ROOT = process.env.WALNUT_SCREEN_WORKSPACE_ROOT
  ? path.resolve(process.env.WALNUT_SCREEN_WORKSPACE_ROOT)
  : path.join(ROOT_DIR, "screen");
const DEFAULT_PLAYLIST_ID = process.env.WALNUT_SCREEN_WORKSPACE_PLAYLIST || "default";

type GenerateRuntimeOptions = {
  workspaceRoot?: string;
  playlistId?: string;
  outputDir?: string;
};

type GenerateRuntimeResult = {
  runtimeDir: string;
  indexPath: string;
  frames: string[];
  playlistHash: string;
};

type CliArgs = {
  help?: boolean;
  workspace?: string;
  playlist?: string;
  outputDir?: string;
};

export async function generateLvglScreenWorkspaceRuntimeAssets({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  playlistId = DEFAULT_PLAYLIST_ID,
  outputDir = path.join(path.resolve(workspaceRoot), "runtime"),
}: GenerateRuntimeOptions = {}): Promise<GenerateRuntimeResult> {
  const workspace = path.resolve(workspaceRoot);
  const runtimeDir = path.resolve(outputDir);
  const config = await buildRuntimeScreenAssets({ workspace, playlistId });
  const written = await writeRuntimeScreenAssets(config, { runtimeDir });
  return {
    runtimeDir,
    indexPath: written.indexPath,
    frames: written.framePaths,
    playlistHash: config.playlistHash,
  };
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
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
  node scripts/generate-lvgl-screen-workspace-runtime-assets.ts [options]

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

#!/usr/bin/env bun
import path from "node:path";
import {
  DEFAULT_ANIMATION_BUDGET,
  appendScreenPlaylistItem,
  processSourceAssetToScreenOutput,
  writeDefaultScreenPlaylist,
} from "./screen-workspace-pipeline.js";

const PRESETS = new Set([
  "fit-cover:480x320",
  "fit-contain:480x320",
  "pixel-grid:120x80@4x",
  "pixel-grid:240x160@2x",
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const source = required(args.source, "--source");
  const id = required(args.id || args.screenId, "--id");
  const workspaceRoot = args.workspace || "screen";
  const outputType = args.type || "static";
  const preset = args.preset || "fit-cover:480x320";

  if (!["static", "animated"].includes(outputType)) {
    throw new Error("--type must be static or animated");
  }
  if (!PRESETS.has(preset)) {
    throw new Error(`--preset must be one of ${[...PRESETS].join(", ")}`);
  }

  const result = await processSourceAssetToScreenOutput({
    workspaceRoot,
    plan: {
      id: args.planId || `${id}-plan`,
      screenId: id,
      title: args.title,
      description: args.description,
      animation: outputType === "animated"
        ? {
            fps: numberArg(args.fps, DEFAULT_ANIMATION_BUDGET.fps),
            maxSeconds: numberArg(args.maxSeconds, DEFAULT_ANIMATION_BUDGET.maxSeconds),
            maxFrames: numberArg(args.maxFrames, DEFAULT_ANIMATION_BUDGET.maxFrames),
          }
        : undefined,
    },
    sourceAsset: {
      id: args.sourceId || `${id}-source`,
      path: source,
      selected: true,
      mediaType: args.mediaType,
      license: args.license || "unknown-personal-sync",
      origin: args.origin || null,
    },
    outputType,
    preset,
  });

  let playlist = null;
  if (args.playlist !== "false") {
    const playlistMode = args.playlistMode || "replace";
    if (!["replace", "append"].includes(playlistMode)) {
      throw new Error("--playlist-mode must be replace or append");
    }
    const writePlaylist = playlistMode === "append" ? appendScreenPlaylistItem : writeDefaultScreenPlaylist;
    playlist = await writePlaylist({
      workspaceRoot,
      playlistId: args.playlist || "default",
      manifestId: id,
      durationMs: numberArg(args.durationMs, 8000),
      repeat: numberArg(args.repeat, 1),
      loop: args.loop === undefined ? true : args.loop !== "false",
    });
  }

  console.log(JSON.stringify({
    ok: true,
    schema: "walnutpi.screenWorkspaceProcessResult.v1",
    workspaceRoot: result.workspaceRoot,
    screenId: result.screenId,
    outputType,
    preset,
    manifestPath: relative(result.manifestPath),
    outputJsonPath: relative(result.outputJsonPath),
    planPath: relative(result.planPath),
    sourcePath: relative(result.sourcePath),
    playlistPath: playlist ? relative(playlist.playlistPath) : null,
    output: result.output,
  }, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }
    if (!raw.startsWith("--")) {
      if (!args.source) args.source = raw;
      else throw new Error(`unexpected argument: ${raw}`);
      continue;
    }
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

function required(value, flag) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${flag} is required`);
  return text;
}

function numberArg(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid number: ${value}`);
  return number;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function printHelp() {
  console.log(`Usage:
  bun scripts/process-screen-workspace-source.js --source <file> --id <screen-id> [options]

Options:
  --workspace <dir>              Screen Workspace root. Default: screen
  --type <static|animated>        Output type. Default: static
  --preset <preset>              fit-cover:480x320, fit-contain:480x320,
                                  pixel-grid:120x80@4x, pixel-grid:240x160@2x
  --source-id <id>               Source Asset id. Default: <screen-id>-source
  --plan-id <id>                 Screen Plan id. Default: <screen-id>-plan
  --title <text>                 Manifest title
  --description <text>           Manifest description
  --license <text>               Source license. Default: unknown-personal-sync
  --media-type <type>            Source media type
  --origin <text>                Source origin or URL
  --fps <n>                      Animated output fps. Default: 10
  --max-seconds <n>              Animated output limit. Default: 8
  --max-frames <n>               Animated output frame limit. Default: 80
  --playlist <id|false>          Write one-item playlist. Default: default
  --playlist-mode <replace|append>
                                  Replace playlist or append this output. Default: replace
  --duration-ms <n>              Playlist item duration. Default: 8000
  --repeat <n>                   Playlist item repeat. Default: 1
  --loop <true|false>            Playlist loop. Default: true`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

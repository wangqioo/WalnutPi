import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import {
  SCREEN_WORKSPACE_HEIGHT,
  SCREEN_WORKSPACE_WIDTH,
  animatedOutputSha256,
  rgbaPixelSha256FromImage,
  rgb565PixelSha256FromImage,
  staticOutputFileSha256,
  validateScreenManifestV2,
  validateScreenPlaylistV1,
} from "./screen-workspace-vocabulary.js";

export const DEFAULT_ANIMATION_BUDGET = {
  fps: 6,
  maxSeconds: 8,
  maxFrames: 24,
};

const SCREEN_PLAN_SCHEMA = "walnutpi.screen-plan.v1";
const SCREEN_SOURCE_ASSET_SCHEMA = "walnutpi.screen-source-asset.v1";
const SCREEN_OUTPUT_SCHEMA = "walnutpi.screen-output.v1";

export async function processSourceAssetToScreenOutput({
  workspaceRoot = "screen",
  plan = {},
  sourceAsset,
  outputType = "static",
  preset = "fit-cover:480x320",
  now = () => new Date(),
} = {}) {
  if (!sourceAsset || typeof sourceAsset !== "object" || Array.isArray(sourceAsset)) {
    throw new Error("sourceAsset is required");
  }
  if (sourceAsset.selected === false) {
    throw new Error("sourceAsset must be user-selected before processing");
  }
  if (!sourceAsset.path) throw new Error("sourceAsset.path is required");
  if (!["static", "animated"].includes(outputType)) {
    throw new Error("outputType must be static or animated");
  }

  const workspace = path.resolve(workspaceRoot);
  const screenId = cleanSlug(plan.screenId || plan.outputId || sourceAsset.screenId || sourceAsset.id || path.basename(sourceAsset.path, path.extname(sourceAsset.path)), "screenId");
  const planId = cleanSlug(plan.id || `${screenId}-plan`, "plan.id");
  const sourceAssetId = cleanSlug(sourceAsset.id || `${screenId}-source`, "sourceAsset.id");
  const sourcePath = path.resolve(sourceAsset.path);
  const generatedAt = now().toISOString();

  await ensureWorkspaceDirs(workspace);

  const sourceRecord = await writeSelectedSourceAsset({
    workspace,
    sourceAsset,
    sourceAssetId,
    sourcePath,
    generatedAt,
  });

  const output =
    outputType === "static"
      ? await processStaticOutput({ workspace, screenId, sourcePath, preset })
      : await processAnimatedOutput({
          workspace,
          screenId,
          sourcePath,
          preset,
          animation: {
            ...DEFAULT_ANIMATION_BUDGET,
            ...(plan.animation || {}),
          },
        });

  const executedPlan = {
    schema: SCREEN_PLAN_SCHEMA,
    id: planId,
    screenId,
    outputType,
    selectedSourceAsset: `../sources/${sourceAssetId}/source.json`,
    processing: {
      preset,
      ...(outputType === "animated"
        ? {
            animation: normalizeAnimationBudget({
              ...DEFAULT_ANIMATION_BUDGET,
              ...(plan.animation || {}),
            }),
          }
        : {}),
    },
    requestedAt: cleanOptionalIso(plan.requestedAt),
    executedAt: generatedAt,
  };

  const manifest = {
    schema: "walnutpi.screen-manifest.v2",
    id: screenId,
    ...(plan.title ? { title: cleanText(plan.title, "plan.title", 80) } : {}),
    ...(plan.description ? { description: cleanText(plan.description, "plan.description", 240) } : {}),
    output: output.manifestOutput,
    provenance: {
      plan: `../plans/${planId}.json`,
      sourceAssets: [
        {
          id: sourceAssetId,
          source: `../sources/${sourceAssetId}/source.json`,
          original: `../sources/${sourceAssetId}/${sourceRecord.originalFileName}`,
          width: sourceRecord.width,
          height: sourceRecord.height,
          mediaType: sourceRecord.mediaType,
          license: sourceRecord.license,
          selected: true,
        },
      ],
      processing: {
        preset,
        tools: output.tools,
      },
    },
  };

  const manifestPath = path.join(workspace, "manifests", `${screenId}.json`);
  await writeJson(output.outputJsonPath, {
    schema: SCREEN_OUTPUT_SCHEMA,
    id: screenId,
    generatedAt,
    manifest: `../../manifests/${screenId}.json`,
    output: manifest.output,
  });
  const normalizedManifest = await validateScreenManifestV2(manifest, {
    manifestPath,
    workspaceRoot: workspace,
  });

  await writeJson(output.outputJsonPath, {
    schema: SCREEN_OUTPUT_SCHEMA,
    id: screenId,
    generatedAt,
    manifest: `../../manifests/${screenId}.json`,
    output: normalizedManifest.output,
  });
  await writeJson(manifestPath, normalizedManifest);
  const planPath = path.join(workspace, "plans", `${planId}.json`);
  await writeJson(planPath, executedPlan);

  return {
    workspaceRoot: workspace,
    screenId,
    planPath,
    sourcePath: sourceRecord.sourceJsonPath,
    manifestPath,
    outputJsonPath: output.outputJsonPath,
    manifest: normalizedManifest,
    output: normalizedManifest.output,
  };
}

export async function writeDefaultScreenPlaylist({
  workspaceRoot = "screen",
  manifestId,
  durationMs = 8000,
  repeat = 1,
  loop = true,
  playlistId = "default",
} = {}) {
  return writeScreenPlaylistItem({
    workspaceRoot,
    manifestId,
    durationMs,
    repeat,
    loop,
    playlistId,
    mode: "replace",
  });
}

export async function appendScreenPlaylistItem({
  workspaceRoot = "screen",
  manifestId,
  durationMs = 8000,
  repeat = 1,
  loop,
  playlistId = "default",
} = {}) {
  return writeScreenPlaylistItem({
    workspaceRoot,
    manifestId,
    durationMs,
    repeat,
    loop,
    playlistId,
    mode: "append",
  });
}

async function writeScreenPlaylistItem({
  workspaceRoot,
  manifestId,
  durationMs,
  repeat,
  loop,
  playlistId,
  mode,
}) {
  const workspace = path.resolve(workspaceRoot);
  const cleanManifestId = cleanSlug(manifestId, "manifestId");
  const cleanPlaylistId = cleanSlug(playlistId, "playlistId");
  await ensureWorkspaceDirs(workspace);

  const playlistPath = path.join(workspace, "playlists", `${cleanPlaylistId}.json`);
  const existing = mode === "append" ? await readJsonIfExists(playlistPath) : null;
  const normalizedExisting = existing
    ? await validateScreenPlaylistV1(existing, {
        playlistPath,
        workspaceRoot: workspace,
      })
    : null;
  const item = {
    manifest: `../manifests/${cleanManifestId}.json`,
    durationMs,
    repeat,
    transition: "cut",
  };
  const playlist = {
    ...(normalizedExisting || {}),
    schema: "walnutpi.screen-playlist.v1",
    id: cleanPlaylistId,
    loop: loop === undefined ? (normalizedExisting?.loop ?? true) : loop,
    items: normalizedExisting ? [...normalizedExisting.items, item] : [item],
  };
  const normalized = await validateScreenPlaylistV1(playlist, {
    playlistPath,
    workspaceRoot: workspace,
  });
  await writeJson(playlistPath, normalized);
  return {
    playlistPath,
    playlist: normalized,
  };
}

export async function probeMediaWithFfmpeg(sourcePath) {
  assertFfmpegAvailable();
  const result = await runFfmpeg(["-hide_banner", "-i", path.resolve(sourcePath)], { allowFailure: true });
  const text = `${result.stderr}\n${result.stdout}`;
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const sizeMatch = text.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  return {
    durationSeconds: durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : null,
    width: sizeMatch ? Number(sizeMatch[1]) : null,
    height: sizeMatch ? Number(sizeMatch[2]) : null,
    raw: text,
  };
}

async function processStaticOutput({ workspace, screenId, sourcePath, preset }) {
  const outputDir = path.join(workspace, "outputs", screenId);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "output.png");
  await renderImagePreset(sourcePath, outputPath, preset);

  const manifestOutput = {
    type: "static",
    path: `../outputs/${screenId}/output.png`,
    width: SCREEN_WORKSPACE_WIDTH,
    height: SCREEN_WORKSPACE_HEIGHT,
    fileSha256: await staticOutputFileSha256(outputPath),
    rgbaPixelSha256: await rgbaPixelSha256FromImage(outputPath),
    rgb565PixelSha256: await rgb565PixelSha256FromImage(outputPath),
  };

  return {
    manifestOutput,
    outputJsonPath: path.join(outputDir, "output.json"),
    tools: [{ name: "sharp", version: sharp.versions.sharp }],
  };
}

async function processAnimatedOutput({ workspace, screenId, sourcePath, preset, animation }) {
  assertFfmpegAvailable();
  const budget = normalizeAnimationBudget(animation);
  const tempDir = await mkdtemp(path.join(tmpdir(), "walnut-screen-frames-"));
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-t",
      String(budget.maxSeconds),
      "-i",
      sourcePath,
      "-vf",
      `fps=${budget.fps}`,
      "-frames:v",
      String(budget.maxFrames),
      path.join(tempDir, "frame-%06d.png"),
    ]);

    const extracted = (await readdir(tempDir))
      .filter((name) => /^frame-\d+\.png$/.test(name))
      .sort();
    if (extracted.length === 0) {
      throw new Error("ffmpeg did not extract any animation frames");
    }

    const outputDir = path.join(workspace, "outputs", screenId);
    const framesDir = path.join(outputDir, "frames");
    await mkdir(framesDir, { recursive: true });
    const durationMs = Math.round(1000 / budget.fps);
    const frames = [];

    for (const [index, frameFile] of extracted.entries()) {
      const framePath = path.join(framesDir, `frame-${String(index).padStart(3, "0")}.png`);
      await renderImagePreset(path.join(tempDir, frameFile), framePath, preset);
      frames.push({
        path: `../outputs/${screenId}/frames/frame-${String(index).padStart(3, "0")}.png`,
        width: SCREEN_WORKSPACE_WIDTH,
        height: SCREEN_WORKSPACE_HEIGHT,
        durationMs,
        fileSha256: await staticOutputFileSha256(framePath),
        rgbaPixelSha256: await rgbaPixelSha256FromImage(framePath),
        rgb565PixelSha256: await rgb565PixelSha256FromImage(framePath),
      });
    }

    const manifestOutput = {
      type: "animated",
      path: `../outputs/${screenId}/output.json`,
      width: SCREEN_WORKSPACE_WIDTH,
      height: SCREEN_WORKSPACE_HEIGHT,
      frameCount: frames.length,
      frames,
      animatedOutputSha256: animatedOutputSha256(frames),
    };

    return {
      manifestOutput,
      outputJsonPath: path.join(outputDir, "output.json"),
      tools: [
        { name: "ffmpeg-static", version: "5.3.0" },
        { name: "sharp", version: sharp.versions.sharp },
      ],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function renderImagePreset(inputPath, outputPath, preset) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await renderRasterImagePreset(inputPath, outputPath, preset);
  } catch (error) {
    if (!ffmpegPath) throw error;
    const tempDir = await mkdtemp(path.join(tmpdir(), "walnut-screen-preview-"));
    try {
      const framePath = path.join(tempDir, "frame.png");
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        framePath,
      ]);
      await renderRasterImagePreset(framePath, outputPath, preset);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function renderRasterImagePreset(inputPath, outputPath, preset) {
  const pipeline = sharp(inputPath, { animated: false }).rotate().ensureAlpha();

  if (preset === "fit-cover:480x320") {
    await pipeline
      .resize(SCREEN_WORKSPACE_WIDTH, SCREEN_WORKSPACE_HEIGHT, {
        fit: "cover",
        position: "centre",
      })
      .png()
      .toFile(outputPath);
    return;
  }

  if (preset === "fit-contain:480x320") {
    await pipeline
      .resize(SCREEN_WORKSPACE_WIDTH, SCREEN_WORKSPACE_HEIGHT, {
        fit: "contain",
        position: "centre",
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .png()
      .toFile(outputPath);
    return;
  }

  if (preset === "pixel-grid:120x80@4x" || preset === "pixel-grid:240x160@2x") {
    const match = preset.match(/^pixel-grid:(\d+)x(\d+)@/);
    const [gridWidth, gridHeight] = match.slice(1, 3).map(Number);
    await pipeline
      .resize(gridWidth, gridHeight, {
        fit: "cover",
        position: "centre",
        kernel: sharp.kernel.nearest,
      })
      .resize(SCREEN_WORKSPACE_WIDTH, SCREEN_WORKSPACE_HEIGHT, {
        fit: "fill",
        kernel: sharp.kernel.nearest,
      })
      .png()
      .toFile(outputPath);
    return;
  }

  throw new Error(`unsupported processing preset: ${preset}`);
}

async function writeSelectedSourceAsset({ workspace, sourceAsset, sourceAssetId, sourcePath, generatedAt }) {
  const sourceDir = path.join(workspace, "sources", sourceAssetId);
  await mkdir(sourceDir, { recursive: true });
  const extension = path.extname(sourcePath) || ".bin";
  const originalFileName = `original${extension.toLowerCase()}`;
  const originalPath = path.join(sourceDir, originalFileName);
  await copyFile(sourcePath, originalPath);
  const metadata = await readSourceMetadata(originalPath, sourceAsset);
  const sourceRecord = {
    schema: SCREEN_SOURCE_ASSET_SCHEMA,
    id: sourceAssetId,
    selected: true,
    importedAt: generatedAt,
    original: originalFileName,
    fileSha256: await staticOutputFileSha256(originalPath),
    width: metadata.width,
    height: metadata.height,
    mediaType: sourceAsset.mediaType || metadata.mediaType,
    license: sourceAsset.license || "unknown-personal-sync",
    origin: sourceAsset.origin || null,
  };
  const sourceJsonPath = path.join(sourceDir, "source.json");
  await writeJson(sourceJsonPath, sourceRecord);
  return {
    ...sourceRecord,
    sourceJsonPath,
    originalFileName,
  };
}

async function readSourceMetadata(filePath, sourceAsset) {
  try {
    const metadata = await sharp(filePath, { animated: true }).metadata();
    return {
      width: sourceAsset.width || metadata.width || 1,
      height: sourceAsset.height || metadata.height || 1,
      mediaType: sourceAsset.mediaType || mediaTypeFromFormat(metadata.format),
    };
  } catch {
    const probed = await probeMediaWithFfmpeg(filePath);
    return {
      width: sourceAsset.width || probed.width || 1,
      height: sourceAsset.height || probed.height || 1,
      mediaType: sourceAsset.mediaType || "video/unknown",
    };
  }
}

function normalizeAnimationBudget(animation) {
  return {
    fps: cleanInteger(animation.fps, "animation.fps", 1, 60),
    maxSeconds: cleanInteger(animation.maxSeconds, "animation.maxSeconds", 1, 60),
    maxFrames: cleanInteger(animation.maxFrames, "animation.maxFrames", 1, 80),
  };
}

async function ensureWorkspaceDirs(workspace) {
  await Promise.all(
    ["plans", "sources", "manifests", "outputs", "playlists"].map((segment) =>
      mkdir(path.join(workspace, segment), { recursive: true }),
    ),
  );
}

function assertFfmpegAvailable() {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide an ffmpeg binary path");
}

function runFfmpeg(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(new Error(`ffmpeg failed with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function mediaTypeFromFormat(format) {
  if (!format) return "application/octet-stream";
  if (format === "jpg") return "image/jpeg";
  return `image/${format}`;
}

function cleanSlug(value, field) {
  const text = cleanText(value, field, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) {
    throw new Error(`${field} must be a simple slug`);
  }
  return text;
}

function cleanText(value, field, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${field} is required`);
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

function cleanInteger(value, field, low, high) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a number`);
  const rounded = Math.round(number);
  if (rounded !== number) throw new Error(`${field} must be an integer`);
  if (rounded < low || rounded > high) throw new Error(`${field} must be between ${low} and ${high}`);
  return rounded;
}

function cleanOptionalIso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

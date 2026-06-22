import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const SCREEN_WORKSPACE_WIDTH = 480;
export const SCREEN_WORKSPACE_HEIGHT = 320;
export const SCREEN_MANIFEST_V2_SCHEMA = "walnutpi.screen-manifest.v2";
export const SCREEN_PLAYLIST_V1_SCHEMA = "walnutpi.screen-playlist.v1";
export const SCREEN_PROCESSING_PRESETS = new Set([
  "fit-cover:480x320",
  "fit-contain:480x320",
  "pixel-grid:120x80@4x",
  "pixel-grid:240x160@2x",
]);

type JsonRecord = Record<string, any>;

export type ScreenOutputFrame = JsonRecord & {
  path: string;
  width: number;
  height: number;
  durationMs: number;
  fileSha256: string;
  rgbaPixelSha256: string;
  rgb565PixelSha256: string;
};

export type StaticScreenOutput = JsonRecord & {
  type: "static";
  path: string;
  width: number;
  height: number;
  fileSha256: string;
  rgbaPixelSha256: string;
  rgb565PixelSha256: string;
};

export type AnimatedScreenOutput = JsonRecord & {
  type: "animated";
  path: string;
  width: number;
  height: number;
  frameCount: number;
  frames: ScreenOutputFrame[];
  animatedOutputSha256: string;
};

export type ScreenOutput = StaticScreenOutput | AnimatedScreenOutput;

export type ScreenManifestV2 = JsonRecord & {
  schema: typeof SCREEN_MANIFEST_V2_SCHEMA;
  id: string;
  title?: string;
  description?: string;
  output: ScreenOutput;
  provenance: JsonRecord;
};

export type ScreenPlaylistItemV1 = JsonRecord & {
  manifest: string;
  durationMs: number;
  repeat: number;
  transition: string;
};

export type ScreenPlaylistV1 = JsonRecord & {
  schema: typeof SCREEN_PLAYLIST_V1_SCHEMA;
  id: string;
  loop: boolean;
  items: ScreenPlaylistItemV1[];
};

type ValidationOptions = {
  manifestPath?: string;
  playlistPath?: string;
  workspaceRoot?: string;
  verifyHashes?: boolean;
};

const HASH_RE = /^[a-f0-9]{64}$/;
const URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}

export function screenManifestV2EnvelopeHash(manifest: ScreenManifestV2 | JsonRecord): string {
  return sha256Hex(stableStringify(normalizeScreenManifestV2(manifest)));
}

export function screenPlaylistV1Hash(playlist: ScreenPlaylistV1 | JsonRecord): string {
  return sha256Hex(stableStringify(normalizeScreenPlaylistV1(playlist)));
}

export async function staticOutputFileSha256(filePath: string): Promise<string> {
  return sha256Hex(await readFile(filePath));
}

export function rgbaPixelSha256(
  rgbaPixels: Buffer | Uint8Array,
  { width = SCREEN_WORKSPACE_WIDTH, height = SCREEN_WORKSPACE_HEIGHT, channels = 4 }: { width?: number; height?: number; channels?: number } = {},
): string {
  assertPixelBuffer(rgbaPixels, width, height, channels, "rgbaPixels");
  return sha256Hex(Buffer.from(rgbaPixels));
}

export async function rgbaPixelSha256FromImage(filePath: string): Promise<string> {
  const { data, info } = await readRgbaPixels(filePath);
  return rgbaPixelSha256(data, info);
}

export function rgb565BufferFromRgba(
  rgbaPixels: Buffer | Uint8Array,
  { width = SCREEN_WORKSPACE_WIDTH, height = SCREEN_WORKSPACE_HEIGHT, channels = 4 }: { width?: number; height?: number; channels?: number } = {},
): Buffer {
  assertPixelBuffer(rgbaPixels, width, height, channels, "rgbaPixels");
  const input = Buffer.from(rgbaPixels);
  const output = Buffer.alloc(width * height * 2);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const inputOffset = pixel * channels;
    const alpha = channels >= 4 ? input[inputOffset + 3] / 255 : 1;
    const red = Math.round(input[inputOffset] * alpha);
    const green = Math.round(input[inputOffset + 1] * alpha);
    const blue = Math.round(input[inputOffset + 2] * alpha);
    const rgb565 = ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
    const outputOffset = pixel * 2;
    output[outputOffset] = rgb565 & 0xff;
    output[outputOffset + 1] = (rgb565 >> 8) & 0xff;
  }

  return output;
}

export function rgb565PixelSha256FromRgba(
  rgbaPixels: Buffer | Uint8Array,
  { width = SCREEN_WORKSPACE_WIDTH, height = SCREEN_WORKSPACE_HEIGHT, channels = 4 }: { width?: number; height?: number; channels?: number } = {},
): string {
  return sha256Hex(rgb565BufferFromRgba(rgbaPixels, { width, height, channels }));
}

export async function rgb565PixelSha256FromImage(filePath: string): Promise<string> {
  const { data, info } = await readRgbaPixels(filePath);
  return rgb565PixelSha256FromRgba(data, info);
}

export function animatedOutputSha256(frames: Array<Partial<ScreenOutputFrame> & JsonRecord>): string {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error("animated output frames must contain at least one frame");
  }
  const hash = createHash("sha256");
  hash.update("walnutpi.animated-output.v1\n");
  frames.forEach((frame, index) => {
    assertObject(frame, `frames[${index}]`);
    const frameHash = cleanSha256(frame.frameRgb565PixelSha256 || frame.rgb565PixelSha256, `frames[${index}].rgb565PixelSha256`);
    const durationMs = cleanInteger(frame.durationMs, `frames[${index}].durationMs`, 1, 600000);
    hash.update(`${frameHash}:${durationMs}\n`);
  });
  return hash.digest("hex");
}

export function normalizeScreenManifestV2(manifest: JsonRecord): ScreenManifestV2 {
  assertObject(manifest, "screen manifest");
  if (manifest.schema !== SCREEN_MANIFEST_V2_SCHEMA) {
    throw new Error(`screen manifest schema must be ${SCREEN_MANIFEST_V2_SCHEMA}`);
  }

  const normalized: ScreenManifestV2 = {
    ...manifest,
    schema: SCREEN_MANIFEST_V2_SCHEMA,
    id: cleanSlug(manifest.id, "id"),
    output: normalizeScreenOutput(manifest.output, "output"),
    provenance: normalizeProcessingProvenance(manifest.provenance, "provenance"),
  };
  if (manifest.title !== undefined) normalized.title = cleanOptionalText(manifest.title, "title", 80);
  if (manifest.description !== undefined) normalized.description = cleanOptionalText(manifest.description, "description", 240);
  return normalized;
}

export async function validateScreenManifestV2(manifest: JsonRecord, options: ValidationOptions = {}): Promise<ScreenManifestV2> {
  const normalized = normalizeScreenManifestV2(manifest);
  if (hasArtifactValidationContext(options)) {
    await validateManifestArtifacts(normalized, options);
  }
  return normalized;
}

export function normalizeScreenPlaylistV1(playlist: JsonRecord): ScreenPlaylistV1 {
  assertObject(playlist, "screen playlist");
  if (playlist.schema !== SCREEN_PLAYLIST_V1_SCHEMA) {
    throw new Error(`screen playlist schema must be ${SCREEN_PLAYLIST_V1_SCHEMA}`);
  }
  if (!Array.isArray(playlist.items) || playlist.items.length === 0) {
    throw new Error("playlist items must contain at least one item");
  }

  return {
    ...playlist,
    schema: SCREEN_PLAYLIST_V1_SCHEMA,
    id: cleanSlug(playlist.id || "default", "id"),
    loop: playlist.loop === undefined ? true : cleanBoolean(playlist.loop, "loop"),
    items: playlist.items.map((item, index) => normalizePlaylistItem(item, `items[${index}]`)),
  };
}

export async function validateScreenPlaylistV1(playlist: JsonRecord, options: ValidationOptions = {}): Promise<ScreenPlaylistV1> {
  const normalized = normalizeScreenPlaylistV1(playlist);
  const baseDir = playlistBaseDir(options);
  const workspaceRoot = cleanWorkspaceRoot(options.workspaceRoot);

  for (const [index, item] of normalized.items.entries()) {
    assertPlaylistManifestReference(item.manifest, `items[${index}].manifest`);
    if (!baseDir) continue;
    const manifestPath = resolveWorkspaceReference(item.manifest, {
      baseDir,
      workspaceRoot,
      field: `items[${index}].manifest`,
    });
    await assertFile(manifestPath, `items[${index}].manifest`);
    const childManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await validateScreenManifestV2(childManifest, {
      workspaceRoot,
      manifestPath,
      verifyHashes: options.verifyHashes,
    });
  }

  return normalized;
}

function normalizeScreenOutput(output, field) {
  assertObject(output, field);
  const type = cleanText(output.type, `${field}.type`, 16);
  if (type === "static") return normalizeStaticOutput(output, field);
  if (type === "animated") return normalizeAnimatedOutput(output, field);
  throw new Error(`${field}.type must be static or animated`);
}

function normalizeStaticOutput(output, field) {
  return {
    ...output,
    type: "static",
    path: cleanRelativePath(output.path, `${field}.path`),
    width: cleanExactInteger(output.width, `${field}.width`, SCREEN_WORKSPACE_WIDTH),
    height: cleanExactInteger(output.height, `${field}.height`, SCREEN_WORKSPACE_HEIGHT),
    fileSha256: cleanSha256(output.fileSha256, `${field}.fileSha256`),
    rgbaPixelSha256: cleanSha256(output.rgbaPixelSha256, `${field}.rgbaPixelSha256`),
    rgb565PixelSha256: cleanSha256(output.rgb565PixelSha256, `${field}.rgb565PixelSha256`),
  };
}

function normalizeAnimatedOutput(output, field) {
  if (!Array.isArray(output.frames) || output.frames.length === 0 || output.frames.length > 80) {
    throw new Error(`${field}.frames must contain 1-80 frames`);
  }
  const frames = output.frames.map((frame, index) => normalizeAnimationFrame(frame, `${field}.frames[${index}]`));
  const normalized = {
    ...output,
    type: "animated",
    path: cleanRelativePath(output.path, `${field}.path`),
    width: cleanExactInteger(output.width, `${field}.width`, SCREEN_WORKSPACE_WIDTH),
    height: cleanExactInteger(output.height, `${field}.height`, SCREEN_WORKSPACE_HEIGHT),
    frameCount: cleanExactInteger(output.frameCount ?? frames.length, `${field}.frameCount`, frames.length),
    frames,
    animatedOutputSha256: cleanSha256(output.animatedOutputSha256, `${field}.animatedOutputSha256`),
  };
  const computedHash = animatedOutputSha256(frames);
  if (normalized.animatedOutputSha256 !== computedHash) {
    throw new Error(`${field}.animatedOutputSha256 does not match frame RGB565 hashes and durations`);
  }
  return normalized;
}

function normalizeAnimationFrame(frame, field) {
  assertObject(frame, field);
  return {
    ...frame,
    path: cleanRelativePath(frame.path, `${field}.path`),
    width: cleanExactInteger(frame.width, `${field}.width`, SCREEN_WORKSPACE_WIDTH),
    height: cleanExactInteger(frame.height, `${field}.height`, SCREEN_WORKSPACE_HEIGHT),
    durationMs: cleanInteger(frame.durationMs, `${field}.durationMs`, 1, 600000),
    fileSha256: cleanSha256(frame.fileSha256, `${field}.fileSha256`),
    rgbaPixelSha256: cleanSha256(frame.rgbaPixelSha256, `${field}.rgbaPixelSha256`),
    rgb565PixelSha256: cleanSha256(frame.rgb565PixelSha256, `${field}.rgb565PixelSha256`),
  };
}

function normalizeProcessingProvenance(provenance, field) {
  assertObject(provenance, field);
  const processing = normalizeProcessing(provenance.processing, `${field}.processing`);
  const normalized = {
    ...provenance,
    processing,
  };
  if (provenance.plan !== undefined) normalized.plan = cleanRelativePath(provenance.plan, `${field}.plan`);
  if (provenance.sourceAssets !== undefined) {
    if (!Array.isArray(provenance.sourceAssets)) throw new Error(`${field}.sourceAssets must be an array`);
    normalized.sourceAssets = provenance.sourceAssets.map((source, index) => normalizeSourceAsset(source, `${field}.sourceAssets[${index}]`));
  }
  return normalized;
}

function normalizeProcessing(processing, field) {
  assertObject(processing, field);
  const preset = cleanText(processing.preset, `${field}.preset`, 32);
  if (!SCREEN_PROCESSING_PRESETS.has(preset)) {
    throw new Error(`${field}.preset must be one of ${[...SCREEN_PROCESSING_PRESETS].join(", ")}`);
  }
  const normalized = {
    ...processing,
    preset,
  };
  if (processing.tools !== undefined) {
    if (!Array.isArray(processing.tools)) throw new Error(`${field}.tools must be an array`);
    normalized.tools = processing.tools.map((tool, index) => normalizeTool(tool, `${field}.tools[${index}]`));
  }
  return normalized;
}

function normalizeSourceAsset(source, field) {
  assertObject(source, field);
  const normalized = { ...source };
  if (source.id !== undefined) normalized.id = cleanSlug(source.id, `${field}.id`);
  if (source.source !== undefined) normalized.source = cleanRelativePath(source.source, `${field}.source`);
  if (source.original !== undefined) normalized.original = cleanRelativePath(source.original, `${field}.original`);
  if (source.width !== undefined) normalized.width = cleanInteger(source.width, `${field}.width`, 1, 100000);
  if (source.height !== undefined) normalized.height = cleanInteger(source.height, `${field}.height`, 1, 100000);
  if (source.mediaType !== undefined) normalized.mediaType = cleanOptionalText(source.mediaType, `${field}.mediaType`, 120);
  if (source.license !== undefined) normalized.license = cleanOptionalText(source.license, `${field}.license`, 120);
  if (source.selected !== undefined) normalized.selected = cleanBoolean(source.selected, `${field}.selected`);
  return normalized;
}

function normalizeTool(tool, field) {
  assertObject(tool, field);
  return {
    ...tool,
    name: cleanText(tool.name, `${field}.name`, 80),
    version: cleanOptionalText(tool.version, `${field}.version`, 80),
  };
}

function normalizePlaylistItem(item, field) {
  assertObject(item, field);
  return {
    ...item,
    manifest: cleanRelativePath(item.manifest, `${field}.manifest`),
    durationMs: cleanInteger(item.durationMs, `${field}.durationMs`, 1, 86400000),
    repeat: cleanInteger(item.repeat ?? 1, `${field}.repeat`, 1, 1000),
    transition: cleanTransition(item.transition ?? "cut", `${field}.transition`),
  };
}

async function validateManifestArtifacts(manifest, options) {
  const baseDir = manifestBaseDir(options);
  if (!baseDir) throw new Error("manifestPath or workspaceRoot is required to validate output artifacts");
  const workspaceRoot = cleanWorkspaceRoot(options.workspaceRoot);
  const verifyHashes = options.verifyHashes !== false;

  if (manifest.output.type === "static") {
    const outputPath = resolveWorkspaceReference(manifest.output.path, {
      baseDir,
      workspaceRoot,
      field: "output.path",
    });
    await validateImageArtifact(outputPath, manifest.output, "output", { verifyHashes });
    return;
  }

  const outputPath = resolveWorkspaceReference(manifest.output.path, {
    baseDir,
    workspaceRoot,
    field: "output.path",
  });
  await assertFile(outputPath, "output.path");

  for (const [index, frame] of manifest.output.frames.entries()) {
    const framePath = resolveWorkspaceReference(frame.path, {
      baseDir,
      workspaceRoot,
      field: `output.frames[${index}].path`,
    });
    await validateImageArtifact(framePath, frame, `output.frames[${index}]`, { verifyHashes });
  }
}

async function validateImageArtifact(filePath, expected, field, { verifyHashes }) {
  await assertFile(filePath, `${field}.path`);
  const metadata = await sharp(filePath).metadata();
  if (metadata.width !== SCREEN_WORKSPACE_WIDTH || metadata.height !== SCREEN_WORKSPACE_HEIGHT) {
    throw new Error(`${field}.path must be a ${SCREEN_WORKSPACE_WIDTH}x${SCREEN_WORKSPACE_HEIGHT} image artifact`);
  }

  if (!verifyHashes) return;
  const fileSha256 = await staticOutputFileSha256(filePath);
  if (fileSha256 !== expected.fileSha256) throw new Error(`${field}.fileSha256 does not match artifact bytes`);
  const rgbaHash = await rgbaPixelSha256FromImage(filePath);
  if (rgbaHash !== expected.rgbaPixelSha256) throw new Error(`${field}.rgbaPixelSha256 does not match decoded RGBA pixels`);
  const rgb565Hash = await rgb565PixelSha256FromImage(filePath);
  if (rgb565Hash !== expected.rgb565PixelSha256) throw new Error(`${field}.rgb565PixelSha256 does not match decoded RGB565 pixels`);
}

async function readRgbaPixels(filePath) {
  return sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function assertPixelBuffer(pixels, width, height, channels, field) {
  if (!Buffer.isBuffer(pixels) && !(pixels instanceof Uint8Array)) {
    throw new Error(`${field} must be a Buffer or Uint8Array`);
  }
  if (!Number.isInteger(width) || width <= 0) throw new Error(`${field} width must be a positive integer`);
  if (!Number.isInteger(height) || height <= 0) throw new Error(`${field} height must be a positive integer`);
  if (!Number.isInteger(channels) || channels < 3 || channels > 4) {
    throw new Error(`${field} channels must be 3 or 4`);
  }
  if (pixels.length !== width * height * channels) {
    throw new Error(`${field} length does not match width, height, and channels`);
  }
}

function manifestBaseDir(options) {
  if (options.manifestPath) return path.dirname(path.resolve(options.manifestPath));
  if (options.workspaceRoot) return path.join(path.resolve(options.workspaceRoot), "manifests");
  return null;
}

function playlistBaseDir(options) {
  if (options.playlistPath) return path.dirname(path.resolve(options.playlistPath));
  if (options.workspaceRoot) return path.join(path.resolve(options.workspaceRoot), "playlists");
  return null;
}

function cleanWorkspaceRoot(workspaceRoot) {
  return workspaceRoot ? path.resolve(workspaceRoot) : null;
}

function hasArtifactValidationContext(options) {
  return Boolean(options.manifestPath || options.workspaceRoot);
}

function resolveWorkspaceReference(relativePath, { baseDir, workspaceRoot, field }) {
  const resolved = path.resolve(baseDir, relativePath);
  if (workspaceRoot && !isPathInside(resolved, workspaceRoot)) {
    throw new Error(`${field} must stay inside the screen workspace`);
  }
  return resolved;
}

function isPathInside(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertFile(filePath, field) {
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    throw new Error(`${field} artifact is missing: ${filePath}`);
  }
  if (!stats.isFile()) throw new Error(`${field} artifact must be a file: ${filePath}`);
}

function assertPlaylistManifestReference(value, field) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized.endsWith(".json") || normalized.includes("/outputs/") || normalized.startsWith("outputs/")) {
    throw new Error(`${field} must reference a Screen Manifest JSON file, not a raw output artifact`);
  }
  if (!normalized.split("/").includes("manifests")) {
    throw new Error(`${field} must reference a file under screen/manifests`);
  }
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function cleanText(value, field, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if (!text) throw new Error(`${field} is required`);
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

function cleanOptionalText(value, field, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

function cleanSlug(value, field) {
  const text = cleanText(value, field, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) {
    throw new Error(`${field} must be a simple slug`);
  }
  return text;
}

function cleanRelativePath(value, field) {
  const text = cleanText(value, field, 260).replaceAll("\\", "/");
  if (URL_RE.test(text) || path.isAbsolute(text)) {
    throw new Error(`${field} must be a relative workspace path`);
  }
  if (text.includes("\0")) throw new Error(`${field} contains a null byte`);
  return text;
}

function cleanSha256(value, field) {
  const text = cleanText(value, field, 64).toLowerCase();
  if (!HASH_RE.test(text)) throw new Error(`${field} must be a SHA-256 hex digest`);
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

function cleanExactInteger(value, field, expected) {
  const number = cleanInteger(value, field, 0, Number.MAX_SAFE_INTEGER);
  if (number !== expected) throw new Error(`${field} must be ${expected}`);
  return number;
}

function cleanBoolean(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function cleanTransition(value, field) {
  const text = cleanText(value, field, 16);
  if (text !== "cut") throw new Error(`${field} must be cut`);
  return text;
}

function rejectControlText(value, field) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} contains control characters`);
  }
}

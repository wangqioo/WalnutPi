import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const SSH_HOST = process.env.SSH_HOST || "192.168.1.24";
const SSH_USER = process.env.SSH_USER || "root";
const SSH_PASSWORD = process.env.SSH_PASSWORD || "root";
const REMOTE_PROJECT_ROOT = process.env.WALNUT_REMOTE_PROJECT_ROOT || process.env.WALNUT_PROJECT_ROOT || "/home/pi/projects/WalnutPi";
const REMOTE_BUILD_USER = process.env.WALNUT_REMOTE_BUILD_USER || "pi";
const BASE_DIR = import.meta.dir;
const PROJECT_ROOT = path.resolve(BASE_DIR, "..");
const MODEL_FILE = "0c6390ea8b1ccf186ec099456954fd42.glb";
const SCREEN_MANIFEST_PATH = process.env.WALNUT_SCREEN_MANIFEST_PATH
  ? path.resolve(process.env.WALNUT_SCREEN_MANIFEST_PATH)
  : path.join(PROJECT_ROOT, "lvgl_app", "screen-manifest.json");
const ACTION_OUTPUT_LIMIT = 24_000;
const CAPTURE_OUTPUT_LIMIT = 1_500_000;
const SCREEN_FRAME_TICKET_TTL_MS = 10 * 60_000;
const parsedScreenRecordLimit = Number(process.env.WALNUT_SCREEN_RECORD_LIMIT || 50);
const SCREEN_RECORD_LIMIT = Number.isFinite(parsedScreenRecordLimit) && parsedScreenRecordLimit > 0
  ? Math.floor(parsedScreenRecordLimit)
  : 50;
const SCREEN_RECORDS_DIR = process.env.WALNUT_SCREEN_RECORDS_DIR || path.join(BASE_DIR, "screen-sync-records");
const screenFrameTickets = new Map();

const files = new Map([
  ["/", "model-terminal.html"],
  ["/model-terminal.html", "model-terminal.html"],
  ["/ssh-terminal.html", "ssh-terminal.html"],
  [`/${MODEL_FILE}`, MODEL_FILE],
]);

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
]);

function contentType(pathname) {
  const extension = pathname.match(/\.[^.]+$/)?.[0] || "";
  return mime.get(extension) || "application/octet-stream";
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

function previewOnly(url) {
  return url.searchParams.has("nossh");
}

function previewOnlyJson() {
  return json(
    {
      ok: false,
      title: "预览模式",
      failedStage: "preview",
      summary: "预览模式下不会连接核桃派。",
      output: "preview mode disables SSH, build, delivery, activation, and device writes",
    },
    403,
  );
}

async function previewOnlyScreenSyncResult(req) {
  const startedAt = new Date();
  const buildId = `screen-${startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  let envelope;
  try {
    envelope = await screenManifestEnvelope();
  } catch (error) {
    return persistScreenSyncResult({
      ok: false,
      title: "同步到核桃派",
      risk: "preview",
      mode: "preview",
      buildId,
      startedAt: startedAt.toISOString(),
      manifest: null,
      manifestHash: null,
      deliveryManifest: null,
      deliveryHash: null,
      artifactHash: null,
      evidence: null,
      screenEvidence: null,
      screenFrameUrl: null,
      command: null,
      code: 1,
      output: error.message,
      summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
      failedStage: "manifest",
    }, {}, 500);
  }
  const { manifest, manifestHash } = envelope;
  let clientManifestHash = null;
  try {
    const body = await req.json();
    clientManifestHash = typeof body.manifestHash === "string" ? body.manifestHash : null;
  } catch {
    clientManifestHash = null;
  }

  return persistScreenSyncResult({
    ok: false,
    title: "同步到核桃派",
    risk: "preview",
    mode: "preview",
    buildId,
    startedAt: startedAt.toISOString(),
    manifest,
    manifestHash,
    deliveryManifest: null,
    deliveryHash: null,
    artifactHash: null,
    evidence: null,
    screenEvidence: null,
    screenFrameUrl: null,
    command: null,
    code: 1,
    output: `preview mode disables SSH, build, delivery, activation, and device writes\nclient=${clientManifestHash || "(missing)"}\nserver=${manifestHash}`,
    summary: "预览模式下不会连接核桃派。",
    failedStage: "preview",
  }, {}, 403);
}

function stableStringify(value) {
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function remoteBuildShell(command) {
  if (!REMOTE_BUILD_USER) return command;
  return `sudo -n -u ${shellQuote(REMOTE_BUILD_USER)} sh -lc ${shellQuote(command)}`;
}

function limitedOutput(value, limit = ACTION_OUTPUT_LIMIT) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[local] output truncated`;
}

function safeRecordId(value) {
  const text = String(value || "");
  if (!/^[a-zA-Z0-9._-]+$/.test(text) || text.includes("..") || text === "." || text.startsWith(".")) return null;
  return text;
}

function screenRecordDir(buildId) {
  const id = safeRecordId(buildId);
  if (!id) return null;
  return path.join(SCREEN_RECORDS_DIR, id);
}

function screenRecordFrameUrl(buildId) {
  return `/api/screen/records/${encodeURIComponent(buildId)}/frame.png`;
}

function compactCommandResult(result) {
  return {
    ok: Boolean(result?.ok),
    code: result?.code ?? null,
    output: limitedOutput(String(result?.output || ""), 12_000),
  };
}

function screenRecordSummary(record) {
  return {
    schema: "walnutpi.screenSyncRecordSummary.v1",
    buildId: record.buildId,
    ok: record.ok,
    title: record.title,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    failedStage: record.failedStage,
    summary: record.summary,
    manifestHash: record.manifestHash,
    artifactHash: record.artifactHash,
    deliveryHash: record.deliveryHash,
    visualMatch: record.screenEvidence?.visualMatch || "unknown",
    frameHash: record.screenEvidence?.frame?.sha256 || null,
    hasFramePng: Boolean(record.framePng),
    frameUrl: record.framePng ? screenRecordFrameUrl(record.buildId) : null,
  };
}

function buildScreenRecord(result, commandResults = {}) {
  const finishedAt = new Date().toISOString();
  return {
    schema: "walnutpi.screenSyncRecord.v1",
    buildId: result.buildId,
    title: result.title || "同步到核桃派",
    ok: Boolean(result.ok),
    risk: result.risk || "write-low",
    mode: result.mode || "remote",
    startedAt: result.startedAt,
    finishedAt,
    failedStage: result.failedStage || null,
    summary: result.summary,
    manifest: result.manifest || null,
    manifestHash: result.manifestHash || null,
    deliveryManifest: result.deliveryManifest || null,
    deliveryHash: result.deliveryHash || null,
    artifactHash: result.artifactHash || null,
    screenEvidence: result.screenEvidence || result.evidence || null,
    command: result.command || null,
    commandResults: Object.fromEntries(
      Object.entries(commandResults).map(([name, value]) => [name, compactCommandResult(value)]),
    ),
    output: limitedOutput(String(result.output || ""), ACTION_OUTPUT_LIMIT),
    framePng: null,
  };
}

async function persistScreenSyncResult(result, commandResults = {}, status = 200) {
  try {
    await writeScreenRecord(buildScreenRecord(result, commandResults));
  } catch (error) {
    result.recordWarning = `screen sync record was not saved: ${error.message}`;
  }
  return json(result, status);
}

async function writeJsonFile(filePath, value) {
  await writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(filePath, { force: true });
  await rename(`${filePath}.tmp`, filePath);
}

async function writeScreenRecord(record) {
  const dir = screenRecordDir(record.buildId);
  if (!dir) return;

  await mkdir(dir, { recursive: true });
  const summary = screenRecordSummary(record);
  await writeJsonFile(path.join(dir, "record.json"), record);
  await writeJsonFile(path.join(dir, "summary.json"), summary);
  await trimScreenRecords();
}

async function updateScreenRecord(buildId, updater) {
  const dir = screenRecordDir(buildId);
  if (!dir) return null;

  const recordPath = path.join(dir, "record.json");
  let record;
  try {
    record = JSON.parse(await readFile(recordPath, "utf8"));
  } catch {
    return null;
  }

  const nextRecord = updater(record) || record;
  await writeJsonFile(recordPath, nextRecord);
  await writeJsonFile(path.join(dir, "summary.json"), screenRecordSummary(nextRecord));
  return nextRecord;
}

async function readScreenRecord(buildId) {
  const dir = screenRecordDir(buildId);
  if (!dir) return null;

  try {
    return JSON.parse(await readFile(path.join(dir, "record.json"), "utf8"));
  } catch {
    return null;
  }
}

async function readScreenRecordSummary(dirent) {
  const dir = path.join(SCREEN_RECORDS_DIR, dirent.name);
  try {
    const summary = JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8"));
    const hasFramePng = await fileExists(path.join(dir, "frame.png"));
    return {
      ...summary,
      hasFramePng,
      frameUrl: hasFramePng ? screenRecordFrameUrl(summary.buildId) : null,
    };
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listScreenRecords() {
  let entries = [];
  try {
    entries = await readdir(SCREEN_RECORDS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!safeRecordId(entry.name)) continue;
    const summary = await readScreenRecordSummary(entry);
    if (summary) summaries.push(summary);
  }
  summaries.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  return summaries;
}

async function trimScreenRecords() {
  const summaries = await listScreenRecords();
  const stale = summaries.slice(Math.max(SCREEN_RECORD_LIMIT, 1));
  for (const summary of stale) {
    const dir = screenRecordDir(summary.buildId);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

function runRemote(command, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return new Promise((resolve) => {
    const target = `${SSH_USER}@${SSH_HOST}`;
    const child = spawn(
      "sshpass",
      [
        "-e",
        "ssh",
        "-T",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        "-o",
        "ConnectTimeout=8",
        target,
        `sh -lc ${shellQuote(command)}`,
      ],
      {
        env: {
          ...process.env,
          SSHPASS: SSH_PASSWORD,
          TERM: "xterm-256color",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        output: limitedOutput(`${stdout}${stderr}\n[local] action timed out`.trim(), outputLimit),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: `[local] ${error.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok", outputLimit);
      resolve({ ok: code === 0, code, output });
    });
  });
}

function commandBlockResult(name, result) {
  return [
    `## ${name}`,
    `ok=${result.ok}`,
    `code=${result.code ?? "timeout"}`,
    result.output,
  ]
    .filter(Boolean)
    .join("\n");
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function parseFrameEvidence(result) {
  if (!result.ok) return null;
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

function validFrameEvidence(frame) {
  return Boolean(
    frame
      && typeof frame === "object"
      && validSha256(frame.sha256)
      && Number.isInteger(frame.byteLength)
      && frame.byteLength > 0
      && (!Number.isInteger(frame.expectedByteLength) || frame.expectedByteLength === frame.byteLength),
  );
}

function frameUrl(buildId) {
  return `/api/screen/frame/${encodeURIComponent(buildId)}`;
}

function cleanupScreenFrameTickets() {
  const now = Date.now();
  for (const [buildId, ticket] of screenFrameTickets.entries()) {
    if (now - ticket.createdAt > SCREEN_FRAME_TICKET_TTL_MS) {
      screenFrameTickets.delete(buildId);
    }
  }
}

function rememberScreenFrameTicket(buildId, ticket) {
  cleanupScreenFrameTickets();
  screenFrameTickets.set(buildId, {
    ...ticket,
    createdAt: Date.now(),
  });
}

function visualStatus(manifest, artifactHashValid, frameEvidence) {
  const frameCaptured = validFrameEvidence(frameEvidence);
  const target = manifest.target || {};
  const visualChecks = {
    manifestHashMatched: true,
    artifactHashValid,
    frameCaptured,
    frameDimensionsMatched: frameCaptured
      && frameEvidence.width === target.width
      && frameEvidence.height === target.height,
    framePixelFormatMatched: frameCaptured
      && target.color === "RGB565"
      && (frameEvidence.pixelFormat === "RGB565_LE" || frameEvidence.bitsPerPixel === 16),
    frameByteLengthMatched: frameCaptured
      && Number.isInteger(frameEvidence.expectedByteLength)
      && frameEvidence.expectedByteLength === frameEvidence.byteLength,
    frameNonblank: frameCaptured
      && frameEvidence.isBlank === false
      && Number(frameEvidence.nonzeroBytes || 0) > 0,
  };
  if (!frameCaptured) {
    return { visualMatch: "unknown", visualChecks };
  }
  return {
    visualMatch: Object.values(visualChecks).every(Boolean) ? "captured" : "mismatch",
    visualChecks,
  };
}

function validPngBytes(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return bytes.length > signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function parseCaptureResult(result) {
  if (!result.ok) return null;
  let capture;
  try {
    capture = JSON.parse(result.output);
  } catch {
    return null;
  }

  if (!capture || typeof capture !== "object" || !validSha256(capture.pngSha256) || typeof capture.pngBase64 !== "string") {
    return null;
  }

  const bytes = Buffer.from(capture.pngBase64, "base64");
  if (!validPngBytes(bytes) || sha256(bytes) !== capture.pngSha256) {
    return null;
  }
  return { capture, bytes };
}

async function handleScreenFrame(buildId) {
  cleanupScreenFrameTickets();
  const ticket = screenFrameTickets.get(buildId);
  if (!ticket) {
    return json(
      {
        ok: false,
        error: "unknown or expired screen frame",
        summary: "screen frame evidence is only available after a recent successful sync",
      },
      404,
    );
  }

  const captureResult = await runRemote("sudo -n walnut screen capture --png-base64", 30_000, CAPTURE_OUTPUT_LIMIT);
  const parsed = parseCaptureResult(captureResult);
  if (!parsed) {
    return json(
      {
        ok: false,
        error: "screen capture failed",
        output: captureResult.output,
      },
      502,
    );
  }

  let recordWarning = "";
  try {
    await cacheScreenFramePng(buildId, parsed);
  } catch (error) {
    recordWarning = `screen record frame was not cached: ${error.message}`;
  }

  return new Response(parsed.bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-walnut-png-sha256": parsed.capture.pngSha256,
      "x-walnut-raw-sha256": parsed.capture.rawSha256,
      "x-walnut-sync-raw-sha256": ticket.frameSha256 || "",
      "x-walnut-manifest-sha256": ticket.manifestHash,
      "x-walnut-artifact-sha256": ticket.artifactHash || "",
      "x-walnut-record-warning": recordWarning,
    },
  });
}

async function cacheScreenFramePng(buildId, parsed) {
  const dir = screenRecordDir(buildId);
  if (!dir) return;

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "frame.png"), parsed.bytes);

  const framePng = {
    capturedAt: new Date().toISOString(),
    pngSha256: parsed.capture.pngSha256,
    pngByteLength: parsed.capture.pngByteLength,
    rawSha256: parsed.capture.rawSha256,
    rawByteLength: parsed.capture.rawByteLength,
    width: parsed.capture.width,
    height: parsed.capture.height,
    pixelFormat: parsed.capture.pixelFormat,
    url: screenRecordFrameUrl(buildId),
  };

  await updateScreenRecord(buildId, (record) => {
    record.framePng = framePng;
    if (record.screenEvidence?.frame && typeof record.screenEvidence.frame === "object") {
      record.screenEvidence.frame.cachedUrl = framePng.url;
    }
    return record;
  });
}

async function handleScreenRecordFrame(buildId) {
  const id = safeRecordId(buildId);
  const dir = screenRecordDir(id);
  if (!id || !dir) return json({ ok: false, error: "Invalid screen record id" }, 400);

  let bytes;
  try {
    bytes = await readFile(path.join(dir, "frame.png"));
  } catch {
    return json({ ok: false, error: "screen record frame not found" }, 404);
  }

  if (!validPngBytes(bytes)) {
    return json({ ok: false, error: "screen record frame is not a valid PNG" }, 500);
  }

  const record = await readScreenRecord(id);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-walnut-png-sha256": record?.framePng?.pngSha256 || sha256(bytes),
      "x-walnut-raw-sha256": record?.framePng?.rawSha256 || record?.screenEvidence?.frame?.sha256 || "",
      "x-walnut-manifest-sha256": record?.manifestHash || "",
      "x-walnut-artifact-sha256": record?.artifactHash || "",
    },
  });
}

async function handleScreenRecord(buildId) {
  const id = safeRecordId(buildId);
  if (!id) return json({ ok: false, error: "Invalid screen record id" }, 400);

  const record = await readScreenRecord(id);
  if (!record) return json({ ok: false, error: "screen record not found" }, 404);

  return json({
    ok: true,
    record: {
      ...record,
      framePng: record.framePng
        ? {
            ...record.framePng,
            url: screenRecordFrameUrl(record.buildId),
          }
        : null,
    },
  });
}

async function handleScreenRecordList() {
  return json({
    ok: true,
    records: await listScreenRecords(),
  });
}

function firstFailure(buildResult, artifactHash, activateResult, stateResult, frameResult, frameEvidence, visual) {
  if (!buildResult.ok) {
    return {
      stage: "build",
      summary: "LVGL 构建失败。请在诊断里查看第一处编译错误。",
    };
  }
  if (!validSha256(artifactHash)) {
    return {
      stage: "artifact",
      summary: "LVGL 产物哈希校验失败。请在诊断里确认构建产物是否存在。",
    };
  }
  if (!activateResult.ok) {
    return {
      stage: "activate",
      summary: "核桃派屏幕激活失败。请确认 walnut-screen.service 已安装并允许 sudo 执行。",
    };
  }
  if (!stateResult.ok) {
    return {
      stage: "evidence",
      summary: "屏幕状态回证失败。请检查 SSH 连接和 walnut screen state 输出。",
    };
  }
  if (!frameResult.ok || !validFrameEvidence(frameEvidence)) {
    return {
      stage: "frame",
      summary: "屏幕画面回证失败。请在诊断里查看 framebuffer 读取结果。",
    };
  }
  if (visual.visualMatch !== "captured") {
    return {
      stage: "visual",
      summary: "屏幕画面回证和目标屏幕约束不一致。请在诊断里查看 frame checks。",
    };
  }
  return null;
}

function validateScreenManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("screen manifest must be a JSON object");
  }
  if (manifest.schema !== "walnutpi.screen.v1") {
    throw new Error("screen manifest schema must be walnutpi.screen.v1");
  }
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("screen manifest id is required");
  }
  if (!manifest.target || typeof manifest.target !== "object" || Array.isArray(manifest.target)) {
    throw new Error("screen manifest target is required");
  }
  if (!Number.isInteger(manifest.target.width) || manifest.target.width <= 0) {
    throw new Error("screen manifest target.width must be a positive integer");
  }
  if (!Number.isInteger(manifest.target.height) || manifest.target.height <= 0) {
    throw new Error("screen manifest target.height must be a positive integer");
  }
  if (manifest.target.color !== "RGB565") {
    throw new Error("screen manifest target.color must be RGB565");
  }
  if (!manifest.target.display || typeof manifest.target.display !== "string") {
    throw new Error("screen manifest target.display is required");
  }
  if (!manifest.source || typeof manifest.source !== "object" || Array.isArray(manifest.source)) {
    throw new Error("screen manifest source is required");
  }
  if (!manifest.source.lvglEntry || typeof manifest.source.lvglEntry !== "string") {
    throw new Error("screen manifest source.lvglEntry is required");
  }
  if (!manifest.source.command || typeof manifest.source.command !== "string") {
    throw new Error("screen manifest source.command is required");
  }
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) {
    throw new Error("screen manifest pages must be a non-empty array");
  }
  for (const [index, page] of manifest.pages.entries()) {
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      throw new Error(`screen manifest pages[${index}] must be an object`);
    }
    if (!page.id || typeof page.id !== "string") {
      throw new Error(`screen manifest pages[${index}].id is required`);
    }
  }
}

async function screenManifestEnvelope() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(SCREEN_MANIFEST_PATH, "utf8"));
  } catch (error) {
    throw new Error(`failed to read screen manifest ${SCREEN_MANIFEST_PATH}: ${error.message}`);
  }
  validateScreenManifest(manifest);
  const serializedManifest = stableStringify(manifest);
  return {
    manifest,
    manifestHash: sha256(serializedManifest),
  };
}

async function handleScreenSync(req) {
  const startedAt = new Date();
  const buildId = `screen-${startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  let envelope;
  try {
    envelope = await screenManifestEnvelope();
  } catch (error) {
    return persistScreenSyncResult(
      {
        title: "同步到核桃派",
        buildId,
        startedAt: startedAt.toISOString(),
        manifest: null,
        manifestHash: null,
        ok: false,
        risk: "write-low",
        mode: "remote",
        failedStage: "manifest",
        deliveryManifest: null,
        deliveryHash: null,
        artifactHash: null,
        evidence: null,
        screenEvidence: null,
        screenFrameUrl: null,
        command: null,
        code: 1,
        summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
        output: error.message,
      },
      {},
      500,
    );
  }
  const { manifest, manifestHash } = envelope;
  const baseResult = {
    title: "同步到核桃派",
    buildId,
    startedAt: startedAt.toISOString(),
    manifest,
    manifestHash,
  };
  let body = {};
  try {
    body = await req.json();
  } catch {
    return persistScreenSyncResult(
      {
        ...baseResult,
        ok: false,
        risk: "write-low",
        mode: "remote",
        failedStage: "manifest",
        deliveryManifest: null,
        deliveryHash: null,
        artifactHash: null,
        evidence: null,
        screenEvidence: null,
        screenFrameUrl: null,
        command: null,
        code: 1,
        summary: "同步请求缺少有效的 screen manifest hash，请刷新页面后再同步。",
        output: "request body is not valid JSON",
      },
      {},
      400,
    );
  }
  if (typeof body.manifestHash !== "string" || !validSha256(body.manifestHash)) {
    return persistScreenSyncResult(
      {
        ...baseResult,
        ok: false,
        risk: "write-low",
        mode: "remote",
        failedStage: "manifest",
        deliveryManifest: null,
        deliveryHash: null,
        artifactHash: null,
        evidence: null,
        screenEvidence: null,
        screenFrameUrl: null,
        command: null,
        code: 1,
        summary: body.manifestHash
          ? "同步请求包含无效的 screen manifest hash，请刷新页面后再同步。"
          : "同步请求缺少 screen manifest hash，请刷新页面后再同步。",
        output: `client=${body.manifestHash || "(missing)"}\nserver=${manifestHash}`,
      },
      {},
      400,
    );
  }

  if (body.manifestHash !== manifestHash) {
    return persistScreenSyncResult(
      {
        ...baseResult,
        ok: false,
        risk: "write-low",
        mode: "remote",
        failedStage: "manifest",
        deliveryManifest: null,
        deliveryHash: null,
        artifactHash: null,
        evidence: null,
        screenEvidence: null,
        screenFrameUrl: null,
        command: null,
        code: 1,
        summary: body.manifestHash
          ? "Web 预览和服务器 screen manifest 不一致，请刷新后再同步。"
          : "同步请求缺少 screen manifest hash，请刷新页面后再同步。",
        output: `client=${body.manifestHash || "(missing)"}\nserver=${manifestHash}`,
      },
      {},
      body.manifestHash ? 409 : 400,
    );
  }

  const buildCommand = [
    "set -e",
    `ROOT=${shellQuote(REMOTE_PROJECT_ROOT)}`,
    'cd "$ROOT"',
    "scripts/build-lvgl-app.sh",
  ].join("; ");
  const remoteBuildCommand = remoteBuildShell(buildCommand);
  const artifactCommand = remoteBuildShell(
    `set -e; ROOT=${shellQuote(REMOTE_PROJECT_ROOT)}; cd "$ROOT"; test -x build/lvgl_app/walnut-lvgl-screen; sha256sum build/lvgl_app/walnut-lvgl-screen | awk '{print $1}'`,
  );
  const activateCommand = "sudo -n walnut screen start";
  const stateCommand = "walnut screen state";
  const frameCommand = "sudo -n walnut screen frame";

  const buildResult = await runRemote(remoteBuildCommand, 120_000);
  const artifactResult = buildResult.ok
    ? await runRemote(artifactCommand, 10_000)
    : { ok: false, code: null, output: "skipped because build failed" };
  const artifactHash = artifactResult.ok ? artifactResult.output.trim().split(/\s+/)[0] : null;
  const artifactHashValid = validSha256(artifactHash);
  const deliveryManifest = {
    schema: "walnutpi.delivery.v1",
    buildId,
    adapter: "ssh-local-agent",
    risk: "write-low",
    artifact: {
      name: "walnut-lvgl-screen",
      path: "build/lvgl_app/walnut-lvgl-screen",
      source: "lvgl_app/src/main.c",
      sha256: artifactHashValid ? artifactHash : null,
    },
    target: {
      host: SSH_HOST,
      user: SSH_USER,
      buildUser: REMOTE_BUILD_USER || SSH_USER,
      projectRoot: REMOTE_PROJECT_ROOT,
      display: manifest.target.display,
      activate: activateCommand,
      evidence: [stateCommand, frameCommand],
    },
    screenManifestHash: manifestHash,
  };
  const deliveryHash = sha256(stableStringify(deliveryManifest));
  const activateResult = buildResult.ok && artifactHashValid
    ? await runRemote(activateCommand, 30_000)
    : {
        ok: false,
        code: null,
        output: buildResult.ok ? "skipped because artifact hash is invalid" : "skipped because build failed",
      };
  const stateResult = buildResult.ok && artifactHashValid && activateResult.ok
    ? await runRemote(stateCommand, 15_000)
    : {
        ok: false,
        code: null,
        output: !buildResult.ok
          ? "skipped because build failed"
          : artifactHashValid
            ? "skipped because activation failed"
            : "skipped because artifact hash is invalid",
      };
  const frameResult = buildResult.ok && artifactHashValid && activateResult.ok && stateResult.ok
    ? await runRemote(frameCommand, 15_000)
    : {
        ok: false,
        code: null,
        output: !buildResult.ok
          ? "skipped because build failed"
          : !artifactHashValid
            ? "skipped because artifact hash is invalid"
            : !activateResult.ok
              ? "skipped because activation failed"
              : "skipped because screen state evidence failed",
      };
  const frameEvidence = parseFrameEvidence(frameResult);
  if (frameEvidence) {
    frameEvidence.capturedAt = new Date().toISOString();
    frameEvidence.command = frameCommand;
  }

  const visual = visualStatus(manifest, artifactHashValid, frameEvidence);
  const frameImageUrl = validFrameEvidence(frameEvidence) ? frameUrl(buildId) : null;
  if (frameImageUrl) {
    rememberScreenFrameTicket(buildId, {
      manifestHash,
      artifactHash: artifactHashValid ? artifactHash : null,
      frameSha256: frameEvidence.sha256,
    });
  }

  const failure = firstFailure(buildResult, artifactHash, activateResult, stateResult, frameResult, frameEvidence, visual);
  const screenEvidence = {
    kind: "screen-frame",
    visualMatch: visual.visualMatch,
    visualChecks: visual.visualChecks,
    state: {
      kind: "screen-state",
      command: stateCommand,
      output: stateResult.output,
      capturedAt: new Date().toISOString(),
    },
    frame: validFrameEvidence(frameEvidence)
      ? {
          ...frameEvidence,
          url: frameImageUrl,
        }
      : {
          command: frameCommand,
          output: frameResult.output,
          capturedAt: new Date().toISOString(),
        },
  };
  const output = limitedOutput(
    [
      commandBlockResult("build", buildResult),
      commandBlockResult("artifact", artifactResult),
      commandBlockResult("activate", activateResult),
      commandBlockResult("evidence", stateResult),
      commandBlockResult("frame", frameResult),
    ].join("\n\n"),
  );

  const result = {
    ...baseResult,
    ok: failure === null,
    risk: "write-low",
    mode: "remote",
    deliveryManifest,
    deliveryHash,
    artifactHash: artifactHashValid ? artifactHash : null,
    evidence: screenEvidence,
    screenEvidence,
    screenFrameUrl: frameImageUrl,
    command: `${remoteBuildCommand}\n${activateCommand}\n${stateCommand}\n${frameCommand}`,
    code: failure ? 1 : 0,
    output,
    summary: failure
      ? failure.summary
      : "已同步到核桃派。Web 预览和设备运行使用同一个 screen manifest。",
    failedStage: failure?.stage || null,
  };

  return persistScreenSyncResult(result, {
    build: buildResult,
    artifact: artifactResult,
    activate: activateResult,
    evidence: stateResult,
    frame: frameResult,
  });
}

const ACTIONS = {
  status: {
    title: "查状态",
    risk: "read",
    mode: "remote",
    command: "walnut status",
    reply: "我会读取系统、网络、存储、服务和音频状态。",
    timeoutMs: 20_000,
  },
  snapshot: {
    title: "设备快照",
    risk: "read",
    mode: "remote",
    command: [
      "hostname",
      "uname -a",
      "cat /etc/WalnutPi-release 2>/dev/null || true",
      "cat /etc/os-release 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
      "gpio pins 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
    ].join("; "),
    reply: "我会先做只读设备快照，确认板子、系统、引脚和 overlay 状态。",
    timeoutMs: 20_000,
  },
  network: {
    title: "网络检查",
    risk: "read",
    mode: "remote",
    command: [
      "ip -br addr",
      "ip route show default",
      "nmcli -t -f ACTIVE,SSID,SIGNAL dev wifi 2>/dev/null || true",
    ].join("; "),
    reply: "我会检查 IP、默认路由和 Wi-Fi 状态。",
    timeoutMs: 12_000,
  },
  gpio: {
    title: "GPIO 检查",
    risk: "read",
    mode: "remote",
    command: [
      "gpio pins",
      "gpio pin i2c 2>/dev/null || true",
      "gpio pin spi 2>/dev/null || true",
      "gpio pin uart 2>/dev/null || true",
      "gpio pin pwm 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
    ].join("; "),
    reply: "我会只读检查引脚、总线和 overlay，避免误占用 GPIO。",
    timeoutMs: 20_000,
  },
  notes: {
    title: "今天笔记",
    risk: "read",
    mode: "remote",
    command: "walnut today",
    reply: "我会读取今天保存的核桃派笔记。",
    timeoutMs: 10_000,
  },
  note: {
    title: "记录笔记",
    risk: "write-low",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要记录的内容。");
      return `walnut note ${shellQuote(text)}`;
    },
    reply: "我会把这句话写进核桃派本地笔记。",
    timeoutMs: 10_000,
  },
  ai: {
    title: "WalnutAI Agent",
    risk: "read",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      return `walnut ai ${shellQuote(text)}`;
    },
    reply: "我会把自然语言交给 WalnutAI，由它判断是否需要先执行本地安全动作。",
    timeoutMs: 120_000,
  },
  video: {
    title: "彩色视频",
    risk: "interactive",
    mode: "terminal",
    command: "walnut video color",
    reply: "我会直接运行彩色 ASCII 视频命令，不打开菜单。",
  },
};

function actionSummary(action, id) {
  return {
    id,
    title: action.title,
    risk: action.risk,
    mode: action.mode,
    reply: action.reply,
  };
}

async function handleAction(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "请求不是有效 JSON。" }, 400);
  }

  const id = String(body.action || "");
  const action = ACTIONS[id];
  if (!action) {
    return json({ ok: false, error: "未知或未允许的动作。" }, 400);
  }

  let command = action.command;
  try {
    if (action.buildCommand) command = action.buildCommand(body);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  if (action.mode === "terminal") {
    return json({
      ok: true,
      ...actionSummary(action, id),
      command,
    });
  }

  const result = await runRemote(command, action.timeoutMs);
  return json({
    ok: result.ok,
    ...actionSummary(action, id),
    command,
    code: result.code,
    output: result.output,
  });
}

function startSsh(ws) {
  const target = `${SSH_USER}@${SSH_HOST}`;
  const child = spawn(
    "sshpass",
    [
      "-e",
      "ssh",
      "-tt",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      target,
    ],
    {
      env: {
        ...process.env,
        SSHPASS: SSH_PASSWORD,
        TERM: "xterm-256color",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  ws.data.child = child;

  const send = (chunk) => {
    try {
      ws.send(chunk);
    } catch {
      child.kill("SIGTERM");
    }
  };

  send(`\r\n[local] ssh ${target}\r\n\r\n`);
  child.stdout.on("data", send);
  child.stderr.on("data", send);

  child.on("error", (error) => {
    send(`\r\n[local] ${error.message}\r\n`);
    ws.close();
  });

  child.on("close", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    send(`\r\n[local] session closed (${reason})\r\n`);
    ws.close();
  });
}

function stopSsh(ws) {
  const child = ws.data.child;
  if (!child || child.killed) return;

  child.stdin.end();
  child.kill("SIGTERM");

  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 1000).unref?.();
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/terminal") {
      if (previewOnly(url)) {
        return new Response("SSH disabled for preview", { status: 403 });
      }
      const upgraded = server.upgrade(req, { data: { child: null } });
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/actions") {
      return json({
        target: `${SSH_USER}@${SSH_HOST}`,
        actions: Object.fromEntries(Object.entries(ACTIONS).map(([id, action]) => [id, actionSummary(action, id)])),
      });
    }

    if (url.pathname === "/api/screen/manifest") {
      try {
        return json(await screenManifestEnvelope());
      } catch (error) {
        return json(
          {
            ok: false,
            error: "screen manifest invalid",
            summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
            output: error.message,
          },
          500,
        );
      }
    }

    if (url.pathname === "/api/screen/sync") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyScreenSyncResult(req);
      return handleScreenSync(req);
    }

    if (url.pathname === "/api/screen/records") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRecordList();
    }

    const screenRecordFrameMatch = url.pathname.match(/^\/api\/screen\/records\/([^/]+)\/frame\.png$/);
    if (screenRecordFrameMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      let buildId;
      try {
        buildId = decodeURIComponent(screenRecordFrameMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen record id" }, 400);
      }
      return handleScreenRecordFrame(buildId);
    }

    const screenRecordMatch = url.pathname.match(/^\/api\/screen\/records\/([^/]+)$/);
    if (screenRecordMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      let buildId;
      try {
        buildId = decodeURIComponent(screenRecordMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen record id" }, 400);
      }
      return handleScreenRecord(buildId);
    }

    const screenFrameMatch = url.pathname.match(/^\/api\/screen\/frame\/([^/]+)$/);
    if (screenFrameMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      let buildId;
      try {
        buildId = decodeURIComponent(screenFrameMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen frame id" }, 400);
      }
      return handleScreenFrame(buildId);
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleAction(req);
    }

    const file = files.get(url.pathname);
    if (!file) {
      return new Response("Not found", { status: 404 });
    }

    const body = Bun.file(`${BASE_DIR}/${file}`);
    if (!(await body.exists())) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(body, {
      headers: {
        "content-type": contentType(file),
      },
    });
  },
  websocket: {
    open(ws) {
      startSsh(ws);
    },
    message(ws, message) {
      const child = ws.data.child;
      if (!child || child.killed || !child.stdin.writable) return;

      child.stdin.write(typeof message === "string" ? message : Buffer.from(message));
    },
    close(ws) {
      stopSsh(ws);
    },
  },
});

console.log(`Serving model terminal at http://${server.hostname}:${server.port}/`);
console.log(`Target: ${SSH_USER}@${SSH_HOST}`);
console.log(`Remote project root: ${REMOTE_PROJECT_ROOT}`);

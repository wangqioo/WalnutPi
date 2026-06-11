import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSshLocalAgentAdapter } from "./screen-delivery-adapters/ssh-local-agent.js";

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
const WALNUT_AI_CORPUS_DIR = process.env.WALNUT_AI_CORPUS_DIR || path.join(PROJECT_ROOT, "walnut-ai-terminal", "corpus");
const SCREEN_SUCCESS_CORPUS_PATH = path.join(WALNUT_AI_CORPUS_DIR, "screen-sync-successes.md");
const AI_MODEL = process.env.WALNUT_AI_MODEL || "gpt-5.4-mini";
const AI_BASE_URL = (process.env.WALNUT_AI_BASE_URL || "https://rehdasu.cn/v1").replace(/\/+$/, "");
const AI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_CONTEXT_LIMIT = 4;
const AI_CONTEXT_TEXT_LIMIT = 900;
const AI_TIMEOUT_SECONDS = Number(process.env.WALNUT_WEB_AI_TIMEOUT || 20);
const SSH_CONTROLMASTER_ENABLED = process.platform !== "win32"
  && !["0", "false", "no", "off"].includes(String(process.env.WALNUT_SSH_CONTROLMASTER || "1").toLowerCase());
const SSH_CONTROL_DIR = process.env.SSH_CONTROL_DIR || path.join(tmpdir(), `walnutpi-web-ssh-${process.getuid?.() || "user"}`);
const screenFrameTickets = new Map();
const WALNUT_MEMORY_DIR = process.env.WALNUT_MEMORY_DIR || path.join(process.env.HOME || process.env.USERPROFILE || PROJECT_ROOT, "walnut-memory");
const WALNUT_AI_MEMORY_FILE = process.env.WALNUT_AI_MEMORY_FILE || path.join(WALNUT_MEMORY_DIR, "memory.json");
const WALNUT_AI_SKILLS_DIR = process.env.WALNUT_AI_SKILLS_DIR || path.join(PROJECT_ROOT, "walnut-ai-terminal", "skills");
const WALNUT_AI_PRIMARY_SKILL = process.env.WALNUT_AI_PRIMARY_SKILL || "walnutpi-1b-zerow";
const MEMORY_FIELDS = ["preferences", "environment", "projects", "workflows", "goals", "summary"];
const RETRIEVAL_FILE_LIMIT = 5000;
const RETRIEVAL_RESULT_LIMIT = 8;
const WEB_SESSIONS_DIR = process.env.WALNUT_WEB_SESSIONS_DIR || path.join(BASE_DIR, "data", "sessions");
const WEB_SESSION_EVENT_LIMIT = Number(process.env.WALNUT_WEB_SESSION_EVENT_LIMIT || 300);

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

function emptyMemory() {
  return Object.fromEntries(MEMORY_FIELDS.map((field) => [field, []]));
}

function normalizeMemory(value) {
  const normalized = emptyMemory();
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const field of MEMORY_FIELDS) {
    if (!Array.isArray(value[field])) continue;
    const seen = new Set();
    for (const item of value[field]) {
      const text = String(item || "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      normalized[field].push(text);
    }
  }
  return normalized;
}

async function readWalnutMemory() {
  try {
    return normalizeMemory(JSON.parse(await readFile(WALNUT_AI_MEMORY_FILE, "utf8")));
  } catch {
    return emptyMemory();
  }
}

function tokenizeQuery(value) {
  const text = String(value || "").toLowerCase();
  const terms = new Set(text.match(/[a-z0-9_./:-]+|[\u4e00-\u9fff]{2,}/g) || []);
  const synonyms = [
    ["屏幕", ["screen", "lvgl", "fb0", "framebuffer"]],
    ["小屏", ["screen", "lvgl", "fb0", "framebuffer"]],
    ["同步", ["sync", "manifest", "delivery"]],
    ["记忆", ["memory", "retrieval"]],
    ["检索", ["retrieval", "skills", "corpus"]],
    ["成功代码", ["corpus", "recipe", "example"]],
    ["gpio", ["引脚", "排针"]],
    ["i2c", ["传感器", "sensor"]],
  ];
  for (const [key, values] of synonyms) {
    if (text.includes(key) || terms.has(key)) values.forEach((term) => terms.add(term));
  }
  return terms;
}

async function readTextFileLimited(filePath, limit = RETRIEVAL_FILE_LIMIT) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".md", ".json", ".txt", ".py", ".c", ".h"].includes(extension)) return "";
  try {
    return (await readFile(filePath, "utf8")).trim().slice(0, limit);
  } catch {
    return "";
  }
}

async function listRetrievalFiles() {
  const files = [
    path.join(WALNUT_AI_SKILLS_DIR, "walnutpi-core.md"),
    path.join(WALNUT_AI_SKILLS_DIR, "walnutpi-screen.md"),
    path.join(WALNUT_AI_SKILLS_DIR, WALNUT_AI_PRIMARY_SKILL, "SKILL.md"),
    path.join(WALNUT_AI_CORPUS_DIR, "successful-code.md"),
    SCREEN_SUCCESS_CORPUS_PATH,
  ];
  async function addDirectoryMarkdown(root, depth = 1) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(entryPath);
      if (entry.isDirectory() && depth > 0) {
        files.push(path.join(entryPath, "SKILL.md"));
      }
    }
  }
  await addDirectoryMarkdown(WALNUT_AI_SKILLS_DIR, 1);
  await addDirectoryMarkdown(path.join(WALNUT_AI_SKILLS_DIR, WALNUT_AI_PRIMARY_SKILL), 0);
  await addDirectoryMarkdown(WALNUT_AI_CORPUS_DIR, 0);
  return [...new Set(files.map((file) => path.resolve(file)))];
}

function scoreRetrievalFile(filePath, data, terms) {
  const lowerPath = filePath.toLowerCase();
  const haystack = `${lowerPath}\n${data.slice(0, 2000).toLowerCase()}`;
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (lowerPath.includes(term)) score += 3;
    else if (haystack.includes(term)) score += 1;
  }
  if (filePath.endsWith("walnutpi-core.md")) score += 1;
  if (filePath.endsWith("walnutpi-screen.md") && [...terms].some((term) => ["screen", "lvgl", "fb0", "framebuffer"].includes(term))) score += 4;
  if (filePath.endsWith("screen-sync-successes.md") && [...terms].some((term) => ["sync", "manifest", "delivery", "成功代码"].includes(term))) score += 4;
  return score;
}

async function retrieveWalnutContext(query) {
  const terms = tokenizeQuery(query);
  const files = await listRetrievalFiles();
  const results = [];
  for (const filePath of files) {
    const content = await readTextFileLimited(filePath);
    if (!content) continue;
    const score = scoreRetrievalFile(filePath, content, terms);
    if (score <= 0 && !filePath.endsWith("walnutpi-core.md") && !filePath.endsWith("walnutpi-screen.md")) continue;
    results.push({
      path: path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/"),
      score,
      preview: content,
    });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, RETRIEVAL_RESULT_LIMIT);
}

function safeSessionId(value) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9._-]{8,80}$/.test(text) || text.includes("..") || text.startsWith(".")) return null;
  return text;
}

function sessionPath(sessionId) {
  const id = safeSessionId(sessionId);
  if (!id) return null;
  return path.join(WEB_SESSIONS_DIR, `${id}.jsonl`);
}

function normalizeSessionEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const role = String(value.role || "").trim();
  if (!["user", "assistant", "system", "action"].includes(role)) return null;
  const content = sessionContent(value.content || "");
  if (!content && role !== "action") return null;
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    role,
    content,
    action: value.action ? clippedText(value.action, 120) : null,
    ok: typeof value.ok === "boolean" ? value.ok : null,
    command: value.command ? clippedText(value.command, 1000) : null,
    contextUsed: value.contextUsed && typeof value.contextUsed === "object" ? value.contextUsed : null,
  };
}

async function appendSessionEvent(sessionId, event) {
  const filePath = sessionPath(sessionId);
  const normalized = normalizeSessionEvent(event);
  if (!filePath || !normalized) return null;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized)}\n`, { encoding: "utf8", flag: "a" });
  return normalized;
}

async function readSessionEvents(sessionId, limit = WEB_SESSION_EVENT_LIMIT) {
  const filePath = sessionPath(sessionId);
  if (!filePath) return null;
  let data = "";
  try {
    data = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = data.split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines.slice(-limit)) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") events.push(parsed);
    } catch {
      // Ignore corrupt trailing lines; append-only history should still be readable.
    }
  }
  return events;
}

async function handleSession(req, url) {
  const sessionId = safeSessionId(url.searchParams.get("sessionId"));
  if (!sessionId) return json({ ok: false, error: "invalid sessionId" }, 400);

  if (req.method === "GET") {
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || WEB_SESSION_EVENT_LIMIT) || WEB_SESSION_EVENT_LIMIT));
    const events = await readSessionEvents(sessionId, limit);
    return json({
      ok: true,
      schema: "walnutpi.webSession.v1",
      sessionId,
      events: events || [],
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }
    const event = await appendSessionEvent(sessionId, body.event || body);
    if (!event) return json({ ok: false, error: "invalid session event" }, 400);
    return json({ ok: true, schema: "walnutpi.webSessionAppend.v1", sessionId, event });
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
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

function shortHash(value) {
  return typeof value === "string" && value.length >= 12 ? value.slice(0, 12) : null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function remoteBuildShell(command) {
  if (!REMOTE_BUILD_USER) return command;
  return `sudo -n -u ${shellQuote(REMOTE_BUILD_USER)} sh -lc ${shellQuote(command)}`;
}

function sshConnectionOptions() {
  const options = [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
  ];
  if (SSH_CONTROLMASTER_ENABLED) {
    mkdirSync(SSH_CONTROL_DIR, { recursive: true, mode: 0o700 });
    options.push(
      "-o",
      "ControlMaster=auto",
      "-o",
      "ControlPersist=600",
      "-o",
      `ControlPath=${path.join(SSH_CONTROL_DIR, "%C")}`,
    );
  }
  return options;
}

function limitedOutput(value, limit = ACTION_OUTPUT_LIMIT) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[local] output truncated`;
}

function clippedText(value, limit = AI_CONTEXT_TEXT_LIMIT) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function sessionContent(value) {
  return String(value || "").replace(/\0/g, "").trim();
}

function compactMemoryForPrompt(memory) {
  const labels = {
    preferences: "用户偏好",
    environment: "技术环境",
    projects: "项目事实",
    workflows: "工作流",
    goals: "长期目标",
    summary: "记忆摘要",
  };
  const lines = [];
  for (const field of MEMORY_FIELDS) {
    const values = Array.isArray(memory?.[field]) ? memory[field].slice(0, 5) : [];
    if (!values.length) continue;
    lines.push(`${labels[field]}：`);
    for (const value of values) lines.push(`- ${clippedText(value, 260)}`);
  }
  return lines.length ? lines.join("\n") : "暂无长期记忆。";
}

function compactRetrievalForPrompt(results) {
  if (!Array.isArray(results) || !results.length) return "无相关检索片段。";
  return results.slice(0, 5).map((item) => [
    `### ${item.path} (score=${item.score})`,
    clippedText(item.preview, 1200),
  ].join("\n")).join("\n\n");
}

function aiQuestionWithContext(text, messages = [], projectMemory = null) {
  const recent = Array.isArray(messages)
    ? messages
      .filter((message) => message && (message.role === "user" || message.role === "assistant"))
      .slice(-AI_CONTEXT_LIMIT)
      .map((message) => `${message.role === "user" ? "用户" : "WalnutAI"}：${clippedText(message.content)}`)
      .filter(Boolean)
    : [];

  return [
    "你是 WalnutAI Web 入口，面向新手操作核桃派。",
    "回答要短、直接、中文。需要实时设备状态时，不要编造，建议使用 Web 本地动作。",
    "常用入口：walnut action run ... --json、walnut-ai、walnut screen、walnut play、walnut video color。",
    "回答必须优先遵守项目记忆、skills 检索和成功代码语料；如果上下文没有证据，明确说需要检查。",
    "",
    "长期记忆：",
    compactMemoryForPrompt(projectMemory?.memory),
    "",
    "检索到的 WalnutPi 上下文：",
    compactRetrievalForPrompt(projectMemory?.retrieval),
    "",
    "最近对话：",
    recent.length ? recent.join("\n") : "（无）",
    "",
    "当前用户问题：",
    text,
  ].join("\n");
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

function firstDiagnosticLine(value) {
  const text = String(value || "");
  const preferred = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /error|failed|fatal|denied|missing|not found|permission|timeout|cmake|make|gcc|sudo/i.test(line));
  if (preferred) return preferred.slice(0, 500);
  const fallback = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return fallback ? fallback.slice(0, 500) : "";
}

function repairCommandOutput(record, commandName) {
  return record.commandResults?.[commandName]?.output || "";
}

function repairCandidateAction(kind, label, detail) {
  return { kind, label, detail };
}

function repairCandidateBase(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  return {
    schema: "walnutpi.screenRepairCandidate.v1",
    buildId: record.buildId,
    stage,
    confidence: "low",
    beginnerSummary: record.summary || "同步记录需要人工检查。",
    developerDiagnosis: firstDiagnosticLine(record.output) || record.output || "missing diagnostic output",
    proposedActions: [],
    requiresConfirmation: true,
    canAutoApply: false,
    autoApplyReason: "第一版只生成修复候选方案，不自动修改文件或触发设备动作。",
  };
}

function buildScreenRepairHint(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  const visualChecks = record.screenEvidence?.visualChecks || null;
  const commandByStage = {
    "screen-slice": "screen-slice",
    build: "build",
    validate: "validate",
    artifact: "artifact",
    activate: "activate",
    evidence: "evidence",
    frame: "frame",
    visual: "frame",
  };
  const commandName = commandByStage[stage] || "";
  const firstError = firstDiagnosticLine(commandName ? repairCommandOutput(record, commandName) : record.output);
  const baseEvidence = {
    buildId: record.buildId,
    failedStage: stage,
    command: commandName || null,
    firstError,
    visualMatch: record.screenEvidence?.visualMatch || "unknown",
    visualChecks,
  };

  const plans = {
    ok: {
      title: "不需要修复",
      summary: "这条同步记录已经成功。",
      beginnerReason: "核桃派已经完成同步。",
      developerDiagnosis: "record.ok=true，没有失败阶段。",
      suggestedActions: ["继续编辑小屏内容，或查看开发者诊断里的同步证据。"],
    },
    preview: {
      title: "预览模式不会同步",
      summary: "当前页面处于预览模式，所以不会连接核桃派。",
      beginnerReason: "预览模式只看 Web 效果，不会构建、SSH、激活或写设备。",
      developerDiagnosis: "URL 带有 ?nossh，后端在 sync 前返回 preview 阶段。",
      suggestedActions: ["去掉 URL 里的 ?nossh 后再点击同步。", "如果只想本地预览，可以忽略这条失败记录。"],
    },
    manifest: {
      title: "小屏配置需要刷新或修复",
      summary: "同步请求里的 screen manifest 不可用或已经过期。",
      beginnerReason: "Web 预览和服务器上的小屏配置不是同一个版本。",
      developerDiagnosis: firstError || "manifest 读取失败、JSON 无效、hash 缺失、hash 格式错误或 stale manifestHash。",
      suggestedActions: ["刷新页面，重新读取当前小屏预览。", "如果仍失败，检查 lvgl_app/screen-manifest.json 是否是有效 JSON。", "确认同步请求带的是最新 manifestHash。"],
    },
    "screen-slice": {
      title: "小屏程序下发失败",
      summary: "当前 Web 的小屏构建片段没有成功写到核桃派。",
      beginnerReason: "核桃派还没有拿到这次预览对应的小屏程序文件。",
      developerDiagnosis: firstError || "screen-slice 阶段没有成功写入 LVGL 源码、构建脚本、生成器或 manifest。",
      suggestedActions: ["检查 SSH 连接和远端 /home/pi/projects/WalnutPi 写入权限。", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向真实 checkout。", "修复权限后重新同步。"],
    },
    build: {
      title: "LVGL 构建失败",
      summary: "设备端没有成功编译小屏程序。",
      beginnerReason: "核桃派还没有生成可以运行的小屏程序。",
      developerDiagnosis: firstError || "构建命令没有返回可识别的第一处错误。",
      suggestedActions: ["先查看 command output 里的 build 段第一处错误。", "如果提示缺少 cmake、gcc、make 或系统头文件，在设备上运行 scripts/install-lvgl-build-deps.sh。", "如果是 C 编译错误，先修复 lvgl_app/src/main.c 或生成的 screen_config.h。"],
    },
    artifact: {
      title: "构建产物不可用",
      summary: "构建后没有拿到绑定当前预览的 LVGL 程序。",
      beginnerReason: "同步需要确认小屏程序文件真实存在，而且就是这次 Web 预览对应的版本。",
      developerDiagnosis: firstError || "artifact/validate 没有返回合法 SHA-256，或二进制没有包含当前 manifest hash。",
      suggestedActions: ["确认 lvgl_app/generated/screen_config.h 包含当前 manifest hash。", "确认 build/lvgl_app/walnut-lvgl-screen 存在且 strings 能看到当前 manifest hash。", "检查远端项目根是否指向 /home/pi/projects/WalnutPi。"],
    },
    activate: {
      title: "屏幕服务激活失败",
      summary: "程序已构建，但没有成功启动核桃派屏幕服务。",
      beginnerReason: "核桃派没有把新的小屏程序启动起来。",
      developerDiagnosis: firstError || "sudo -n walnut screen start 没有成功。",
      suggestedActions: ["确认 walnut screen start 在设备上可运行。", "检查 sudo -n 是否允许当前 SSH 用户启动 walnut-screen.service。", "查看 walnut-screen.service 状态和日志。"],
    },
    evidence: {
      title: "屏幕状态回证失败",
      summary: "屏幕启动后，状态命令没有返回可信证据。",
      beginnerReason: "系统无法确认屏幕服务是否真的在运行。",
      developerDiagnosis: firstError || "walnut screen state 没有成功。",
      suggestedActions: ["在设备上运行 walnut screen state 查看状态。", "确认 walnut-screen.service 存在且 active。", "如果服务刚启动，稍等几秒后重新同步。"],
    },
    frame: {
      title: "屏幕画面回证失败",
      summary: "无法读取到有效的 framebuffer 画面证据。",
      beginnerReason: "系统没有看到核桃派真实屏幕画面。",
      developerDiagnosis: firstError || "sudo -n walnut screen frame 没有返回合法 frame 元数据。",
      suggestedActions: ["确认 /dev/fb0 可读，且 walnut screen frame 能返回 JSON 元数据。", "确认 walnut-screen.service 正在占用小屏，而不是被其他 framebuffer 程序覆盖。", "检查 sudo -n walnut screen frame 权限。"],
    },
    visual: {
      title: "屏幕画面结构不一致",
      summary: "framebuffer 可读，但尺寸、格式、字节数或非空检查没有通过。",
      beginnerReason: "核桃派返回了画面，但不像当前目标小屏画面。",
      developerDiagnosis: visualChecks ? JSON.stringify(visualChecks, null, 2) : firstError || "visual checks 不完整。",
      suggestedActions: ["确认目标屏幕仍是 480x320 RGB565。", "确认 framebuffer 返回的 byteLength 等于 expectedByteLength。", "如果 frame 是空白，重启 walnut-screen.service 后再同步。"],
    },
    delivery: {
      title: "交付适配器失败",
      summary: "同步流程在 delivery adapter 内部异常退出。",
      beginnerReason: "同步程序自己出错了，还没有进入完整的构建和回证流程。",
      developerDiagnosis: firstError || record.output || "adapter exception without output",
      suggestedActions: ["查看 command output 里的异常堆栈。", "确认 sshpass、SSH 配置和 adapter 参数可用。", "修复 adapter 错误后重新同步。"],
    },
    unknown: {
      title: "同步失败原因不明确",
      summary: "同步记录没有提供明确的失败阶段。",
      beginnerReason: "系统知道同步失败，但还不能判断具体卡在哪里。",
      developerDiagnosis: firstError || record.output || "missing failedStage",
      suggestedActions: ["查看 developer diagnostics 里的 command output。", "保留 buildId，按输出里最早失败的命令继续排查。"],
    },
  };

  const selected = plans[stage] || plans.unknown;
  return {
    schema: "walnutpi.screenRepairHint.v1",
    buildId: record.buildId,
    stage,
    title: selected.title,
    summary: selected.summary,
    beginnerReason: selected.beginnerReason,
    developerDiagnosis: selected.developerDiagnosis,
    suggestedActions: selected.suggestedActions,
    evidence: baseEvidence,
    autoRepairAvailable: false,
  };
}

function buildScreenRepairCandidate(record) {
  const hint = record.repairHint || buildScreenRepairHint(record);
  const candidate = {
    ...repairCandidateBase(record),
    stage: hint.stage,
    beginnerSummary: hint.beginnerReason || hint.summary,
    developerDiagnosis: hint.developerDiagnosis,
  };
  const action = repairCandidateAction;
  const stagePlans = {
    ok: {
      confidence: "high",
      actions: [
        action("manual-check", "不需要修复", "这条同步记录已经成功，可以继续编辑小屏内容。"),
      ],
    },
    preview: {
      confidence: "high",
      actions: [
        action("refresh-and-retry", "退出预览模式", "去掉 URL 里的 ?nossh 后重新打开页面，再手动点击同步。"),
      ],
    },
    manifest: {
      confidence: "high",
      actions: [
        action("refresh-and-retry", "刷新小屏预览", "重新读取 /api/screen/manifest，确保同步请求携带最新 manifestHash。"),
        action("local-edit-plan", "检查 manifest JSON", "检查 lvgl_app/screen-manifest.json 是否是合法 JSON，schema 是否仍是 walnutpi.screen.v1。"),
      ],
    },
    "screen-slice": {
      confidence: "medium",
      actions: [
        action("device-check", "检查远端项目权限", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向真实 checkout，且构建用户可以写入 lvgl_app 和 scripts。"),
        action("manual-check", "查看 screen-slice 输出", "在开发者诊断 command output 的 screen-slice 段查看最早失败的 install、base64 或 chmod 行。"),
      ],
    },
    build: {
      confidence: "medium",
      actions: [
        action("manual-check", "查看 build 段第一处错误", "在开发者诊断 command output 的 build 段查找第一条 error、failed、fatal 或 permission 行。"),
        action("local-edit-plan", "检查生成配置和 LVGL 源码", "如果是 C 或生成头文件错误，检查 lvgl_app/generated/screen_config.h 和 lvgl_app/src/main.c。"),
      ],
    },
    artifact: {
      confidence: "medium",
      actions: [
        action("device-check", "检查 LVGL 产物", "确认远端 build/lvgl_app/walnut-lvgl-screen 存在且可执行，并包含当前 manifest hash。"),
        action("manual-check", "确认远端项目根", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向 /home/pi/projects/WalnutPi 或真实 checkout。"),
      ],
    },
    activate: {
      confidence: "medium",
      actions: [
        action("device-check", "检查屏幕服务", "确认 walnut-screen.service 已安装，且 sudo -n walnut screen start 可以运行。"),
        action("manual-check", "查看服务日志", "在设备上查看 walnut-screen.service 状态和最近日志，定位启动失败原因。"),
      ],
    },
    evidence: {
      confidence: "medium",
      actions: [
        action("device-check", "检查屏幕状态命令", "在设备上运行 walnut screen state，确认 walnut-screen.service 是 active。"),
        action("refresh-and-retry", "等待后重新同步", "如果服务刚启动，等待几秒后手动重新同步。"),
      ],
    },
    frame: {
      confidence: "medium",
      actions: [
        action("device-check", "检查 framebuffer 证据命令", "在设备上运行 sudo -n walnut screen frame，确认返回 JSON 元数据。"),
        action("manual-check", "检查 /dev/fb0 权限", "确认 /dev/fb0 可读，且没有其他 framebuffer 程序覆盖小屏。"),
      ],
    },
    visual: {
      confidence: "medium",
      actions: [
        action("manual-check", "检查画面结构字段", "查看 visualChecks，确认 480x320、RGB565、byteLength 和 nonblank 检查是否通过。"),
        action("device-check", "检查是否空白帧", "如果 frameNonblank=false，确认 walnut-screen.service 是否真的在绘制当前 LVGL 程序。"),
      ],
    },
    delivery: {
      confidence: "medium",
      actions: [
        action("manual-check", "查看 adapter 异常", "查看 command output 里的异常堆栈或 adapter 参数错误。"),
        action("manual-check", "检查 SSH 工具和参数", "确认 sshpass、SSH_HOST、SSH_USER、WALNUT_REMOTE_PROJECT_ROOT 和 WALNUT_REMOTE_BUILD_USER 配置可用。"),
      ],
    },
    unknown: {
      confidence: "low",
      actions: [
        action("manual-check", "按最早失败输出排查", "保留 buildId，查看 command output 中最早出现的 error、failed、fatal、permission 或 timeout 行。"),
      ],
    },
  };
  const plan = stagePlans[candidate.stage] || stagePlans.unknown;
  candidate.confidence = plan.confidence;
  candidate.proposedActions = plan.actions;
  candidate.evidence = candidate.stage === "ok"
    ? { ...hint.evidence, firstError: "" }
    : hint.evidence;
  return candidate;
}

function screenRepairConfirmationPhrase(buildId) {
  return `APPLY SCREEN REPAIR ${buildId}`;
}

function buildScreenRepairProposal(record) {
  const repairCandidate = buildScreenRepairCandidate(record);
  const confirmationPhrase = screenRepairConfirmationPhrase(record.buildId);
  const repairTargetPath = path.resolve(SCREEN_MANIFEST_PATH);
  const projectRoot = path.resolve(PROJECT_ROOT);
  const repairTargetInsideProject = repairTargetPath === projectRoot || repairTargetPath.startsWith(`${projectRoot}${path.sep}`);
  const repairRelativePath = path.relative(PROJECT_ROOT, repairTargetPath).replace(/\\/g, "/");
  const base = {
    schema: "walnutpi.screenRepairProposal.v1",
    buildId: record.buildId,
    stage: repairCandidate.stage,
    title: "屏幕修复提案",
    summary: "当前没有可安全自动应用的本地补丁。",
    canApply: false,
    requiresConfirmation: true,
    confirmationPhrase,
    proposedPatch: null,
    notes: [
      "生成修复提案不会 SSH、构建、激活、抓图、写文件或重新同步。",
      "只有输入精确确认短语后，才允许应用本地文件补丁。",
    ],
  };

  if (!repairTargetInsideProject) {
    return {
      ...base,
      notes: [
        ...base.notes,
        "当前 screen manifest 路径不在项目目录内，不能生成可应用补丁。",
      ],
    };
  }

  if (repairCandidate.stage === "manifest" && record.manifest) {
    const manifest = normalizeScreenManifest(record.manifest);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    return {
      ...base,
      summary: "可以把这条记录中的 screen manifest 写回本地 manifest 文件，然后重新预览并手动同步。",
      canApply: true,
      proposedPatch: {
        schema: "walnutpi.screenRepairPatch.v1",
        kind: "replace-file",
        risk: "write-low",
        path: repairRelativePath,
        bytes: Buffer.byteLength(manifestText, "utf8"),
        sha256: sha256(manifestText),
        preview: manifestText.slice(0, 4000),
      },
      notes: [
        ...base.notes,
        "应用后只更新本地 manifest 文件，不会自动构建、连接核桃派或重新同步。",
      ],
    };
  }

  return {
    ...base,
    notes: [
      ...base.notes,
      "这条记录的失败阶段不适合自动生成本地补丁，请按 repairCandidate 的建议人工处理。",
    ],
  };
}

function screenSummaryEvidence(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  const commandByStage = {
    build: "build",
    artifact: "artifact",
    activate: "activate",
    evidence: "evidence",
    frame: "frame",
    visual: "frame",
  };
  const commandName = commandByStage[stage] || "";
  const repairCandidate = buildScreenRepairCandidate(record);
  return {
    buildId: record.buildId,
    ok: Boolean(record.ok),
    failedStage: record.failedStage || null,
    summary: record.summary || "",
    manifestHashShort: shortHash(record.manifestHash),
    artifactHashShort: shortHash(record.artifactHash),
    deliveryHashShort: shortHash(record.deliveryHash),
    visualMatch: record.screenEvidence?.visualMatch || "unknown",
    visualChecks: record.screenEvidence?.visualChecks || null,
    repairHint: record.repairHint
      ? {
          stage: record.repairHint.stage,
          title: record.repairHint.title,
          summary: record.repairHint.summary,
          beginnerReason: record.repairHint.beginnerReason,
        }
      : null,
    repairCandidate: {
      stage: repairCandidate.stage,
      confidence: repairCandidate.confidence,
      beginnerSummary: repairCandidate.beginnerSummary,
      proposedActions: repairCandidate.proposedActions,
      canAutoApply: repairCandidate.canAutoApply,
    },
    firstDiagnosticLine: firstDiagnosticLine(commandName ? repairCommandOutput(record, commandName) : record.output),
  };
}

function localScreenAiSummary(evidence) {
  if (evidence.ok) {
    if (evidence.visualMatch === "captured") {
      return "已同步到核桃派。设备返回了有效的小屏画面证据，Web 预览和设备运行使用同一个 screen manifest。";
    }
    return "同步记录显示已完成，但画面证据还需要在开发者诊断里确认。";
  }

  const stage = evidence.failedStage || "unknown";
  const nextAction = evidence.repairCandidate?.proposedActions?.[0]?.label
    || evidence.repairHint?.summary
    || "查看开发者诊断里的 command output";
  const reason = evidence.repairCandidate?.beginnerSummary
    || evidence.repairHint?.beginnerReason
    || evidence.summary
    || "同步失败，原因还需要进一步确认。";
  return `同步失败，卡在 ${stage} 阶段。${reason} 下一步建议：${nextAction}。`;
}

function parseResponsesOutput(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function callScreenSummaryAi(evidence) {
  if (!AI_API_KEY) return { text: null, error: null, apiUsed: false };
  const prompt = [
    "你是 WalnutPi Web 控制台的同步结果总结器。",
    "只根据提供的 JSON 证据总结，不要编造没有发生的动作。",
    "用中文，面向小白，最多三句话。",
    "如果同步失败，说清失败阶段和最安全的下一步。",
    "",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
  const response = await fetch(`${AI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      input: [
        { role: "system", content: "你只总结已提供的设备执行证据。" },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return { text: null, error: `API HTTP ${response.status}: ${detail.slice(0, 800)}`, apiUsed: true };
  }
  const data = await response.json();
  const text = parseResponsesOutput(data);
  return { text: text || null, error: text ? null : "API response did not include output text", apiUsed: true };
}

async function buildScreenAiSummary(record) {
  const evidence = screenSummaryEvidence(record);
  const localSummary = localScreenAiSummary(evidence);
  let source = "local";
  let summary = localSummary;
  let apiError = null;
  let apiUsed = false;

  try {
    const ai = await callScreenSummaryAi(evidence);
    apiUsed = ai.apiUsed;
    if (ai.text) {
      source = "ai";
      summary = ai.text;
    } else if (ai.error) {
      source = "ai-fallback";
      apiError = ai.error;
    }
  } catch (error) {
    source = "ai-fallback";
    apiUsed = true;
    apiError = error.message;
  }

  return {
    schema: "walnutpi.screenAiSummary.v1",
    buildId: record.buildId,
    source,
    summary,
    evidence,
    diagnostics: {
      model: apiUsed ? AI_MODEL : null,
      apiUsed,
      apiError,
    },
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
    pixelEvidenceStatus: record.screenEvidence?.pixelEvidence?.status || null,
    pixelEvidenceClaim: record.screenEvidence?.pixelEvidence?.claim || null,
    pixelSampleHash: record.screenEvidence?.pixelEvidence?.sampleHash || null,
    webDevicePixelDiffSchema: record.webDevicePixelDiff?.schema || null,
    webDevicePixelDiffStatus: record.webDevicePixelDiff?.status || null,
    webDevicePixelDiffRatio: record.webDevicePixelDiff?.diffRatio ?? null,
    webDevicePixelDiffSource: record.webDevicePixelDiff?.source || null,
    webDevicePixelDiffWidth: record.webDevicePixelDiff?.width ?? null,
    webDevicePixelDiffHeight: record.webDevicePixelDiff?.height ?? null,
    webDevicePixelDiffComparedPixels: record.webDevicePixelDiff?.comparedPixels ?? null,
    previewSignatureHash: record.screenEvidence?.semantic?.previewSignatureHash || null,
    deviceSignatureHash: record.screenEvidence?.semantic?.deviceSignatureHash || null,
    hasFramePng: Boolean(record.framePng),
    frameUrl: record.framePng ? screenRecordFrameUrl(record.buildId) : null,
    repairHint: record.repairHint
      ? {
          stage: record.repairHint.stage,
          title: record.repairHint.title,
          summary: record.repairHint.summary,
          autoRepairAvailable: record.repairHint.autoRepairAvailable,
        }
      : null,
  };
}

function buildScreenRecord(result, commandResults = {}) {
  const finishedAt = new Date().toISOString();
  const record = {
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
    webDevicePixelDiff: null,
  };
  record.repairHint = record.ok ? null : buildScreenRepairHint(record);
  return record;
}

async function persistScreenSyncResult(result, commandResults = {}, status = 200) {
  try {
    const record = buildScreenRecord(result, commandResults);
    if (!result.repairHint) result.repairHint = record.repairHint;
    await writeScreenRecord(record);
    await rememberSuccessfulScreenSync(record);
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

function successfulScreenSyncEntry(record) {
  const manifest = record.manifest || {};
  const labels = Array.isArray(manifest.labels)
    ? manifest.labels.map((item) => item?.text).filter(Boolean).slice(0, 6)
    : [];
  const cards = Array.isArray(manifest.cards)
    ? manifest.cards.map((item) => item?.title).filter(Boolean).slice(0, 6)
    : [];
  const visualChecks = record.screenEvidence?.visualChecks || {};
  const semantic = record.screenEvidence?.semantic || {};
  const lines = [
    `## ${record.buildId}`,
    "",
    "- kind: screen-sync-success",
    `- finishedAt: ${record.finishedAt || ""}`,
    `- manifestHash: ${record.manifestHash || ""}`,
    `- artifactHash: ${record.artifactHash || ""}`,
    `- deliveryHash: ${record.deliveryHash || ""}`,
    `- visualMatch: ${record.screenEvidence?.visualMatch || "unknown"}`,
    `- frameHash: ${record.screenEvidence?.frame?.sha256 || ""}`,
    `- previewSignatureHash: ${semantic.previewSignatureHash || ""}`,
    `- deviceSignatureHash: ${semantic.deviceSignatureHash || ""}`,
    `- checks: width=${visualChecks.width || ""} height=${visualChecks.height || ""} nonblank=${visualChecks.frameNonblank ?? ""}`,
    `- labels: ${labels.join(" | ") || "none"}`,
    `- cards: ${cards.join(" | ") || "none"}`,
    `- summary: ${String(record.summary || "").replace(/\s+/g, " ").slice(0, 500)}`,
    "",
    "Reuse this pattern for manifest-driven LVGL screen sync: require current manifestHash, build with scripts/build-lvgl-app.sh, activate with sudo -n walnut screen start, verify with walnut screen state and sudo -n walnut screen frame.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function rememberSuccessfulScreenSync(record) {
  if (!record?.ok) return;
  if (!record.buildId || record.mode === "preview") return;
  await mkdir(WALNUT_AI_CORPUS_DIR, { recursive: true });
  let existing = "";
  try {
    existing = await readFile(SCREEN_SUCCESS_CORPUS_PATH, "utf8");
  } catch {
    existing = "# WalnutPi Screen Sync Successes\n\nThis file is auto-appended by the Web screen sync flow. It stores compact successful patterns only, not command logs or image bytes.\n\n";
  }
  if (existing.includes(`## ${record.buildId}`)) return;
  await writeFile(SCREEN_SUCCESS_CORPUS_PATH, `${existing.trimEnd()}\n\n${successfulScreenSyncEntry(record)}`, "utf8");
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
        ...sshConnectionOptions(),
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ConnectionAttempts=1",
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

function runRemoteScript(script, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return new Promise((resolve) => {
    const target = `${SSH_USER}@${SSH_HOST}`;
    const child = spawn(
      "sshpass",
      [
        "-e",
        "ssh",
        "-T",
        ...sshConnectionOptions(),
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ConnectionAttempts=1",
        target,
        "sh",
      ],
      {
        env: {
          ...process.env,
          SSHPASS: SSH_PASSWORD,
        },
        stdio: ["pipe", "pipe", "pipe"],
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
        output: limitedOutput(`${stdout}${stderr}\n[local] remote script timed out after ${timeoutMs}ms`.trim(), outputLimit),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.on("error", () => {});
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
    child.stdin.end(String(script || "").replace(/\r\n/g, "\n"));
  });
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

const screenDeliveryAdapters = new Map([
  [
    "ssh-local-agent",
    createSshLocalAgentAdapter({
      localProjectRoot: PROJECT_ROOT,
      remoteProjectRoot: REMOTE_PROJECT_ROOT,
      remoteBuildUser: REMOTE_BUILD_USER,
      sshHost: SSH_HOST,
      sshUser: SSH_USER,
      runRemote,
      runRemoteScript,
      shellQuote,
      remoteBuildShell,
      sha256,
      stableStringify,
      validSha256,
      limitedOutput,
      frameUrl,
    }),
  ],
]);

function screenDeliveryAdapter(id = "ssh-local-agent") {
  const adapter = screenDeliveryAdapters.get(id);
  if (!adapter) throw new Error(`unknown screen delivery adapter: ${id}`);
  return adapter;
}

const SCREEN_PAGE_IDS = ["home", "system", "ai", "network"];
const SCREEN_TEXT_LIMIT = 48;
const SCREEN_LINE_LIMIT = 72;
const SCREEN_TONES = new Set(["ok", "warn", "error"]);
const SCREEN_COMPONENT_TYPES = new Set(["statusCard", "metricGroup", "list", "progress", "alert", "textPage"]);

const SCREEN_TEMPLATES = [
  {
    id: "device-status",
    label: "设备状态",
    summary: "显示核桃派核心状态、系统、AI 和网络。",
    manifest: {
      title: "WalnutPi",
      subtitle: "server screen",
      pages: [
        { id: "home", tab: "HOME", status: "OK CORE", metrics: ["IP loading", "MEM --", "DISK --"] },
        { id: "system", tab: "SYS", title: "System", lines: ["CPU load", "Memory", "Disk", "Uptime"] },
        { id: "ai", tab: "AI", title: "AI Agent", lines: ["Local shell online", "Cloud model ready", "Screen cards active"] },
        { id: "network", tab: "NET", title: "Network", lines: ["IP", "FRP", "SSH", "Display fbdev"] },
      ],
    },
  },
  {
    id: "ai-task-board",
    label: "AI 任务板",
    summary: "突出当前 AI 任务、运行状态和下一步。",
    manifest: {
      title: "WalnutAI",
      subtitle: "task board",
      pages: [
        { id: "home", tab: "TASK", status: "AI READY", metrics: ["Plan ready", "Sync safe", "Logs open"] },
        { id: "system", tab: "RUN", title: "Runtime", lines: ["Agent online", "Shell ready", "Screen active", "Evidence saved"] },
        { id: "ai", tab: "AI", title: "Current Task", lines: ["Waiting for intent", "Will ask before risk", "Summaries use evidence"] },
        { id: "network", tab: "NEXT", title: "Next Steps", lines: ["Preview first", "Sync after confirm", "Check frame evidence"] },
      ],
    },
  },
  {
    id: "network-panel",
    label: "网络面板",
    summary: "突出 IP、SSH、FRP 和连接状态。",
    manifest: {
      title: "WalnutNet",
      subtitle: "network panel",
      pages: [
        { id: "home", tab: "NET", status: "LINK OK", metrics: ["IP loading", "SSH ready", "FRP check"] },
        { id: "system", tab: "SYS", title: "System Link", lines: ["Screen active", "Agent ready", "Logs available", "Safe sync"] },
        { id: "ai", tab: "AI", title: "Remote Agent", lines: ["Local actions gated", "Evidence first", "No public root shell"] },
        { id: "network", tab: "LAN", title: "Network", lines: ["IP", "Default route", "FRP", "SSH"] },
      ],
    },
  },
  {
    id: "health-alert",
    label: "健康告警",
    summary: "突出告警状态、风险指标和需要检查的项目。",
    manifest: {
      title: "WalnutAlert",
      subtitle: "health watch",
      pages: [
        { id: "home", tab: "ALRT", status: "WARN", tone: "warn", progress: 62, metrics: ["CPU watch", "MEM high", "Disk ok"] },
        { id: "system", tab: "SYS", title: "System Alerts", lines: ["CPU load watch", "Memory high", "Disk ok", "Check uptime"] },
        { id: "ai", tab: "AI", title: "AI Assist", lines: ["Collect evidence", "Explain risk", "No auto repair", "Ask before writes"] },
        { id: "network", tab: "NET", title: "Network Risk", lines: ["LAN reachable", "SSH guarded", "FRP check", "No public shell"] },
      ],
    },
  },
  {
    id: "music-player",
    label: "音乐播放器",
    summary: "把音乐软件想法落成核桃派小屏播放器预览。",
    manifest: {
      title: "WalnutMusic",
      subtitle: "music player",
      pages: [
        { id: "home", tab: "PLAY", status: "MUSIC READY", tone: "ok", progress: 38, metrics: ["Track queue", "Vol --", "Local audio"] },
        { id: "system", tab: "LIB", title: "Music Library", lines: ["Scan music-library", "MP3 FLAC WAV", "Playlist ready", "No cloud needed"] },
        { id: "ai", tab: "CTL", title: "Player Controls", lines: ["Play pause next", "Volume guarded", "Use walnut play", "Terminal fallback"] },
        { id: "network", tab: "SYNC", title: "WalnutPi Sync", lines: ["Preview first", "Sync to fbdev", "Evidence frame", "Ask before writes"] },
      ],
    },
  },
];

function rejectControlText(value, field) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} contains control characters`);
  }
}

function cleanText(value, field, limit = SCREEN_TEXT_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if (!text) throw new Error(`${field} is required`);
  if ([...text].length > limit) {
    throw new Error(`${field} is too long`);
  }
  return text;
}

function cleanOptionalText(value, field, limit = SCREEN_TEXT_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if ([...text].length > limit) {
    throw new Error(`${field} is too long`);
  }
  return text;
}

function cleanTextList(values, field, maxItems, limit = SCREEN_LINE_LIMIT) {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  const items = values.map((value, index) => cleanText(value, `${field}[${index}]`, limit));
  if (items.length === 0 || items.length > maxItems) {
    throw new Error(`${field} must contain 1-${maxItems} items`);
  }
  return items;
}

function cleanTone(value, field) {
  const tone = String(value || "ok").trim().toLowerCase();
  if (!SCREEN_TONES.has(tone)) throw new Error(`${field} must be ok, warn, or error`);
  return tone;
}

function cleanProgress(value, field) {
  if (value === undefined || value === null || value === "") return 72;
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
  return Math.round(progress);
}

function cleanScreenComponent(component, field) {
  if (!component || typeof component !== "object" || Array.isArray(component)) {
    throw new Error(`${field} must be an object`);
  }
  const type = cleanText(component.type, `${field}.type`, 16);
  if (!SCREEN_COMPONENT_TYPES.has(type)) throw new Error(`${field}.type is not supported`);
  if (type === "statusCard") {
    return {
      type,
      label: cleanText(component.label || "Status", `${field}.label`, 12),
      value: cleanText(component.value || "OK CORE", `${field}.value`, 24),
      tone: cleanTone(component.tone || "ok", `${field}.tone`),
      detail: cleanText(component.detail || "Ready", `${field}.detail`, 24),
    };
  }
  if (type === "metricGroup") {
    if (!Array.isArray(component.items)) throw new Error(`${field}.items must be an array`);
    if (component.items.length === 0 || component.items.length > 3) {
      throw new Error(`${field}.items must contain 1-3 items`);
    }
    return {
      type,
      items: component.items.map((item, index) => {
        const itemObject = item && typeof item === "object" && !Array.isArray(item) ? item : null;
        return {
          label: cleanText(itemObject ? itemObject.label || `M${index + 1}` : item, `${field}.items[${index}].label`, 12),
          value: cleanText(itemObject ? itemObject.value || "--" : item, `${field}.items[${index}].value`, 16),
          unit: cleanOptionalText(itemObject ? itemObject.unit || "" : "", `${field}.items[${index}].unit`, 8),
          tone: cleanTone(itemObject ? itemObject.tone || "ok" : "ok", `${field}.items[${index}].tone`),
        };
      }),
    };
  }
  if (type === "list") {
    return {
      type,
      title: cleanText(component.title || "List", `${field}.title`, 32),
      items: cleanTextList(component.items || [], `${field}.items`, 4, 48),
    };
  }
  if (type === "progress") {
    return {
      type,
      label: cleanText(component.label || "Progress", `${field}.label`, 16),
      value: cleanProgress(component.value ?? 72, `${field}.value`),
      max: cleanProgress(component.max ?? 100, `${field}.max`),
      tone: cleanTone(component.tone || "ok", `${field}.tone`),
    };
  }
  if (type === "alert") {
    return {
      type,
      title: cleanText(component.title || "Alert", `${field}.title`, 32),
      body: cleanText(component.body || "Check status", `${field}.body`, 48),
      tone: cleanTone(component.tone || "warn", `${field}.tone`),
    };
  }
  return {
    type,
    title: cleanText(component.title || "Page", `${field}.title`, 32),
    lines: cleanTextList(component.lines || [], `${field}.lines`, 4, 48),
  };
}

function normalizeScreenComponents(page, pageIndex) {
  if (page.components === undefined) return [];
  if (!Array.isArray(page.components)) throw new Error(`pages[${pageIndex}].components must be an array`);
  if (page.components.length > 6) throw new Error(`pages[${pageIndex}].components must contain at most 6 items`);
  const normalized = page.components.map((component, index) => cleanScreenComponent(component, `pages[${pageIndex}].components[${index}]`));
  const seenTypes = new Set();
  for (const component of normalized) {
    if (seenTypes.has(component.type)) throw new Error(`pages[${pageIndex}].components must not repeat ${component.type}`);
    seenTypes.add(component.type);
  }
  return normalized;
}

function firstScreenComponent(components, type) {
  return components.find((component) => component.type === type) || null;
}

function screenMetricText(item) {
  const value = `${item.value} ${item.unit || ""}`.trim();
  return cleanText(`${item.label} ${value}`.trim(), "metricGroup.item", 24);
}

function metricItemFromText(value, index) {
  const text = cleanText(value, `pages[0].metrics[${index}]`, 24);
  const [label, ...rest] = text.split(/\s+/);
  return {
    label: cleanText(label || `M${index + 1}`, `pages[0].metrics[${index}].label`, 12),
    value: cleanText(rest.join(" ") || "--", `pages[0].metrics[${index}].value`, 16),
    unit: "",
    tone: "ok",
  };
}

function componentLines(page, components, pageIndex) {
  const alert = firstScreenComponent(components, "alert");
  const textPage = firstScreenComponent(components, "textPage");
  const listComponent = firstScreenComponent(components, "list");
  if (alert) {
    return {
      title: alert.title,
      lines: cleanTextList([alert.body], `pages[${pageIndex}].componentLines`, 4, 48),
    };
  }
  if (listComponent) {
    return {
      title: listComponent.title,
      lines: cleanTextList(listComponent.items.slice(0, 4), `pages[${pageIndex}].componentLines`, 4, 48),
    };
  }
  if (textPage) {
    return {
      title: textPage.title,
      lines: cleanTextList(textPage.lines.slice(0, 4), `pages[${pageIndex}].componentLines`, 4, 48),
    };
  }
  const title = cleanText(page.title || page.tab || SCREEN_PAGE_IDS[pageIndex], `pages[${pageIndex}].title`, 32);
  return {
    title,
    lines: cleanTextList(page.lines || [title], `pages[${pageIndex}].lines`, 4, 48),
  };
}

function buildHomeComponents(page, status, tone, progress, metrics, existingComponents) {
  const components = existingComponents.filter((component) => !["statusCard", "progress", "metricGroup"].includes(component.type));
  const existingStatusCard = firstScreenComponent(existingComponents, "statusCard");
  const existingProgress = firstScreenComponent(existingComponents, "progress");
  const existingMetricGroup = firstScreenComponent(existingComponents, "metricGroup");
  components.unshift({
    type: "metricGroup",
    items: existingMetricGroup?.items || metrics.map(metricItemFromText),
  });
  components.unshift({
    type: "progress",
    label: existingProgress?.label || "Progress",
    value: progress,
    max: existingProgress?.max || 100,
    tone,
  });
  components.unshift({
    type: "statusCard",
    label: existingStatusCard?.label || "Status",
    value: status,
    tone,
    detail: existingStatusCard?.detail || "Ready",
  });
  return components;
}

function buildTextPageComponents(title, lines, existingComponents) {
  const existingAlert = firstScreenComponent(existingComponents, "alert");
  const components = existingComponents.filter((component) => !["alert", "textPage", "list"].includes(component.type));
  const existingTextPage = firstScreenComponent(existingComponents, "textPage");
  const existingList = firstScreenComponent(existingComponents, "list");
  if (existingAlert) {
    components.unshift(existingList ? {
      type: "list",
      title: existingList.title,
      items: existingList.items,
    } : {
      type: "textPage",
      title: existingTextPage?.title || title,
      lines: existingTextPage?.lines || lines,
    });
    components.unshift({
      type: "alert",
      title,
      body: lines[0] || "Check status",
      tone: existingAlert.tone || "warn",
    });
    return components;
  }
  if (existingList) {
    components.unshift({
      type: "list",
      title,
      items: lines,
    });
    return components;
  }
  components.unshift({
    type: "textPage",
    title,
    lines,
  });
  return components;
}

function toneFromText(value) {
  const text = String(value || "");
  if (/错误|失败|异常|危险|离线|error|fail|failed|down|offline|critical/i.test(text)) return "error";
  if (/告警|警告|注意|偏高|等待|warn|warning|pending|busy|degraded/i.test(text)) return "warn";
  return "ok";
}

function ensureFourScreenPages(manifest) {
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== SCREEN_PAGE_IDS.length) {
    throw new Error(`screen manifest pages must contain exactly ${SCREEN_PAGE_IDS.length} pages`);
  }
  for (const [index, expectedId] of SCREEN_PAGE_IDS.entries()) {
    if (manifest.pages[index]?.id !== expectedId) {
      throw new Error(`screen manifest pages[${index}].id must be ${expectedId}`);
    }
  }
}

function normalizeScreenManifest(manifest) {
  validateScreenManifest(manifest);
  ensureFourScreenPages(manifest);

  const pages = manifest.pages.map((page, index) => {
    const components = normalizeScreenComponents(page, index);
    const next = {
      id: SCREEN_PAGE_IDS[index],
      tab: cleanText(page.tab || SCREEN_PAGE_IDS[index].toUpperCase(), `pages[${index}].tab`, 8),
    };
    if (index === 0) {
      const statusCard = firstScreenComponent(components, "statusCard");
      const progressComponent = firstScreenComponent(components, "progress");
      const metricGroup = firstScreenComponent(components, "metricGroup");
      const alert = firstScreenComponent(components, "alert");
      next.status = cleanText(statusCard ? statusCard.value : page.status || "OK CORE", "pages[0].status", 24);
      next.tone = cleanTone(
        statusCard ? statusCard.tone : alert ? alert.tone : progressComponent ? progressComponent.tone : page.tone || toneFromText(next.status),
        "pages[0].tone",
      );
      next.progress = cleanProgress(progressComponent ? progressComponent.value : page.progress, "pages[0].progress");
      next.metrics = metricGroup
        ? metricGroup.items.map(screenMetricText)
        : cleanTextList(page.metrics || ["IP loading", "MEM --", "DISK --"], "pages[0].metrics", 3, 24);
      while (next.metrics.length < 3) next.metrics.push("--");
      next.metrics = next.metrics.slice(0, 3);
      next.components = buildHomeComponents(page, next.status, next.tone, next.progress, next.metrics, components);
    } else {
      const text = componentLines(page, components, index);
      next.title = text.title;
      next.lines = text.lines;
      next.components = buildTextPageComponents(next.title, next.lines, components);
    }
    return next;
  });

  return {
    ...manifest,
    title: cleanText(manifest.title || "WalnutPi", "title", 32),
    subtitle: cleanText(manifest.subtitle || "server screen", "subtitle", 40),
    pages,
  };
}

function mutableManifestView(manifest) {
  return {
    title: manifest.title,
    subtitle: manifest.subtitle,
    pages: manifest.pages,
  };
}

function mergeScreenComponents(baseComponents, patchComponents) {
  if (patchComponents === undefined) return baseComponents;
  if (!Array.isArray(patchComponents)) return patchComponents;
  const merged = Array.isArray(baseComponents) ? [...baseComponents] : [];
  for (const component of patchComponents) {
    const type = component?.type;
    const existingIndex = merged.findIndex((item) => item?.type === type);
    if (type && existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...component,
      };
    } else {
      merged.push(component);
    }
  }
  return merged;
}

function mergePageComponents(basePage, mutablePage) {
  if (!mutablePage) return basePage?.components;
  if (mutablePage.components !== undefined) {
    return mergeScreenComponents(basePage?.components, mutablePage.components);
  }
  const replacesComponentBackedFields = ["status", "tone", "progress", "metrics", "title", "lines"]
    .some((field) => Object.prototype.hasOwnProperty.call(mutablePage, field));
  return replacesComponentBackedFields ? undefined : basePage?.components;
}

function applyMutableManifest(baseManifest, mutable) {
  const basePages = baseManifest.pages || [];
  const mutablePages = mutable.pages || [];
  return normalizeScreenManifest({
    ...baseManifest,
    title: mutable.title ?? baseManifest.title,
    subtitle: mutable.subtitle ?? baseManifest.subtitle,
    pages: SCREEN_PAGE_IDS.map((id, index) => ({
      ...(basePages[index] || { id }),
      ...(mutablePages[index] || {}),
      components: mergePageComponents(basePages[index], mutablePages[index]),
      id,
    })),
  });
}

function templatePreviewManifest(template) {
  const base = {
    schema: "walnutpi.screen.v1",
    id: `preview-${template.id}`,
    target: {
      runtime: "lvgl-fbdev",
      display: "/dev/fb0",
      width: 480,
      height: 320,
      color: "RGB565",
    },
    source: {
      lvglEntry: "lvgl_app/src/main.c",
      command: "walnut screen start",
    },
    pages: SCREEN_PAGE_IDS.map((id) => ({ id })),
  };
  return applyMutableManifest(base, template.manifest);
}

function screenTemplateSummary(template) {
  return {
    id: template.id,
    label: template.label,
    summary: template.summary,
    manifest: mutableManifestView(templatePreviewManifest(template)),
  };
}

async function readJsonRequest(req) {
  try {
    return await req.json();
  } catch {
    throw new Error("请求不是有效 JSON。");
  }
}

async function currentManifestForWrite(body) {
  let envelope;
  try {
    envelope = await screenManifestEnvelope();
  } catch (error) {
    return {
      error: json(
        {
          ok: false,
          error: "screen manifest invalid",
          summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
          output: error.message,
        },
        500,
      ),
    };
  }
  const clientHash = typeof body.manifestHash === "string" ? body.manifestHash : "";
  if (!validSha256(clientHash)) {
    return {
      error: json(
        {
          ok: false,
          error: "invalid manifestHash",
          summary: clientHash
            ? "同步请求包含无效的 screen manifest hash，请刷新页面后再试。"
            : "同步请求缺少 screen manifest hash，请刷新页面后再试。",
          manifestHash: envelope.manifestHash,
        },
        400,
      ),
    };
  }
  if (clientHash !== envelope.manifestHash) {
    return {
      error: json(
        {
          ok: false,
          error: "stale manifestHash",
          summary: "Web 预览和服务器 screen manifest 不一致，请刷新后再试。",
          manifestHash: envelope.manifestHash,
        },
        409,
      ),
    };
  }
  return envelope;
}

async function writeScreenManifest(manifest) {
  const normalized = normalizeScreenManifest(manifest);
  await writeJsonFile(SCREEN_MANIFEST_PATH, normalized);
  return screenManifestEnvelope();
}

function splitIntentItems(value) {
  return String(value || "")
    .split(/[，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function splitGroupedIntentItems(value, maxItems) {
  const text = String(value || "");
  const grouped = text
    .split(/[，,、;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (grouped.length > 1) return grouped.slice(0, maxItems);
  return splitIntentItems(text).slice(0, maxItems);
}

function linePagePatch(pageIndex, title, lines, tab) {
  const pages = SCREEN_PAGE_IDS.map((id) => ({ id }));
  pages[pageIndex] = {
    id: SCREEN_PAGE_IDS[pageIndex],
    tab,
    title,
    lines,
    components: [
      {
        type: "textPage",
        title,
        lines,
      },
    ],
  };
  return { pages };
}

function homeComponentPatch(component) {
  const pages = SCREEN_PAGE_IDS.map((id) => ({ id }));
  pages[0] = {
    id: "home",
    components: [component],
  };
  return { pages };
}

function currentHomeComponent(currentManifest, type) {
  return firstScreenComponent(currentManifest.pages?.[0]?.components || [], type);
}

function currentTextComponent(currentManifest, pageIndex, type) {
  return firstScreenComponent(currentManifest.pages?.[pageIndex]?.components || [], type);
}

function pageComponentPatch(pageIndex, tab, component) {
  const pages = SCREEN_PAGE_IDS.map((id) => ({ id }));
  pages[pageIndex] = {
    id: SCREEN_PAGE_IDS[pageIndex],
    tab,
    components: [component],
  };
  return { pages };
}

function looksLikeScreenProgramRequest(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  if (/(小屏|屏幕|界面|lvgl|screen)/i.test(text) && /(做|创建|生成|开发|写|造|设计|弄|来一个)/i.test(text)) {
    return true;
  }
  return /(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个).*(?:软件|应用|app|程序|小程序|小工具|播放器|面板)|(?:软件|应用|app|程序|小程序|小工具|播放器|面板).*(?:做|创建|生成|开发|写|造|设计|弄)/i.test(text);
}

function screenProgramIntentPatch(input) {
  if (!looksLikeScreenProgramRequest(input)) return null;

  if (/音乐|歌曲|歌单|播放器|音频|声音|music|audio|player/i.test(input)) {
    const template = SCREEN_TEMPLATES.find((item) => item.id === "music-player");
    return template
      ? {
        ...template.manifest,
        intentSummary: "已把音乐软件生成成小屏播放器预览。可以继续说要改哪里，或说“同步到核桃派”。",
      }
      : null;
  }

  return {
    title: "WalnutApp",
    subtitle: "app preview",
    pages: [
      { id: "home", tab: "APP", status: "APP DRAFT", tone: "ok", progress: 40, metrics: ["Preview ready", "Sync safe", "Edit by chat"] },
      { id: "system", tab: "UI", title: "Screen UI", lines: ["Main screen", "Status area", "Action list", "Evidence ready"] },
      { id: "ai", tab: "AI", title: "Build Intent", lines: ["Natural language", "Safe local actions", "Ask before writes", "Beginner first"] },
      { id: "network", tab: "NEXT", title: "Next Steps", lines: ["Refine preview", "Sync to WalnutPi", "Check frame", "Keep diagnostics hidden"] },
    ],
    intentSummary: "已生成一个小屏应用预览。可以继续说要改哪里，或说“同步到核桃派”。",
  };
}

function parseScreenIntent(text, currentManifest) {
  const input = String(text || "").trim();
  if (!input) return null;

  const programPatch = screenProgramIntentPatch(input);
  if (programPatch) return programPatch;

  let match = input.match(/(?:副标题|说明)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
  if (match) return { subtitle: match[1].trim() };

  match = input.match(/(?:标题|名字|名称)\s*(?:改成|改为|写成|叫|是|:|：)\s*(.+)$/);
  if (match) return { title: match[1].trim() };

  match = input.match(/(?:状态|核心状态)\s*(?:改成|改为|写成|写|是|:|：)\s*(.+)$/);
  if (match) {
    const pages = currentManifest.pages.map((page) => ({ id: page.id }));
    const status = match[1].trim();
    const tone = toneFromText(status);
    pages[0] = {
      id: "home",
      status,
      tone,
      components: [
        {
          type: "statusCard",
          label: firstScreenComponent(currentManifest.pages[0]?.components || [], "statusCard")?.label || "Status",
          value: status,
          tone,
          detail: firstScreenComponent(currentManifest.pages[0]?.components || [], "statusCard")?.detail || "Ready",
        },
      ],
    };
    return { pages };
  }

  match = input.match(/(?:状态标签|状态卡标签|状态名)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
  if (match) {
    const statusCard = currentHomeComponent(currentManifest, "statusCard") || {};
    return homeComponentPatch({
      type: "statusCard",
      label: match[1].trim(),
      value: currentManifest.pages[0]?.status || statusCard.value || "OK CORE",
      tone: currentManifest.pages[0]?.tone || statusCard.tone || "ok",
      detail: statusCard.detail || "Ready",
    });
  }

  match = input.match(/(?:状态详情|状态说明|详情)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
  if (match) {
    const statusCard = currentHomeComponent(currentManifest, "statusCard") || {};
    return homeComponentPatch({
      type: "statusCard",
      label: statusCard.label || "Status",
      value: currentManifest.pages[0]?.status || statusCard.value || "OK CORE",
      tone: currentManifest.pages[0]?.tone || statusCard.tone || "ok",
      detail: match[1].trim(),
    });
  }

  match = input.match(/(?:进度|完成度)\s*(?:改成|改为|写成|是|:|：)?\s*(\d{1,3})\s*%?$/);
  if (match) {
    const pages = currentManifest.pages.map((page) => ({ id: page.id }));
    const value = Number(match[1]);
    pages[0] = {
      id: "home",
      progress: value,
      components: [
        {
          type: "progress",
          label: firstScreenComponent(currentManifest.pages[0]?.components || [], "progress")?.label || "Progress",
          value,
          max: 100,
          tone: currentManifest.pages[0]?.tone || "ok",
        },
      ],
    };
    return { pages };
  }

  match = input.match(/(?:进度标签|进度名|进度说明)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
  if (match) {
    const progress = currentHomeComponent(currentManifest, "progress") || {};
    return homeComponentPatch({
      type: "progress",
      label: match[1].trim(),
      value: currentManifest.pages[0]?.progress ?? progress.value ?? 72,
      max: progress.max || 100,
      tone: currentManifest.pages[0]?.tone || progress.tone || "ok",
    });
  }

  match = input.match(/(?:状态色|语义|告警级别|等级)\s*(?:改成|改为|写成|是|:|：)?\s*(正常|健康|ok|OK|告警|警告|warn|warning|错误|失败|error|ERROR)$/);
  if (match) {
    const raw = match[1];
    const tone = /错误|失败|error/i.test(raw) ? "error" : /告警|警告|warn|warning/i.test(raw) ? "warn" : "ok";
    const pages = currentManifest.pages.map((page) => ({ id: page.id }));
    pages[0] = {
      id: "home",
      tone,
      components: [
        {
          type: "statusCard",
          label: firstScreenComponent(currentManifest.pages[0]?.components || [], "statusCard")?.label || "Status",
          value: currentManifest.pages[0]?.status || "OK CORE",
          tone,
          detail: firstScreenComponent(currentManifest.pages[0]?.components || [], "statusCard")?.detail || "Ready",
        },
        {
          type: "progress",
          label: firstScreenComponent(currentManifest.pages[0]?.components || [], "progress")?.label || "Progress",
          value: currentManifest.pages[0]?.progress ?? 72,
          max: 100,
          tone,
        },
      ],
    };
    return { pages };
  }

  match = input.match(/(?:告警|警告|提示)\s*(?:改成|改为|写成|写|是|:|：)\s*(.+)$/);
  if (match) {
    return pageComponentPatch(1, currentManifest.pages[1]?.tab || "SYS", {
      type: "alert",
      title: "Alert",
      body: match[1].trim(),
      tone: toneFromText(match[1]),
    });
  }

  match = input.match(/(?:指标组|组件指标)\s*(?:改成|改为|写成|写|:|：)?\s*(.+)$/);
  if (match) {
    const metrics = splitGroupedIntentItems(match[1], 3);
    if (metrics.length > 0) {
      return homeComponentPatch({
        type: "metricGroup",
        items: metrics.map(metricItemFromText),
      });
    }
  }

  match = input.match(/(?:列表|清单|步骤)\s*(?:改成|改为|写成|写|显示|:|：)\s*(.+)$/);
  if (match) {
    const items = splitIntentItems(match[1]).slice(0, 4);
    if (items.length > 0) {
      return pageComponentPatch(1, currentManifest.pages[1]?.tab || "LIST", {
        type: "list",
        title: currentTextComponent(currentManifest, 1, "list")?.title || "List",
        items,
      });
    }
  }

  match = input.match(/(?:列表标题|清单标题|步骤标题)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
  if (match) {
    const list = currentTextComponent(currentManifest, 1, "list") || {};
    return pageComponentPatch(1, currentManifest.pages[1]?.tab || "LIST", {
      type: "list",
      title: match[1].trim(),
      items: list.items || currentManifest.pages[1]?.lines || ["Item"],
    });
  }

  if (/告警|警告|异常|风险|错误|失败|报警|warn|error/i.test(input)) {
    return SCREEN_TEMPLATES.find((template) => template.id === "health-alert")?.manifest || null;
  }

  if (/网络|联网|IP|ip|ssh|frp/i.test(input)) {
    return SCREEN_TEMPLATES.find((template) => template.id === "network-panel")?.manifest || null;
  }

  if (/AI|ai|任务|助手|agent/i.test(input)) {
    return SCREEN_TEMPLATES.find((template) => template.id === "ai-task-board")?.manifest || null;
  }

  if (/系统|状态|健康|内存|磁盘/.test(input)) {
    return SCREEN_TEMPLATES.find((template) => template.id === "device-status")?.manifest || null;
  }

  match = input.match(/(?:指标|显示)\s*(?:改成|改为|写成|写|:|：)?\s*(.+)$/);
  if (match) {
    const metrics = splitGroupedIntentItems(match[1], 3);
    if (metrics.length > 0) {
      const pages = currentManifest.pages.map((page) => ({ id: page.id }));
      pages[0] = {
        id: "home",
        metrics,
        components: [
          {
            type: "metricGroup",
            items: metrics.map(metricItemFromText),
          },
        ],
      };
      return { pages };
    }
  }

  match = input.match(/(?:系统页|系统)\s*(?:写|显示|:|：)\s*(.+)$/);
  if (match) return linePagePatch(1, "System", splitIntentItems(match[1]), "SYS");

  match = input.match(/(?:AI页|AI|ai)\s*(?:写|显示|:|：)\s*(.+)$/);
  if (match) return linePagePatch(2, "AI Agent", splitIntentItems(match[1]), "AI");

  match = input.match(/(?:网络页|网络)\s*(?:写|显示|:|：)\s*(.+)$/);
  if (match) return linePagePatch(3, "Network", splitIntentItems(match[1]), "NET");

  return null;
}

async function handleScreenTemplate(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const current = await currentManifestForWrite(body);
  if (current.error) return current.error;

  const templateId = String(body.templateId || "");
  const template = SCREEN_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    return json({ ok: false, error: "invalid templateId", summary: "未知的小屏模板。" }, 400);
  }

  try {
    const next = applyMutableManifest(current.manifest, template.manifest);
    const envelope = await writeScreenManifest(next);
    return json({
      ok: true,
      summary: "已更新预览。",
      template: screenTemplateSummary(template),
      ...envelope,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "screen manifest update failed",
        summary: "无法更新小屏预览。",
        output: error.message,
      },
      500,
    );
  }
}

async function handleScreenIntent(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const current = await currentManifestForWrite(body);
  if (current.error) return current.error;

  const text = String(body.text || "").trim();
  const patch = parseScreenIntent(text, current.manifest);
  if (!patch) {
    return json({
      ok: false,
      error: "unrecognized screen intent",
      summary: "无法理解这次修改。",
    }, 400);
  }

  try {
    const next = applyMutableManifest(current.manifest, patch);
    const envelope = await writeScreenManifest(next);
    return json({
      ok: true,
      summary: patch.intentSummary || "已更新预览。",
      ...envelope,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "screen manifest update failed",
        summary: "无法更新小屏预览。",
        output: error.message,
      },
      500,
    );
  }
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

function cleanPixelDiffHash(value, field) {
  const text = String(value || "").trim();
  if (!/^[a-f0-9]{8}$/i.test(text) && !validSha256(text)) {
    throw new Error(`${field} must be an 8-char FNV hash or SHA-256 hex`);
  }
  return text.toLowerCase();
}

function cleanPixelDiffNumber(value, field, min, max, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return Number(number.toFixed(digits));
}

function cleanPixelDiffInteger(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeWebDevicePixelDiff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("webDevicePixelDiff must be an object");
  }
  const schema = String(value.schema || "").trim();
  if (!["walnutpi.webDevicePixelDiff.v1", "walnutpi.webDevicePixelDiff.v2"].includes(schema)) {
    throw new Error("webDevicePixelDiff schema must be walnutpi.webDevicePixelDiff.v1 or walnutpi.webDevicePixelDiff.v2");
  }
  const status = String(value.status || "").trim();
  if (!["matched", "different", "unavailable"].includes(status)) {
    throw new Error("webDevicePixelDiff status is invalid");
  }
  const limitations = Array.isArray(value.limitations)
    ? value.limitations.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4)
    : [];
  const manifestHash = value.manifestHash ? String(value.manifestHash).trim() : null;
  if (manifestHash && !validSha256(manifestHash)) {
    throw new Error("manifestHash must be SHA-256 hex");
  }
  const width = cleanPixelDiffInteger(value.width, "width", 1, 4096);
  const height = cleanPixelDiffInteger(value.height, "height", 1, 4096);
  const comparedPixels = schema === "walnutpi.webDevicePixelDiff.v2"
    ? cleanPixelDiffInteger(value.comparedPixels, "comparedPixels", 1, 4096 * 4096)
    : width * height;
  const differentPixels = cleanPixelDiffInteger(value.differentPixels, "differentPixels", 0, 4096 * 4096);
  if (differentPixels > comparedPixels) {
    throw new Error("differentPixels must not exceed comparedPixels");
  }
  return {
    schema,
    status,
    claim: String(value.claim || "web-semantic-preview-compared-to-device-png").slice(0, 120),
    source: String(value.source || (schema.endsWith(".v2") ? "actual-preview-dom-snapshot" : "semantic-canvas-preview"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
    manifestHash,
    frameUrl: value.frameUrl ? String(value.frameUrl).slice(0, 240) : null,
    previewHash: cleanPixelDiffHash(value.previewHash, "previewHash"),
    devicePngHash: cleanPixelDiffHash(value.devicePngHash, "devicePngHash"),
    width,
    height,
    comparedPixels,
    threshold: cleanPixelDiffNumber(value.threshold, "threshold", 0, 1),
    differentPixels,
    diffRatio: cleanPixelDiffNumber(value.diffRatio, "diffRatio", 0, 1),
    averageChannelDelta: cleanPixelDiffNumber(value.averageChannelDelta, "averageChannelDelta", 0, 255, 3),
    limitations,
    capturedAt: new Date().toISOString(),
  };
}

async function handleScreenPixelDiff(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  let webDevicePixelDiff;
  try {
    webDevicePixelDiff = normalizeWebDevicePixelDiff(body.webDevicePixelDiff);
  } catch (error) {
    return json({ ok: false, error: error.message, summary: "Web/device pixel diff 格式无效。" }, 400);
  }

  const existingRecord = await readScreenRecord(safeBuildId);
  if (!existingRecord) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }
  if (
    webDevicePixelDiff.manifestHash
    && existingRecord.manifestHash
    && webDevicePixelDiff.manifestHash !== existingRecord.manifestHash
  ) {
    return json({
      ok: false,
      error: "stale pixel diff manifestHash",
      summary: "Web/device pixel diff 对应的 manifest 和同步记录不一致，请重新打开设备截图。",
      manifestHash: existingRecord.manifestHash,
    }, 409);
  }

  const record = await updateScreenRecord(safeBuildId, (nextRecord) => {
    nextRecord.webDevicePixelDiff = webDevicePixelDiff;
    return nextRecord;
  });

  return json({
    ok: true,
    buildId: safeBuildId,
    webDevicePixelDiff: record.webDevicePixelDiff,
  });
}

async function handleMemory() {
  const memory = await readWalnutMemory();
  return json({
    ok: true,
    schema: "walnutpi.memoryView.v1",
    memoryFile: WALNUT_AI_MEMORY_FILE,
    memory,
  });
}

async function handleRetrieval(url) {
  const query = url.searchParams.get("query") || "";
  const results = await retrieveWalnutContext(query);
  return json({
    ok: true,
    schema: "walnutpi.retrievalView.v1",
    query,
    skillsDir: WALNUT_AI_SKILLS_DIR,
    corpusDir: WALNUT_AI_CORPUS_DIR,
    results,
  });
}

async function handleProjectMemory(url) {
  const query = url.searchParams.get("query") || "";
  const [memory, retrieval] = await Promise.all([
    readWalnutMemory(),
    retrieveWalnutContext(query),
  ]);
  return json({
    ok: true,
    schema: "walnutpi.projectMemoryView.v1",
    query,
    memoryFile: WALNUT_AI_MEMORY_FILE,
    skillsDir: WALNUT_AI_SKILLS_DIR,
    corpusDir: WALNUT_AI_CORPUS_DIR,
    memory,
    retrieval,
  });
}

async function handleScreenRepairPlan(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const repairHint = record.repairHint || buildScreenRepairHint(record);
  if (!record.repairHint) {
    try {
      await updateScreenRecord(safeBuildId, (nextRecord) => {
        nextRecord.repairHint = repairHint;
        return nextRecord;
      });
    } catch {
      // The response can still return the plan even if persisting the backfill fails.
    }
  }

  return json({
    ok: true,
    repairHint,
  });
}

async function handleScreenRepairCandidate(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const repairCandidate = buildScreenRepairCandidate(record);
  return json({
    ok: true,
    buildId: safeBuildId,
    repairCandidate,
  });
}

async function handleScreenRepairProposal(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const repairProposal = buildScreenRepairProposal(record);
  return json({
    ok: true,
    buildId: safeBuildId,
    repairProposal,
  });
}

async function handleScreenRepairApply(req) {
  const url = new URL(req.url);
  if (previewOnly(url)) {
    return json({
      ok: false,
      error: "preview mode disables repair apply",
      summary: "预览模式下不会写入本地 manifest。",
    }, 403);
  }

  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const proposal = buildScreenRepairProposal(record);
  const confirmation = String(body.confirmation || "");
  if (!proposal.canApply || !proposal.proposedPatch) {
    return json({
      ok: false,
      error: "repair proposal is not applicable",
      summary: "这条同步记录没有可自动应用的本地补丁。",
      repairProposal: proposal,
    }, 409);
  }
  if (confirmation !== proposal.confirmationPhrase) {
    return json({
      ok: false,
      error: "confirmation mismatch",
      summary: `请输入确认短语：${proposal.confirmationPhrase}`,
      repairProposal: proposal,
    }, 400);
  }
  const targetPath = path.resolve(SCREEN_MANIFEST_PATH);
  const projectRoot = path.resolve(PROJECT_ROOT);
  const repairRelativePath = path.relative(PROJECT_ROOT, targetPath).replace(/\\/g, "/");
  if (proposal.proposedPatch.kind !== "replace-file" || proposal.proposedPatch.path !== repairRelativePath) {
    return json({ ok: false, error: "unsupported repair patch", summary: "修复补丁类型不受支持。" }, 400);
  }

  const manifest = normalizeScreenManifest(record.manifest);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!(targetPath === projectRoot || targetPath.startsWith(`${projectRoot}${path.sep}`))) {
    return json({ ok: false, error: "repair target is outside project root", summary: "修复目标不在当前项目内。" }, 400);
  }
  if (sha256(manifestText) !== proposal.proposedPatch.sha256) {
    return json({ ok: false, error: "repair patch hash changed", summary: "修复补丁已变化，请重新生成提案。" }, 409);
  }

  await writeFile(targetPath, manifestText, "utf8");
  const envelope = await screenManifestEnvelope();
  return json({
    ok: true,
    buildId: safeBuildId,
    summary: "已应用本地 screen manifest 修复。Web 会重新读取预览；确认后请手动同步到核桃派。",
    nextAction: "reload-preview-then-manual-sync",
    autoSync: false,
    manifestHash: envelope.manifestHash,
    manifest: envelope.manifest,
    repairProposal: proposal,
  });
}

async function handleScreenAiSummary(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const aiSummary = await buildScreenAiSummary(record);
  return json({
    ok: true,
    buildId: safeBuildId,
    aiSummary,
  });
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
  manifest = normalizeScreenManifest(manifest);
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

  let delivery;
  try {
    delivery = await screenDeliveryAdapter().deliver({ buildId, manifest, manifestHash });
  } catch (error) {
    delivery = {
      ok: false,
      risk: "write-low",
      mode: "remote",
      deliveryManifest: null,
      deliveryHash: null,
      artifactHash: null,
      screenEvidence: null,
      screenFrameUrl: null,
      frameTicket: null,
      command: null,
      commandResults: {},
      code: 1,
      output: error.stack || error.message,
      summary: "核桃派交付适配器执行失败。请在诊断里查看错误。",
      failedStage: "delivery",
    };
  }
  if (delivery.frameTicket) {
    rememberScreenFrameTicket(buildId, delivery.frameTicket);
  }

  const result = {
    ...baseResult,
    ok: delivery.ok,
    risk: delivery.risk,
    mode: delivery.mode,
    deliveryManifest: delivery.deliveryManifest,
    deliveryHash: delivery.deliveryHash,
    artifactHash: delivery.artifactHash,
    evidence: delivery.screenEvidence,
    screenEvidence: delivery.screenEvidence,
    screenFrameUrl: delivery.screenFrameUrl,
    command: delivery.command,
    code: delivery.code,
    output: delivery.output,
    summary: delivery.summary,
    failedStage: delivery.failedStage,
  };

  return persistScreenSyncResult(result, delivery.commandResults);
}

const ACTIONS = {
  status: {
    title: "查状态",
    risk: "read",
    mode: "remote",
    command: "walnut action run status --json",
    parseJsonOutput: true,
    reply: "我会读取系统、网络、存储、服务和音频状态。",
    timeoutMs: 20_000,
  },
  snapshot: {
    title: "设备快照",
    risk: "read",
    mode: "remote",
    command: "walnut action run snapshot --json",
    parseJsonOutput: true,
    reply: "我会先做只读设备快照，确认板子、系统、引脚和 overlay 状态。",
    timeoutMs: 20_000,
  },
  network: {
    title: "网络检查",
    risk: "read",
    mode: "remote",
    command: "walnut action run network --json",
    parseJsonOutput: true,
    reply: "我会检查 IP、默认路由和 Wi-Fi 状态。",
    timeoutMs: 12_000,
  },
  gpio: {
    title: "GPIO 检查",
    risk: "read",
    mode: "remote",
    command: "walnut action run gpio --json",
    parseJsonOutput: true,
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
    async buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      const projectMemory = {
        memory: await readWalnutMemory(),
        retrieval: await retrieveWalnutContext(text),
      };
      const prompt = aiQuestionWithContext(text, body.messages, projectMemory);
      return {
        command: `WALNUT_AI_TIMEOUT=${shellQuote(AI_TIMEOUT_SECONDS)} WALNUT_AI_CHAT_ONLY=1 WALNUT_AI_ENABLE_INLINE_MEMORY=0 WALNUT_AI_DISABLE_SESSION_LOG=1 walnut-ai ${shellQuote(prompt)}`,
        contextUsed: {
          schema: "walnutpi.webAiContext.v1",
          memoryDistillCandidate: /记住|记着|以后|下次|我的偏好|我喜欢|我不喜欢|我习惯|我是|我叫|我用|我在用|我的项目|我的设备|所有对话|目标|默认/.test(text),
          memoryFields: Object.fromEntries(MEMORY_FIELDS.map((field) => [field, projectMemory.memory[field]?.length || 0])),
          retrieval: projectMemory.retrieval.map((item) => ({ path: item.path, score: item.score })),
        },
      };
    },
    reply: "我会带上项目记忆、skills 检索和成功代码语料，再把普通问题交给 WalnutAI 回答。",
    timeoutMs: (AI_TIMEOUT_SECONDS + 15) * 1000,
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

function aiActionOutputFailed(output) {
  const firstLine = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return /^(API 请求失败|API HTTP|OPENAI_API_KEY|usage:|walnut: error:|ERR:|\[local\])/i.test(firstLine);
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
  const sessionId = safeSessionId(body.sessionId);

  let command = action.command;
  let contextUsed = null;
  try {
    if (action.buildCommand) {
      const built = await action.buildCommand(body);
      if (typeof built === "string") {
        command = built;
      } else if (built && typeof built === "object") {
        command = built.command;
        contextUsed = built.contextUsed || null;
      }
    }
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  if (action.mode === "terminal") {
    const responseBody = {
      ok: true,
      ...actionSummary(action, id),
      command,
    };
    if (sessionId) {
      await appendSessionEvent(sessionId, {
        role: "action",
        action: id,
        content: action.reply || "",
        command,
        ok: true,
      });
    }
    return json(responseBody);
  }

  const result = await runRemote(command, action.timeoutMs);
  const outputFailed = id === "ai" && aiActionOutputFailed(result.output);
  let actionEvidence = null;
  let output = result.output;
  let remoteOk = result.ok;
  if (action.parseJsonOutput && result.output) {
    try {
      actionEvidence = JSON.parse(result.output);
      if (typeof actionEvidence?.output === "string") {
        output = actionEvidence.output;
      }
      if (typeof actionEvidence?.ok === "boolean") {
        remoteOk = result.ok && actionEvidence.ok;
      }
    } catch {
      actionEvidence = null;
    }
  }
  const responseBody = {
    ok: remoteOk && !outputFailed,
    ...actionSummary(action, id),
    command,
    code: result.code,
    remoteOk,
    outputFailed,
    output,
    actionEvidence,
    contextUsed,
  };
  if (sessionId) {
    await appendSessionEvent(sessionId, {
      role: "action",
      action: id,
      content: output || result.output || "",
      command,
      ok: responseBody.ok,
      contextUsed,
    });
  }
  return json(responseBody);
}

function startSsh(ws) {
  const target = `${SSH_USER}@${SSH_HOST}`;
  const child = spawn(
    "sshpass",
    [
      "-e",
      "ssh",
      "-tt",
      ...sshConnectionOptions(),
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

    if (url.pathname === "/api/memory") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleMemory();
    }

    if (url.pathname === "/api/retrieval") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleRetrieval(url);
    }

    if (url.pathname === "/api/project-memory") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleProjectMemory(url);
    }

    if (url.pathname === "/api/session") {
      return handleSession(req, url);
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

    if (url.pathname === "/api/screen/templates") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return json({
        ok: true,
        templates: SCREEN_TEMPLATES.map(screenTemplateSummary),
      });
    }

    if (url.pathname === "/api/screen/template") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleScreenTemplate(req);
    }

    if (url.pathname === "/api/screen/intent") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleScreenIntent(req);
    }

    if (url.pathname === "/api/screen/sync") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyScreenSyncResult(req);
      return handleScreenSync(req);
    }

    if (url.pathname === "/api/screen/repair-plan") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRepairPlan(req);
    }

    if (url.pathname === "/api/screen/repair-candidate") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRepairCandidate(req);
    }

    if (url.pathname === "/api/screen/repair-proposal") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRepairProposal(req);
    }

    if (url.pathname === "/api/screen/repair-apply") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRepairApply(req);
    }

    if (url.pathname === "/api/screen/ai-summary") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenAiSummary(req);
    }

    if (url.pathname === "/api/screen/pixel-diff") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenPixelDiff(req);
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

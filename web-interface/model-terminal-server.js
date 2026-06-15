import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createScreenEvidenceLedger } from "./screen-evidence-ledger.js";
import { createSshLocalAgentAdapter } from "./screen-delivery-adapters/ssh-local-agent.js";
import { createScreenWorkspaceSyncWorkflow } from "./screen-workspace-sync-workflow.js";
import { createWebSessionLedger } from "./web-session-ledger.js";
import { createWebMetricsLedger } from "./web-metrics-ledger.js";
import { createWalnutRemoteAdapter } from "./walnut-remote-adapter.js";
import { createScreenWorkspaceStore, workspaceErrorResponse } from "./screen-workspace-store.js";
import { appendScreenPlaylistItem, processSourceAssetToScreenOutput, writeDefaultScreenPlaylist } from "../scripts/screen-workspace-pipeline.js";
import { stableStringify } from "../scripts/screen-workspace-vocabulary.js";
import { generateLvglScreenWorkspaceRuntimeAssets } from "../scripts/generate-lvgl-screen-workspace-runtime-assets.js";

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
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH
  ? path.resolve(process.env.CODEX_AUTH_PATH)
  : path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex", "auth.json");
const SCREEN_WORKSPACE_ROOT = process.env.WALNUT_SCREEN_WORKSPACE_ROOT
  ? path.resolve(process.env.WALNUT_SCREEN_WORKSPACE_ROOT)
  : path.join(PROJECT_ROOT, "screen");
const ACTION_OUTPUT_LIMIT = 24_000;
const CAPTURE_OUTPUT_LIMIT = 1_500_000;
const SCREEN_FRAME_TICKET_TTL_MS = 10 * 60_000;
const parsedScreenRecordLimit = Number(process.env.WALNUT_SCREEN_RECORD_LIMIT || 50);
const SCREEN_RECORD_LIMIT = Number.isFinite(parsedScreenRecordLimit) && parsedScreenRecordLimit > 0
  ? Math.floor(parsedScreenRecordLimit)
  : 50;
const SCREEN_RECORDS_DIR = process.env.WALNUT_SCREEN_RECORDS_DIR || path.join(BASE_DIR, "screen-sync-records");
const SCREEN_SOURCE_IMPORT_MAX_BYTES = Number(process.env.WALNUT_SCREEN_SOURCE_IMPORT_MAX_BYTES || 25 * 1024 * 1024);
const SCREEN_LVGL_PREVIEW_OUTPUT_DIR = path.join(SCREEN_WORKSPACE_ROOT, "outputs", "lvgl-preview");
const WALNUT_AI_CORPUS_DIR = process.env.WALNUT_AI_CORPUS_DIR || path.join(PROJECT_ROOT, "walnut-ai-terminal", "corpus");
const SCREEN_SUCCESS_CORPUS_PATH = path.join(WALNUT_AI_CORPUS_DIR, "screen-sync-successes.md");

const AI_MODEL = process.env.WALNUT_AI_MODEL || "gpt-5.4-mini";
const AI_BASE_URL = (process.env.WALNUT_AI_BASE_URL || "https://rehdasu.cn/v1").replace(/\/+$/, "");
const AI_API_KEY = resolveAiApiKey();
const AI_REASONING_EFFORT = process.env.WALNUT_AI_REASONING_EFFORT || "none";
const AI_CONTEXT_LIMIT = 4;
const AI_CONTEXT_TEXT_LIMIT = 900;
const AI_TIMEOUT_SECONDS = Number(process.env.WALNUT_WEB_AI_TIMEOUT || 60);
const SSH_CONTROLMASTER_ENABLED = process.platform !== "win32"
  && !["0", "false", "no", "off"].includes(String(process.env.WALNUT_SSH_CONTROLMASTER || "1").toLowerCase());
const SSH_CONTROL_DIR = process.env.SSH_CONTROL_DIR || path.join(tmpdir(), `walnutpi-web-ssh-${process.getuid?.() || "user"}`);
const screenFrameTickets = new Map();
const WALNUT_MEMORY_DIR = process.env.WALNUT_MEMORY_DIR || path.join(process.env.HOME || process.env.USERPROFILE || PROJECT_ROOT, "walnut-memory");
const WALNUT_AI_MEMORY_FILE = process.env.WALNUT_AI_MEMORY_FILE || path.join(WALNUT_MEMORY_DIR, "memory.json");
const WALNUT_AI_SKILLS_DIR = process.env.WALNUT_AI_SKILLS_DIR || path.join(PROJECT_ROOT, "walnut-ai-terminal", "skills");
const WALNUT_AI_PRIMARY_SKILL = process.env.WALNUT_AI_PRIMARY_SKILL || "walnutpi-1b-zerow";
const WALNUT_CLI_SOURCE_PATH = path.join(PROJECT_ROOT, "walnut-assistant", "walnut");
const MEMORY_FIELDS = ["preferences", "environment", "projects", "workflows", "goals", "summary"];
const RETRIEVAL_FILE_LIMIT = 5000;
const RETRIEVAL_RESULT_LIMIT = 8;
const WEB_SESSIONS_DIR = process.env.WALNUT_WEB_SESSIONS_DIR || path.join(BASE_DIR, "data", "sessions");
const WEB_METRICS_PATH = process.env.WALNUT_WEB_METRICS_PATH || path.join(BASE_DIR, "data", "metrics.jsonl");
const WEB_SESSION_EVENT_LIMIT = Number(process.env.WALNUT_WEB_SESSION_EVENT_LIMIT || 300);
const webSessionLedger = createWebSessionLedger({
  sessionsDir: WEB_SESSIONS_DIR,
  eventLimit: WEB_SESSION_EVENT_LIMIT,
});
const webMetricsLedger = createWebMetricsLedger({
  metricsPath: WEB_METRICS_PATH,
  limit: Number(process.env.WALNUT_WEB_METRICS_LIMIT || 200),
});

const files = new Map([
  ["/", "screen-workspace-preview.html"],
  ["/workspace.html", "screen-workspace-preview.html"],
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

function readCodexAuthApiKey() {
  try {
    if (!CODEX_AUTH_PATH) return "";
    const parsed = JSON.parse(readFileSync(CODEX_AUTH_PATH, "utf8"));
    return typeof parsed?.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY : "";
  } catch {
    return "";
  }
}

function resolveAiApiKey() {
  if (Object.hasOwn(process.env, "WALNUT_AI_API_KEY")) return String(process.env.WALNUT_AI_API_KEY || "").trim();
  if (Object.hasOwn(process.env, "OPENAI_API_KEY")) return String(process.env.OPENAI_API_KEY || "").trim();
  return String(readCodexAuthApiKey() || "").trim();
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

async function handleSession(req, url) {
  const sessionId = webSessionLedger.safeSessionId(url.searchParams.get("sessionId"));
  if (!sessionId) return json({ ok: false, error: "invalid sessionId" }, 400);

  if (req.method === "GET") {
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || WEB_SESSION_EVENT_LIMIT) || WEB_SESSION_EVENT_LIMIT));
    const events = await webSessionLedger.readEvents(sessionId, limit);
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
    const event = await webSessionLedger.appendEvent(sessionId, body.event || body);
    if (!event) return json({ ok: false, error: "invalid session event" }, 400);
    return json({ ok: true, schema: "walnutpi.webSessionAppend.v1", sessionId, event });
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
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

function findWindowsCommand(command) {
  try {
    const output = execFileSync("where.exe", [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  } catch {
    const names = command.toLowerCase().endsWith(".exe") ? [command] : [command, `${command}.exe`];
    for (const dir of String(process.env.Path || process.env.PATH || "").split(path.delimiter)) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (existsSync(candidate)) return candidate;
      }
    }
    return "";
  }
}

const walnutRemote = createWalnutRemoteAdapter({
  sshHost: SSH_HOST,
  sshUser: SSH_USER,
  sshPassword: SSH_PASSWORD,
  remoteProjectRoot: REMOTE_PROJECT_ROOT,
  walnutCliSourcePath: WALNUT_CLI_SOURCE_PATH,
  outputLimit: ACTION_OUTPUT_LIMIT,
  captureOutputLimit: CAPTURE_OUTPUT_LIMIT,
  sha256,
  limitedOutput,
  controlMasterEnabled: SSH_CONTROLMASTER_ENABLED,
  controlDir: SSH_CONTROL_DIR,
});

function clippedText(value, limit = AI_CONTEXT_TEXT_LIMIT) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
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

function buildScreenRepairHint(record) {
  return {
    schema: "walnutpi.screenRepairHint.v2",
    stage: record?.failedStage || "unknown",
    title: "Screen Workspace sync failed",
    summary: record?.summary || "Screen Workspace sync failed before completion.",
    autoRepairAvailable: false,
    suggestedActions: [
      "Open /workspace.html and refresh the current playlist.",
      "Regenerate the Screen Workspace output if the playlist or artifacts are missing.",
      "Retry sync with the current playlistHash.",
    ],
  };
}

const screenEvidenceLedger = createScreenEvidenceLedger({
  recordsDir: SCREEN_RECORDS_DIR,
  recordLimit: SCREEN_RECORD_LIMIT,
  outputLimit: ACTION_OUTPUT_LIMIT,
  buildRepairHint: buildScreenRepairHint,
});

const safeRecordId = screenEvidenceLedger.safeRecordId;
const screenRecordFrameUrl = screenEvidenceLedger.frameUrl;
const readScreenRecord = screenEvidenceLedger.readRecord;
const updateScreenRecord = screenEvidenceLedger.updateRecord;
const listScreenRecords = screenEvidenceLedger.listRecords;

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

function parseJsonObjectText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  const parsed = JSON.parse(candidate);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI response must be a JSON object");
  }
  return parsed;
}

function aiFetchSignal() {
  const timeoutMs = Math.max(1, AI_TIMEOUT_SECONDS) * 1000;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function responsesRequestBody(body) {
  return {
    ...body,
    model: body.model || AI_MODEL,
    reasoning: body.reasoning || { effort: AI_REASONING_EFFORT },
  };
}

async function callResponsesApi({ operation, body, signal = aiFetchSignal() }) {
  const startedAt = Date.now();
  let status = null;
  let requestId = null;
  try {
    const response = await fetch(`${AI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify(responsesRequestBody(body)),
    });
    status = response.status;
    requestId = response.headers.get("x-request-id") || response.headers.get("openai-request-id") || null;
    if (!response.ok) {
      const detail = await response.text();
      const message = `API HTTP ${response.status}: ${detail.slice(0, 800)}`;
      await webMetricsLedger.append({
        kind: "openai.responses",
        operation,
        ok: false,
        status,
        model: body.model || AI_MODEL,
        reasoningEffort: body.reasoning?.effort || AI_REASONING_EFFORT,
        latencyMs: Date.now() - startedAt,
        requestId,
        error: message,
      });
      throw new Error(message);
    }
    const data = await response.json();
    await webMetricsLedger.append({
      kind: "openai.responses",
      operation,
      ok: true,
      status,
      model: body.model || AI_MODEL,
      reasoningEffort: body.reasoning?.effort || AI_REASONING_EFFORT,
      latencyMs: Date.now() - startedAt,
      requestId: requestId || data.id || null,
      usage: data.usage,
    });
    return data;
  } catch (error) {
    if (status === null) {
      await webMetricsLedger.append({
        kind: "openai.responses",
        operation,
        ok: false,
        model: body.model || AI_MODEL,
        reasoningEffort: body.reasoning?.effort || AI_REASONING_EFFORT,
        latencyMs: Date.now() - startedAt,
        requestId,
        error: error.message,
      });
    }
    throw error;
  }
}

const INTENT_TYPES = new Set([
  "screen.generate",
  "screen.sync",
  "device.status.read",
  "device.snapshot.read",
  "device.network.read",
  "device.gpio.read",
  "device.notes.read",
  "device.note.write",
  "terminal.open",
  "terminal.tool",
  "ai.chat",
]);
const INTENT_DELIVERIES = new Set(["none", "sync_after_preview", "sync_existing"]);

function wantsScreenDeliveryIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return /同步|部署|推送|运行到|显示到|烧录|sync|deploy|flash/.test(value);
}

function screenIntentSubject(input) {
  let subject = String(input || "").trim();
  subject = subject
    .replace(/^(?:请|麻烦|帮我|给我|你|我要|我想|直接开始|直接|先|开始|继续|现在|按这个|就这个|照这个)\s*/i, "")
    .replace(/(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)\s*/i, "")
    .replace(/(?:然后|并且|并|再)?\s*(?:同步|部署|推送|烧录|运行到|显示到)\s*(?:到|至)?\s*(?:核桃派|设备|板子|小屏|屏幕|lvgl|screen)?/ig, "")
    .replace(/[，。,.!！?？；;：:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return subject || "Screen Workspace output";
}

function looksLikeScreenProgramRequest(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  if (/^(?:同步|sync|生成\s*AI\s*总结|总结)$/i.test(text)) return false;
  return /(小屏|屏幕|界面|lvgl|screen|程序|应用|app|面板|工具|播放列表|workspace)/i.test(text)
    || /(?:给我|帮我)?\s*(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)\s*\S{2,}/i.test(text);
}

function ruleBasedIntentClassification(text) {
  const trimmed = String(text || "").trim();
  const lower = trimmed.toLowerCase();
  const aiQuestion = trimmed.match(/^(?:问一下|问ai|问 ai|ai[:：]?|聊天[:：]?)(.+)/i);
  const noteMatch = trimmed.match(/^(?:记一下|记录|note)\s*[:：]?\s*(.+)/i);

  if (aiQuestion && aiQuestion[1].trim()) {
    return normalizeIntentClassification({
      intent: "ai.chat",
      subject: aiQuestion[1].trim(),
      delivery: "none",
      confidence: 0.96,
      source: "rule",
    }, trimmed);
  }

  if (/清屏|clear|重连|断开|ssh|连接/.test(lower)) {
    return normalizeIntentClassification({ intent: "terminal.open", subject: trimmed, confidence: 0.92, source: "rule" }, trimmed);
  }

  if (looksLikeScreenProgramRequest(trimmed)) {
    return normalizeIntentClassification({
      intent: "screen.generate",
      subject: screenIntentSubject(trimmed),
      delivery: wantsScreenDeliveryIntent(trimmed) ? "sync_after_preview" : "none",
      confidence: 0.9,
      source: "rule",
    }, trimmed);
  }

  if (wantsScreenDeliveryIntent(trimmed) && /核桃派|设备|板子|小屏|屏幕|lvgl|screen|派/.test(lower)) {
    return normalizeIntentClassification({ intent: "screen.sync", subject: trimmed, delivery: "sync_existing", confidence: 0.86, source: "rule" }, trimmed);
  }

  if (noteMatch && noteMatch[1].trim()) {
    return normalizeIntentClassification({ intent: "device.note.write", subject: noteMatch[1].trim(), confidence: 0.9, source: "rule" }, trimmed);
  }

  if (/状态|健康|还好吗|status|系统|服务|docker|内存|存储|磁盘|空间/.test(lower) || (/怎么样/.test(lower) && /核桃派|设备|板子|系统|服务/.test(lower))) {
    return normalizeIntentClassification({ intent: "device.status.read", subject: trimmed, confidence: 0.86, source: "rule" }, trimmed);
  }
  if (/快照|snapshot|release|os-release|kernel|内核|hostname|启动配置|boot|设备信息|板子信息|硬件信息/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.snapshot.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.network.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/gpio|引脚|针脚|i2c|spi|uart|pwm|总线|bus|set-device/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.gpio.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/今天.*(笔记|记录)|笔记.*今天|记了什么|notes|today/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.notes.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }

  if (!/播放\s*(按钮|键|控件)/.test(lower) && (/walnut\s+(video|play)|视频|彩色\s*ascii|ascii\s*(视频|动画)?|demo/.test(lower) || /(运行|执行|打开|播放).*(玩具|演示|效果|动画|play)/.test(lower))) {
    return normalizeIntentClassification({ intent: "terminal.tool", subject: trimmed, confidence: 0.78, source: "rule" }, trimmed);
  }

  return normalizeIntentClassification({ intent: "ai.chat", subject: trimmed, confidence: 0.62, source: "rule" }, trimmed);
}

function normalizeIntentClassification(value, fallbackText = "") {
  const fallback = String(fallbackText || "").trim();
  const intent = INTENT_TYPES.has(value?.intent) ? value.intent : "ai.chat";
  const delivery = INTENT_DELIVERIES.has(value?.delivery) ? value.delivery : "none";
  const confidence = Math.max(0, Math.min(1, Number(value?.confidence ?? 0.5)));
  const subject = String(value?.subject || fallback).trim().slice(0, 120) || fallback || "";
  return {
    schema: "walnutpi.intent.classification.v1",
    intent,
    subject,
    delivery,
    confidence: Number(confidence.toFixed(2)),
    source: value?.source === "ai" ? "ai" : "rule",
  };
}

function parseIntentJson(text) {
  return parseJsonObjectText(text);
}

function intentClassificationSystemPrompt() {
  return [
    "You classify WalnutPi Web user input into a strict JSON object.",
    "Return JSON only. Do not return shell commands.",
    "Allowed intent values: screen.generate, screen.sync, device.status.read, device.snapshot.read, device.network.read, device.gpio.read, device.notes.read, device.note.write, terminal.open, terminal.tool, ai.chat.",
    "Allowed delivery values: none, sync_after_preview, sync_existing.",
    "Workflow priority: explicit AI/chat first; generation/design/create/build any object is screen.generate; sync/flash/deploy to WalnutPi is screen sync or sync_after_preview when generation is also present; only explicit Web shortcuts become device status/network/GPIO intents; open-ended realtime questions stay ai.chat so device-side WalnutAI can choose tools.",
    "CLI tools are executors only. Never choose terminal.tool just because generated UI mentions broadcast, play button, effect, or animation style.",
  ].join("\n");
}

async function aiIntentClassification(text, ruleIntent) {
  if (!AI_API_KEY) return null;
  const data = await callResponsesApi({
    operation: "intent.classify",
    body: {
      model: AI_MODEL,
      input: [
        { role: "system", content: intentClassificationSystemPrompt() },
        {
          role: "user",
          content: JSON.stringify({
            text,
            ruleFallback: ruleIntent,
            outputSchema: {
              intent: "one allowed intent string",
              subject: "short object/topic text",
              delivery: "none | sync_after_preview | sync_existing",
              confidence: "0..1 number",
            },
          }, null, 2),
        },
      ],
    },
  });
  const parsed = parseIntentJson(parseResponsesOutput(data));
  return normalizeIntentClassification({ ...parsed, source: "ai" }, text);
}

function intentClassificationAllowed(aiIntent, ruleIntent, text) {
  if (!aiIntent || aiIntent.confidence < 0.72) return false;
  if (ruleIntent.intent === "screen.generate" && aiIntent.intent !== "screen.generate") return false;
  if (ruleIntent.intent === "screen.sync" && !["screen.sync", "screen.generate"].includes(aiIntent.intent)) return false;
  if (ruleIntent.intent.startsWith("device.") && aiIntent.intent === "terminal.tool") return false;
  if (wantsScreenDeliveryIntent(text) && aiIntent.intent === "ai.chat") return false;
  return true;
}

async function classifyIntent(text) {
  const ruleIntent = ruleBasedIntentClassification(text);
  try {
    const aiIntent = await aiIntentClassification(text, ruleIntent);
    if (intentClassificationAllowed(aiIntent, ruleIntent, text)) {
      return { ...aiIntent, fallback: ruleIntent };
    }
  } catch {
    // Rule-based classification remains the safety boundary if the AI classifier fails.
  }
  return ruleIntent;
}

async function handleIntentClassify(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }
  const text = String(body.text || "").trim();
  if (!text) return json({ ok: false, error: "missing text" }, 400);
  const classification = await classifyIntent(text);
  return json({ ok: true, classification });
}

async function persistScreenSyncResult(result, commandResults = {}, status = 200) {
  try {
    const record = await screenEvidenceLedger.persistSyncResult(result, commandResults);
    await rememberSuccessfulScreenSync(record);
  } catch (error) {
    result.recordWarning = `screen sync record was not saved: ${error.message}`;
  }
  return json(result, status);
}

function successfulScreenSyncEntry(record) {
  const visualChecks = record.screenEvidence?.visualChecks || {};
  const semantic = record.screenEvidence?.semantic || {};
  const playlistHash = record.playlistHash || record.deliveryManifest?.screenPlaylistHash || "";
  const activeItem = record.screenEvidence?.playlistEvidence?.activeItem || semantic.activeItem || null;
  const lines = [
    `## ${record.buildId}`,
    "",
    "- kind: screen-workspace-sync-success",
    `- finishedAt: ${record.finishedAt || ""}`,
    `- playlistHash: ${playlistHash}`,
    `- activeManifestHash: ${activeItem?.manifestHash || ""}`,
    `- artifactHash: ${record.artifactHash || ""}`,
    `- deliveryHash: ${record.deliveryHash || ""}`,
    `- visualMatch: ${record.screenEvidence?.visualMatch || "unknown"}`,
    `- frameHash: ${record.screenEvidence?.frame?.sha256 || ""}`,
    `- previewSignatureHash: ${semantic.previewSignatureHash || ""}`,
    `- deviceSignatureHash: ${semantic.deviceSignatureHash || ""}`,
    `- checks: frameDimensionsMatched=${visualChecks.frameDimensionsMatched ?? ""} frameNonblank=${visualChecks.frameNonblank ?? ""}`,
    `- activeItem: ${activeItem?.manifestId || "none"} ${activeItem?.outputType || ""}`,
    `- summary: ${String(record.summary || "").replace(/\s+/g, " ").slice(0, 500)}`,
    "",
    "Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.",
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
    existing = [
      "# WalnutPi Screen Workspace Sync Successes",
      "",
      "This file is auto-appended by the Web screen sync flow. It stores compact successful Screen Workspace patterns only, not command logs or image bytes.",
      "",
    ].join("\n");
  }
  if (existing.includes(`## ${record.buildId}`)) return;
  await writeFile(SCREEN_SUCCESS_CORPUS_PATH, `${existing.trimEnd()}\n\n${successfulScreenSyncEntry(record)}`, "utf8");
}

function runLocal(command, args, options = {}) {
  const {
    timeoutMs = 15_000,
    outputLimit = ACTION_OUTPUT_LIMIT,
    cwd = PROJECT_ROOT,
  } = options;
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (command === "bash") {
      const runtimeShimDir = path.join(tmpdir(), "walnutpi-runtime-shims");
      mkdirSync(runtimeShimDir, { recursive: true });
      const nodeTarget = findWindowsCommand("node.exe") || process.execPath || "";
      const bunTarget = findWindowsCommand("bun.exe") || (env.BUN_INSTALL ? path.join(env.BUN_INSTALL, "bin", "bun.exe") : "");
      try {
        if (nodeTarget) {
          const nodeShim = path.join(runtimeShimDir, "node");
          writeFileSync(nodeShim, [
            "#!/usr/bin/env sh",
            "args=\"\"",
            "for arg in \"$@\"; do",
            "  case \"$arg\" in",
            "    /mnt/[a-zA-Z]/*)",
            "      drive=$(printf '%s' \"$arg\" | cut -c6 | tr '[:lower:]' '[:upper:]')",
            "      rest=$(printf '%s' \"$arg\" | cut -c8- | sed 's#/#\\\\#g')",
            "      arg=\"${drive}:\\\\${rest}\"",
            "      ;;",
            "  esac",
            "  args=\"$args $(printf '%s' \"$arg\" | sed \"s/'/'\\\\''/g; s/^/'/; s/$/'/\")\"",
            "done",
            `eval "exec ${shellQuote(bashPath(nodeTarget))} $args"`,
            "",
          ].join("\n"));
          chmodSync(nodeShim, 0o755);
        }
        if (bunTarget) {
          const bunShim = path.join(runtimeShimDir, "bun");
          writeFileSync(bunShim, `#!/usr/bin/env sh\nexec ${shellQuote(bashPath(bunTarget))} "$@"\n`);
          chmodSync(bunShim, 0o755);
        }
      } catch {
        // The build script can still use runtimes already available in PATH.
      }
      env.PATH = `${bashPath(runtimeShimDir)}:${env.PATH || env.Path || ""}`;
      env.Path = env.PATH;
    } else {
      const runtimeDirs = [
        process.execPath ? path.dirname(process.execPath) : "",
        env.BUN_INSTALL ? path.join(env.BUN_INSTALL, "bin") : "",
      ].filter(Boolean);
      if (runtimeDirs.length) {
        env.PATH = [...runtimeDirs, env.PATH || env.Path || ""].filter(Boolean).join(path.delimiter);
        env.Path = env.PATH;
      }
    }
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
        output: limitedOutput(`${stdout}${stderr}\n[local] command timed out`.trim(), outputLimit),
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
      resolve({
        ok: code === 0,
        code,
        output: limitedOutput(`${stdout}${stderr}`.trim() || "ok", outputLimit),
      });
    });
  });
}

function bashPath(value) {
  return String(value).replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
}

async function runRemote(command, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.run(command, timeoutMs, outputLimit);
}

async function runRemoteScript(script, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.runScript(script, timeoutMs, outputLimit);
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

const screenWorkspaceStore = createScreenWorkspaceStore({
  workspaceRoot: SCREEN_WORKSPACE_ROOT,
});

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

function newScreenBuildId(startedAt = new Date()) {
  return `screen-${startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

const screenWorkspaceSyncWorkflow = createScreenWorkspaceSyncWorkflow({
  readPlaylistEnvelope: () => screenWorkspaceStore.readPlaylistEnvelope("default"),
  deliveryAdapter: screenDeliveryAdapter(),
  rememberFrameTicket: rememberScreenFrameTicket,
  validSha256,
  newBuildId: newScreenBuildId,
});

async function readJsonRequest(req) {
  try {
    return await req.json();
  } catch {
    throw new Error("请求不是有效 JSON。");
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

  const captureResult = await walnutRemote.capturePngBase64();
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
      "x-walnut-playlist-sha256": ticket.playlistHash || "",
      "x-walnut-manifest-sha256": ticket.manifestHash || "",
      "x-walnut-artifact-sha256": ticket.artifactHash || "",
      "x-walnut-record-warning": recordWarning,
    },
  });
}

async function cacheScreenFramePng(buildId, parsed) {
  await screenEvidenceLedger.writeFramePng(buildId, parsed);
}

async function handleScreenRecordFrame(buildId) {
  const { id, bytes } = await screenEvidenceLedger.readFramePng(buildId);
  if (!id) return json({ ok: false, error: "Invalid screen record id" }, 400);
  if (!bytes) return json({ ok: false, error: "screen record frame not found" }, 404);

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
      "x-walnut-playlist-sha256": record?.playlistHash || "",
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

async function handleScreenWorkspacePlaylist(url) {
  try {
    const playlistId = url.searchParams.get("id") || "default";
    return json(await screenWorkspaceStore.readPlaylistEnvelope(playlistId));
  } catch (error) {
    return workspaceErrorResponse(error, json);
  }
}

async function handleScreenWorkspaceManifest(manifestId) {
  try {
    const envelope = await screenWorkspaceStore.readManifest(manifestId);
    return json({
      ok: true,
      schema: "walnutpi.screenWorkspaceManifestEnvelope.v1",
      manifest: envelope.manifest,
      manifestHash: envelope.manifestHash,
    });
  } catch (error) {
    return workspaceErrorResponse(error, json);
  }
}

async function handleScreenWorkspaceAsset(url) {
  try {
    const asset = await screenWorkspaceStore.assetResponse(url.pathname);
    if (!asset) return json({ ok: false, error: "asset route not found" }, 404);
    return new Response(Bun.file(asset.filePath), {
      headers: asset.headers,
    });
  } catch (error) {
    return workspaceErrorResponse(error, json);
  }
}

async function handleScreenWorkspaceImport(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  try {
    const sourceId = cleanScreenWorkspaceId(body.sourceId || body.id || `source-${Date.now()}`, "sourceId");
    const sourceUrl = cleanWorkspaceSourceUrl(body.url || body.sourceUrl);
    const imported = await importWorkspaceSourceUrl({
      sourceId,
      sourceUrl,
      license: body.license || "unknown-personal-sync",
      title: body.title,
    });

    await webMetricsLedger.append({
      kind: "screen.workspace.import",
      operation: "screen.workspace.import",
      ok: true,
      sourceId,
      mediaType: imported.mediaType,
      bytes: imported.bytes,
    });

    return json({
      ok: true,
      schema: "walnutpi.screenWorkspaceImportResult.v1",
      source: imported.sourceRecord,
      sourceAssetId: sourceId,
    });
  } catch (error) {
    await webMetricsLedger.append({
      kind: "screen.workspace.import",
      operation: "screen.workspace.import",
      ok: false,
      error: error.message,
    });
    return json({
      ok: false,
      error: "screen workspace import failed",
      output: error.message,
    }, error.status || 400);
  }
}

async function handleScreenWorkspaceProcess(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  try {
    const sourceAssetRecord = body.sourceAssetId
      ? await readWorkspaceSourceAsset(body.sourceAssetId)
      : null;
    const sourcePath = sourceAssetRecord?.originalPath || cleanWorkspaceSourcePath(body.sourcePath || body.path);
    const screenId = cleanScreenWorkspaceId(body.screenId || body.id, "screenId");
    const sourceId = body.sourceId
      ? cleanScreenWorkspaceId(body.sourceId, "sourceId")
      : sourceAssetRecord?.id || `${screenId}-source`;
    const outputType = cleanWorkspaceOutputType(body.outputType || body.type || "static");
    const preset = cleanWorkspacePreset(body.preset || "fit-cover:480x320");
    const animation = cleanWorkspaceAnimation(body.animation || {});
    const result = await processSourceAssetToScreenOutput({
      workspaceRoot: SCREEN_WORKSPACE_ROOT,
      plan: {
        id: body.planId,
        screenId,
        title: body.title,
        description: body.description,
        animation,
      },
      sourceAsset: {
        id: sourceId,
        path: sourcePath,
        selected: true,
        mediaType: body.mediaType || sourceAssetRecord?.mediaType,
        license: body.license || sourceAssetRecord?.license || "unknown-personal-sync",
        origin: body.origin || sourceAssetRecord?.origin || null,
      },
      outputType,
      preset,
    });

    let playlist = null;
    if (body.playlist !== false) {
      const playlistMode = cleanWorkspacePlaylistMode(body.playlistMode || body.playlistAction || "replace");
      const writePlaylist = playlistMode === "append" ? appendScreenPlaylistItem : writeDefaultScreenPlaylist;
      playlist = await writePlaylist({
        workspaceRoot: SCREEN_WORKSPACE_ROOT,
        playlistId: typeof body.playlist === "string" ? body.playlist : "default",
        manifestId: result.screenId,
        durationMs: cleanWorkspaceInteger(body.durationMs || 8000, "durationMs", 1, 86400000),
        repeat: cleanWorkspaceInteger(body.repeat || 1, "repeat", 1, 1000),
        loop: body.loop === undefined ? true : Boolean(body.loop),
      });
    }

    await webMetricsLedger.append({
      kind: "screen.workspace.process",
      operation: "screen.workspace.process",
      ok: true,
      outputType: result.output.type,
      screenId: result.screenId,
      preset,
    });

    return json({
      ok: true,
      schema: "walnutpi.screenWorkspaceProcessResult.v1",
      workspaceRoot: SCREEN_WORKSPACE_ROOT,
      screenId: result.screenId,
      manifest: result.manifest,
      output: result.output,
      playlist: playlist?.playlist || null,
    });
  } catch (error) {
    await webMetricsLedger.append({
      kind: "screen.workspace.process",
      operation: "screen.workspace.process",
      ok: false,
      error: error.message,
    });
    return json({
      ok: false,
      error: "screen workspace processing failed",
      output: error.message,
    }, 400);
  }
}

async function handleScreenWorkspaceLvglPreview() {
  try {
    const envelope = await screenWorkspaceStore.readPlaylistEnvelope("default");
    await mkdir(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, { recursive: true });
    const runtimeAssets = await generateLvglScreenWorkspaceRuntimeAssets({
      workspaceRoot: SCREEN_WORKSPACE_ROOT,
      playlistId: "default",
    });

    const build = await runLvglPreviewBuild();
    if (!build.ok) {
      return json({
        ok: false,
        error: "LVGL preview build failed",
        output: build.output,
      }, 500);
    }

    const exePath = lvglPreviewExePath();
    if (!existsSync(exePath)) {
      return json({
        ok: false,
        error: "LVGL preview executable is missing",
        output: exePath,
      }, 500);
    }

    const advanceMs = lvglPreviewAdvanceTimes(envelope);
    const frames = [];
    for (const ms of advanceMs) {
      const stem = `lvgl-${String(ms).padStart(5, "0")}ms`;
      const bmpPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.bmp`);
      const pngPath = path.join(SCREEN_LVGL_PREVIEW_OUTPUT_DIR, `${stem}.png`);
      const rendered = await runLocal(exePath, [bmpPath, "--advance-ms", String(ms), "--runtime", runtimeAssets.indexPath], {
        timeoutMs: 30_000,
        outputLimit: 12_000,
      });
      if (!rendered.ok) {
        return json({
          ok: false,
          error: "LVGL preview render failed",
          output: rendered.output,
          advanceMs: ms,
        }, 500);
      }
      await ensurePreviewPng(bmpPath, pngPath);
      frames.push({
        advanceMs: ms,
        bmp: screenWorkspaceAssetUrl(bmpPath),
        png: screenWorkspaceAssetUrl(pngPath),
      });
    }

    return json({
      ok: true,
      schema: "walnutpi.screenWorkspaceLvglPreview.v1",
      playlistHash: envelope.playlistHash,
      runtimeIndex: screenWorkspaceAssetUrl(runtimeAssets.indexPath),
      itemCount: envelope.items.length,
      frameCount: frames.length,
      frames,
      buildOutput: build.output,
    });
  } catch (error) {
    return json({
      ok: false,
      error: "LVGL preview failed",
      output: error.message,
    }, 500);
  }
}

async function readWorkspaceSourceAsset(sourceAssetId) {
  const cleanId = cleanScreenWorkspaceId(sourceAssetId, "sourceAssetId");
  const sourceJsonPath = path.resolve(SCREEN_WORKSPACE_ROOT, "sources", cleanId, "source.json");
  const sourceRoot = path.resolve(SCREEN_WORKSPACE_ROOT, "sources");
  const relativeToSources = path.relative(sourceRoot, sourceJsonPath);
  if (relativeToSources.startsWith("..") || path.isAbsolute(relativeToSources)) {
    throw new Error("sourceAssetId must stay inside the Screen Workspace sources");
  }
  const sourceRecord = JSON.parse(await readFile(sourceJsonPath, "utf8"));
  if (!sourceRecord || typeof sourceRecord !== "object" || Array.isArray(sourceRecord)) {
    throw new Error("source asset record must be an object");
  }
  if (sourceRecord.selected === false) {
    throw new Error("source asset must be selected before processing");
  }
  const original = String(sourceRecord.original || "").trim();
  if (!original) throw new Error("source asset original is missing");
  const originalPath = path.resolve(path.dirname(sourceJsonPath), original);
  const relativeToWorkspace = path.relative(SCREEN_WORKSPACE_ROOT, originalPath);
  if (relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
    throw new Error("source asset original must stay inside the Screen Workspace");
  }
  return {
    ...sourceRecord,
    id: cleanId,
    sourceJsonPath,
    originalPath,
  };
}

async function importWorkspaceSourceUrl({
  sourceId,
  sourceUrl,
  license,
  title,
}) {
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(30_000)
      : undefined,
    headers: {
      "user-agent": "WalnutPi Screen Workspace source importer",
      accept: "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,*/*;q=0.2",
    },
  });
  if (!response.ok) {
    throw new Error(`source download failed with HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > SCREEN_SOURCE_IMPORT_MAX_BYTES) {
    throw new Error(`source is too large; max ${SCREEN_SOURCE_IMPORT_MAX_BYTES} bytes`);
  }

  const mediaType = cleanWorkspaceImportMediaType(response.headers.get("content-type"));
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("source download was empty");
  if (bytes.length > SCREEN_SOURCE_IMPORT_MAX_BYTES) {
    throw new Error(`source is too large; max ${SCREEN_SOURCE_IMPORT_MAX_BYTES} bytes`);
  }

  const sourceDir = path.join(SCREEN_WORKSPACE_ROOT, "sources", sourceId);
  const extension = workspaceImportExtension(mediaType, sourceUrl);
  const originalFileName = `original${extension}`;
  const originalPath = path.join(sourceDir, originalFileName);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(originalPath, bytes);

  const sourceRecord = {
    schema: "walnutpi.screen-source-asset.v1",
    id: sourceId,
    ...(title ? { title: String(title).replace(/\s+/g, " ").trim().slice(0, 80) } : {}),
    selected: true,
    importedAt: new Date().toISOString(),
    original: originalFileName,
    fileSha256: sha256(bytes),
    mediaType,
    license: String(license || "unknown-personal-sync").replace(/\s+/g, " ").trim().slice(0, 120),
    origin: sourceUrl,
  };
  await writeFile(path.join(sourceDir, "source.json"), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");

  return {
    sourceRecord,
    mediaType,
    bytes: bytes.length,
  };
}

function cleanScreenWorkspaceId(value, field) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) {
    throw new Error(`${field} must be a simple slug`);
  }
  return text;
}

function cleanWorkspaceSourceUrl(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("sourceUrl is required");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("sourceUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("sourceUrl must use http or https");
  }
  parsed.hash = "";
  return parsed.toString();
}

function cleanWorkspaceImportMediaType(value) {
  const mediaType = String(value || "").split(";")[0].trim().toLowerCase();
  const allowed = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ]);
  if (!allowed.has(mediaType)) {
    throw new Error("source URL must point to a PNG, JPEG, GIF, WebP, MP4, WebM, or MOV file");
  }
  return mediaType;
}

function workspaceImportExtension(mediaType, sourceUrl) {
  const byType = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
  };
  const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm", ".mov"].includes(extension)) {
    return extension === ".jpeg" ? ".jpg" : extension;
  }
  return byType[mediaType] || ".bin";
}

function lvglPreviewExePath() {
  return process.platform === "win32"
    ? path.join(PROJECT_ROOT, "build", "lvgl_app-windows", "walnut-lvgl-preview.exe")
    : path.join(PROJECT_ROOT, "build", "lvgl_app", "walnut-lvgl-preview");
}

async function runLvglPreviewBuild() {
  if (process.platform === "win32") {
    const pwsh = findWindowsCommand("pwsh.exe") || findWindowsCommand("powershell.exe") || "pwsh";
    return runLocal(pwsh, ["./scripts/build-lvgl-app.ps1", "-WorkspaceLvgl", "1"], {
      timeoutMs: 120_000,
      outputLimit: 24_000,
    });
  }
  return runLocal("bash", ["./scripts/build-lvgl-app.sh"], {
    timeoutMs: 120_000,
    outputLimit: 24_000,
  });
}

function lvglPreviewAdvanceTimes(envelope) {
  const first = envelope?.items?.[0];
  const output = first?.output;
  if (!output || output.type === "static") return [0];
  const frames = Array.isArray(output.frames) ? output.frames : [];
  const duration = frames.reduce((sum, frame) => sum + Math.max(1, Number(frame.durationMs || 100)), 0);
  if (duration <= 0) return [0];
  const count = Math.min(24, Math.max(1, frames.length));
  if (count === 1) return [0];
  return [...new Set(Array.from({ length: count }, (_, index) => (
    Math.floor(index * (duration - 1) / (count - 1))
  )))];
}

async function ensurePreviewPng(bmpPath, pngPath) {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Drawing",
      `$bmp = [System.Drawing.Image]::FromFile('${escapePowershellSingleQuoted(bmpPath)}')`,
      "try {",
      `  $bmp.Save('${escapePowershellSingleQuoted(pngPath)}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "} finally {",
      "  $bmp.Dispose()",
      "}",
    ].join("\n");
    const pwsh = findWindowsCommand("pwsh.exe") || findWindowsCommand("powershell.exe") || "pwsh";
    const converted = await runLocal(pwsh, ["-NoProfile", "-Command", script], {
      timeoutMs: 30_000,
      outputLimit: 8_000,
    });
    if (!converted.ok) throw new Error(`LVGL preview PNG conversion failed: ${converted.output}`);
    return;
  }
  await copyFile(bmpPath, pngPath);
}

function screenWorkspaceAssetUrl(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(SCREEN_WORKSPACE_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("LVGL preview output must stay inside the Screen Workspace");
  }
  return `/api/screen/workspace/assets/${encodeURIComponent(relative.replaceAll("\\", "/"))}`;
}

function escapePowershellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function cleanWorkspaceSourcePath(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("sourcePath is required");
  const resolved = path.resolve(text);
  const relativeToProject = path.relative(PROJECT_ROOT, resolved);
  if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
    throw new Error("sourcePath must stay inside the WalnutPi project");
  }
  return resolved;
}

function cleanWorkspaceOutputType(value) {
  const text = String(value || "static").trim();
  if (text !== "static" && text !== "animated") throw new Error("outputType must be static or animated");
  return text;
}

function cleanWorkspacePreset(value) {
  const text = String(value || "").trim();
  const allowed = new Set([
    "fit-cover:480x320",
    "fit-contain:480x320",
    "pixel-grid:120x80@4x",
    "pixel-grid:240x160@2x",
  ]);
  if (!allowed.has(text)) throw new Error("preset is not supported");
  return text;
}

function cleanWorkspaceAnimation(value) {
  const animation = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    fps: cleanWorkspaceInteger(animation.fps || 6, "animation.fps", 1, 60),
    maxSeconds: cleanWorkspaceInteger(animation.maxSeconds || 8, "animation.maxSeconds", 1, 60),
    maxFrames: cleanWorkspaceInteger(animation.maxFrames || 24, "animation.maxFrames", 1, 80),
  };
}

function cleanWorkspacePlaylistMode(value) {
  const text = String(value || "replace").trim();
  if (text !== "replace" && text !== "append") throw new Error("playlistMode must be replace or append");
  return text;
}

function cleanWorkspaceInteger(value, field, low, high) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a number`);
  const rounded = Math.round(number);
  if (rounded !== number || rounded < low || rounded > high) {
    throw new Error(`${field} must be an integer between ${low} and ${high}`);
  }
  return rounded;
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
    claim: String(value.claim || "web-lvgl-preview-compared-to-device-png").slice(0, 120),
    source: String(value.source || (schema.endsWith(".v2") ? "actual-lvgl-offscreen-bmp" : "semantic-canvas-preview"))
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

async function handleScreenWorkspaceSync(req, mode = "remote") {
  const startedAt = Date.now();
  const outcome = await screenWorkspaceSyncWorkflow.run({
    requestJson: () => req.json(),
    mode,
  });
  await webMetricsLedger.append({
    kind: "screen.workspace.sync",
    operation: "screen.workspace.sync",
    ok: Boolean(outcome.result?.ok),
    status: outcome.status,
    latencyMs: Date.now() - startedAt,
    mode: outcome.result?.mode,
    stage: outcome.result?.failedStage || "complete",
    buildId: outcome.result?.buildId,
    playlistHash: outcome.result?.playlistHash,
    error: outcome.result?.ok ? null : outcome.result?.summary || outcome.result?.output,
  });
  return persistScreenSyncResult(outcome.result, outcome.commandResults, outcome.status);
}

const ACTIONS = {
  status: {
    title: "查状态",
    risk: "read",
    mode: "remote",
    command: "if walnut action --help >/dev/null 2>&1; then walnut action run status --json; else walnut status; fi",
    parseJsonOutput: true,
    reply: "我会读取系统、网络、存储、服务和音频状态。",
    timeoutMs: 20_000,
  },
  snapshot: {
    title: "设备快照",
    risk: "read",
    mode: "remote",
    command: "if walnut action --help >/dev/null 2>&1; then walnut action run snapshot --json; else hostname; uname -a; cat /etc/os-release 2>/dev/null | head -n 6; walnut screen state 2>/dev/null || true; fi",
    parseJsonOutput: true,
    reply: "我会先做只读设备快照，确认板子、系统、引脚和 overlay 状态。",
    timeoutMs: 20_000,
  },
  network: {
    title: "网络检查",
    risk: "read",
    mode: "remote",
    command: "if walnut action --help >/dev/null 2>&1; then walnut action run network --json; else ip -brief addr; ip route; command -v nmcli >/dev/null 2>&1 && nmcli -t -f DEVICE,STATE,CONNECTION device status || true; fi",
    parseJsonOutput: true,
    reply: "我会检查 IP、默认路由和 Wi-Fi 状态。",
    timeoutMs: 12_000,
  },
  gpio: {
    title: "GPIO 检查",
    risk: "read",
    mode: "remote",
    command: "if walnut action --help >/dev/null 2>&1; then walnut action run gpio --json; elif command -v gpio >/dev/null 2>&1; then gpio pins; gpio pin i2c; gpio pin spi; gpio pin uart; else echo 'gpio unavailable'; fi",
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
      return {
        command: `WALNUT_AI_TIMEOUT=${shellQuote(AI_TIMEOUT_SECONDS)} WALNUT_AI_ENABLE_INLINE_MEMORY=0 WALNUT_AI_DISABLE_SESSION_LOG=1 walnut-ai ${shellQuote(text)}`,
        contextUsed: {
          schema: "walnutpi.webAiDelegation.v1",
          delegatedTo: "walnut-ai",
          toolRouting: "device-side",
          memoryDistillCandidate: /记住|记着|以后|下次|我的偏好|我喜欢|我不喜欢|我习惯|我是|我叫|我用|我在用|我的项目|我的设备|所有对话|目标|默认/.test(text),
        },
      };
    },
    reply: "",
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
  const startedAt = Date.now();
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "请求不是有效 JSON。" }, 400);
  }

  const id = String(body.action || "");
  const action = ACTIONS[id];
  if (!action) {
    await webMetricsLedger.append({
      kind: "agent.action",
      operation: "agent.action",
      ok: false,
      status: 400,
      latencyMs: Date.now() - startedAt,
      action: id || "unknown",
      error: "unknown action",
    });
    return json({ ok: false, error: "未知或未允许的动作。" }, 400);
  }
  const sessionId = webSessionLedger.safeSessionId(body.sessionId);

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
    await webMetricsLedger.append({
      kind: "agent.action",
      operation: "agent.action",
      ok: false,
      status: 400,
      latencyMs: Date.now() - startedAt,
      action: id,
      mode: action.mode,
      error: error.message,
    });
    return json({ ok: false, error: error.message }, 400);
  }

  if (action.mode === "terminal") {
    const ensure = await walnutRemote.ensureWalnutCli();
    if (!ensure.ok) {
      await webMetricsLedger.append({
        kind: "agent.action",
        operation: "agent.action",
        ok: false,
        status: 500,
        latencyMs: Date.now() - startedAt,
        action: id,
        mode: action.mode,
        error: "walnut cli preflight failed",
      });
      return json({
        ok: false,
        ...actionSummary(action, id),
        command,
        code: ensure.code,
        remoteOk: false,
        output: limitedOutput(
          [
            "[walnut cli preflight failed]",
            ensure.output,
            "",
            "[terminal command skipped]",
            command,
          ].join("\n"),
        ),
      }, 500);
    }
    const responseBody = {
      ok: true,
      ...actionSummary(action, id),
      command,
      preflightOutput: ensure.ensured ? ensure.output : "",
    };
    if (sessionId) {
      await webSessionLedger.appendEvent(sessionId, {
        role: "action",
        action: id,
        content: action.reply || "",
        command,
        ok: true,
      });
    }
    await webMetricsLedger.append({
      kind: "agent.action",
      operation: "agent.action",
      ok: true,
      latencyMs: Date.now() - startedAt,
      action: id,
      mode: action.mode,
      source: "terminal",
    });
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
    await webSessionLedger.appendEvent(sessionId, {
      role: "action",
      action: id,
      content: output || result.output || "",
      command,
      ok: responseBody.ok,
      contextUsed,
    });
  }
  await webMetricsLedger.append({
    kind: "agent.action",
    operation: "agent.action",
    ok: responseBody.ok,
    latencyMs: Date.now() - startedAt,
    action: id,
    mode: action.mode,
    source: contextUsed?.delegatedTo || "remote",
    error: responseBody.ok ? null : output || result.output,
  });
  return json(responseBody);
}

function startSsh(ws) {
  const target = `${SSH_USER}@${SSH_HOST}`;
  const send = (chunk) => {
    try {
      ws.send(chunk);
      return true;
    } catch {
      return false;
    }
  };

  ws.data.child = null;
  send(`\r\n[local] checking walnut CLI on ${target}\r\n`);

  walnutRemote.ensureWalnutCli()
    .then((ensure) => {
      if (!ensure.ok) {
        send(`\r\n[local] walnut CLI preflight failed\r\n${ensure.output}\r\n`);
        ws.close();
        return;
      }
      if (ensure.ensured) {
        send(`\r\n[local] ${ensure.output}\r\n`);
      }
      openSshSession(ws, target);
    })
    .catch((error) => {
      send(`\r\n[local] walnut CLI preflight error: ${error.message}\r\n`);
      ws.close();
    });
}

function openSshSession(ws, target) {
  const child = walnutRemote.openInteractiveSession();

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
  idleTimeout: 255,
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

    if (url.pathname === "/api/metrics") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      const limit = Number(url.searchParams.get("limit") || 200);
      return json(await webMetricsLedger.report(Number.isFinite(limit) ? limit : 200));
    }

    if (url.pathname === "/api/session") {
      return handleSession(req, url);
    }

    if (url.pathname === "/api/intent/classify") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleIntentClassify(req);
    }

    if (url.pathname === "/api/screen/workspace/playlist") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenWorkspacePlaylist(url);
    }

    if (url.pathname === "/api/screen/workspace/process") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenWorkspaceProcess(req);
    }

    if (url.pathname === "/api/screen/workspace/import") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenWorkspaceImport(req);
    }

    if (url.pathname === "/api/screen/workspace/lvgl-preview") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenWorkspaceLvglPreview();
    }

    if (url.pathname === "/api/screen/workspace/sync") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenWorkspaceSync(req, previewOnly(url) ? "preview" : "remote");
    }

    const screenWorkspaceManifestMatch = url.pathname.match(/^\/api\/screen\/workspace\/manifest\/([^/]+)$/);
    if (screenWorkspaceManifestMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      let manifestId;
      try {
        manifestId = decodeURIComponent(screenWorkspaceManifestMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen workspace manifest id" }, 400);
      }
      return handleScreenWorkspaceManifest(manifestId);
    }

    if (url.pathname.startsWith("/api/screen/workspace/assets/")) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenWorkspaceAsset(url);
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

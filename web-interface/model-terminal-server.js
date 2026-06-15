import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import {
  cleanText,
  metricItemFromText,
  normalizeScreenManifest,
  stableStringify,
} from "../scripts/screen-manifest-vocabulary.js";
import { createScreenEvidenceLedger } from "./screen-evidence-ledger.js";
import { createScreenEvidenceReview } from "./screen-evidence-review.js";
import { createSshLocalAgentAdapter } from "./screen-delivery-adapters/ssh-local-agent.js";
import { createScreenSyncWorkflow } from "./screen-sync-workflow.js";
import { createWebSessionLedger } from "./web-session-ledger.js";
import { createWebMetricsLedger } from "./web-metrics-ledger.js";
import { createLvglPreviewRenderer } from "./lvgl-preview-renderer.js";
import { createWalnutRemoteAdapter } from "./walnut-remote-adapter.js";
import { createScreenManifestStore } from "./screen-manifest-store.js";
import { createScreenManifestEditor } from "./screen-manifest-editor.js";

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
const LVGL_PREVIEW_TIMEOUT_MS = Number(process.env.WALNUT_LVGL_PREVIEW_TIMEOUT_MS || 180_000);
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

const screenEvidenceReview = createScreenEvidenceReview({
  screenManifestPath: SCREEN_MANIFEST_PATH,
  projectRoot: PROJECT_ROOT,
});

const buildScreenRepairHint = screenEvidenceReview.buildRepairHint;

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

const buildScreenRepairCandidate = screenEvidenceReview.buildRepairCandidate;
const buildScreenRepairProposal = screenEvidenceReview.buildRepairProposal;

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
  return screenProgramSubject(input);
}

function asciiScreenTitle(value, fallback = "Walnut App") {
  const words = String(value || "")
    .match(/[a-z0-9]+/gi)
    ?.filter((word) => !/^(a|an|the|screen|ui|app|page|panel|make|create|build|design|for|with)$/i.test(word));
  if (words && words.length) {
    return cleanText(words.slice(0, 2).join(" ").replace(/\b\w/g, (char) => char.toUpperCase()), "generated.title", 32);
  }
  if (/ip|IP|角色|头像|宠物|表情|mascot|character|pixel|像素|动画/i.test(value)) return "IP Loop";
  if (/时间|时钟|日期|clock|time|date/i.test(value)) return "Clock";
  if (/天气|温度|weather/i.test(value)) return "Weather";
  if (/音乐|频谱|播放器|播放|music|audio|spectrum|visualizer/i.test(value)) return "Audio";
  if (/商城|商店|购物|商品|价格|购物车|market|shop|store|cart/i.test(value)) return "Shop";
  if (/网络|network|wifi|wi-?fi/i.test(value)) return "Link";
  if (/状态|健康|status|health|system/i.test(value)) return "Status";
  return fallback;
}

function asciiScreenSubject(value, fallback = "Controlled screen preview") {
  const words = String(value || "").match(/[a-z0-9]+/gi);
  if (words && words.length) return cleanText(words.slice(0, 6).join(" "), "generated.subject", 48);
  if (/ip|IP|角色|头像|宠物|表情|mascot|character|pixel|像素|动画/i.test(value)) return "custom pixel animation";
  if (/时间|时钟|日期|clock|time|date/i.test(value)) return "time and date display";
  if (/天气|温度|weather/i.test(value)) return "weather panel";
  if (/音乐|频谱|播放器|播放|music|audio|spectrum|visualizer/i.test(value)) return "audio visualizer";
  if (/商城|商店|购物|商品|价格|购物车|market|shop|store|cart/i.test(value)) return "shop display";
  if (/网络|network|wifi|wi-?fi/i.test(value)) return "link status display";
  if (/状态|健康|status|health|system/i.test(value)) return "status badge display";
  return fallback;
}

function screenProgramIntentSummary(subject) {
  return "已按你的描述生成小屏预览。确认效果后，可以点击或说“同步到核桃派”。";
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
    "Reuse this pattern for manifest-driven LVGL screen sync: require current manifestHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.",
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

const handleScreenLvglPreview = createLvglPreviewRenderer({
  projectRoot: PROJECT_ROOT,
  timeoutMs: LVGL_PREVIEW_TIMEOUT_MS,
  readManifestEnvelope: screenManifestEnvelope,
  runLocal,
  shellQuote,
  bashPath,
  json,
});

async function runRemote(command, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.run(command, timeoutMs, outputLimit);
}

async function runRemoteScript(script, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.runScript(script, timeoutMs, outputLimit);
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

const screenManifestStore = createScreenManifestStore({
  manifestPath: SCREEN_MANIFEST_PATH,
  validSha256,
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

const screenSyncWorkflow = createScreenSyncWorkflow({
  readManifestEnvelope: screenManifestEnvelope,
  deliveryAdapter: screenDeliveryAdapter(),
  rememberFrameTicket: rememberScreenFrameTicket,
  validSha256,
  newBuildId: newScreenBuildId,
});

function statusPage({ id = "main", tab = "MAIN", status = "READY", tone = "ok", detail = "Ready", progress = 72, metrics = [] } = {}) {
  const metricItems = (metrics.length ? metrics : ["State ready", "Sync next", "Evidence on"])
    .slice(0, 3)
    .map((metric, index) => typeof metric === "object" ? metric : metricItemFromText(metric, index));
  return {
    id,
    tab,
    components: [
      { type: "statusCard", label: "Status", value: status, tone, detail },
      { type: "progress", label: "Progress", value: progress, max: 100, tone },
      { type: "metricGroup", items: metricItems },
    ],
  };
}

function textPage({ id, tab, title, lines }) {
  return {
    id,
    tab,
    components: [
      {
        type: "textPage",
        title,
        lines,
      },
    ],
  };
}

function generatedPage({ id = "main", tab = "PAGE", style = "panel", title = "Walnut App", kicker = "WalnutAI", headline = "READY", body = "Generated screen", badge = "LIVE", accent = "cyan", progress = 64, items = [] } = {}) {
  return {
    id,
    tab,
    components: [
      {
        type: "generatedPage",
        style,
        kicker,
        headline,
        body,
        badge,
        accent,
        progress,
        items: items.slice(0, 3),
      },
    ],
  };
}

function rowsFromGlyphs(width, height, draw) {
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => "."));
  const put = (x, y, symbol) => {
    if (x >= 0 && x < width && y >= 0 && y < height) grid[y][x] = symbol;
  };
  const rect = (x, y, w, h, symbol) => {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) put(xx, yy, symbol);
    }
  };
  const circle = (cx, cy, rx, ry, symbol) => {
    const safeRx = Math.max(1, rx);
    const safeRy = Math.max(1, ry);
    for (let y = Math.floor(cy - safeRy); y <= Math.ceil(cy + safeRy); y += 1) {
      for (let x = Math.floor(cx - safeRx); x <= Math.ceil(cx + safeRx); x += 1) {
        const dx = (x - cx) / safeRx;
        const dy = (y - cy) / safeRy;
        if (dx * dx + dy * dy <= 1) put(x, y, symbol);
      }
    }
  };
  const line = (x, y, text) => {
    for (let i = 0; i < String(text).length; i += 1) {
      const symbol = String(text)[i];
      if (symbol !== ".") put(x + i, y, symbol);
    }
  };
  draw({ put, rect, circle, line });
  return grid.map((row) => row.join(""));
}

const SCREEN_MODULES = [
  { id: "clock", tab: "TIME", pattern: /时间|时钟|日期|clock|time|date/i },
  { id: "weather", tab: "WX", pattern: /天气|温度|weather|forecast/i },
  { id: "audio", tab: "AUD", pattern: /音乐|频谱|播放器|播放|music|audio|spectrum|visualizer/i },
  { id: "shop", tab: "SHOP", pattern: /商城|商店|购物|商品|价格|购物车|market|shop|store|cart/i },
  { id: "network", tab: "NET", pattern: /网络|联网|wifi|wi-?fi|ip\b|ssh|frp|network|link/i },
  { id: "status", tab: "STAT", pattern: /状态|健康|系统|内存|磁盘|status|health|system|device/i },
  { id: "tasks", tab: "TASK", pattern: /任务|待办|todo|task|计划|步骤|agent/i },
];

function seedFromText(value) {
  return parseInt(sha256(String(value || "WalnutPi")).slice(0, 8), 16);
}

function shouldUsePublicImageMaterial(text) {
  const value = String(text || "");
  if (/不要(?:联网|搜索|找图)|本地生成|纯像素|规则生成|no\s+(?:web|search|image)/i.test(value)) return false;
  return /图|图片|照片|素材|参考|海报|封面|头像|角色|IP|logo|商品|商城|天气|城市|车|猫|狗|机器人|视频|动图|动画|文字|文案|新闻|百科|资料|介绍|photo|image|picture|poster|cover|logo|shop|store|market|cat|dog|car|robot|video|clip|gif|text|article|wiki/i.test(value);
}

function publicImageSearchQuery(text) {
  const value = String(text || "");
  const hints = [];
  if (/商城|商店|购物|商品|价格|购物车|shop|store|market|cart/i.test(value)) hints.push("shopping store product icon");
  if (/猫|cat|neko/i.test(value)) hints.push("cat icon");
  if (/狗|dog/i.test(value)) hints.push("dog icon");
  if (/机器人|robot|bot/i.test(value)) hints.push("robot icon");
  if (/车|car|jdm/i.test(value)) hints.push("car icon");
  if (/天气|weather|sun|cloud/i.test(value)) hints.push("weather icon");
  if (/logo|徽标|标志/i.test(value)) hints.push("logo icon");
  const asciiWords = value.match(/[a-z0-9]+/gi)?.slice(0, 6).join(" ");
  if (asciiWords) hints.push(asciiWords);
  return hints.join(" ") || "pixel art icon";
}

function desiredMaterialKind(text) {
  const value = String(text || "");
  if (/视频|短片|动态视频|录像|video|clip|movie|footage/i.test(value)) return "video";
  if (/gif|动图|动画素材|animated/i.test(value)) return "animated-image";
  if (/文字|说明|文案|新闻|百科|资料|介绍|text|article|wiki|copy/i.test(value)) return "text";
  if (/动态|动画|会动|motion|animated/i.test(value)) return "animated-image";
  return "image";
}

async function fetchJsonUrl(url, { timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "WalnutPi screen material search",
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinaryUrl(url, { timeoutMs = 4000, maxBytes = 4_000_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "WalnutPi screen material fetch",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) throw new Error(`image too large: ${contentLength}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`image too large: ${bytes.length}`);
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWikimediaImage(text) {
  const query = publicImageSearchQuery(text);
  const searchUrl = new URL("https://commons.wikimedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("generator", "search");
  searchUrl.searchParams.set("gsrnamespace", "6");
  searchUrl.searchParams.set("gsrsearch", query);
  searchUrl.searchParams.set("gsrlimit", "8");
  searchUrl.searchParams.set("prop", "imageinfo");
  searchUrl.searchParams.set("iiprop", "url|mime|size|extmetadata");
  searchUrl.searchParams.set("iiurlwidth", "480");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("origin", "*");
  const data = await fetchJsonUrl(searchUrl);
  const pages = Object.values(data?.query?.pages || {});
  const candidates = pages
    .map((page) => {
      const info = page?.imageinfo?.[0] || {};
      const mime = String(info.mime || "");
      const url = info.thumburl || info.url || "";
      return {
        title: page.title || "",
        url,
        sourceUrl: info.descriptionurl || "",
        mime,
        width: info.thumbwidth || info.width || null,
        height: info.thumbheight || info.height || null,
        license: info.extmetadata?.LicenseShortName?.value || info.extmetadata?.UsageTerms?.value || "",
        artist: info.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, "").slice(0, 120) || "",
      };
    })
    .filter((item) => item.url && /^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(item.mime));
  return candidates[0] ? { ...candidates[0], query } : null;
}

async function searchWikimediaMedia(text, kind) {
  const query = publicImageSearchQuery(text);
  const mediaType = kind === "video" ? "video" : "image";
  const searchUrl = new URL("https://commons.wikimedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("generator", "mediasearch");
  searchUrl.searchParams.set("gmssearch", query);
  searchUrl.searchParams.set("gmstype", mediaType);
  searchUrl.searchParams.set("gmslimit", "8");
  searchUrl.searchParams.set("prop", "imageinfo");
  searchUrl.searchParams.set("iiprop", "url|mime|size|extmetadata");
  searchUrl.searchParams.set("iiurlwidth", "480");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("origin", "*");
  const data = await fetchJsonUrl(searchUrl);
  const pages = Object.values(data?.query?.pages || {});
  const candidates = pages
    .map((page) => {
      const info = page?.imageinfo?.[0] || {};
      const mime = String(info.mime || "");
      const url = info.thumburl || info.url || "";
      return {
        title: page.title || "",
        url,
        sourceUrl: info.descriptionurl || "",
        mime,
        width: info.thumbwidth || info.width || null,
        height: info.thumbheight || info.height || null,
        license: info.extmetadata?.LicenseShortName?.value || info.extmetadata?.UsageTerms?.value || "",
        artist: info.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, "").slice(0, 120) || "",
        query,
      };
    })
    .filter((item) => {
      if (!item.url) return false;
      if (kind === "video") return /^video\//i.test(item.mime);
      if (kind === "animated-image") return /^image\/gif$/i.test(item.mime) || /gif/i.test(item.title);
      return /^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(item.mime);
    });
  return candidates[0] || null;
}

async function searchWikimediaText(text) {
  const query = publicImageSearchQuery(text);
  const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", query);
  searchUrl.searchParams.set("srlimit", "1");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("origin", "*");
  const data = await fetchJsonUrl(searchUrl);
  const hit = data?.query?.search?.[0];
  if (!hit) return null;
  const title = String(hit.title || "");
  const summaryUrl = new URL(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  const summary = await fetchJsonUrl(summaryUrl);
  return {
    title,
    extract: String(summary.extract || hit.snippet || "").replace(/<[^>]*>/g, "").slice(0, 360),
    url: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`,
    query,
    license: "CC BY-SA",
  };
}

function fallbackPublicImageMaterial(text) {
  const seed = seedFromText(text);
  return {
    title: `public image seed ${seed}`,
    url: `https://picsum.photos/seed/walnutpi-${seed}/480/320`,
    sourceUrl: `https://picsum.photos/seed/walnutpi-${seed}/480/320`,
    mime: "image/jpeg",
    width: 480,
    height: 320,
    license: "public placeholder source",
    artist: "Lorem Picsum",
    query: publicImageSearchQuery(text),
  };
}

function rgbToHex([r, g, b]) {
  return `0x${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistanceSquared(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function quantizePixelsToPalette(rawPixels, maxColors = 8) {
  const buckets = new Map();
  for (let i = 0; i < rawPixels.length; i += 4) {
    const alpha = rawPixels[i + 3];
    if (alpha < 32) continue;
    const r = rawPixels[i] & 0xf0;
    const g = rawPixels[i + 1] & 0xf0;
    const b = rawPixels[i + 2] & 0xf0;
    const key = `${r},${g},${b}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += rawPixels[i];
    bucket.g += rawPixels[i + 1];
    bucket.b += rawPixels[i + 2];
    buckets.set(key, bucket);
  }
  const colors = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map((bucket) => [
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    ]);
  return colors.length ? colors : [[8, 10, 13], [103, 214, 255], [244, 241, 223]];
}

function nearestPaletteIndex(color, palette) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < palette.length; index += 1) {
    const distance = colorDistanceSquared(color, palette[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function rowsFromRawPixels(rawPixels, width, height, colors, symbols) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      row += symbols[nearestPaletteIndex([rawPixels[offset], rawPixels[offset + 1], rawPixels[offset + 2]], colors)] || "A";
    }
    rows.push(row);
  }
  return rows;
}

async function imageBufferToPixelFrame(imageBytes, { width = 48, height = 32, colors = null, symbols = ["A", "S", "H", "K", "P", "Y", "B", "C"] } = {}) {
  const { data } = await sharp(imageBytes, { animated: false })
    .resize(width, height, { fit: "cover", position: "attention" })
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const paletteColors = colors || quantizePixelsToPalette(data, symbols.length);
  return {
    rows: rowsFromRawPixels(data, width, height, paletteColors, symbols),
    colors: paletteColors,
  };
}

async function materialPixelPageFromImage(plan, material, imageBytes) {
  const width = 48;
  const height = 32;
  const symbols = ["A", "S", "H", "K", "P", "Y", "B", "C"];
  const firstFrame = await imageBufferToPixelFrame(imageBytes, { width, height, symbols });
  const colors = firstFrame.colors;
  const palette = {};
  colors.forEach((color, index) => {
    palette[symbols[index]] = rgbToHex(color);
  });
  const rows = firstFrame.rows;
  const frames = Array.from({ length: 4 }, (_, phase) => ({
    durationMs: 260 + (phase % 2) * 80,
    rows: rows.map((row, y) => {
      if (phase === 0) return row;
      const chars = row.split("");
      for (let x = phase % 3; x < width; x += 9) {
        if ((x + y + phase) % 5 === 0) chars[x] = symbols[(nearestPaletteIndex(colors[0], colors) + phase) % Math.min(colors.length, symbols.length)] || chars[x];
      }
      return chars.join("");
    }),
  }));
  return {
    id: "material-screen",
    tab: SCREEN_MODULES.find((item) => item.id === plan.modules[0])?.tab || "IMG",
    components: [
      {
        type: "pixelArt",
        background: rgbToHex(colors[0]),
        x: 0,
        y: 0,
        width,
        height,
        pixelSize: 10,
        gap: 0,
        palette,
        frames,
        material: {
          source: "wikimedia-commons",
          query: material.query,
          title: String(material.title || "").slice(0, 120),
          url: String(material.sourceUrl || material.url || "").slice(0, 500),
          license: String(material.license || "").slice(0, 80),
        },
      },
    ],
  };
}

async function extractVideoFrameImages(videoBytes) {
  if (!ffmpegPath) return [];
  const id = `walnutpi-material-${randomUUID()}`;
  const dir = path.join(tmpdir(), id);
  const inputPath = path.join(dir, "input");
  const outputPattern = path.join(dir, "frame-%02d.png");
  await mkdir(dir, { recursive: true });
  await writeFile(inputPath, videoBytes);
  const result = await runLocal(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-vf", "fps=2,scale=480:320:force_original_aspect_ratio=increase,crop=480:320",
    "-frames:v", "4",
    outputPattern,
  ], { cwd: dir, timeoutMs: 8000, outputLimit: 2000 });
  if (!result.ok) return [];
  const names = (await readdir(dir)).filter((name) => /^frame-\d+\.png$/.test(name)).sort();
  const frames = [];
  for (const name of names.slice(0, 4)) {
    frames.push(await readFile(path.join(dir, name)));
  }
  return frames;
}

async function materialPixelPageFromVideo(plan, material, videoBytes) {
  const width = 48;
  const height = 32;
  const symbols = ["A", "S", "H", "K", "P", "Y", "B", "C"];
  const images = await extractVideoFrameImages(videoBytes);
  if (!images.length) return null;
  const first = await imageBufferToPixelFrame(images[0], { width, height, symbols });
  const colors = first.colors;
  const frames = [{ durationMs: 220, rows: first.rows }];
  for (const image of images.slice(1, 4)) {
    const frame = await imageBufferToPixelFrame(image, { width, height, colors, symbols });
    frames.push({ durationMs: 220, rows: frame.rows });
  }
  const palette = {};
  colors.forEach((color, index) => {
    palette[symbols[index]] = rgbToHex(color);
  });
  return {
    id: "video-material-screen",
    tab: "VID",
    components: [{
      type: "pixelArt",
      background: rgbToHex(colors[0]),
      x: 0,
      y: 0,
      width,
      height,
      pixelSize: 10,
      gap: 0,
      palette,
      frames,
      material: {
        source: "wikimedia-commons-video",
        query: material.query,
        title: String(material.title || "").slice(0, 120),
        url: String(material.sourceUrl || material.url || "").slice(0, 500),
        license: String(material.license || "").slice(0, 80),
      },
    }],
  };
}

function textMaterialPixelPage(plan, material) {
  const width = 48;
  const height = 32;
  const text = `${material.title || plan.title} ${material.extract || ""}`
    .replace(/[^a-z0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 96);
  const words = text.split(/\s+/).filter(Boolean);
  const palette = {
    A: plan.palette.a,
    S: plan.palette.s,
    H: plan.palette.h,
    K: plan.palette.k,
    Y: plan.palette.y,
  };
  const frames = Array.from({ length: 4 }, (_, phase) => ({
    durationMs: 360,
    rows: rowsFromGlyphs(width, height, ({ rect, line }) => {
      rect(0, 0, width, height, "K");
      rect(2, 3, 44, 5, phase % 2 ? "A" : "S");
      line(4, 5, "H".repeat(Math.min(16, Math.max(4, plan.title.length))));
      for (let i = 0; i < 4; i += 1) {
        const word = words[(phase + i) % Math.max(1, words.length)] || "PIXEL";
        const y = 11 + i * 4;
        rect(4, y - 1, Math.min(40, word.length * 2 + 4), 3, i % 2 ? "A" : "S");
        line(6, y, "H".repeat(Math.min(36, Math.max(3, word.length * 2))));
      }
      rect(4 + phase * 8, 28, 12, 2, "Y");
    }),
  }));
  return {
    id: "text-material-screen",
    tab: "TXT",
    components: [{
      type: "pixelArt",
      background: plan.palette.bg,
      x: 0,
      y: 0,
      width,
      height,
      pixelSize: 10,
      gap: 0,
      palette,
      frames,
      material: {
        source: "wikipedia-summary",
        query: material.query,
        title: String(material.title || "").slice(0, 120),
        url: String(material.url || "").slice(0, 500),
        license: String(material.license || "CC BY-SA").slice(0, 80),
      },
    }],
  };
}

async function publicMaterialScreenSpec(subject) {
  const plan = screenPlanFromSubject(subject);
  if (!shouldUsePublicImageMaterial(subject)) return null;
  try {
    const kind = desiredMaterialKind(subject);
    let material = null;
    let page = null;
    if (kind === "text") {
      material = await searchWikimediaText(subject);
      if (material) page = textMaterialPixelPage(plan, material);
    }
    if (!page && kind === "video") {
      material = await searchWikimediaMedia(subject, "video");
      if (material) {
        const bytes = await fetchBinaryUrl(material.url, { timeoutMs: 4500, maxBytes: 8_000_000 });
        page = await materialPixelPageFromVideo(plan, material, bytes);
      }
    }
    if (!page && kind === "animated-image") {
      material = await searchWikimediaMedia(subject, "animated-image");
      if (material) {
        const bytes = await fetchBinaryUrl(material.url, { timeoutMs: 4500, maxBytes: 6_000_000 });
        page = await materialPixelPageFromImage(plan, material, bytes);
      }
    }
    if (!page) {
      material = await searchWikimediaImage(subject);
      if (!material) material = fallbackPublicImageMaterial(subject);
      const bytes = await fetchBinaryUrl(material.url);
      page = await materialPixelPageFromImage(plan, material, bytes);
    }
    if (!page) return null;
    return {
      title: plan.title,
      subtitle: `${page.components?.[0]?.material?.source || "public-material"} pixel canvas`,
      page,
      plan,
      material,
    };
  } catch {
    return null;
  }
}

function withTimeout(promise, timeoutMs, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs)),
  ]);
}

function hasPixelIntent(value) {
  return String(value || "").trim().length > 0;
}

function planModules(text) {
  const modules = SCREEN_MODULES.filter((module) => module.pattern.test(text)).map((module) => module.id);
  return modules.length ? modules : [];
}

function planPalette(text, seed) {
  if (/粉|桃|樱|pink|sakura|cute|可爱|萌/i.test(text)) {
    return { name: "pink", accent: "pink", bg: "0x080509", a: "0xff66b7", s: "0xffb3d9", h: "0xfff4dc", k: "0x1e1018", y: "0xffd35a" };
  }
  if (/红|告警|警告|错误|失败|red|alert|warn|error|jdm|车/i.test(text)) {
    return { name: "red", accent: "red", bg: "0x080304", a: "0xff2a1f", s: "0xff7b3a", h: "0xfff4dc", k: "0x210607", y: "0xffd35a" };
  }
  if (/黄|金|橙|amber|orange|gold|sun/i.test(text)) {
    return { name: "amber", accent: "amber", bg: "0x070503", a: "0xffc857", s: "0xff8a1c", h: "0xfff6cf", k: "0x1c1003", y: "0xfff06a" };
  }
  if (/绿|健康|森林|green|matrix|terminal/i.test(text)) {
    return { name: "green", accent: "green", bg: "0x020807", a: "0x33d6a6", s: "0x8dffcf", h: "0xeafff6", k: "0x061a14", y: "0xffd35a" };
  }
  if (/蓝|海|冷|blue|minimal|clean/i.test(text)) {
    return { name: "blue", accent: "blue", bg: "0x04070d", a: "0x7aa8d8", s: "0x67d6ff", h: "0xf4f1df", k: "0x081421", y: "0xffd35a" };
  }
  const variants = [
    { name: "cyan", accent: "cyan", bg: "0x02070a", a: "0x5cf8ff", s: "0x67d6ff", h: "0xfff4dc", k: "0x06141b", y: "0xffd35a" },
    { name: "pink", accent: "pink", bg: "0x080509", a: "0xff66b7", s: "0xffb3d9", h: "0xfff4dc", k: "0x1e1018", y: "0xffd35a" },
    { name: "green", accent: "green", bg: "0x020807", a: "0x33d6a6", s: "0x8dffcf", h: "0xeafff6", k: "0x061a14", y: "0xffd35a" },
  ];
  return variants[seed % variants.length];
}

function planMascot(text, seed) {
  if (/车|car|jdm|痛车|车载/i.test(text)) return "car";
  if (/猫|cat|neko/i.test(text)) return "cat";
  if (/狗|dog|inu/i.test(text)) return "dog";
  if (/兔|rabbit|bunny/i.test(text)) return "rabbit";
  if (/熊|bear/i.test(text)) return "bear";
  if (/机器人|robot|bot/i.test(text)) return "robot";
  if (/logo|徽标|标志|coin|badge|orb|章/i.test(text)) return "badge";
  return ["cat", "robot", "badge", "car"][seed % 4];
}

function screenPlanFromSubject(subject) {
  const text = String(subject || "");
  const seed = seedFromText(text);
  const modules = planModules(text);
  const palette = planPalette(text, seed);
  return {
    seed,
    title: titleFromProgramSubject(text),
    subtitle: "480x320 pixel canvas",
    mode: "pixel",
    modules,
    palette,
    mascot: planMascot(text, seed),
    motion: /快|高速|闪|flash|fast/i.test(text) ? "fast" : /慢|柔和|slow|calm/i.test(text) ? "slow" : "loop",
    subject: asciiScreenSubject(text, "custom screen"),
  };
}

function drawPixelScanlines({ put }, phase, width, height, symbol = "K") {
  for (let y = (phase % 2) + 1; y < height; y += 4) {
    for (let x = 0; x < width; x += 3) put(x, y, symbol);
  }
}

function drawSparkles(put, phase, seed, width, height, symbols = ["A", "S", "Y"]) {
  for (let i = 0; i < 14; i += 1) {
    const x = (seed + i * 17 + phase * 3) % width;
    const y = (Math.floor(seed / 7) + i * 11 + phase * 2) % height;
    const symbol = symbols[(i + phase) % symbols.length];
    put(x, y, symbol);
    if ((i + phase) % 4 === 0) {
      put(x - 1, y, symbol);
      put(x + 1, y, symbol);
      put(x, y - 1, symbol);
      put(x, y + 1, symbol);
    }
  }
}

function drawWeatherPixels({ put, rect, circle }, phase) {
  circle(34, 8, 5, 5, "Y");
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    put(Math.round(34 + Math.cos(angle) * 8), Math.round(8 + Math.sin(angle) * 7), "Y");
  }
  circle(16, 16, 7, 4, "S");
  circle(23, 15, 8, 5, "H");
  rect(10, 17, 22, 5, "S");
  rect(15, 20, 19, 3, "A");
  for (let x = 9 + (phase % 3); x < 37; x += 5) {
    rect(x, 25 + ((x + phase) % 2), 1, 4, "A");
  }
}

function drawAudioPixels({ put, rect }, plan, phase) {
  for (let x = 4; x < 44; x += 4) {
    const h = 5 + ((plan.seed >> (x % 8)) + x * 3 + phase * 5) % 22;
    rect(x, 30 - h, 2, h, x % 8 === 0 ? "S" : "A");
  }
  for (let y = 8; y <= 17; y += 1) {
    const span = Math.max(1, y - 7);
    rect(9, y, span, 1, "H");
  }
  rect(6, 7, 2, 12, "H");
  for (let x = 30; x < 44; x += 1) put(x, 6 + Math.round(Math.sin((x + phase) / 2) * 2), "Y");
}

const SEVEN_SEGMENTS = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

function drawSevenDigit({ rect }, x, y, value, symbol = "A") {
  const segments = SEVEN_SEGMENTS[String(value)] || SEVEN_SEGMENTS["0"];
  const has = (segment) => segments.includes(segment);
  if (has("a")) rect(x + 1, y, 5, 1, symbol);
  if (has("b")) rect(x + 6, y + 1, 1, 5, symbol);
  if (has("c")) rect(x + 6, y + 7, 1, 5, symbol);
  if (has("d")) rect(x + 1, y + 12, 5, 1, symbol);
  if (has("e")) rect(x, y + 7, 1, 5, symbol);
  if (has("f")) rect(x, y + 1, 1, 5, symbol);
  if (has("g")) rect(x + 1, y + 6, 5, 1, symbol);
}

function drawClockPixels(draw, phase) {
  const digits = phase % 2 === 0 ? ["1", "2", "3", "4"] : ["1", "2", "3", "5"];
  drawSevenDigit(draw, 5, 8, digits[0], "A");
  drawSevenDigit(draw, 14, 8, digits[1], "A");
  drawSevenDigit(draw, 27, 8, digits[2], "S");
  drawSevenDigit(draw, 36, 8, digits[3], "S");
  draw.rect(24, 11, 2, 2, "Y");
  draw.rect(24, 17, 2, 2, "Y");
  draw.rect(7, 26, 34, 2, "K");
}

function drawNetworkPixels({ put, rect }, phase) {
  const nodes = [
    [8, 10], [20, 6], [33, 10], [39, 21], [24, 25], [10, 22],
  ];
  for (let i = 0; i < nodes.length; i += 1) {
    const [x, y] = nodes[i];
    rect(x - 1, y - 1, 3, 3, i === phase % nodes.length ? "Y" : "A");
    const [nx, ny] = nodes[(i + 1) % nodes.length];
    const steps = Math.max(Math.abs(nx - x), Math.abs(ny - y));
    for (let s = 0; s <= steps; s += 1) {
      put(Math.round(x + ((nx - x) * s) / steps), Math.round(y + ((ny - y) * s) / steps), "K");
    }
  }
  rect(18, 14, 12, 5, "S");
}

function drawStatusPixels({ rect }, plan, phase) {
  for (let i = 0; i < 5; i += 1) {
    const h = 6 + ((plan.seed >> i) + phase * 2 + i * 5) % 18;
    rect(7 + i * 7, 28 - h, 4, h, i % 2 ? "S" : "A");
  }
  rect(7, 5, 34, 3, "H");
  rect(7, 10, 26 + phase * 2, 3, "Y");
}

function drawShopPixels({ put, rect }, plan, phase) {
  rect(2, 3, 44, 5, "A");
  rect(4, 4, 10, 2, "H");
  rect(35, 4, 6, 2, phase % 2 ? "Y" : "S");
  rect(42, 3, 3, 3, "Y");
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x = 4 + col * 14;
      const y = 11 + row * 10;
      const symbol = (row + col + phase) % 3 === 0 ? "Y" : (col % 2 ? "S" : "A");
      rect(x, y, 10, 7, "K");
      rect(x + 1, y + 1, 8, 4, symbol);
      rect(x + 2, y + 6, 5, 1, "H");
      rect(x + 8, y + 6, 1, 1, "Y");
    }
  }
  rect(34, 27, 9, 2, "H");
  rect(35, 29, 2, 2, "A");
  rect(41, 29, 2, 2, "A");
  put(43, 26 + (phase % 2), "Y");
}

function drawMascotFace({ put, rect }, mascot, phase, cx, cy) {
  const blink = phase % 4 === 2;
  const bob = phase % 2;
  if (mascot === "car") {
    rect(cx - 20, cy + 4 + bob, 40, 8, "A");
    rect(cx - 14, cy - 2 + bob, 20, 7, "S");
    rect(cx - 16, cy + 12 + bob, 6, 4, "K");
    rect(cx + 10, cy + 12 + bob, 6, 4, "K");
    rect(cx - 19, cy + 6 + bob, 4, 2, "Y");
    rect(cx + 15, cy + 6 + bob, 4, 2, "H");
    return;
  }
  if (mascot === "badge") {
    rect(cx - 13, cy - 10 + bob, 26, 3, "A");
    rect(cx - 18, cy - 7 + bob, 36, 14, "S");
    rect(cx - 13, cy + 7 + bob, 26, 3, "A");
    rect(cx - 6, cy - 2 + bob, 12, 4, "K");
    rect(cx - 3, cy - 5 + bob, 6, 10, "H");
    return;
  }
  if (mascot === "robot") {
    rect(cx - 14, cy - 10 + bob, 28, 22, "S");
    rect(cx - 10, cy - 14 + bob, 20, 4, "A");
    rect(cx - 18, cy - 2 + bob, 4, 8, "A");
    rect(cx + 14, cy - 2 + bob, 4, 8, "A");
  } else {
    rect(cx - 13, cy - 8 + bob, 26, 20, "S");
    if (mascot === "cat") {
      rect(cx - 14, cy - 13 + bob, 6, 7, "S");
      rect(cx + 8, cy - 13 + bob, 6, 7, "S");
    }
    if (mascot === "rabbit") {
      rect(cx - 10, cy - 18 + bob, 5, 11, "S");
      rect(cx + 5, cy - 18 + bob, 5, 11, "S");
    }
    if (mascot === "bear" || mascot === "dog") {
      rect(cx - 16, cy - 8 + bob, 5, 7, "S");
      rect(cx + 11, cy - 8 + bob, 5, 7, "S");
    }
  }
  rect(cx - 8, cy - 2 + bob, 4, blink ? 1 : 4, "K");
  rect(cx + 4, cy - 2 + bob, 4, blink ? 1 : 4, "K");
  rect(cx - 2, cy + 4 + bob, 4, 2, "P");
  rect(cx - 5, cy + 9 + bob, 10, 2, phase % 3 === 0 ? "A" : "K");
  rect(cx - 19, cy + 3 + bob, 5, 5, "P");
  rect(cx + 14, cy + 3 + bob, 5, 5, "P");
}

function drawMascotPixels(draw, plan, phase) {
  drawSparkles(draw.put, phase, plan.seed, 48, 32);
  drawMascotFace(draw, plan.mascot, phase, 24 + ((plan.seed >> 3) % 5) - 2, plan.mascot === "car" ? 15 : 16);
}

function drawPixelScreen(draw, plan, phase, width, height) {
  drawPixelScanlines(draw, phase, width, height);
  const module = plan.modules[0] || "";
  if (module === "weather") {
    drawWeatherPixels(draw, phase);
    return;
  }
  if (module === "audio") {
    drawAudioPixels(draw, plan, phase);
    return;
  }
  if (module === "shop") {
    drawShopPixels(draw, plan, phase);
    return;
  }
  if (module === "clock") {
    drawClockPixels(draw, phase);
    return;
  }
  if (module === "network") {
    drawNetworkPixels(draw, phase);
    return;
  }
  if (module === "status" || module === "tasks") {
    drawStatusPixels(draw, plan, phase);
    return;
  }
  drawMascotPixels(draw, plan, phase);
}

function promptPixelFrames(plan) {
  const width = 48;
  const height = 32;
  const frameCount = plan.motion === "slow" ? 3 : 4;
  const duration = plan.motion === "fast" ? 140 : plan.motion === "slow" ? 520 : 260;
  return Array.from({ length: frameCount }, (_, phase) => ({
    durationMs: duration + (phase % 2) * 80,
    rows: rowsFromGlyphs(width, height, (draw) => drawPixelScreen(draw, plan, phase, width, height)),
  }));
}

function layoutElement(kind, options = {}) {
  return {
    kind,
    x: options.x ?? 0,
    y: options.y ?? 0,
    w: options.w ?? (kind === "label" ? 120 : 80),
    h: options.h ?? (kind === "label" ? 28 : 24),
    color: options.color || "0xf4f1df",
    bg: options.bg || "0x000000",
    border: options.border || "0x000000",
    radius: options.radius ?? 0,
    width: options.width ?? 0,
    value: options.value ?? 0,
    font: options.font || "body",
    text: options.text || "",
  };
}

function moduleLabel(plan) {
  const module = plan.modules[0] || "animation";
  return {
    animation: "ANIM LOOP",
    clock: "HH:MM",
    weather: "WX PANEL",
    audio: "AUDIO",
    shop: "SHOP",
    network: "LINK",
    status: "STATUS",
    tasks: "TASKS",
  }[module] || "SCREEN";
}

function pixelOverlayElements(plan) {
  const accent = plan.palette.a;
  const text = plan.title.toUpperCase();
  const elements = [
    layoutElement("rect", { x: 14, y: 276, w: 452, h: 30, color: "0x070a0d", border: accent, radius: 6, width: 1 }),
    layoutElement("label", { x: 24, y: 281, w: 220, h: 22, color: "0xf4f1df", font: "body", text }),
    layoutElement("label", { x: 306, y: 281, w: 132, h: 22, color: accent, font: "small", text: moduleLabel(plan) }),
  ];
  if (plan.modules.includes("clock")) {
    elements.push(layoutElement("label", { x: 342, y: 238, w: 90, h: 28, color: accent, font: "body", text: "HH:MM" }));
  }
  return elements;
}

function pixelArtPage(plan, { id = "custom-ip", tab = "IP" } = {}) {
  return {
    id,
    tab,
    components: [
      {
        type: "pixelArt",
        background: plan.palette.bg,
        x: 0,
        y: 0,
        width: 48,
        height: 32,
        pixelSize: 10,
        gap: 0,
        palette: {
          A: plan.palette.a,
          S: plan.palette.s,
          H: plan.palette.h,
          K: plan.palette.k,
          P: "0xff66b7",
          Y: plan.palette.y,
        },
        frames: promptPixelFrames(plan),
      },
    ],
  };
}

function moduleLayoutElements(plan) {
  const accent = plan.palette.a;
  const secondary = plan.palette.s;
  const fg = "0xf4f1df";
  const muted = "0x95a1a6";
  const bg = plan.palette.bg;
  const module = plan.modules[0] || "status";
  const elements = [
    layoutElement("rect", { x: 0, y: 0, w: 480, h: 320, color: bg }),
    layoutElement("label", { x: 22, y: 18, w: 230, h: 28, color: accent, font: "small", text: plan.title.toUpperCase() }),
  ];
  if (module === "clock") {
    elements.push(
      layoutElement("rect", { x: 18, y: 96, w: 444, h: 92, color: accent, border: accent, radius: 4, width: 0 }),
      layoutElement("label", { x: 116, y: 112, w: 248, h: 58, color: "0x071014", bg: accent, font: "title", text: "HH:MM" }),
      layoutElement("label", { x: 154, y: 214, w: 172, h: 32, color: fg, font: "title", text: "YYYY-MM-DD" }),
    );
    return elements;
  }
  if (module === "weather") {
    elements.push(
      layoutElement("label", { x: 22, y: 56, w: 220, h: 46, color: fg, font: "title", text: "26C CLEAR" }),
      layoutElement("circle", { x: 344, y: 50, w: 70, h: 70, color: secondary, border: secondary, radius: 35 }),
      layoutElement("line", { x: 22, y: 132, w: 436, h: 1, color: accent, width: 2 }),
      layoutElement("label", { x: 26, y: 154, w: 82, h: 24, color: accent, font: "small", text: "NOW" }),
      layoutElement("label", { x: 174, y: 154, w: 82, h: 24, color: accent, font: "small", text: "TODAY" }),
      layoutElement("label", { x: 322, y: 154, w: 108, h: 24, color: accent, font: "small", text: "TOMORROW" }),
      layoutElement("bar", { x: 26, y: 198, w: 92, h: 12, color: secondary, bg: "0x172329", border: "0x000000", radius: 6, value: 70 }),
      layoutElement("bar", { x: 174, y: 198, w: 92, h: 12, color: secondary, bg: "0x172329", border: "0x000000", radius: 6, value: 58 }),
      layoutElement("bar", { x: 322, y: 198, w: 92, h: 12, color: secondary, bg: "0x172329", border: "0x000000", radius: 6, value: 42 }),
      layoutElement("label", { x: 26, y: 228, w: 106, h: 24, color: fg, font: "body", text: "SUNNY" }),
      layoutElement("label", { x: 174, y: 228, w: 106, h: 24, color: fg, font: "body", text: "HUM 68" }),
      layoutElement("label", { x: 322, y: 228, w: 112, h: 24, color: fg, font: "body", text: "RAIN 20" }),
      layoutElement("line", { x: 160, y: 148, w: 1, h: 116, color: "0x20313a", width: 1 }),
      layoutElement("line", { x: 308, y: 148, w: 1, h: 116, color: "0x20313a", width: 1 }),
    );
    return elements;
  }
  if (module === "audio") {
    elements.push(
      layoutElement("label", { x: 32, y: 56, w: 210, h: 48, color: fg, font: "title", text: "PLAYING" }),
      layoutElement("label", { x: 338, y: 64, w: 88, h: 24, color: muted, font: "small", text: "VOL 68" }),
      layoutElement("bar", { x: 336, y: 96, w: 92, h: 12, color: accent, bg: "0x172329", border: "0x000000", radius: 6, value: 68 }),
      layoutElement("line", { x: 28, y: 130, w: 424, h: 1, color: accent, width: 2 }),
    );
    for (let i = 0; i < 12; i += 1) {
      const h = 26 + ((plan.seed >> (i % 8)) + i * 11) % 118;
      elements.push(layoutElement("bar", { x: 34 + i * 34, y: 276 - h, w: 16, h, color: accent, bg: "0x10191d", border: "0x000000", radius: 2, value: 100 }));
    }
    elements.push(layoutElement("label", { x: 32, y: 286, w: 190, h: 22, color: muted, font: "small", text: "BEAT 124 BPM" }));
    return elements;
  }
  elements.push(
    layoutElement("rect", { x: 20, y: 80, w: 440, h: 72, color: "0x10191d", border: accent, radius: 6, width: 2 }),
    layoutElement("label", { x: 42, y: 98, w: 240, h: 34, color: fg, font: "title", text: module === "network" ? "LINK READY" : module === "tasks" ? "NEXT STEP" : "READY" }),
    layoutElement("bar", { x: 42, y: 184, w: 316, h: 18, color: accent, bg: "0x172329", border: "0x33434a", radius: 9, width: 1, value: 68 }),
    layoutElement("label", { x: 42, y: 222, w: 120, h: 24, color: muted, font: "small", text: module === "network" ? "IP --" : "SIGNAL" }),
    layoutElement("label", { x: 184, y: 222, w: 120, h: 24, color: muted, font: "small", text: module === "tasks" ? "GATED" : "SYNC NEXT" }),
    layoutElement("label", { x: 326, y: 222, w: 120, h: 24, color: muted, font: "small", text: "EVIDENCE" }),
  );
  return elements;
}

function isCardLikeRect(element, index) {
  if (element?.kind !== "rect") return false;
  if (index === 0 && element.x <= 2 && element.y <= 2 && element.w >= 470 && element.h >= 310) return false;
  const area = Number(element.w || 0) * Number(element.h || 0);
  const hasBoxStyle = Number(element.width || 0) > 0 || Number(element.radius || 0) >= 4;
  return hasBoxStyle && area >= 3200 && area <= 130000;
}

function decardLayoutElements(elements) {
  if (!Array.isArray(elements)) return elements;
  const cardLikeCount = elements.filter(isCardLikeRect).length;
  if (cardLikeCount === 0) return elements;

  const kept = elements.filter((element, index) => !isCardLikeRect(element, index));
  const separators = [];
  const columns = elements
    .map((element, index) => ({ element, index }))
    .filter(({ element, index }) => isCardLikeRect(element, index))
    .sort((a, b) => Number(a.element.x || 0) - Number(b.element.x || 0));
  for (let i = 0; i < columns.length - 1 && separators.length < 2; i += 1) {
    const left = columns[i].element;
    const right = columns[i + 1].element;
    const x = Math.round((Number(left.x) + Number(left.w) + Number(right.x)) / 2);
    separators.push(layoutElement("line", {
      x,
      y: Math.max(18, Math.min(Number(left.y || 0), Number(right.y || 0))),
      w: 1,
      h: Math.min(250, Math.max(Number(left.h || 0), Number(right.h || 0))),
      color: "0x20313a",
      width: 1,
    }));
  }
  return [...kept, ...separators].slice(0, 24);
}

function decardGeneratedPatch(patch) {
  if (!patch || !Array.isArray(patch.pages)) return patch;
  return {
    ...patch,
    pages: patch.pages.map((page) => ({
      ...page,
      components: Array.isArray(page.components)
        ? page.components.map((component) => (
          component?.type === "layout"
            ? { ...component, elements: decardLayoutElements(component.elements) }
            : component
        ))
        : page.components,
    })),
  };
}

function layoutPageFromPlan(plan, { id = "custom-screen", tab = null } = {}) {
  const module = plan.modules[0] || "status";
  const moduleTab = SCREEN_MODULES.find((item) => item.id === module)?.tab || "PAGE";
  return {
    id,
    tab: tab || moduleTab,
    components: [
      {
        type: "layout",
        background: plan.palette.bg,
        elements: moduleLayoutElements(plan),
      },
    ],
  };
}

function isFullPixelCanvasComponent(component) {
  if (component?.type !== "pixelArt") return false;
  const width = Number(component.width || 0);
  const height = Number(component.height || 0);
  const pixelSize = Number(component.pixelSize || 0);
  const gap = Number(component.gap || 0);
  const drawnWidth = width * pixelSize + Math.max(0, width - 1) * gap;
  const drawnHeight = height * pixelSize + Math.max(0, height - 1) * gap;
  return Number(component.x || 0) === 0
    && Number(component.y || 0) === 0
    && drawnWidth === 480
    && drawnHeight === 320
    && Array.isArray(component.frames)
    && component.frames.length >= 2;
}

const SCREEN_TEMPLATES = [
  {
    id: "device-status",
    label: "设备状态",
    summary: "显示核桃派核心状态和检查项。",
    manifest: {
      title: "WalnutPi",
      subtitle: "server screen",
      pages: [
        statusPage({ id: "status", tab: "STAT", status: "OK CORE", metrics: ["IP loading", "MEM --", "DISK --"] }),
        textPage({ id: "checks", tab: "CHK", title: "Checks", lines: ["CPU load", "Memory", "Disk", "Uptime"] }),
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
        statusPage({ id: "task", tab: "TASK", status: "AI READY", metrics: ["Plan ready", "Sync safe", "Logs open"] }),
        textPage({ id: "next", tab: "NEXT", title: "Next Steps", lines: ["Waiting for intent", "Ask before risk", "Run local tools", "Summarize evidence"] }),
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
        statusPage({ id: "network", tab: "NET", status: "LINK OK", metrics: ["IP loading", "SSH ready", "FRP check"] }),
        textPage({ id: "lan", tab: "LAN", title: "Network", lines: ["IP", "Default route", "FRP", "SSH"] }),
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
        statusPage({ id: "alert", tab: "ALRT", status: "WARN", tone: "warn", progress: 62, metrics: ["CPU watch", "MEM high", "Disk ok"] }),
        {
          id: "detail",
          tab: "WHY",
          components: [
            { type: "alert", title: "System Alerts", body: "Memory high; check CPU and uptime.", tone: "warn" },
            { type: "list", title: "Next", items: ["Collect evidence", "Explain risk", "Ask before writes"] },
          ],
        },
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
        statusPage({ id: "player", tab: "PLAY", status: "MUSIC READY", tone: "ok", progress: 38, metrics: ["Track queue", "Vol --", "Local audio"] }),
        textPage({ id: "library", tab: "LIB", title: "Music Library", lines: ["Scan music-library", "MP3 FLAC WAV", "Playlist ready", "No cloud needed"] }),
        textPage({ id: "control", tab: "CTL", title: "Player Controls", lines: ["Play pause next", "Volume guarded", "Use walnut play", "Terminal fallback"] }),
      ],
    },
  },
];

function mutableManifestView(manifest) {
  return {
    title: manifest.title,
    subtitle: manifest.subtitle,
    pages: manifest.pages,
  };
}

async function readJsonRequest(req) {
  try {
    return await req.json();
  } catch {
    throw new Error("请求不是有效 JSON。");
  }
}

function looksLikeScreenProgramRequest(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  if (/^(?:同步|sync|生成\s*AI\s*总结|总结)$/i.test(text)) return false;
  if (/(小屏|屏幕|界面|lvgl|screen|程序|应用|app|面板|工具)/i.test(text) && /(做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)/i.test(text)) {
    return true;
  }
  if (/(?:直接)?(?:开始|继续|按这个|就这个|照这个|生成|创建|设计|做|弄)/i.test(text) && /(界面|UI|ui|小屏|屏幕|面板|页面|风格|按钮|旋钮|信号灯|指示灯|控件|卡片|布局|仪表盘|状态栏|播放按钮)/i.test(text)) {
    return true;
  }
  if (/(?:给我|帮我)?\s*(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)\s*\S{2,}/i.test(text)) {
    return true;
  }
  return true;
}

function screenProgramSubject(input) {
  let subject = String(input || "").trim();
  subject = subject
    .replace(/^(?:请|麻烦|帮我|给我|你|我要|我想|直接开始|直接|先|开始|继续|现在|按这个|就这个|照这个)\s*/i, "")
    .replace(/(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)\s*/i, "")
    .replace(/(?:然后|并且|并|再)?\s*(?:同步|部署|推送|烧录|运行到|显示到)\s*(?:到|至)?\s*(?:核桃派|设备|板子|小屏|屏幕|lvgl|screen)?/ig, "")
    .replace(/[，。,.!！?？；;：:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return subject || "小屏程序";
}

function titleFromProgramSubject(subject) {
  return asciiScreenTitle(subject);
}

async function generatedScreenSpec(subject) {
  const materialSpec = await publicMaterialScreenSpec(subject);
  if (materialSpec) return materialSpec;
  const plan = screenPlanFromSubject(subject);
  const page = plan.mode === "pixel" ? pixelArtPage(plan) : layoutPageFromPlan(plan);
  return {
    title: plan.title,
    subtitle: plan.subtitle,
    page: decardGeneratedPatch({ pages: [page] }).pages[0],
    plan,
  };
}

function screenManifestGenerationSystemPrompt() {
  return [
    "You generate a WalnutPi small-screen UI as controlled Screen Manifest patch JSON for a real LVGL framebuffer.",
    "Return JSON only. Do not return Markdown, React, LVGL C, shell commands, SSH commands, sudo commands, or device instructions.",
    "The JSON object must be a mutable manifest patch with this shape:",
    "{ \"title\": string, \"subtitle\": string, \"replacePages\": true, \"pages\": [page], \"intentSummary\": string }.",
    "Each page: { \"id\": slug, \"tab\": ASCII label <= 8 chars, \"components\": [component] }.",
    "Use 1 page by default. Use at most 3 pages and at most 4 components per page.",
    "All manifest text fields must be ASCII only because the current WalnutPi LVGL font slice does not support CJK glyphs yet.",
    "intentSummary may be Chinese and is only for the Web chat, not for the device manifest.",
    "The physical screen is exactly 480x320 pixels. Treat every new creative generation as a pixel canvas, not as desktop UI composition.",
    "Use pixelArt as the primary component for all generated small-screen requests, including weather, time, audio spectrum, status, user-defined IP, mascot, LED sign, poster, and animation requests.",
    "pixelArt component: { type:\"pixelArt\", background:\"0xRRGGBB\", x,y,width,height,pixelSize,gap,palette,frames }.",
    "pixelArt width is 8..64 cells, height is 8..32 cells. x + width*pixelSize + (width-1)*gap <= 480. y + height*pixelSize + (height-1)*gap <= 320.",
    "pixelArt palette maps single ASCII symbols to 0xRRGGBB colors. '.' and spaces are transparent/off pixels. Use at most 12 palette symbols.",
    "pixelArt frames: 1..8 frames, each frame has durationMs and rows. Every row must be exactly width symbols and there must be exactly height rows.",
    "Pixel animation must be continuous: reuse the same base art and change only phase details such as blink, scanline, sparkle, scroll offset, mouth/eye state, or glow intensity.",
    "Do not generate unrelated frame-by-frame scenes. The viewer should feel one living 480x320 pixel screen over time.",
    "For broad image replication, use a coarse pixel grid that fills the 480x320 screen and captures the approximate silhouette, color blocks, and motion. Exact text is less important than the pixel shape.",
    "layout is secondary and compatibility-only for tiny overlays. Do not use layout as the main generated screen.",
    "layout component: { type:\"layout\", background:\"0xRRGGBB\", elements:[drawElement] }.",
    "drawElement: { kind:\"rect\"|\"label\"|\"bar\"|\"line\"|\"circle\", x,y,w,h,color,bg,border,radius,width,value,font,text }.",
    "Coordinates are absolute pixels inside the 480x320 screen. x+w <= 480 and y+h <= 320. Keep text inside its element.",
    "Use a 16px outer safe margin. Keep main content in 2 or 3 clear zones, not many tiny boxes.",
    "Do not make card grids. Do not use repeated rounded rectangles as containers. This device UI should feel like one full-screen instrument panel, poster, pixel display, or dashboard canvas.",
    "Use separators, baselines, large type, icon dots, bars, tracks, scanlines, and open zones instead of card borders.",
    "For labels use h >= 18 and w >= 42. Keep at least 8px vertical and horizontal space between foreground labels, bars, and circles.",
    "Do not place status lights, bars, or decorative circles over text. Decorative shapes must stay behind or away from labels.",
    "Prefer 10-14 draw elements. Only use 15-18 when the request truly needs dense telemetry.",
    "Fonts: small, body, title. Colors must be 0xRRGGBB. Use bg 0x000000 for transparent label backgrounds.",
    "Good pixel screens use large silhouettes, limited colors, visible pixel blocks, and simple 2-4 frame motion.",
    "Legacy information components remain allowed only when the request is simple:",
    "statusCard: type,label,value,tone(ok|warn|error),detail.",
    "metricGroup: type,items; each item has label,value,unit,tone.",
    "list: type,title,items.",
    "progress: type,label,value(0..100),max(100),tone.",
    "alert: type,title,body,tone.",
    "textPage: type,title,lines.",
    "generatedPage is compatibility-only. Do not choose it for new creative screens unless the user asks for a simple title/body card.",
    "If a first attempt fails validation, repair the JSON while preserving the design intent. Do not collapse to a text-only page unless the user asked for text.",
  ].join("\n");
}

function aiScreenManifestUserPayload(text, currentManifest, repair = null) {
  return {
    request: text,
    currentManifest: {
      title: currentManifest?.title || "",
      subtitle: currentManifest?.subtitle || "",
      pageCount: Array.isArray(currentManifest?.pages) ? currentManifest.pages.length : 0,
    },
    device: {
      width: 480,
      height: 320,
      runtime: "lvgl-fbdev",
      display: "/dev/fb0",
      color: "RGB565",
    },
    constraints: [
      "Output only a JSON object.",
      "Do not include schema, target, source, build, delivery, SSH, shell, sudo, filesystem, GPIO, reboot, flash, or arbitrary code fields.",
      "Use the allowed component vocabulary exactly.",
      "For every generated small-screen request, use pixelArt as the primary component and think in cells that fill the 480x320 framebuffer.",
      "Weather, time, audio spectrum, status, and user-defined IP screens should become coarse pixel images or pixel animations, not information cards.",
      "Do not use HTML, CSS, SVG, Canvas, React, image URLs, base64 images, or browser-only concepts.",
      "Keep text short enough for a 480x320 screen.",
      "Prioritize approximate image shape, silhouette, color blocks, and simple motion over exact text.",
      "Do not make repeated rounded card containers. Do not use layout as the main generated screen.",
      "Labels need h >= 18; bars need h >= 8.",
      "Prefer one polished page over internal tabs for simple generated screens.",
    ],
    fieldLimits: {
      title: 32,
      subtitle: 40,
      pageTab: 8,
      statusCard: { label: 12, value: 24, detail: 24 },
      generatedPage: { compatibilityOnly: true, kicker: 20, headline: 24, body: 56, badge: 12, itemLabel: 12, itemValue: 16, itemUnit: 8 },
      layout: { compatibilityOnly: true, elements: 8, labelText: 32, x: "0..479", y: "0..319", w: "1..480", h: "1..320" },
      pixelArt: { primary: true, width: "8..64", height: "8..32", pixelSize: "1..16", gap: "0..4", frames: "1..8", rows: "exactly height rows, each exactly width symbols" },
      textPage: { title: 32, line: 48 },
      list: { title: 32, item: 48 },
      alert: { title: 32, body: 48 },
    },
    repair: repair
      ? {
        previousError: repair.error,
        previousOutput: repair.output,
        instruction: "Return a corrected full JSON patch that satisfies the schema and field limits. Keep the design intent; shorten or restructure text instead of dropping the UI.",
      }
      : null,
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickTextFields(source, fields) {
  const target = {};
  for (const field of fields) {
    if (source[field] !== undefined) target[field] = source[field];
  }
  return target;
}

function asciiDeviceText(value, fallback = "Ready", limit = 64) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  const ascii = raw.replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
  const text = ascii || fallback;
  return [...text].slice(0, limit).join("");
}

function sanitizeAiComponent(component) {
  if (!isPlainObject(component)) return { type: "" };
  const type = String(component.type || "").trim();
  if (type === "pixelArt") {
    const palette = isPlainObject(component.palette) ? Object.fromEntries(Object.entries(component.palette).slice(0, 12)) : {};
    const width = Number(component.width) || 48;
    const height = Number(component.height) || 20;
    return {
      type,
      background: component.background,
      x: component.x,
      y: component.y,
      width,
      height,
      pixelSize: component.pixelSize,
      gap: component.gap,
      palette,
      frames: Array.isArray(component.frames)
        ? component.frames.slice(0, 8).map((frame) => ({
          durationMs: frame?.durationMs,
          rows: Array.isArray(frame?.rows)
            ? frame.rows.slice(0, height).map((row) => asciiDeviceText(row, ".".repeat(width), Math.max(8, width)))
            : [],
        }))
        : [],
    };
  }
  if (type === "layout") {
    return {
      type,
      background: component.background,
      elements: Array.isArray(component.elements)
        ? component.elements.slice(0, 24).map((element) => (
          isPlainObject(element)
            ? {
              ...pickTextFields(element, ["kind", "x", "y", "w", "h", "color", "bg", "border", "radius", "width", "value", "font"]),
              text: asciiDeviceText(element.text, "", 64),
            }
            : {}
        ))
        : [],
    };
  }
  if (type === "statusCard") return {
    type,
    label: asciiDeviceText(component.label, "Status", 12),
    value: asciiDeviceText(component.value, "Ready", 24),
    tone: component.tone,
    detail: asciiDeviceText(component.detail, "Ready", 24),
  };
  if (type === "metricGroup") return {
    type,
    items: Array.isArray(component.items)
      ? component.items.slice(0, 3).map((item, index) => {
        const source = isPlainObject(item) ? item : { label: item };
        return {
          label: asciiDeviceText(source.label, `M${index + 1}`, 12),
          value: asciiDeviceText(source.value, "--", 16),
          unit: asciiDeviceText(source.unit, "", 8),
          tone: source.tone,
        };
      })
      : [],
  };
  if (type === "list") return { type, title: asciiDeviceText(component.title, "List", 32), items: Array.isArray(component.items) ? component.items.slice(0, 4).map((item) => asciiDeviceText(item, "Item", 48)) : [] };
  if (type === "progress") return { type, label: asciiDeviceText(component.label, "Progress", 16), ...pickTextFields(component, ["value", "max", "tone"]) };
  if (type === "alert") return { type, title: asciiDeviceText(component.title, "Alert", 32), body: asciiDeviceText(component.body, "Check status", 48), tone: component.tone };
  if (type === "textPage") return { type, title: asciiDeviceText(component.title, "Page", 32), lines: Array.isArray(component.lines) ? component.lines.slice(0, 4).map((line) => asciiDeviceText(line, "Ready", 48)) : [] };
  if (type === "generatedPage") {
    return {
      type,
      style: component.style,
      kicker: asciiDeviceText(component.kicker, "WalnutAI", 20),
      headline: asciiDeviceText(component.headline, "Ready", 24),
      body: asciiDeviceText(component.body, "Generated screen", 56),
      badge: asciiDeviceText(component.badge, "LIVE", 12),
      accent: component.accent,
      progress: component.progress,
      items: Array.isArray(component.items)
        ? component.items.slice(0, 3).map((item, index) => {
          const source = isPlainObject(item) ? item : { label: item };
          return {
            label: asciiDeviceText(source.label, `M${index + 1}`, 12),
            value: asciiDeviceText(source.value, "--", 16),
            unit: asciiDeviceText(source.unit, "", 8),
            tone: source.tone,
          };
        })
        : [],
    };
  }
  return { type };
}

function assertAsciiManifestPatch(value, field = "patch") {
  if (typeof value === "string") {
    if (/[^\x20-\x7e]/.test(value)) {
      throw new Error(`${field} must be ASCII until CJK font support is added`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAsciiManifestPatch(item, `${field}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "intentSummary") continue;
      assertAsciiManifestPatch(item, `${field}.${key}`);
    }
  }
}

function sanitizeAiScreenManifestPatch(value) {
  const source = isPlainObject(value?.patch)
    ? value.patch
    : isPlainObject(value?.manifest)
      ? value.manifest
      : value;
  if (!isPlainObject(source)) throw new Error("AI manifest patch must be an object");
  const pages = Array.isArray(source.pages) ? source.pages.slice(0, 6) : [];
  const patch = {
    replacePages: true,
    pages: pages.map((page, index) => {
      const pageObject = isPlainObject(page) ? page : {};
      return {
        id: pageObject.id || (index === 0 ? "main" : `page-${index + 1}`),
        tab: pageObject.tab || (index === 0 ? "PAGE" : `P${index + 1}`),
        components: Array.isArray(pageObject.components)
          ? pageObject.components.slice(0, 6).map(sanitizeAiComponent)
          : [],
      };
    }),
  };
  if (source.title !== undefined) patch.title = source.title;
  if (source.subtitle !== undefined) patch.subtitle = source.subtitle;
  if (value.intentSummary !== undefined) patch.intentSummary = String(value.intentSummary || "").trim().slice(0, 160);
  else if (source.intentSummary !== undefined) patch.intentSummary = String(source.intentSummary || "").trim().slice(0, 160);
  if (patch.pages.length === 0) throw new Error("AI manifest patch must include pages");
  assertAsciiManifestPatch(patch);
  return patch;
}

function applyGeneratedManifestPatch(baseManifest, patch) {
  return normalizeScreenManifest({
    ...baseManifest,
    title: patch.title ?? baseManifest.title,
    subtitle: patch.subtitle ?? baseManifest.subtitle,
    pages: patch.pages.map((page, index) => ({
      id: page.id || (index === 0 ? "main" : `page-${index + 1}`),
      tab: page.tab || (index === 0 ? "PAGE" : `P${index + 1}`),
      components: page.components,
    })),
  });
}

function enforceGeneratedManifestContract(text, patch) {
  if (!patch || !Array.isArray(patch.pages)) return patch;
  const plan = screenPlanFromSubject(screenProgramSubject(text));
  const pixelPage = pixelArtPage(plan);
  return {
    ...patch,
    title: patch.title || plan.title,
    subtitle: "480x320 pixel canvas",
    pages: patch.pages.map((page, index) => {
      const components = Array.isArray(page.components) ? page.components : [];
      if (index !== 0) return page;
      const pixelArt = components.find((component) => component?.type === "pixelArt");
      if (!isFullPixelCanvasComponent(pixelArt)) {
        return {
          ...pixelPage,
          id: page.id || pixelPage.id,
          tab: page.tab || pixelPage.tab,
        };
      }
      return {
        ...page,
        components: [pixelArt],
      };
    }),
  };
}

async function buildAiScreenManifestCandidate(text, currentManifest) {
  const subject = screenProgramSubject(text);
  const materialSpec = await withTimeout(publicMaterialScreenSpec(subject), 5500, null);
  if (materialSpec) {
    const patch = {
      title: materialSpec.title,
      subtitle: materialSpec.subtitle,
      replacePages: true,
      pages: [materialSpec.page],
      intentSummary: `已从公共图片素材生成 480x320 像素小屏：${materialSpec.material.title || materialSpec.material.query}`,
    };
    return {
      manifest: applyGeneratedManifestPatch(currentManifest, patch),
      patch,
      generation: {
        schema: "walnutpi.screenGeneration.v1",
        source: "public-material",
        apiUsed: false,
        model: null,
        material: {
          source: "wikimedia-commons",
          query: materialSpec.material.query,
          title: materialSpec.material.title,
          url: materialSpec.material.sourceUrl || materialSpec.material.url,
          license: materialSpec.material.license,
        },
        steps: [
          {
            label: "搜索公共素材",
            ok: true,
            detail: `${materialSpec.material.title || materialSpec.material.query}`,
          },
          {
            label: "素材像素化",
            ok: true,
            detail: "已量化为 48x32 pixelArt，铺满 480x320。",
          },
        ],
      },
    };
  }

  const fallbackSpec = screenPlanGeneratedSpec(subject);
  const fallbackPatch = {
    title: fallbackSpec.title,
    subtitle: fallbackSpec.subtitle,
    replacePages: true,
    pages: [fallbackSpec.page],
    intentSummary: screenProgramIntentSummary(subject),
  };

  if (shouldUsePublicImageMaterial(subject)) {
    return {
      manifest: applyGeneratedManifestPatch(currentManifest, fallbackPatch),
      patch: fallbackPatch,
      generation: {
        schema: "walnutpi.screenGeneration.v1",
        source: "rule",
        apiUsed: false,
        model: null,
        fallbackReason: "public material search timed out or returned no usable image",
        steps: [
          {
            label: "搜索公共素材",
            ok: false,
            detail: "公共图片源暂时不可用，已快速回退。",
          },
          {
            label: "本地像素生成",
            ok: true,
            detail: "已用确定性 pixelArt 生成，不等待上传素材。",
          },
        ],
      },
    };
  }

  if (!AI_API_KEY) {
    return {
      manifest: applyGeneratedManifestPatch(currentManifest, fallbackPatch),
      patch: fallbackPatch,
      generation: {
        schema: "walnutpi.screenGeneration.v1",
        source: "rule",
        apiUsed: false,
        model: null,
        fallbackReason: "OPENAI_API_KEY is not configured",
        steps: [
          {
            label: "本地像素生成",
            ok: true,
            detail: "公共素材不可用时，已用确定性 pixelArt 生成。",
          },
        ],
      },
    };
  }

  const startedAt = Date.now();
  const attempts = [];
  let repair = null;
  let lastOutputText = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const data = await callResponsesApi({
        operation: attempt === 1 ? "screen.generate" : "screen.generate.repair",
        signal: aiFetchSignal(),
        body: {
          model: AI_MODEL,
          input: [
            { role: "system", content: screenManifestGenerationSystemPrompt() },
            { role: "user", content: JSON.stringify(aiScreenManifestUserPayload(text, currentManifest, repair), null, 2) },
          ],
        },
      });
      const outputText = parseResponsesOutput(data);
      lastOutputText = outputText.slice(0, 4000);
      if (!outputText) throw new Error("API response did not include output text");
      const patch = decardGeneratedPatch(enforceGeneratedManifestContract(text, sanitizeAiScreenManifestPatch(parseJsonObjectText(outputText))));
      const manifest = applyGeneratedManifestPatch(currentManifest, patch);
      attempts.push({
        attempt,
        operation: attempt === 1 ? "generate" : "repair",
        ok: true,
        componentTypes: patch.pages.flatMap((page) => (page.components || []).map((component) => component.type)),
      });
      return {
        manifest,
        patch,
        generation: {
          schema: "walnutpi.screenGeneration.v1",
          source: "ai",
          apiUsed: true,
          model: AI_MODEL,
          latencyMs: Date.now() - startedAt,
          attempts,
          steps: attempts.map((item) => ({
            label: item.operation === "repair" ? `第 ${item.attempt} 次修复` : "生成 480x320 像素画布",
            ok: item.ok,
            detail: item.ok
              ? `通过 manifest 校验：${(item.componentTypes || []).join(", ") || "components"}`
              : item.error,
          })),
          repaired: attempt > 1,
        },
      };
    } catch (error) {
      attempts.push({
        attempt,
        operation: attempt === 1 ? "generate" : "repair",
        ok: false,
        error: error.message,
      });
      repair = {
        error: error.message,
        output: lastOutputText,
      };
    }
  }
  return {
    manifest: null,
    patch: null,
    generation: {
      schema: "walnutpi.screenGeneration.v1",
      source: "ai-fallback",
      apiUsed: true,
      model: AI_MODEL,
      latencyMs: Date.now() - startedAt,
      attempts,
      steps: attempts.map((item) => ({
        label: item.operation === "repair" ? `第 ${item.attempt} 次修复` : "生成 480x320 像素画布",
        ok: false,
        detail: item.error,
      })),
      fallbackSource: "rule",
      fallbackReason: attempts.at(-1)?.error || "AI generation failed",
    },
  };
}

function screenProgramIntentPatch(input) {
  if (!looksLikeScreenProgramRequest(input)) return null;

  const subject = screenProgramSubject(input);
  const spec = screenPlanGeneratedSpec(subject);
  return {
    title: spec.title,
    subtitle: spec.subtitle,
    replacePages: true,
    pages: [
      spec.page,
    ],
    intentSummary: screenProgramIntentSummary(subject),
  };
}

function screenPlanGeneratedSpec(subject) {
  const plan = screenPlanFromSubject(subject);
  const page = plan.mode === "pixel" ? pixelArtPage(plan) : layoutPageFromPlan(plan);
  return {
    title: plan.title,
    subtitle: plan.subtitle,
    page: decardGeneratedPatch({ pages: [page] }).pages[0],
    plan,
  };
}

const screenManifestEditor = createScreenManifestEditor({
  templates: SCREEN_TEMPLATES,
  manifestStore: screenManifestStore,
  json,
  readJsonRequest,
  looksLikeScreenProgramRequest,
  buildAiScreenManifestCandidate,
  screenProgramIntentSummary,
  screenProgramIntentPatch,
  screenProgramSubject,
  recordMetric: (event) => webMetricsLedger.append(event),
});

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
      "x-walnut-manifest-sha256": ticket.manifestHash,
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

async function screenManifestEnvelope() {
  return screenManifestStore.envelope();
}

async function handleScreenSync(req) {
  const startedAt = Date.now();
  const outcome = await screenSyncWorkflow.run({
    requestJson: () => req.json(),
    mode: "remote",
  });
  await webMetricsLedger.append({
    kind: "screen.sync",
    operation: "screen.sync",
    ok: Boolean(outcome.result?.ok),
    status: outcome.status,
    latencyMs: Date.now() - startedAt,
    mode: outcome.result?.mode,
    stage: outcome.result?.failedStage || "complete",
    buildId: outcome.result?.buildId,
    manifestHash: outcome.result?.manifestHash,
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
  idleTimeout: Math.min(255, Math.ceil(LVGL_PREVIEW_TIMEOUT_MS / 1000) + 15),
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

    if (url.pathname === "/api/screen/preview/lvgl.bmp") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      try {
        return await handleScreenLvglPreview(url);
      } catch (error) {
        return json(
          {
            ok: false,
            error: "lvgl preview failed",
            summary: "无法生成真实 LVGL Web 预览。",
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
          templates: screenManifestEditor.templateSummaries(),
        });
      }

    if (url.pathname === "/api/screen/template") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return screenManifestEditor.handleTemplate(req);
    }

    if (url.pathname === "/api/screen/intent") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenManifestEditor.handleIntent(req);
    }

    if (url.pathname === "/api/screen/sync") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) {
        const outcome = await screenSyncWorkflow.run({
          requestJson: () => req.json(),
          mode: "preview",
        });
        return persistScreenSyncResult(outcome.result, outcome.commandResults, outcome.status);
      }
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

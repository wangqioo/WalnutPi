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
import { actionsForExecutor, loadActionPolicyManifest } from "./action-policy.js";
import { createAgentActionsApi } from "./agent-actions-api.js";
import { createProjectMemoryApi } from "./project-memory-api.js";
import { createScreenDiagnosticsApi } from "./screen-diagnostics-api.js";
import { createScreenWorkspaceApi } from "./screen-workspace-api.js";
import { createStaticUiHost } from "./static-ui-host.js";
import { evaluateRuleIntent } from "./intent-rules/evaluator.js";
import { appendScreenPlaylistItem, processSourceAssetToScreenOutput, writeDefaultScreenPlaylist } from "../scripts/screen-workspace-pipeline.js";
import { stableStringify } from "../scripts/screen-workspace-vocabulary.js";
import { generateLvglScreenWorkspaceRuntimeAssets } from "../scripts/generate-lvgl-screen-workspace-runtime-assets.js";
import { z } from "zod";

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
const ACTION_POLICY_MANIFEST_PATH = path.join(PROJECT_ROOT, "action-policy-manifest.json");
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
const ACTION_POLICY_MANIFEST = await loadActionPolicyManifest(ACTION_POLICY_MANIFEST_PATH);
const WEB_ACTIONS = actionsForExecutor(ACTION_POLICY_MANIFEST, "web");

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
  ["/", "walnut-agent-console.html"],
  ["/workspace.html", "screen-workspace-preview.html"],
  ["/ssh-terminal.html", "ssh-terminal.html"],
  ["/vendor/ansi_up.js", "vendor/ansi_up.js"],
  [`/${MODEL_FILE}`, MODEL_FILE],
]);

const staticUiHost = createStaticUiHost({ baseDir: BASE_DIR, files });

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
  actionPolicyManifestPath: ACTION_POLICY_MANIFEST_PATH,
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

const screenDiagnosticsApi = createScreenDiagnosticsApi({
  screenEvidenceLedger,
  screenFrameTickets,
  screenFrameTicketTtlMs: SCREEN_FRAME_TICKET_TTL_MS,
  walnutRemote,
  validSha256,
  sha256,
  json,
});

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
const IntentClassificationSchema = z.object({
  intent: z.enum([
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
  ]),
  subject: z.string().optional(),
  delivery: z.enum(["none", "sync_after_preview", "sync_existing"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["rule", "ai"]).optional(),
});

function wantsScreenDeliveryIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (/不(?:要|用|必)?\s*(?:同步|部署|推送|运行到|显示到|烧录)|别\s*(?:同步|部署|推送|运行到|显示到|烧录)|只\s*(?:预览|生成|看看)|preview\s*only|no\s*(?:sync|deploy)/i.test(value)) {
    return false;
  }
  return /同步|部署|推送|运行到|显示到|烧录|sync|deploy|flash/.test(value);
}

function looksLikeAssistantQuestion(input) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return false;
  return /^(?:你|walnutai|walnut ai|ai)\s*(?:现在|目前|到底)?\s*(?:是?谁|能做什么|能帮我做(?:什么|哪些事)|可以做什么|会做什么|有什么功能|介绍(?:一下)?(?:你自己|自己)?)/i.test(text)
    || /(?:你是?谁|你能做什么|你能帮我做(?:什么|哪些事)|你可以做什么|你会做什么|介绍一下你自己|介绍一下自己|有什么功能)/i.test(text);
}

function hasWriteOrDeliveryNegation(input) {
  const text = String(input || "").trim().toLowerCase();
  return /不(?:要|用|必)?\s*(?:执行|同步|部署|推送|运行到|显示到|烧录|重启|修改|改|变更|写|写入|保存|安装|配置)|别\s*(?:执行|同步|部署|推送|运行到|显示到|烧录|重启|修改|改|变更|写|写入|保存|安装|配置)|只(?:做|进行)?\s*(?:只读|读|看|检查|查询|看看)|read[-\s]*only|no\s*(?:sync|deploy|write|restart|change|modify|execute)|don'?t\s*(?:sync|deploy|write|restart|change|modify|execute)/i.test(text);
}

function looksLikeReadOnlyDeviceRequest(input) {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  if (!text) return false;
  if (looksLikeExplicitScreenGeneration(text)) {
    return false;
  }
  if (!/(核桃派|设备|板子|系统|服务|屏幕服务|网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network|gpio|引脚|针脚|i2c|spi|uart|pwm|状态|健康|还好[吗嘛]|status|health|内存|存储|磁盘|空间)/i.test(lower)) {
    return false;
  }
  return hasWriteOrDeliveryNegation(text)
    || /(?:看|查|检查|查询|确认|了解|判断|诊断|health|check|inspect|status|read)\S*(?:核桃派|设备|板子|系统|服务|屏幕服务|网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|gpio|引脚|针脚|i2c|spi|uart|pwm|状态|健康|还好)/i.test(lower);
}

function looksLikeExplicitScreenGeneration(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  return /(?:生成|创建|设计|做|做成|整理成|来一个|写个|做个).{0,24}(?:小屏|屏幕|卡片|状态卡|界面|面板|screen|480x320|480\s*[x×]\s*320)|(?:小屏|屏幕|screen|480x320|480\s*[x×]\s*320).{0,24}(?:生成|创建|设计|预览|同步|卡片|界面|面板)/i.test(text);
}

function readOnlyDeviceIntent(input) {
  const lower = String(input || "").toLowerCase();
  const mentionsNetwork = /网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network/.test(lower);
  const mentionsGpio = /gpio|引脚|针脚|i2c|spi|uart|pwm|总线|bus|set-device/.test(lower);
  const mentionsStatus = /屏幕服务|状态|健康|还好[吗嘛]|status|health|系统|服务|docker|内存|存储|磁盘|空间/.test(lower)
    || (/怎么样/.test(lower) && /核桃派|设备|板子|系统|服务/.test(lower));
  if ((mentionsNetwork && mentionsStatus) || (mentionsGpio && mentionsStatus) || (mentionsNetwork && mentionsGpio)) {
    return "device.status.read";
  }
  if (mentionsGpio) return "device.gpio.read";
  if (mentionsNetwork) return "device.network.read";
  return "device.status.read";
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
  if (!looksLikeExplicitScreenGeneration(text) && looksLikeReadOnlyDeviceRequest(text)) return false;
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

  if (looksLikeAssistantQuestion(trimmed)) {
    return normalizeIntentClassification({
      intent: "ai.chat",
      subject: trimmed,
      delivery: "none",
      confidence: 0.92,
      source: "rule",
    }, trimmed);
  }

  if (looksLikeExplicitScreenGeneration(trimmed)) {
    return normalizeIntentClassification({
      intent: "screen.generate",
      subject: screenIntentSubject(trimmed),
      delivery: wantsScreenDeliveryIntent(trimmed) ? "sync_after_preview" : "none",
      confidence: 0.92,
      source: "rule",
    }, trimmed);
  }

  if (looksLikeReadOnlyDeviceRequest(trimmed)) {
    return normalizeIntentClassification({
      intent: readOnlyDeviceIntent(trimmed),
      subject: trimmed,
      delivery: "none",
      confidence: 0.9,
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

  if (/gpio|引脚|针脚|i2c|spi|uart|pwm|总线|bus|set-device/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.gpio.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/快照|snapshot|release|os-release|kernel|内核|hostname|启动配置|boot|设备信息|板子信息|硬件信息/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.snapshot.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.network.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/状态|健康|还好[吗嘛]|status|health|系统|服务|docker|内存|存储|磁盘|空间/.test(lower) || (/怎么样/.test(lower) && /核桃派|设备|板子|系统|服务/.test(lower))) {
    return normalizeIntentClassification({ intent: "device.status.read", subject: trimmed, confidence: 0.86, source: "rule" }, trimmed);
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
  const parsed = IntentClassificationSchema.safeParse(value || {});
  const clean = parsed.success ? parsed.data : {};
  const intent = clean.intent || "ai.chat";
  const delivery = clean.delivery || "none";
  const confidence = Math.max(0, Math.min(1, Number(clean.confidence ?? 0.5)));
  const subject = String(clean.subject || fallback).trim().slice(0, 120) || fallback || "";
  return {
    schema: "walnutpi.intent.classification.v1",
    intent,
    subject,
    delivery,
    confidence: Number(confidence.toFixed(2)),
    source: clean.source === "ai" ? "ai" : "rule",
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
  if (ruleIntent.intent === "ai.chat" && looksLikeAssistantQuestion(text) && aiIntent.intent !== "ai.chat") return false;
  if (ruleIntent.intent === "screen.generate" && aiIntent.intent !== "screen.generate") return false;
  if (ruleIntent.intent === "screen.sync" && !["screen.sync", "screen.generate"].includes(aiIntent.intent)) return false;
  if (ruleIntent.intent.startsWith("device.") && aiIntent.intent === "terminal.tool") return false;
  if (wantsScreenDeliveryIntent(text) && aiIntent.intent === "ai.chat") return false;
  if (!wantsScreenDeliveryIntent(text) && aiIntent.delivery !== "none") return false;
  return true;
}

function canUseRuleIntentWithoutAi(ruleIntent) {
  if (!ruleIntent || ruleIntent.source !== "rule") return false;
  if (ruleIntent.confidence < 0.84) return false;
  return [
    "ai.chat",
    "screen.sync",
    "device.status.read",
    "device.snapshot.read",
    "device.network.read",
    "device.gpio.read",
    "device.notes.read",
    "device.note.write",
    "terminal.open",
  ].includes(ruleIntent.intent);
}

async function classifyIntent(text) {
  let ruleIntent;
  try {
    const evaluated = await evaluateRuleIntent(text);
    ruleIntent = evaluated.classification
      ? normalizeIntentClassification(evaluated.classification, text)
      : ruleBasedIntentClassification(text);
  } catch {
    ruleIntent = ruleBasedIntentClassification(text);
  }
  if (canUseRuleIntentWithoutAi(ruleIntent)) {
    return {
      classification: ruleIntent,
      ruleIntent,
      ruleShortCircuited: true,
      aiClassifierUsed: false,
    };
  }
  let aiClassifierUsed = false;
  try {
    const aiIntent = await aiIntentClassification(text, ruleIntent);
    aiClassifierUsed = Boolean(aiIntent);
    if (intentClassificationAllowed(aiIntent, ruleIntent, text)) {
      return {
        classification: { ...aiIntent, fallback: ruleIntent },
        ruleIntent,
        ruleShortCircuited: false,
        aiClassifierUsed,
      };
    }
  } catch {
    // Rule-based classification remains the safety boundary if the AI classifier fails.
  }
  return {
    classification: ruleIntent,
    ruleIntent,
    ruleShortCircuited: false,
    aiClassifierUsed,
  };
}

async function handleIntentClassify(req) {
  const startedAt = Date.now();
  const traceId = randomUUID();
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    await webMetricsLedger.append({
      kind: "web.intent.classify",
      operation: "intent.classify",
      ok: false,
      status: 400,
      latencyMs: Date.now() - startedAt,
      traceId,
      span: "request",
      error: error.message,
    });
    return json({ ok: false, error: error.message }, 400);
  }
  const text = String(body.text || "").trim();
  if (!text) {
    await webMetricsLedger.append({
      kind: "web.intent.classify",
      operation: "intent.classify",
      ok: false,
      status: 400,
      latencyMs: Date.now() - startedAt,
      traceId,
      span: "request",
      inputChars: 0,
      error: "missing text",
    });
    return json({ ok: false, error: "missing text" }, 400);
  }
  const result = await classifyIntent(text);
  const classification = result.classification;
  await webMetricsLedger.append({
    kind: "web.intent.classify",
    operation: "intent.classify",
    ok: true,
    status: 200,
    latencyMs: Date.now() - startedAt,
    traceId,
    span: "total",
    inputChars: text.length,
    classificationSource: classification.source || "unknown",
    ruleShortCircuited: result.ruleShortCircuited,
    aiClassifierUsed: result.aiClassifierUsed,
  });
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
    "Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.",
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

async function runRemoteRaw(command, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.runRaw(command, timeoutMs, outputLimit);
}

async function runRemoteScript(script, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.runScript(script, timeoutMs, outputLimit);
}

async function runRemoteRawScript(script, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.runRawScript(script, timeoutMs, outputLimit);
}

async function runRemoteWithInput(command, input, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.runWithInput(command, input, timeoutMs, outputLimit);
}

async function runRemoteRawWithInput(command, input, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return walnutRemote.runRawWithInput(command, input, timeoutMs, outputLimit);
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
      runRemoteRaw,
      runRemoteScript,
      runRemoteRawScript,
      runRemoteWithInput,
      runRemoteRawWithInput,
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
  rememberFrameTicket: screenDiagnosticsApi.rememberScreenFrameTicket,
  validSha256,
  newBuildId: newScreenBuildId,
});

const agentActionsApi = createAgentActionsApi({
  policyActions: WEB_ACTIONS,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  shellQuote,
  limitedOutput,
  json,
  aiTimeoutSeconds: AI_TIMEOUT_SECONDS,
});

async function readJsonRequest(req) {
  try {
    return await req.json();
  } catch {
    throw new Error("请求不是有效 JSON。");
  }
}

const projectMemoryApi = createProjectMemoryApi({
  webSessionLedger,
  readWalnutMemory,
  retrieveWalnutContext,
  memoryFile: WALNUT_AI_MEMORY_FILE,
  skillsDir: WALNUT_AI_SKILLS_DIR,
  corpusDir: WALNUT_AI_CORPUS_DIR,
  eventLimit: WEB_SESSION_EVENT_LIMIT,
  readJsonRequest,
  json,
});

function frameUrl(buildId) {
  return `/api/screen/frame/${encodeURIComponent(buildId)}`;
}

const screenWorkspaceApi = createScreenWorkspaceApi({
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow,
  readJsonRequest,
  json,
  workspaceErrorResponse,
  webMetricsLedger,
  processSourceAssetToScreenOutput,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
  generateLvglScreenWorkspaceRuntimeAssets,
  persistScreenSyncResult,
  runLocal,
  findWindowsCommand,
  sha256,
  projectRoot: PROJECT_ROOT,
  screenWorkspaceRoot: SCREEN_WORKSPACE_ROOT,
  screenSourceImportMaxBytes: SCREEN_SOURCE_IMPORT_MAX_BYTES,
  screenLvglPreviewOutputDir: SCREEN_LVGL_PREVIEW_OUTPUT_DIR,
});

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
      return json(agentActionsApi.actionPolicyView({
        target: `${SSH_USER}@${SSH_HOST}`,
        manifest: {
          schema: ACTION_POLICY_MANIFEST.schema,
          version: ACTION_POLICY_MANIFEST.version,
          path: path.relative(PROJECT_ROOT, ACTION_POLICY_MANIFEST_PATH).replaceAll("\\", "/"),
        },
      }));
    }

    if (url.pathname === "/api/memory") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return projectMemoryApi.handleMemory();
    }

    if (url.pathname === "/api/retrieval") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return projectMemoryApi.handleRetrieval(url);
    }

    if (url.pathname === "/api/project-memory") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return projectMemoryApi.handleProjectMemory(url);
    }

    if (url.pathname === "/api/metrics") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      const limit = Number(url.searchParams.get("limit") || 200);
      return json(await webMetricsLedger.report(
        Number.isFinite(limit) ? limit : 200,
        { since: url.searchParams.get("since") || null },
      ));
    }

    if (url.pathname === "/api/session") {
      return projectMemoryApi.handleSession(req, url);
    }

    if (url.pathname === "/api/intent/classify") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleIntentClassify(req);
    }

    if (url.pathname === "/api/screen/workspace/playlist") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenWorkspaceApi.handleScreenWorkspacePlaylist(url);
    }

    if (url.pathname === "/api/screen/workspace/process") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenWorkspaceApi.handleScreenWorkspaceProcess(req);
    }

    if (url.pathname === "/api/screen/workspace/import") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenWorkspaceApi.handleScreenWorkspaceImport(req);
    }

    if (url.pathname === "/api/screen/workspace/generate") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenWorkspaceApi.handleScreenWorkspaceGenerate(req);
    }

    if (url.pathname === "/api/screen/workspace/lvgl-preview") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenWorkspaceApi.handleScreenWorkspaceLvglPreview();
    }

    if (url.pathname === "/api/screen/workspace/sync") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenWorkspaceApi.handleScreenWorkspaceSync(req, previewOnly(url) ? "preview" : "remote");
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
      return screenWorkspaceApi.handleScreenWorkspaceManifest(manifestId);
    }

    if (url.pathname.startsWith("/api/screen/workspace/assets/")) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenWorkspaceApi.handleScreenWorkspaceAsset(url);
    }

    if (url.pathname === "/api/screen/pixel-diff") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenDiagnosticsApi.handleScreenPixelDiff(req, readJsonRequest);
    }

    if (url.pathname === "/api/screen/records") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return screenDiagnosticsApi.handleScreenRecordList();
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
      return screenDiagnosticsApi.handleScreenRecordFrame(buildId);
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
      return screenDiagnosticsApi.handleScreenRecord(buildId);
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
      return screenDiagnosticsApi.handleScreenFrame(buildId);
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return agentActionsApi.handleAction(req);
    }

    return (await staticUiHost.handle(url.pathname)) || new Response("Not found", { status: 404 });
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

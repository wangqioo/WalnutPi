import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRouter } from "./router.ts";
import { createScreenEvidenceLedger } from "./screen-evidence-ledger.ts";
import { createSshLocalAgentAdapter } from "./screen-delivery-adapters/ssh-local-agent.ts";
import { createScreenWorkspaceSyncWorkflow } from "./screen-workspace-sync-workflow.ts";
import { createWebSessionLedger } from "./web-session-ledger.ts";
import { createWebMetricsLedger } from "./web-metrics-ledger.ts";
import { createWalnutRemoteAdapter } from "./walnut-remote-adapter.ts";
import { createScreenWorkspaceStore, workspaceErrorResponse } from "./screen-workspace-store.ts";
import { actionsForExecutor, loadActionPolicyManifest } from "./action-policy.ts";
import { createAgentActionsApi } from "./agent-actions-api.ts";
import { createAgentEventBus } from "./agent-event-bus.ts";
import { createAgentHarnessSessionStore } from "./agent-harness-session-store.ts";
import { createOneLaneQueue } from "./agent-one-lane-queue.ts";
import { createAgentTurnEventLedger } from "./agent-turn-event-ledger.ts";
import { createAgentTurnLedger } from "./agent-turn-ledger.ts";
import { createAgentTurnLoop } from "./agent-turn-loop.ts";
import { createActionRegistry } from "./action-registry.ts";
import { createProjectMemoryApi } from "./project-memory-api.ts";
import { createScreenDiagnosticsApi } from "./screen-diagnostics-api.ts";
import { createScreenWorkspaceApi } from "./screen-workspace-api.ts";
import { createStaticUiHost } from "./static-ui-host.ts";
import { evaluateRuleIntent, intentTypeToRoute } from "./intent-rules/evaluator.ts";
import { appendScreenPlaylistItem, processSourceAssetToScreenOutput, writeDefaultScreenPlaylist } from "../scripts/screen-workspace-pipeline.ts";
import { stableStringify } from "../scripts/screen-workspace-vocabulary.ts";
import { generateLvglScreenWorkspaceRuntimeAssets } from "../scripts/generate-lvgl-screen-workspace-runtime-assets.ts";
import { normalizeAgentLoopProposal } from "../scripts/agent-loop-model-contract.ts";
import {
  ACTION_OUTPUT_LIMIT,
  ACTION_POLICY_MANIFEST_PATH,
  AGENT_HARNESS_SESSIONS_PATH,
  AGENT_TURNS_PATH,
  AGENT_TURN_EVENTS_PATH,
  AI_BASE_URL,
  AI_CONTEXT_LIMIT,
  AI_CONTEXT_TEXT_LIMIT,
  AI_MODEL,
  AI_REASONING_EFFORT,
  AI_TIMEOUT_SECONDS,
  BASE_DIR,
  CAPTURE_OUTPUT_LIMIT,
  CODEX_AUTH_PATH,
  HOST,
  MEMORY_FIELDS,
  MODEL_FILE,
  PORT,
  PROJECT_ROOT,
  REMOTE_BUILD_USER,
  REMOTE_PROJECT_ROOT,
  RETRIEVAL_FILE_LIMIT,
  RETRIEVAL_RESULT_LIMIT,
  SCREEN_FRAME_TICKET_TTL_MS,
  SCREEN_LVGL_PREVIEW_OUTPUT_DIR,
  SCREEN_RECORDS_DIR,
  SCREEN_RECORD_LIMIT,
  SCREEN_SOURCE_IMPORT_MAX_BYTES,
  SCREEN_SUCCESS_CORPUS_PATH,
  SCREEN_WORKSPACE_ROOT,
  SSH_HOST,
  SSH_PASSWORD,
  SSH_USER,
  WALNUT_AI_CORPUS_DIR,
  WALNUT_AI_MEMORY_FILE,
  WALNUT_AI_PRIMARY_SKILL,
  WALNUT_AI_SKILLS_DIR,
  WALNUT_CLI_SOURCE_PATH,
  WEB_METRICS_PATH,
  WEB_SESSIONS_DIR,
  WEB_SESSION_EVENT_LIMIT,
} from "./config.ts";

const WEB_CONFIG = {
  ACTION_OUTPUT_LIMIT,
  ACTION_POLICY_MANIFEST_PATH,
  AGENT_HARNESS_SESSIONS_PATH,
  AGENT_TURNS_PATH,
  AGENT_TURN_EVENTS_PATH,
  AI_BASE_URL,
  AI_CONTEXT_LIMIT,
  AI_CONTEXT_TEXT_LIMIT,
  AI_MODEL,
  AI_REASONING_EFFORT,
  AI_TIMEOUT_SECONDS,
  BASE_DIR,
  CAPTURE_OUTPUT_LIMIT,
  CODEX_AUTH_PATH,
  HOST,
  MEMORY_FIELDS,
  MODEL_FILE,
  PORT,
  PROJECT_ROOT,
  REMOTE_BUILD_USER,
  REMOTE_PROJECT_ROOT,
  RETRIEVAL_FILE_LIMIT,
  RETRIEVAL_RESULT_LIMIT,
  SCREEN_FRAME_TICKET_TTL_MS,
  SCREEN_LVGL_PREVIEW_OUTPUT_DIR,
  SCREEN_RECORDS_DIR,
  SCREEN_RECORD_LIMIT,
  SCREEN_SOURCE_IMPORT_MAX_BYTES,
  SCREEN_SUCCESS_CORPUS_PATH,
  SCREEN_WORKSPACE_ROOT,
  SSH_HOST,
  SSH_PASSWORD,
  SSH_USER,
  WALNUT_AI_CORPUS_DIR,
  WALNUT_AI_MEMORY_FILE,
  WALNUT_AI_PRIMARY_SKILL,
  WALNUT_AI_SKILLS_DIR,
  WALNUT_CLI_SOURCE_PATH,
  WEB_METRICS_PATH,
  WEB_SESSIONS_DIR,
  WEB_SESSION_EVENT_LIMIT,
};
type JsonObject = Record<string, any>;
type TerminalWsData = { child?: ChildProcessWithoutNullStreams | null; command?: string };
type TerminalWebSocket = { close: () => void; data: TerminalWsData; send: (chunk: any) => void };

const ACTION_POLICY_MANIFEST = await loadActionPolicyManifest(ACTION_POLICY_MANIFEST_PATH);
const WEB_ACTIONS = actionsForExecutor(ACTION_POLICY_MANIFEST, "web");
const aiApiKey = resolveAiApiKey();
const screenFrameTickets = new Map();
const webSessionLedger = createWebSessionLedger({
  sessionsDir: WEB_SESSIONS_DIR,
  eventLimit: WEB_SESSION_EVENT_LIMIT,
});
const webMetricsLedger = createWebMetricsLedger({
  metricsPath: WEB_METRICS_PATH,
  limit: Number(process.env.WALNUT_WEB_METRICS_LIMIT || 200),
});
const agentTurnLedger = createAgentTurnLedger({
  turnsPath: AGENT_TURNS_PATH,
  limit: Number(process.env.WALNUT_AGENT_TURN_LIMIT || 100),
});
const agentEventBus = createAgentEventBus();
const agentTurnEventLedger = createAgentTurnEventLedger({
  eventsPath: AGENT_TURN_EVENTS_PATH,
  eventBus: agentEventBus,
  limit: Number(process.env.WALNUT_AGENT_TURN_EVENT_LIMIT || 500),
});
const agentQueue = createOneLaneQueue();
const agentHarnessSessionStore = createAgentHarnessSessionStore({
  filePath: AGENT_HARNESS_SESSIONS_PATH,
});

const files = new Map([
  ["/", "walnut-agent-console.html"],
  ["/apps.html", "widget-app-gallery.html"],
  ["/workspace.html", "screen-workspace-preview.html"],
  ["/ssh-terminal.html", "ssh-terminal.html"],
  ["/vendor/ansi_up.js", path.join(PROJECT_ROOT, "node_modules", "ansi_up", "ansi_up.js")],
  [`/${MODEL_FILE}`, MODEL_FILE],
]);

const staticUiHost = createStaticUiHost({ baseDir: BASE_DIR, files });

function json(data, status = 200) {
  return Response.json(data, { status });
}

function sseFrame(event) {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

function readCodexAuthApiKey() {
  try {
    if (!CODEX_AUTH_PATH) return "";
    const parsed = JSON.parse(readFileSync(CODEX_AUTH_PATH, "utf8"));
    if (typeof parsed?.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.trim()) return parsed.OPENAI_API_KEY;
    return "";
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
  const synonyms: [string, string[]][] = [
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

function parseResponsesOutput(data: any) {
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

function responsesRequestBody(body: JsonObject) {
  return {
    ...body,
    model: body.model || AI_MODEL,
    reasoning: body.reasoning || { effort: AI_REASONING_EFFORT },
  };
}

async function callResponsesApi({ operation, body, signal = aiFetchSignal(), telemetry = {} }: { operation: string; body: JsonObject; signal?: AbortSignal; telemetry?: JsonObject }) {
  const startedAt = Date.now();
  let status = null;
  let requestId = null;
  try {
    const response = await fetch(`${AI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiApiKey}`,
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
        sessionId: telemetry.sessionId,
        turnId: telemetry.turnId,
        error: message,
      });
      throw new Error(message);
    }
    const data: JsonObject = await response.json();
    await webMetricsLedger.append({
      kind: "openai.responses",
      operation,
      ok: true,
      status,
      model: body.model || AI_MODEL,
      reasoningEffort: body.reasoning?.effort || AI_REASONING_EFFORT,
      latencyMs: Date.now() - startedAt,
      requestId: requestId || data.id || null,
      sessionId: telemetry.sessionId,
      turnId: telemetry.turnId,
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
        sessionId: telemetry.sessionId,
        turnId: telemetry.turnId,
        error: error.message,
      });
    }
    throw error;
  }
}

async function classifyIntent(text: string, telemetry: JsonObject = {}) {
  const evaluated = await evaluateRuleIntent(text);
  if (!evaluated.classification) throw new Error("intent rule did not match");
  return {
    classification: evaluated.classification,
    ruleIntent: evaluated.classification,
    ruleShortCircuited: true,
    aiClassifierUsed: false,
  };
}

async function classifyAgentIntent(text: string, { traceId = randomUUID(), startedAt = Date.now(), sessionId = null, turnId = null }: JsonObject = {}) {
  const input = String(text || "").trim();
  if (!input) {
    await webMetricsLedger.append({
      kind: "web.intent.classify",
      operation: "intent.classify",
      ok: false,
      status: 400,
      latencyMs: Date.now() - startedAt,
      traceId,
      sessionId,
      turnId,
      span: "request",
      inputChars: 0,
      error: "missing text",
    });
    return { ok: false, status: 400, error: "missing text" };
  }
  try {
    const result = await classifyIntent(input, { sessionId, turnId });
    const classification = result.classification;
    await webMetricsLedger.append({
      kind: "web.intent.classify",
      operation: "intent.classify",
      ok: true,
      status: 200,
      latencyMs: Date.now() - startedAt,
      traceId,
      sessionId,
      turnId,
      span: "total",
      inputChars: input.length,
      classificationSource: classification.source || "unknown",
      ruleShortCircuited: result.ruleShortCircuited,
      aiClassifierUsed: result.aiClassifierUsed,
    });
    return { ok: true, status: 200, classification };
  } catch (error) {
    await webMetricsLedger.append({
      kind: "web.intent.classify",
      operation: "intent.classify",
      ok: false,
      status: 400,
      latencyMs: Date.now() - startedAt,
      traceId,
      sessionId,
      turnId,
      span: "total",
      inputChars: input.length,
      error: error.message,
    });
    return { ok: false, status: 400, error: error.message };
  }
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
  const result = await classifyAgentIntent(body.text, { traceId, startedAt });
  return json(result.ok ? { ok: true, classification: result.classification } : { ok: false, error: result.error }, result.status);
}

async function persistScreenSyncResult(result, commandResults = {}, status = 200) {
  try {
    const record = await screenEvidenceLedger.persistSyncResult(result, commandResults);
    const recordDir = screenEvidenceLedger.recordDir(record.buildId);
    result.syncRecord = {
      buildId: record.buildId,
      recordPath: recordDir ? path.join(recordDir, "record.json") : null,
      summaryPath: recordDir ? path.join(recordDir, "summary.json") : null,
      url: `/api/screen/records/${encodeURIComponent(record.buildId)}`,
    };
    result.syncRecordPath = result.syncRecord.recordPath;
    await rememberSuccessfulScreenSync(record);
  } catch (error) {
    result.recordWarning = `screen sync record was not saved: ${error.message}`;
  }
  return json(result, status);
}

async function syncScreenFromTurn(body: JsonObject) {
  const startedAt = Date.now();
  const outcome = await screenWorkspaceSyncWorkflow.run({
    requestJson: async () => body || {},
    mode: "remote",
  });
  const latencyMs = Date.now() - startedAt;
  const result = outcome.result as JsonObject;
  const remoteExecution = result.remoteExecution || {};
  await webMetricsLedger.append({
    kind: "screen.workspace.sync",
    operation: "screen.workspace.sync",
    ok: Boolean(result.ok),
    status: outcome.status,
    latencyMs,
    mode: result.mode,
    stage: result.failedStage || "complete",
    buildId: result.buildId,
    playlistHash: result.playlistHash,
    sessionId: body?.sessionId,
    turnId: body?.turnId,
    remoteTransport: remoteExecution.remoteTransport,
    connectionReused: remoteExecution.connectionReused,
    segments: {
      workspaceSyncMs: latencyMs,
      deliveryMs: result.segments?.deliveryMs,
      preflightMs: remoteExecution.segments?.preflightMs,
      remoteMs: remoteExecution.segments?.remoteMs,
    },
    error: result.ok ? null : result.summary || result.output,
  });
  try {
    const record = await screenEvidenceLedger.persistSyncResult(result, outcome.commandResults);
    const recordDir = screenEvidenceLedger.recordDir(record.buildId);
    result.syncRecord = {
      buildId: record.buildId,
      recordPath: recordDir ? path.join(recordDir, "record.json") : null,
      summaryPath: recordDir ? path.join(recordDir, "summary.json") : null,
      url: `/api/screen/records/${encodeURIComponent(record.buildId)}`,
    };
    result.syncRecordPath = result.syncRecord.recordPath;
    await rememberSuccessfulScreenSync(record);
  } catch (error) {
    result.recordWarning = `screen sync record was not saved: ${error.message}`;
  }
  return { status: outcome.status, body: result };
}

async function handleAgentEvents(req, url) {
  const sessionId = url.searchParams.get("sessionId") || null;
  const afterSeq = Number(url.searchParams.get("afterSeq") || url.searchParams.get("lastSeq") || req.headers.get("last-event-id") || 0);
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(sseFrame(event)));
      for (const event of await agentTurnEventLedger.readEvents({ sessionId, afterSeq })) send(event);
      const unsubscribe = agentEventBus.subscribe(sessionId, send);
      req.signal?.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // connection already closed
        }
      }, { once: true });
    },
  }), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
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

function runLocal(command: string, args: string[], options: { cwd?: string; outputLimit?: number; timeoutMs?: number } = {}) {
  const {
    timeoutMs = 15_000,
    outputLimit = ACTION_OUTPUT_LIMIT,
    cwd = PROJECT_ROOT,
  } = options;
  return new Promise((resolve) => {
    const env = { ...process.env };
    const runtimeDirs = [
      process.execPath ? path.dirname(process.execPath) : "",
      env.BUN_INSTALL ? path.join(env.BUN_INSTALL, "bin") : "",
    ].filter(Boolean);
    if (runtimeDirs.length) {
      env.PATH = [...runtimeDirs, env.PATH || env.Path || ""].filter(Boolean).join(path.delimiter);
      env.Path = env.PATH;
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

const actionRegistry = createActionRegistry({
  manifestPath: ACTION_POLICY_MANIFEST_PATH,
  shellQuote,
  aiTimeoutSeconds: AI_TIMEOUT_SECONDS,
});

const agentActionsApi = createAgentActionsApi({
  policyManifest: ACTION_POLICY_MANIFEST,
  policyActions: WEB_ACTIONS,
  actionRegistry,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
  json,
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
  runRemote,
  runRemoteWithInput,
  shellQuote,
  findWindowsCommand,
  sha256,
  projectRoot: PROJECT_ROOT,
  screenWorkspaceRoot: SCREEN_WORKSPACE_ROOT,
  screenSourceImportMaxBytes: SCREEN_SOURCE_IMPORT_MAX_BYTES,
  screenLvglPreviewOutputDir: SCREEN_LVGL_PREVIEW_OUTPUT_DIR,
  generateWidgetCatalog,
});

const agentTurnLoop = createAgentTurnLoop({
  classifyIntent: classifyAgentIntent,
  runAction: agentActionsApi.runAction,
  generateScreen: screenWorkspaceApi.generateScreenWorkspace,
  syncScreen: syncScreenFromTurn,
  loopModelAdapter: createRelayLoopModelAdapter(),
  readPlaylistEnvelope: () => screenWorkspaceStore.readPlaylistEnvelope("default"),
  turnLedger: agentTurnLedger,
  eventLedger: agentTurnEventLedger,
  metricsLedger: webMetricsLedger,
  queue: agentQueue,
  readJsonRequest,
  json,
});

function createRelayLoopModelAdapter() {
  return {
    async propose(context: JsonObject, options: JsonObject = {}) {
      if (!aiApiKey) throw new Error("AI API key is not configured");
      const startedAt = Date.now();
      const promptText = JSON.stringify(context, null, 2);
      const data: JsonObject = await callResponsesApi({
        operation: "agent.loop.propose",
        telemetry: { sessionId: options.sessionId, turnId: options.turnId },
        body: {
          model: options.model || AI_MODEL,
          reasoning: { effort: options.reasoningEffort || AI_REASONING_EFFORT },
          input: [
            {
              role: "system",
              content: [
                "You are the proposal layer inside the WalnutPi agent loop.",
                "You do not execute actions.",
                "Return JSON only.",
                "Use only the visible context. Do not mention or infer hidden oracle or evaluator answers.",
                "If evidence is missing or a continuation is unsafe, block it.",
                "Allowed output fields: source, kind, safeAutoContinue, proposedTasks, blockedTasks, evidencePlan, rationale.",
                "source must be model.",
              ].join("\n"),
            },
            { role: "user", content: promptText },
          ],
        },
      });
      const raw = parseResponsesOutput(data);
      const proposal = normalizeAgentLoopProposal(parseJsonObjectText(raw), { source: "model" });
      return {
        proposal,
        diagnostics: {
          provider: new URL(AI_BASE_URL).hostname,
          model: options.model || AI_MODEL,
          reasoningEffort: options.reasoningEffort || AI_REASONING_EFFORT,
          requestId: data.id || null,
          latencyMs: Date.now() - startedAt,
          promptHash: sha256(promptText),
          rawOutputHash: sha256(raw),
        },
      };
    },
  };
}

async function generateWidgetCatalog({ prompt, sessionId = null, turnId = null }) {
  if (!aiApiKey) return null;
  const data = await callResponsesApi({
    operation: "screen.widget.catalog.generate",
    telemetry: { sessionId, turnId },
    body: {
      model: AI_MODEL,
      input: [
        {
          role: "system",
          content: [
            "You design a playable 480x320 WalnutPi LVGL widget app as JSON.",
            "Return JSON only.",
            "Do not generate an image. Do not use markdown.",
            "Schema must be walnutpi.lvgl-widget-catalog.v1.",
            "Canvas is exactly 480x320. All layout rectangles must stay inside it.",
            "Use a small, readable pixel-style dashboard composition.",
            "Allowed node kinds: container, rect, text, image, button, toggle, progress, gauge, list, status_tile.",
            "Allowed style tokens: screen, panel, text, muted, muted2, primary, accent, danger, trace, chip, panelBorder, barTrack.",
            "Root node id must exist and usually be a full-screen container.",
            "Return useful actions as action names, never shell commands.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt,
            outputSchema: {
              schema: "walnutpi.lvgl-widget-catalog.v1",
              id: "simple slug",
              title: "1-80 chars",
              size: { width: 480, height: 320 },
              theme: "pixel-default",
              data: {},
              root: "root",
              nodes: [
                {
                  id: "unique slug",
                  kind: "container|rect|text|button|progress|gauge|status_tile",
                  parent: "root except root itself",
                  layout: { x: "0..479", y: "0..319", w: "1..480", h: "1..320" },
                  text: "optional display text",
                  style: "style token",
                  value: "optional number",
                  action: { name: "optional.action.name", params: {} },
                },
              ],
            },
          }, null, 2),
        },
      ],
    },
  });
  return parseJsonObjectText(parseResponsesOutput(data));
}

function startSsh(ws: TerminalWebSocket) {
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

function openSshSession(ws: TerminalWebSocket, target: string) {
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
  if (ws.data.command) {
    setTimeout(() => {
      if (!child.killed && child.stdin.writable) child.stdin.write(`${ws.data.command}\n`);
    }, 1200);
  }
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

function stopSsh(ws: TerminalWebSocket) {
  const child = ws.data.child;
  if (!child || child.killed) return;

  child.stdin.end();
  child.kill("SIGTERM");

  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 1000).unref?.();
}

const router = createRouter({
  json,
  previewOnly,
  previewOnlyJson,
  config: WEB_CONFIG,
  path,
  agentActionsApi,
  actionPolicyManifest: ACTION_POLICY_MANIFEST,
  projectMemoryApi,
  webMetricsLedger,
  handleIntentClassify,
  agentTurnLoop,
  handleAgentEvents,
  agentHarnessSessionStore,
  readJsonRequest,
  screenWorkspaceApi,
  screenDiagnosticsApi,
  staticUiHost,
});

const server = Bun.serve<TerminalWsData>({
  hostname: HOST,
  port: PORT,
  idleTimeout: 255,
  fetch: router,
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

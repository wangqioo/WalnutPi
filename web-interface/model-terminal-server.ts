import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createScreenEvidenceLedger } from "./screen-evidence-ledger.ts";
import { createSshLocalAgentAdapter, createSshScreenDeviceSurface } from "./screen-delivery-adapters/ssh-local-agent.ts";
import { createScreenWorkspaceSyncWorkflow } from "./screen-workspace-sync-workflow.ts";
import { createWebSessionLedger } from "./web-session-ledger.ts";
import { createWebMetricsLedger } from "./web-metrics-ledger.ts";
import { createWalnutRemoteAdapter } from "./walnut-remote-adapter.ts";
import { createScreenWorkspaceStore, workspaceErrorResponse } from "./screen-workspace-store.ts";
import { actionsForExecutor, loadActionPolicyManifest } from "./action-policy.ts";
import { createDeviceActionsApi } from "./device-actions-api.ts";
import { createAgentEventBus } from "./agent-event-bus.ts";
import { createAgentTurnEventLedger } from "./agent-turn-event-ledger.ts";
import { createAgentTurnLedger } from "./agent-turn-ledger.ts";
import { createAgentPlatformTurnRoute } from "./agent-platform-turn-route.ts";
import { createActionCommandBindings } from "./action-command-bindings.ts";
import { createProjectMemoryApi } from "./project-memory-api.ts";
import { createScreenDiagnosticsApi } from "./screen-diagnostics-api.ts";
import { createScreenWorkspaceApi } from "./screen-workspace-api.ts";
import { createSshWidgetAppDeviceSurface, createWidgetAppDeviceAdapter } from "./widget-app-device-adapter.ts";
import { createLvglRuntimePreviewRenderer } from "./lvgl-runtime-preview-renderer.ts";
import { createScreenCommandRunner } from "./screen-command-runner.ts";
import { createWalnutMastraAgentApi } from "./mastra-agent-api.ts";
import { createStaticUiHost } from "./static-ui-host.ts";
import { createProductGatewayApp, createProductGatewayFetch } from "./gateway/mcp-server.ts";
import { createMcpAuthContext } from "./gateway/auth-context.ts";
import { createGatewayToolCatalog } from "./gateway/tool-catalog.ts";
import { handleWalnutMcpRequest } from "./platform/mcp/server.ts";
import { createMastraAgentTurnWorkflowDispatcher } from "./platform/mastra/agent-turn-workflows.ts";
import { createOpaEnforcer } from "./gateway/opa-enforcer.ts";
import { createToolDispatcher } from "./gateway/tool-dispatcher.ts";
import { createGatewayAuditLedger } from "./gateway/audit-ledger.ts";
import { createOpaPolicyBoundary } from "./platform/policy/opa-boundary.ts";
import { getAiModelConfig } from "./platform/config/platform-config.ts";
import {
  getWalnutObservabilityStatus,
  readWalnutLangfuseReceipt,
  startWalnutObservability,
} from "./platform/observability/tracing.ts";
import { CLASSIFIER_INTENTS, createWalnutIntentClassifier } from "./intent-classifier.ts";
import { compactRetrievalForPrompt } from "./walnut-retrieval.ts";
import { createCuratedRetrievalStore } from "./platform/memory/curated-retrieval-store.ts";
import { appendScreenPlaylistItem, writeDefaultScreenPlaylist } from "../scripts/screen-workspace-pipeline.ts";
import { stableStringify } from "../scripts/screen-workspace-vocabulary.ts";
import { createRuntimeAssetRenderer, createTerminalPrintRenderer, createWallpaperRenderer, createWidgetAppRenderer } from "./screen-renderers/index.ts";
import {
  ACTION_OUTPUT_LIMIT,
  ACTION_POLICY_MANIFEST_PATH,
  AI_CONTEXT_LIMIT,
  AI_CONTEXT_TEXT_LIMIT,
  BASE_DIR,
  CAPTURE_OUTPUT_LIMIT,
  HOST,
  MEMORY_FIELDS,
  MODEL_FILE,
  PORT,
  PROJECT_ROOT,
  REMOTE_BUILD_USER,
  REMOTE_PROJECT_ROOT,
  RETRIEVAL_RESULT_LIMIT,
  SCREEN_FRAME_TICKET_TTL_MS,
  SCREEN_LVGL_PREVIEW_OUTPUT_DIR,
  SCREEN_RECORDS_DIR,
  SCREEN_RECORD_LIMIT,
  SCREEN_SOURCE_IMPORT_MAX_BYTES,
  SCREEN_WORKSPACE_ROOT,
  SSH_HOST,
  SSH_PASSWORD,
  SSH_USER,
  WALNUT_AI_MEMORY_FILE,
  WALNUT_CLI_SOURCE_PATH,
  WEB_METRICS_PATH,
  WEB_SESSION_EVENT_LIMIT,
} from "./config.ts";

const WEB_CONFIG = {
  ACTION_OUTPUT_LIMIT,
  ACTION_POLICY_MANIFEST_PATH,
  AI_CONTEXT_LIMIT,
  AI_CONTEXT_TEXT_LIMIT,
  BASE_DIR,
  CAPTURE_OUTPUT_LIMIT,
  HOST,
  MEMORY_FIELDS,
  MODEL_FILE,
  PORT,
  PROJECT_ROOT,
  REMOTE_BUILD_USER,
  REMOTE_PROJECT_ROOT,
  RETRIEVAL_RESULT_LIMIT,
  SCREEN_FRAME_TICKET_TTL_MS,
  SCREEN_LVGL_PREVIEW_OUTPUT_DIR,
  SCREEN_RECORDS_DIR,
  SCREEN_RECORD_LIMIT,
  SCREEN_SOURCE_IMPORT_MAX_BYTES,
  SCREEN_WORKSPACE_ROOT,
  SSH_HOST,
  SSH_PASSWORD,
  SSH_USER,
  WALNUT_AI_MEMORY_FILE,
  WALNUT_CLI_SOURCE_PATH,
  WEB_METRICS_PATH,
  WEB_SESSION_EVENT_LIMIT,
};
const walnutObservability = startWalnutObservability();
type JsonObject = Record<string, any>;
const LOCAL_MCP_ENDPOINT = `http://${HOST}:${PORT}/mcp`;
const ACTION_POLICY_MANIFEST = await loadActionPolicyManifest(ACTION_POLICY_MANIFEST_PATH);
const WEB_ACTIONS = actionsForExecutor(ACTION_POLICY_MANIFEST, "web");
const aiApiKey = getAiModelConfig().apiKey;
const screenFrameTickets = new Map();
const webSessionLedger = createWebSessionLedger({
  eventLimit: WEB_SESSION_EVENT_LIMIT,
});
const webMetricsLedger = createWebMetricsLedger({
  metricsPath: WEB_METRICS_PATH,
  limit: Number(process.env.WALNUT_WEB_METRICS_LIMIT || 200),
});
const agentTurnLedger = createAgentTurnLedger({
  limit: Number(process.env.WALNUT_AGENT_TURN_LIMIT || 100),
});
const agentEventBus = createAgentEventBus();
const agentTurnEventLedger = createAgentTurnEventLedger({
  eventBus: agentEventBus,
  limit: Number(process.env.WALNUT_AGENT_TURN_EVENT_LIMIT || 500),
});
const gatewayAuditLedger = createGatewayAuditLedger();
const curatedRetrievalStore = createCuratedRetrievalStore({
  resultLimit: RETRIEVAL_RESULT_LIMIT,
});
const files = new Map([
  [`/${MODEL_FILE}`, MODEL_FILE],
]);

const staticUiHost = createStaticUiHost({ baseDir: BASE_DIR, files });

function json(data, status = 200) {
  return Response.json(data, { status });
}

function sseFrame(event) {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
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

async function retrieveWalnutContextView(query) {
  return curatedRetrievalStore.retrieve(query, {
    resultLimit: RETRIEVAL_RESULT_LIMIT,
  });
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
    compactRetrievalForPrompt(projectMemory?.retrieval, { clip: clippedText }),
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
      "Open the Next/Tailwind console Screen tab and refresh the current playlist.",
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

const walnutMastraAgentApi = createWalnutMastraAgentApi();

const intentClassifier = createWalnutIntentClassifier({
  aiEnabled: Boolean(aiApiKey),
  classifyWithModel: async (text, telemetry) => walnutMastraAgentApi.classifyIntent(text, telemetry),
  async recordModelError(error, text, telemetry = {}) {
    await webMetricsLedger.append({
      kind: "web.intent.classify",
      operation: "intent.classify.model",
      ok: false,
      sessionId: telemetry.sessionId,
      turnId: telemetry.turnId,
      inputChars: String(text || "").length,
      error: error.message,
    });
  },
});

async function classifyAgentIntent(text: string, {
  traceId = randomUUID(),
  startedAt = Date.now(),
  sessionId = null,
  turnId = null,
  scenario = null,
  requirements = null,
}: JsonObject = {}) {
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
    const result = await intentClassifier.classifyIntent(input, { sessionId, turnId, scenario, requirements });
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
  const result = await classifyAgentIntent(body.text, {
    traceId,
    startedAt,
    scenario: body.scenario || null,
    requirements: body.requirements || null,
  });
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
  } catch (error) {
    result.recordWarning = `screen sync record was not saved: ${error.message}`;
  }
  return json(result, status);
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
const wallpaperRenderer = createWallpaperRenderer();
const runtimeAssetRenderer = createRuntimeAssetRenderer();
const terminalPrintRenderer = createTerminalPrintRenderer();
const widgetAppRenderer = createWidgetAppRenderer({
  appsRoot: path.join(SCREEN_WORKSPACE_ROOT, "apps"),
  runtimeRoot: path.join(SCREEN_WORKSPACE_ROOT, "widget-runtime"),
});
const screenDeviceSurface = createSshScreenDeviceSurface({
  remoteProjectRoot: REMOTE_PROJECT_ROOT,
  remoteBuildUser: REMOTE_BUILD_USER,
  runRemote,
  runRemoteRaw,
  runRemoteScript,
  runRemoteRawScript,
  runRemoteWithInput,
  runRemoteRawWithInput,
  shellQuote,
  remoteBuildShell,
});
const widgetAppDeviceSurface = createSshWidgetAppDeviceSurface({
  remoteProjectRoot: REMOTE_PROJECT_ROOT,
  remoteBuildUser: REMOTE_BUILD_USER,
  sshHost: SSH_HOST,
  sshUser: SSH_USER,
  runRemoteRaw,
  runRemoteRawWithInput,
});

const screenDeliveryAdapters = new Map([
  [
    "ssh-local-agent",
    createSshLocalAgentAdapter({
      localProjectRoot: PROJECT_ROOT,
      sshHost: SSH_HOST,
      sshUser: SSH_USER,
      deviceSurface: screenDeviceSurface,
      sha256,
      stableStringify,
      validSha256,
      limitedOutput,
      frameUrl,
      runtimeAssetRenderer,
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

const actionCommandBindings = createActionCommandBindings({
  manifestPath: ACTION_POLICY_MANIFEST_PATH,
  shellQuote,
  aiTimeoutSeconds: Number(process.env.WALNUT_AI_TIMEOUT_SECONDS || 15),
});
const opaBoundary = createOpaPolicyBoundary({
  manifest: ACTION_POLICY_MANIFEST,
  policyPath: path.join(BASE_DIR, "platform", "policy", "opa-policy.rego"),
});
const opaEnforcer = createOpaEnforcer({ policyManifest: ACTION_POLICY_MANIFEST, opaBoundary });

const deviceActionsApi = createDeviceActionsApi({
  policyManifest: ACTION_POLICY_MANIFEST,
  policyActions: WEB_ACTIONS,
  actionBindings: actionCommandBindings,
  opaEnforcer,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
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
  retrieveWalnutContextView,
  memoryFile: WALNUT_AI_MEMORY_FILE,
  eventLimit: WEB_SESSION_EVENT_LIMIT,
  readJsonRequest,
  json,
});

function frameUrl(buildId) {
  return `/api/screen/frame/${encodeURIComponent(buildId)}`;
}

const lvglRuntimePreviewRenderer = createLvglRuntimePreviewRenderer({
  projectRoot: PROJECT_ROOT,
  screenWorkspaceRoot: SCREEN_WORKSPACE_ROOT,
  previewOutputDir: SCREEN_LVGL_PREVIEW_OUTPUT_DIR,
  runLocal,
  findWindowsCommand,
});

const screenWorkspaceApi = createScreenWorkspaceApi({
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow,
  readJsonRequest,
  json,
  workspaceErrorResponse,
  webMetricsLedger,
  wallpaperRenderer,
  terminalPrintRenderer,
  widgetAppRenderer,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
  runtimeAssetRenderer,
  persistScreenSyncResult,
  runRemote,
  lvglRuntimePreviewRenderer,
  sha256,
  projectRoot: PROJECT_ROOT,
  screenWorkspaceRoot: SCREEN_WORKSPACE_ROOT,
  screenSourceImportMaxBytes: SCREEN_SOURCE_IMPORT_MAX_BYTES,
  generateWidgetCatalog,
});

const screenCommandRunner = createScreenCommandRunner({
  projectRoot: PROJECT_ROOT,
  workspaceRoot: SCREEN_WORKSPACE_ROOT,
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow,
  wallpaperRenderer,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
  walnutRemote,
  validSha256,
  sha256,
});
const widgetAppDeviceAdapter = createWidgetAppDeviceAdapter({
  screenWorkspaceRoot: SCREEN_WORKSPACE_ROOT,
  deviceSurface: widgetAppDeviceSurface,
});

const toolDispatcher = createToolDispatcher({
  actionDispatcher: deviceActionsApi,
  screenCommandRunner,
  widgetAppDeviceAdapter,
  turnLedger: agentTurnLedger,
  metricsLedger: webMetricsLedger,
  policyManifest: ACTION_POLICY_MANIFEST,
  opaEnforcer,
  auditLedger: gatewayAuditLedger,
});

const agentPlatform = createAgentPlatformTurnRoute({
  classifyIntent: classifyAgentIntent,
  turnLedger: agentTurnLedger,
  eventLedger: agentTurnEventLedger,
  metricsLedger: webMetricsLedger,
  mastraWorkflows: {
    async forRequest(req: Request) {
      const authContext = await createMcpAuthContext(req, {
        deviceProfile: "device",
        target: `${SSH_USER}@${SSH_HOST}`,
      });
      return {
        dispatch: createMastraAgentTurnWorkflowDispatcher({
          endpoint: LOCAL_MCP_ENDPOINT,
          fetchImpl: ((url, init) => handleWalnutMcpRequest(new Request(url, init), {
            auditLedger: gatewayAuditLedger,
            authContext,
            toolCatalog: createGatewayToolCatalog({ policyActions: ACTION_POLICY_MANIFEST.actions || {} }),
            toolDispatcher,
          })) as any,
          id: "agent-turn-workflow",
        }),
      };
    },
  },
  readJsonRequest,
  json,
});
(agentPlatform as any).toolDispatcher = () => toolDispatcher;

async function generateWidgetCatalog({ prompt, sessionId = null, turnId = null }) {
  if (!aiApiKey) return null;
  return walnutMastraAgentApi.generateWidgetCatalog(prompt, { sessionId, turnId });
}

const productGateway = createProductGatewayApp({
  json,
  previewOnly,
  previewOnlyJson,
  config: WEB_CONFIG,
  path,
  deviceActionsApi,
  actionPolicyManifest: ACTION_POLICY_MANIFEST,
  projectMemoryApi,
  webMetricsLedger,
  agentPlatform,
  handleAgentChat: (req) => walnutMastraAgentApi.handleChat(req),
  handleAgentEvents,
  readJsonRequest,
  screenWorkspaceApi,
  screenDiagnosticsApi,
  auditLedger: gatewayAuditLedger,
  observabilityStatus: () => getWalnutObservabilityStatus(),
  langfuseReceipt: (traceId) => readWalnutLangfuseReceipt({ traceId }),
  staticUiHost,
});
const gatewayFetch = createProductGatewayFetch(productGateway);

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 255,
  fetch: gatewayFetch,
});

console.log(`Serving model terminal at http://${server.hostname}:${server.port}/`);
console.log(`Target: ${SSH_USER}@${SSH_HOST}`);
console.log(`Remote project root: ${REMOTE_PROJECT_ROOT}`);
console.log(`Observability: ${walnutObservability.started ? "started" : "not-started"}; Langfuse exporter: ${walnutObservability.exporterEnabled ? "enabled" : "disabled"}`);

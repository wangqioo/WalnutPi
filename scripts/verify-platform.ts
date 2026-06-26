import { randomUUID } from "node:crypto";
import path from "node:path";
import { createGatewayToolCatalog } from "../web-interface/gateway/tool-catalog.ts";
import { createOpaPolicyBoundary } from "../web-interface/platform/policy/opa-boundary.ts";
import { createWalnutMcpServer } from "../web-interface/platform/mcp/server.ts";
import { createWalnutMastraMcpClient } from "../web-interface/platform/mastra/mcp-client.ts";
import {
  MASTRA_AGENT_TURN_CAPABILITIES,
  createMastraAgentTurnWorkflowDispatcher,
  runMastraAgentTurnWorkflow,
  type MastraAgentTurnCapability,
} from "../web-interface/platform/mastra/agent-turn-workflows.ts";
import { getWalnutMastraRegistry } from "../web-interface/platform/mastra/runtime.ts";
import { runAgentPlatformTurn } from "../web-interface/agent-platform-turn-route.ts";
import { createWalnutAiSdkProvider } from "../web-interface/platform/ai-sdk/server.ts";
import { createWalnutAuth } from "../web-interface/platform/auth/auth.ts";
import { walnutInngest, walnutInngestFunctions } from "../web-interface/platform/inngest/client.ts";
import { createWalnutLangfuseClient, createWalnutOpenTelemetrySdk, getWalnutTracer } from "../web-interface/platform/observability/tracing.ts";
import { createWalnutPostgresClient, schema } from "../web-interface/platform/db/client.ts";
import { loadActionPolicyManifest } from "../web-interface/action-policy.ts";
import { createOpaEnforcer } from "../web-interface/gateway/opa-enforcer.ts";
import { handleWalnutMcpRequest } from "../web-interface/platform/mcp/server.ts";
import { createScreenCommandRunner } from "../web-interface/screen-command-runner.ts";
import { createScreenWorkspaceStore } from "../web-interface/screen-workspace-store.ts";
import { createToolDispatcher } from "../web-interface/gateway/tool-dispatcher.ts";
import { getAiModelConfig, getAuthConfig, getDbConfig, getLangfuseConfig } from "../web-interface/platform/config/platform-config.ts";
import { intentTypeToRoute } from "../web-interface/intent-route.ts";

type JsonObject = Record<string, any>;

const projectRoot = path.resolve(import.meta.dir, "..");
const manifestPath = path.join(projectRoot, "action-policy-manifest.json");
const policyPath = path.join(projectRoot, "web-interface", "platform", "policy", "opa-policy.rego");
const screenRoot = path.join(projectRoot, "screen");

const results: JsonObject[] = [];

function record(name: string, result: JsonObject) {
  results.push({ name, ...result });
}

function jsonSummary(value: any) {
  return JSON.stringify(value, null, 2);
}

const manifest = await loadActionPolicyManifest(manifestPath);
const opaBoundary = createOpaPolicyBoundary({ manifest, policyPath });
const opaEnforcer = createOpaEnforcer({ policyManifest: manifest, opaBoundary });
const aiConfig = getAiModelConfig();
const authConfig = getAuthConfig();
const dbConfig = getDbConfig();
const langfuseConfig = getLangfuseConfig();

record("platform.config", {
  ok: Boolean(aiConfig.id && aiConfig.url && authConfig.secret && dbConfig.url),
  aiModel: aiConfig.id,
  aiKeyConfigured: Boolean(aiConfig.apiKey),
  dbUrlConfigured: Boolean(dbConfig.url),
  langfuseConfigured: langfuseConfig.configured,
  authSecretDerived: authConfig.secret.length === 64,
});

try {
  const health = await opaBoundary.health();
  record("opa.version-and-eval", { ok: true, versionLine: health.version.split(/\r?\n/)[0], eval: health.eval });
} catch (error: any) {
  record("opa.version-and-eval", { ok: false, error: error.message });
}

const policyDecision = await opaEnforcer.decideActionAsync({
  actionId: "status",
  executor: "web",
  params: {},
});
record("policy.opa-boundary", {
  ok: policyDecision.allow === true && policyDecision.engine === "opa-cli",
  status: policyDecision.status,
  engine: policyDecision.engine,
});

const toolCatalog = createGatewayToolCatalog({ policyActions: manifest.actions });
const screenWorkspaceStore = createScreenWorkspaceStore({ workspaceRoot: screenRoot });
const screenCommandRunner = createScreenCommandRunner({
  projectRoot,
  workspaceRoot: screenRoot,
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow: null,
  processSourceAssetToScreenOutput: null,
  appendScreenPlaylistItem: null,
  writeDefaultScreenPlaylist: null,
  walnutRemote: null,
});
const turnLedger = {
  async readTurns() {
    return [];
  },
};
const metricsLedger = {
  async report() {
    return { events: [] };
  },
};
const actionDispatcher = {
  async runAction({ action, policyDecision }: JsonObject) {
    return {
      status: 200,
      body: {
        ok: true,
        summary: `${action} reached the policy-gated dispatcher boundary.`,
        output: `${action} boundary reached`,
        evidence: {
          policyDecision: opaEnforcer.publicDecision(policyDecision),
          dispatcherBoundaryReached: true,
          noRawShellExposed: true,
        },
      },
    };
  },
};
const toolDispatcher = createToolDispatcher({
  actionDispatcher,
  screenCommandRunner,
  turnLedger,
  metricsLedger,
  policyManifest: manifest,
  opaEnforcer,
  auditLedger: { async append() {} },
});

const mcpServer = createWalnutMcpServer({ toolCatalog, toolDispatcher });
record("mcp.sdk-server-init", { ok: Boolean(mcpServer) });

const mcpFetch = async (url: string | URL, init?: RequestInit) => {
  const request = new Request(url, init);
  return handleWalnutMcpRequest(request, { toolCatalog, toolDispatcher });
};

const mcpClient = createWalnutMastraMcpClient({
  endpoint: "http://127.0.0.1:4173/mcp",
  fetchImpl: mcpFetch as any,
  id: `verify-${randomUUID()}`,
});
try {
  const tools = await mcpClient.listTools();
  const toolNames = Object.keys(tools).sort();
  const expectedMcpTools = [
    "walnutpi_screen.readPlaylist",
    "walnutpi_diagnostics.recentFailure",
    "walnutpi_memory.sessionSummary",
    "walnutpi_device.status.read",
    "walnutpi_device.network.read",
    "walnutpi_device.snapshot.read",
    "walnutpi_device.i2c.read",
    "walnutpi_device.gpio.read",
    "walnutpi_device.notes.read",
  ];
  record("mastra.mcp-client-list-tools", {
    ok: expectedMcpTools.every((toolName) => toolNames.includes(toolName)),
    toolNames,
  });
  const mcpCallTargets = [
    ["screen.readPlaylist", "walnutpi_screen.readPlaylist", { playlistId: "default" }],
    ["diagnostics.recentFailure", "walnutpi_diagnostics.recentFailure", {}],
    ["memory.sessionSummary", "walnutpi_memory.sessionSummary", {}],
    ["device.status.read", "walnutpi_device.status.read", {}],
    ["device.network.read", "walnutpi_device.network.read", {}],
    ["device.snapshot.read", "walnutpi_device.snapshot.read", {}],
    ["device.i2c.read", "walnutpi_device.i2c.read", {}],
    ["device.gpio.read", "walnutpi_device.gpio.read", {}],
    ["device.notes.read", "walnutpi_device.notes.read", {}],
  ] as const;
  let mcpCallOkCount = 0;
  for (const [capability, mcpToolName, args] of mcpCallTargets) {
    const result = await tools[mcpToolName]?.execute?.(args as any, {} as any);
    const ok = Boolean(result?.ok);
    if (ok) mcpCallOkCount += 1;
    record(`mcp.tools-call-${capability}`, {
      ok,
      family: result?.family || null,
      operation: result?.result?.operation || null,
      policyEngine: result?.evidence?.policyDecision?.engine || null,
      boundaryReached: Boolean(result?.evidence?.dispatcherBoundaryReached || result?.result?.command?.kind === capability),
    });
  }
  record("mcp.tools-call-read-only-count", {
    ok: mcpCallOkCount >= 5,
    passed: mcpCallOkCount,
    required: 5,
  });
  const deviceStatus = await runMastraAgentTurnWorkflow({
    capability: "device.status.read",
    endpoint: "http://127.0.0.1:4173/mcp",
    fetchImpl: mcpFetch as any,
    id: `verify-status-${randomUUID()}`,
    sessionId: "verify-platform",
    turnId: "verify-platform-status",
  });
  record("mastra.workflow-device-status-read", {
    ok: Boolean(deviceStatus.ok),
    family: deviceStatus.family,
    actionId: deviceStatus.result?.actionId || deviceStatus.result?.operation || null,
    policyEngine: deviceStatus.evidence?.policyDecision?.engine || null,
  });
} catch (error: any) {
  record("mastra.mcp-client-list-tools", { ok: false, error: error.message });
} finally {
  await mcpClient.disconnect();
}

const mastraDispatch = createMastraAgentTurnWorkflowDispatcher({
      endpoint: "http://127.0.0.1:4173/mcp",
      fetchImpl: mcpFetch as any,
      id: `verify-turn-${randomUUID()}`,
});

const turnCapabilities = [
  "device.status.read",
  "screen.readPlaylist",
  "device.network.read",
  "device.snapshot.read",
  "device.i2c.read",
  "device.gpio.read",
  "memory.sessionSummary",
] satisfies MastraAgentTurnCapability[];
let platformTurnOkCount = 0;
for (const capability of turnCapabilities) {
  const platformTurn = await runAgentPlatformTurn({
    body: { text: capability, sessionId: "verify-platform", playlistId: "default" },
    classifyIntent: async () => ({
      ok: true,
      status: 200,
      classification: intentTypeToRoute(capability, {
        subject: capability,
        delivery: "none",
        confidence: 1,
        source: "structured",
      }),
    }),
    turnLedger: { async appendTurn() {} },
    eventLedger: { async appendEvent() {} },
    metricsLedger,
    mastraWorkflows: { dispatch: mastraDispatch },
  });
  const expectedOperation = `mastra.mcp.${capability}`;
  const ok = platformTurn.turn?.ok === true
    && platformTurn.turn?.toolResults?.some((item: JsonObject) => item.diagnostics?.operation === expectedOperation);
  if (ok) platformTurnOkCount += 1;
  record(`agent-turn-${capability}-mastra-path`, {
    ok,
    status: platformTurn.status,
    operation: expectedOperation,
    userSummary: platformTurn.turn?.userSummary || null,
  });
}
record("agent-turn-structured-mastra-count", {
  ok: platformTurnOkCount >= 5,
  passed: platformTurnOkCount,
  required: 5,
  registeredCapabilities: [...MASTRA_AGENT_TURN_CAPABILITIES],
});

try {
  const registry = getWalnutMastraRegistry();
  record("mastra.registry", { ok: Boolean(registry.getAgentById("router")) });
} catch (error: any) {
  record("mastra.registry", { ok: false, error: error.message });
}

try {
  createWalnutAiSdkProvider();
  record("ai-sdk.provider", { ok: true });
} catch (error: any) {
  record("ai-sdk.provider", { ok: false, error: error.message });
}

try {
  const auth = createWalnutAuth();
  record("auth.better-auth", { ok: Boolean(auth.api) });
} catch (error: any) {
  record("auth.better-auth", { ok: false, error: error.message });
}

record("inngest.client-functions", {
  ok: Boolean(walnutInngest) && walnutInngestFunctions.length > 0,
  functionCount: walnutInngestFunctions.length,
});

try {
  createWalnutOpenTelemetrySdk({ enableLangfuse: false });
  const tracer = getWalnutTracer();
  record("observability.otel", { ok: Boolean(tracer) });
} catch (error: any) {
  record("observability.otel", { ok: false, error: error.message });
}

const langfuse = createWalnutLangfuseClient();
record("observability.langfuse", {
  ok: langfuse.ok || langfuse.skipped,
  skipped: langfuse.skipped,
  reason: langfuse.reason || null,
});

const db = createWalnutPostgresClient();
record("db.drizzle-postgres", {
  ok: db.ok || db.skipped,
  skipped: db.skipped,
  reason: db.reason || null,
  tables: Object.keys(schema),
});
if (db.sql) await db.sql.end({ timeout: 1 });

const failed = results.filter((item) => !item.ok);
console.log(jsonSummary({
  ok: failed.length === 0,
  results,
}));

if (failed.length) {
  process.exitCode = 1;
}

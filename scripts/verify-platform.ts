import { randomUUID } from "node:crypto";
import path from "node:path";
import { createGatewayToolCatalog } from "../web-interface/gateway/tool-catalog.ts";
import { createOpaPolicyBoundary } from "../web-interface/platform/policy/opa-boundary.ts";
import { createWalnutMcpServer } from "../web-interface/platform/mcp/server.ts";
import { createWalnutMastraMcpClient } from "../web-interface/platform/mastra/mcp-client.ts";
import { runDeviceStatusReadWorkflow } from "../web-interface/platform/mastra/device-status-workflow.ts";
import { getWalnutMastraRegistry } from "../web-interface/platform/mastra/runtime.ts";
import { runPlatformTurn } from "../web-interface/agent-platform-runtime.ts";
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
import { getAiModelConfig, getAuthConfig, getDbConfig, getLangfuseConfig } from "../web-interface/platform/config/platform-config.ts";

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
const toolDispatcher = {
  async callTool(toolName: string, params: JsonObject, turn: JsonObject) {
    if (toolName === "screen.readPlaylist") {
      return screenCommandRunner.run({ kind: "screen.readPlaylist", playlistId: params.playlistId || "default" });
    }
    if (toolName === "diagnostics.recentFailure") {
      const metricsReport = await metricsLedger.report();
      return {
        ok: true,
        summary: "No recent failure found in local ledgers.",
        result: { operation: "diagnostics.recent_failure" },
        evidence: {
          diagnosticSummary: "No recent failure found in local ledgers.",
          traceIdOrBuildId: "not-found",
          failedOperation: "none-found",
          errorMessage: "none",
          metricsEventsRead: metricsReport.events.length,
        },
      };
    }
    if (toolName === "device.status.read") {
      const decision = await opaEnforcer.decideActionAsync({ actionId: "status", executor: "web", params });
      if (!decision.allow) {
        return {
          ok: false,
          summary: "Device status read was not allowed by policy.",
          evidence: { policyDecision: opaEnforcer.publicDecision(decision), noCommandExecution: true },
        };
      }
      return {
        ok: true,
        summary: "Device status read reached the policy-gated dispatcher boundary.",
        result: { operation: "device.action", actionId: "status", status: "boundary-only" },
        evidence: { policyDecision: opaEnforcer.publicDecision(decision), noRawShellExposed: true },
      };
    }
    return { ok: false, summary: `Unsupported verification tool ${toolName}` };
  },
};

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
  record("mastra.mcp-client-list-tools", {
    ok: toolNames.length >= 3 && toolNames.includes("walnutpi_screen.readPlaylist"),
    toolNames,
  });
  const screenRead = await tools["walnutpi_screen.readPlaylist"]?.execute?.({ playlistId: "default" } as any, {} as any);
  record("mcp.tools-call-screen-readPlaylist", {
    ok: Boolean(screenRead?.ok),
    playlistHash: screenRead?.result?.playlistHash || screenRead?.evidence?.playlistHash || null,
    dispatcherReached: Boolean(screenRead?.result?.command?.kind === "screen.readPlaylist"),
  });
  const deviceStatus = await runDeviceStatusReadWorkflow({
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

const platformTurn = await runPlatformTurn({
  body: { text: "status", sessionId: "verify-platform" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      route: "device.action",
      action: "read",
      subject: "status",
      delivery: "none",
      riskHint: "read",
      exposure: ["internal", "agent_action"],
      actionPolicyId: null,
      parameters: {},
      confidence: 1,
      source: "structured",
      intent: "device.status.read",
    },
  }),
  toolDispatcher,
  turnLedger: { async appendTurn() {} },
  eventLedger: { async appendEvent() {} },
  metricsLedger,
  mastraWorkflows: {
    deviceStatusRead: (args: JsonObject) => runDeviceStatusReadWorkflow({
      endpoint: "http://127.0.0.1:4173/mcp",
      fetchImpl: mcpFetch as any,
      id: `verify-turn-${randomUUID()}`,
      ...args,
    }),
  },
});
record("agent-turn-device-status-mastra-path", {
  ok: platformTurn.turn?.ok === true
    && platformTurn.turn?.toolResults?.some((item: JsonObject) => item.diagnostics?.operation === "mastra.mcp.device.status.read"),
  status: platformTurn.status,
  userSummary: platformTurn.turn?.userSummary || null,
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

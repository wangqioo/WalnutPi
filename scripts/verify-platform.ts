import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { createLocalOwnerAuthContext } from "../web-interface/platform/auth/auth.ts";
import { createScreenCommandRunner } from "../web-interface/screen-command-runner.ts";
import { createScreenWorkspaceStore } from "../web-interface/screen-workspace-store.ts";
import { createToolDispatcher } from "../web-interface/gateway/tool-dispatcher.ts";
import { getAiModelConfig, getAuthConfig, getDbConfig, getLangfuseConfig } from "../web-interface/platform/config/platform-config.ts";
import { processSourceAssetToScreenOutput, writeDefaultScreenPlaylist } from "./screen-workspace-pipeline.ts";

type JsonObject = Record<string, any>;

const projectRoot = path.resolve(import.meta.dir, "..");
const manifestPath = path.join(projectRoot, "action-policy-manifest.json");
const policyPath = path.join(projectRoot, "web-interface", "platform", "policy", "opa-policy.rego");
const screenRoot = await createVerifyScreenWorkspace(projectRoot);

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

const degradedOpaBoundary = createOpaPolicyBoundary({
  manifest,
  opaPath: "walnutpi-missing-opa-for-verify",
  policyPath,
});
const degradedReadDecision = await degradedOpaBoundary.decideAction({
  actionId: "status",
  executor: "web",
  params: {},
});
const degradedWriteDecision = await degradedOpaBoundary.decideAction({
  actionId: "note",
  executor: "web",
  params: { text: "verify-platform fail closed" },
});
record("policy.opa-unavailable-fail-closed", {
  ok: degradedReadDecision.allow === true
    && degradedWriteDecision.allow === false
    && degradedWriteDecision.status === "refused"
    && degradedWriteDecision.evidence?.noCommandExecution === true,
  readStatus: degradedReadDecision.status,
  writeStatus: degradedWriteDecision.status,
  writeReason: degradedWriteDecision.reason,
});

const toolCatalog = createGatewayToolCatalog({ policyActions: manifest.actions });
const screenWorkspaceStore = createScreenWorkspaceStore({ workspaceRoot: screenRoot });
const screenCommandRunner = createScreenCommandRunner({
  projectRoot,
  workspaceRoot: screenRoot,
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow: {
    async run({ requestJson, mode }: JsonObject) {
      const request = await requestJson();
      return {
        status: mode === "preview" ? 200 : 400,
        result: {
          ok: mode === "preview",
          summary: mode === "preview"
            ? "Preview sync reached the Screen Command DSL no-write boundary."
            : "Remote sync requires the real device profile.",
          playlistHash: request.playlistHash,
          evidence: {
            previewNoWrite: mode === "preview",
            dispatcherBoundaryReached: true,
          },
        },
      };
    },
  },
  processSourceAssetToScreenOutput,
  appendScreenPlaylistItem: null,
  writeDefaultScreenPlaylist,
  walnutRemote: {
    async capturePngBase64() {
      const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
      const pngBytes = Buffer.from(pngBase64, "base64");
      return {
        ok: true,
        code: 0,
        output: JSON.stringify({
          width: 1,
          height: 1,
          isBlank: false,
          pngSha256: createHash("sha256").update(pngBytes).digest("hex"),
          rawSha256: createHash("sha256").update("verify-platform-capture-boundary").digest("hex"),
          pngBase64,
        }),
      };
    },
  },
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
const memoryWrites: JsonObject[] = [];
const memoryStore = {
  async capturePreferenceCandidate({ text, sessionId, turnId }: JsonObject) {
    const record = {
      kind: "memory.candidate",
      candidateText: String(text || "").trim(),
      sourceSessionId: sessionId || null,
      sourceTurnId: turnId || null,
      categoryKey: "preferences.screen_generation",
      persisted: true,
    };
    memoryWrites.push(record);
    return {
      ok: true,
      writeState: "candidate",
      categoryKey: record.categoryKey,
      candidateText: record.candidateText,
      persisted: true,
      skipped: false,
      reason: null,
    };
  },
  async recordSensitiveSkip({ text, sessionId, turnId }: JsonObject) {
    const normalized = String(text || "").trim();
    const record = {
      kind: "memory.sensitive_skip",
      textHash: `sha256:${createHash("sha256").update(normalized).digest("hex")}`,
      textLength: normalized.length,
      sourceSessionId: sessionId || null,
      sourceTurnId: turnId || null,
      persisted: true,
    };
    memoryWrites.push(record);
    return {
      ok: true,
      reason: "sensitive-temporary",
      textHash: record.textHash,
      textLength: record.textLength,
      persisted: true,
      skipped: false,
      writeReason: null,
    };
  },
  async summarizeSession({ sessionId, turnLedger, inputText }: JsonObject) {
    const previousTurns = await turnLedger.readTurns({ sessionId, count: 20 });
    const lines = previousTurns
      .filter((item: JsonObject) => item.input?.text && item.input.text !== inputText)
      .slice(-8)
      .map((item: JsonObject) => `- ${item.input.text} -> ${item.status}`);
    return {
      summary: lines.length ? lines.join("\n") : "No prior turns in this session.",
      eventsReadCount: previousTurns.length,
      source: "turn-ledger",
    };
  },
};
const actionDispatcher = {
  async runAction({ action, policyDecision }: JsonObject) {
    return {
      status: 200,
      body: {
        ok: true,
        summary: `${action} reached the policy-gated dispatcher boundary.`,
        command: `sudo -n walnut ${action}`,
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
  auditLedger: {
    async append(record: JsonObject) {
      auditEvents.push(record);
    },
  },
  memoryStore,
});
const auditEvents: JsonObject[] = [];

const mcpServer = createWalnutMcpServer({ toolCatalog, toolDispatcher });
record("mcp.sdk-server-init", { ok: Boolean(mcpServer) });

const mcpFetch = async (url: string | URL, init?: RequestInit) => {
  const request = new Request(url, init);
  return handleWalnutMcpRequest(request, {
    authContext: {
      subject: createLocalOwnerAuthContext(),
      environment: {
        previewOnly: false,
        deviceProfile: "device",
        target: "verify@walnutpi",
      },
    },
    toolCatalog,
    toolDispatcher,
    auditLedger: {
      async append(record: JsonObject) {
        auditEvents.push(record);
      },
    },
  });
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
    "walnutpi_screen.captureFrame",
    "walnutpi_screen.syncPlaylist",
    "walnutpi_screen.renderWallpaper",
    "walnutpi_screen.writePlaylist",
    "walnutpi_diagnostics.recentFailure",
    "walnutpi_memory.sessionSummary",
    "walnutpi_device.status.read",
    "walnutpi_device.network.read",
    "walnutpi_device.snapshot.read",
    "walnutpi_device.i2c.read",
    "walnutpi_device.gpio.read",
    "walnutpi_device.notes.read",
    "walnutpi_device.note.write",
    "walnutpi_memory.preference",
    "walnutpi_memory.sensitiveSkip",
  ];
  record("mastra.mcp-client-list-tools", {
    ok: expectedMcpTools.every((toolName) => toolNames.includes(toolName)),
    toolNames,
  });
  const mcpCallTargets = [
    ["screen.readPlaylist", "walnutpi_screen.readPlaylist", { playlistId: "default" }],
    ["screen.captureFrame", "walnutpi_screen.captureFrame", {}],
    ["screen.syncPlaylist", "walnutpi_screen.syncPlaylist", { mode: "preview", evidenceMode: "fast" }],
    ["screen.renderWallpaper", "walnutpi_screen.renderWallpaper", {
      source: {
        kind: "local",
        path: path.join(projectRoot, "screen", "outputs", "seed-terminal-ops.png"),
        sourceId: "verify-platform-source",
        mediaType: "image/png",
        license: "project-local",
      },
      screenId: "verify-platform-render",
      preset: "fit-cover:480x320",
      outputType: "static",
      title: "Verify Platform Render",
    }],
    ["screen.writePlaylist", "walnutpi_screen.writePlaylist", {
      playlistId: "verify-platform",
      manifestId: "verify-platform-render",
      mode: "replace",
      durationMs: 8000,
      loop: true,
    }],
    ["diagnostics.recentFailure", "walnutpi_diagnostics.recentFailure", {}],
    ["memory.sessionSummary", "walnutpi_memory.sessionSummary", {}],
    ["device.status.read", "walnutpi_device.status.read", {}],
    ["device.network.read", "walnutpi_device.network.read", {}],
    ["device.snapshot.read", "walnutpi_device.snapshot.read", {}],
    ["device.i2c.read", "walnutpi_device.i2c.read", {}],
    ["device.gpio.read", "walnutpi_device.gpio.read", {}],
    ["device.notes.read", "walnutpi_device.notes.read", {}],
    ["device.note.write", "walnutpi_device.note.write", { text: "verify-platform note boundary" }],
    ["memory.preference", "walnutpi_memory.preference", { text: "prefer concise device evidence" }],
    ["memory.sensitiveSkip", "walnutpi_memory.sensitiveSkip", { text: "temporary secret-like value" }],
  ] as const;
  let mcpCallOkCount = 0;
  const mcpMemoryResults: Record<string, JsonObject> = {};
  for (const [capability, mcpToolName, args] of mcpCallTargets) {
    const result = await tools[mcpToolName]?.execute?.(args as any, {} as any);
    if (capability.startsWith("memory.")) mcpMemoryResults[capability] = result;
    const commandExposure = findRawCommandExposure(result);
    const ok = Boolean(result?.ok);
    if (ok) mcpCallOkCount += 1;
    record(`mcp.tools-call-${capability}`, {
      ok: ok && !commandExposure,
      family: result?.family || null,
      operation: result?.result?.operation || null,
      policyEngine: result?.evidence?.policyDecision?.engine || null,
      boundaryReached: Boolean(result?.evidence?.dispatcherBoundaryReached || result?.result?.command?.kind === capability),
      rawCommandExposure: commandExposure,
    });
  }
  record("mcp.tools-call-platform-count", {
    ok: mcpCallOkCount >= 5,
    passed: mcpCallOkCount,
    required: 5,
  });
  const sensitiveSkipTextExposure = JSON.stringify(mcpMemoryResults["memory.sensitiveSkip"] || {}).includes("temporary secret-like value");
  record("memory.product-state-tools", {
    ok: memoryWrites.some((item) => item.kind === "memory.candidate" && item.persisted === true)
      && memoryWrites.some((item) => item.kind === "memory.sensitive_skip" && item.persisted === true)
      && mcpMemoryResults["memory.preference"]?.evidence?.dbProductState?.boundaryReached === true
      && mcpMemoryResults["memory.sensitiveSkip"]?.evidence?.memorySkipEvidence?.textHash?.startsWith("sha256:")
      && !sensitiveSkipTextExposure,
    candidateWrites: memoryWrites.filter((item) => item.kind === "memory.candidate").length,
    sensitiveSkipWrites: memoryWrites.filter((item) => item.kind === "memory.sensitive_skip").length,
    sensitiveSkipTextExposure,
  });
  const deviceStatus = await runMastraAgentTurnWorkflow({
    capability: "device.status.read",
    endpoint: "http://127.0.0.1:4173/mcp",
    fetchImpl: mcpFetch as any,
    id: `verify-status-${randomUUID()}`,
    sessionId: "verify-platform",
    turnId: "verify-platform-status",
  });
  const deviceStatusCommandExposure = findRawCommandExposure(deviceStatus);
  record("mastra.workflow-device-status-read", {
    ok: Boolean(deviceStatus.ok) && !deviceStatusCommandExposure,
    family: deviceStatus.family,
    actionId: deviceStatus.result?.actionId || deviceStatus.result?.operation || null,
    policyEngine: deviceStatus.evidence?.policyDecision?.engine || null,
    rawCommandExposure: deviceStatusCommandExposure,
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
  "screen.captureFrame",
  "screen.syncPlaylist",
  "device.network.read",
  "device.snapshot.read",
  "device.i2c.read",
  "device.gpio.read",
  "memory.sessionSummary",
  "memory.preference",
  "memory.sensitiveSkip",
  "device.note.write",
] satisfies MastraAgentTurnCapability[];
let platformTurnOkCount = 0;
for (const capability of turnCapabilities) {
  const platformTurn = await runAgentPlatformTurn({
    body: {
      capability,
      text: capability,
      sessionId: "verify-platform",
      playlistId: "default",
      ...(capability === "screen.syncPlaylist" ? { mode: "preview", evidenceMode: "fast" } : {}),
      ...(capability === "memory.preference" ? { text: "prefer concise device evidence" } : {}),
      ...(capability === "memory.sensitiveSkip" ? { text: "temporary secret-like value" } : {}),
      ...(capability === "device.note.write" ? { text: "verify-platform note boundary" } : {}),
    },
    classifyIntent: async () => {
      throw new Error(`structured capability ${capability} unexpectedly called the classifier`);
    },
    turnLedger: { async appendTurn() {} },
    eventLedger: { async appendEvent() {} },
    metricsLedger,
    mastraWorkflows: { dispatch: mastraDispatch },
  });
  const expectedOperation = `mastra.mcp.${capability}`;
  const ok = platformTurn.turn?.ok === true
    && platformTurn.turn?.toolResults?.some((item: JsonObject) => item.diagnostics?.operation === expectedOperation);
  const commandExposure = findRawCommandExposure(platformTurn);
  if (ok) platformTurnOkCount += 1;
  record(`agent-turn-${capability}-mastra-path`, {
    ok: ok && !commandExposure,
    status: platformTurn.status,
    operation: expectedOperation,
    userSummary: platformTurn.turn?.userSummary || null,
    rawCommandExposure: commandExposure,
  });
}
record("agent-turn-structured-mastra-count", {
  ok: platformTurnOkCount >= 5,
  passed: platformTurnOkCount,
  required: 5,
  registeredCapabilities: [...MASTRA_AGENT_TURN_CAPABILITIES],
});

const policyAuditWithContext = auditEvents.find((event) =>
  event.kind === "gateway.policy"
  && event.subjectKind === "local-user"
  && event.deviceProfile === "device"
  && event.sessionId
  && event.turnId
  && event.decision?.schema === "walnutpi.action-policy-decision.v1"
);
record("policy.mcp-auth-context", {
  ok: Boolean(policyAuditWithContext),
  subjectKind: policyAuditWithContext?.subjectKind || null,
  deviceProfile: policyAuditWithContext?.deviceProfile || null,
  sessionId: policyAuditWithContext?.sessionId || null,
  turnId: policyAuditWithContext?.turnId || null,
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
record("db.memory-product-state-schema", {
  ok: Boolean(schema.memoryCandidates && schema.memorySensitiveSkips),
  tables: Object.keys(schema).filter((table) => table.toLowerCase().includes("memory")),
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

async function createVerifyScreenWorkspace(projectRoot: string) {
  const sourceScreenRoot = path.join(projectRoot, "screen");
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "walnutpi-verify-screen-"));
  await mkdir(path.join(workspaceRoot, "manifests"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "outputs"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "playlists"), { recursive: true });
  await copyFile(
    path.join(sourceScreenRoot, "outputs", "seed-terminal-ops.png"),
    path.join(workspaceRoot, "outputs", "seed-terminal-ops.png"),
  );
  await writeFile(
    path.join(workspaceRoot, "manifests", "seed-terminal-ops.json"),
    `${JSON.stringify({
      schema: "walnutpi.screen-manifest.v2",
      id: "seed-terminal-ops",
      title: "WalnutPi Terminal Ops Seed",
      description: "Verify-platform seed copied into a temporary Screen Workspace.",
      output: {
        type: "static",
        path: "../outputs/seed-terminal-ops.png",
        width: 480,
        height: 320,
        fileSha256: "25e92e240278d7f05b70ca26bf898588f6e553546438adef64a3ebe76a40241b",
        rgbaFrameSha256: "9e6262d8113761db7c3513add3f448d8663eea15e0e11c3df4146e526193a2b7",
        rgb565FrameSha256: "e3fbf800e5918d0edc07ed7a805c7eb2bf17f57f74a99057d45e98e39186c13f",
      },
      provenance: {
        processing: {
          preset: "fit-cover:480x320",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workspaceRoot, "playlists", "default.json"),
    `${JSON.stringify({
      schema: "walnutpi.screen-playlist.v1",
      id: "default",
      loop: true,
      items: [
        {
          manifest: "../manifests/seed-terminal-ops.json",
          durationMs: 8000,
          repeat: 1,
          transition: "cut",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  return workspaceRoot;
}

function findRawCommandExposure(value: any, pathParts: string[] = []): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findRawCommandExposure(value[index], [...pathParts, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const path = [...pathParts, key];
    if (isRawCommandKey(key) && typeof child === "string") {
      return `${path.join(".")}: ${child.slice(0, 80)}`;
    }
    const found = findRawCommandExposure(child, path);
    if (found) return found;
  }
  return null;
}

function isRawCommandKey(key: string) {
  return /^(commands?|commandLine|remoteCommand|rawCommand|sshCommand)$/i.test(key);
}

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
import { closeWalnutAuthForTests, createWalnutAuth } from "../web-interface/platform/auth/auth.ts";
import { walnutInngest, walnutInngestFunctions } from "../web-interface/platform/inngest/client.ts";
import { createWalnutLangfuseClient, createWalnutOpenTelemetrySdk, getWalnutTracer } from "../web-interface/platform/observability/tracing.ts";
import { createWalnutPostgresClient, schema } from "../web-interface/platform/db/client.ts";
import { getWalnutMastraStorage } from "../web-interface/platform/mastra/storage.ts";
import { loadActionPolicyManifest } from "../web-interface/action-policy.ts";
import { createOpaEnforcer } from "../web-interface/gateway/opa-enforcer.ts";
import { handleWalnutMcpRequest } from "../web-interface/platform/mcp/server.ts";
import { createLocalOwnerAuthContext, resolveWalnutSubjectFromRequest } from "../web-interface/platform/auth/auth.ts";
import { createScreenCommandRunner } from "../web-interface/screen-command-runner.ts";
import { createScreenWorkspaceStore } from "../web-interface/screen-workspace-store.ts";
import { createToolDispatcher } from "../web-interface/gateway/tool-dispatcher.ts";
import { publicGatewayAuditEventFromRecord } from "../web-interface/gateway/audit-ledger.ts";
import { createMemoryActionApprovalStore } from "../web-interface/platform/policy/action-approval-store.ts";
import { createCuratedRetrievalStore } from "../web-interface/platform/memory/curated-retrieval-store.ts";
import { createRetrievalEmbeddingIndex } from "../web-interface/platform/memory/retrieval-embedding-index.ts";
import { createRetrievalReindexWorkflow } from "../web-interface/platform/memory/retrieval-reindex-workflow.ts";
import { getAiModelConfig, getAuthConfig, getDbConfig, getLangfuseConfig } from "../web-interface/platform/config/platform-config.ts";
import { processSourceAssetToScreenOutput, writeDefaultScreenPlaylist } from "./screen-workspace-pipeline.ts";
import { createMcpAuthContext } from "../web-interface/gateway/auth-context.ts";

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
const memoryCandidatesById = new Map<string, JsonObject>();
const actionApprovalStore = createMemoryActionApprovalStore();
const memoryStore = {
  async capturePreferenceCandidate({ text, sessionId, turnId }: JsonObject) {
    const candidateId = randomUUID();
    const record = {
      kind: "memory.candidate",
      candidateId,
      candidateText: String(text || "").trim(),
      sourceSessionId: sessionId || null,
      sourceTurnId: turnId || null,
      categoryKey: "preferences.screen_generation",
      persisted: true,
    };
    memoryWrites.push(record);
    memoryCandidatesById.set(candidateId, record);
    return {
      ok: true,
      writeState: "candidate",
      candidateId,
      categoryKey: record.categoryKey,
      candidateText: record.candidateText,
      persisted: true,
      skipped: false,
      reason: null,
    };
  },
  async approveCandidate({ candidateId, subject }: JsonObject) {
    const candidate = memoryCandidatesById.get(String(candidateId || ""));
    if (!candidate) {
      return {
        ok: false,
        persisted: false,
        skipped: false,
        reason: "candidate-not-found",
      };
    }
    const record = {
      kind: "durable_memory.approved",
      recordId: randomUUID(),
      candidateId: candidate.candidateId,
      categoryKey: candidate.categoryKey,
      memoryText: candidate.candidateText,
      approvedBySubjectKind: subject?.kind || null,
      persisted: true,
    };
    memoryWrites.push(record);
    return {
      ok: true,
      ...record,
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
  actionApprovalStore,
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
        orgId: "local-control-plane",
        deviceId: "default-walnutpi",
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
const mcpMemoryResults: Record<string, JsonObject> = {};
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
    "walnutpi_memory.approve",
    "walnutpi_memory.sensitiveSkip",
    "walnutpi_policy.action.prepare",
    "walnutpi_policy.action.commit",
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
    ["policy.action.prepare", "walnutpi_policy.action.prepare", { actionId: "restart_walnut_screen_service", params: {} }],
  ] as const;
  let mcpCallOkCount = 0;
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
  const approveCandidateId = mcpMemoryResults["memory.preference"]?.result?.candidateId;
  const approvedMemory = await tools["walnutpi_memory.approve"]?.execute?.({
    candidateId: approveCandidateId,
    sessionId: "verify-platform",
    turnId: "verify-memory-approve",
  } as any, {} as any);
  mcpMemoryResults["memory.approve"] = approvedMemory;
  const approveCommandExposure = findRawCommandExposure(approvedMemory);
  record("mcp.tools-call-memory.approve", {
    ok: approvedMemory?.ok === true
      && approvedMemory?.evidence?.durableMemoryWrite?.writeState === "approved"
      && approvedMemory?.evidence?.noRawSessionIndexing === true
      && approvedMemory?.evidence?.noRawDailyNotesIndexing === true
      && !approveCommandExposure,
    family: approvedMemory?.family || null,
    operation: approvedMemory?.result?.operation || null,
    recordId: approvedMemory?.result?.recordId || null,
    rawCommandExposure: approveCommandExposure,
  });
  const preparedPolicy = await tools["walnutpi_policy.action.prepare"]?.execute?.({
    actionId: "restart_walnut_screen_service",
    params: {},
    sessionId: "verify-platform",
    turnId: "verify-policy-prepare",
  } as any, {} as any);
  const committedPolicy = await tools["walnutpi_policy.action.commit"]?.execute?.({
    decisionId: preparedPolicy?.result?.decisionId,
    actionId: "restart_walnut_screen_service",
    params: {},
    approvalToken: preparedPolicy?.result?.approvalToken,
    execute: true,
    sessionId: "verify-platform",
    turnId: "verify-policy-commit",
  } as any, {} as any);
  record("policy.prepare-commit-approval-flow", {
    ok: preparedPolicy?.ok === true
      && preparedPolicy?.evidence?.noCommandExecution === true
      && committedPolicy?.ok === false
      && committedPolicy?.evidence?.highRiskDirectExecutionBlocked === true
      && !findRawCommandExposure(preparedPolicy)
      && !findRawCommandExposure(committedPolicy),
    prepareOperation: preparedPolicy?.result?.operation || null,
    commitOperation: committedPolicy?.result?.operation || null,
    highRiskBlocked: Boolean(committedPolicy?.evidence?.highRiskDirectExecutionBlocked),
    prepareRawCommandExposure: findRawCommandExposure(preparedPolicy),
    commitRawCommandExposure: findRawCommandExposure(committedPolicy),
  });
  record("mcp.tools-call-platform-count", {
    ok: mcpCallOkCount >= 5,
    passed: mcpCallOkCount,
    required: 5,
  });
  const sensitiveSkipTextExposure = JSON.stringify(mcpMemoryResults["memory.sensitiveSkip"] || {}).includes("temporary secret-like value");
  record("memory.product-state-tools", {
    ok: memoryWrites.some((item) => item.kind === "memory.candidate" && item.persisted === true)
      && memoryWrites.some((item) => item.kind === "durable_memory.approved" && item.persisted === true)
      && memoryWrites.some((item) => item.kind === "memory.sensitive_skip" && item.persisted === true)
      && mcpMemoryResults["memory.preference"]?.evidence?.dbProductState?.boundaryReached === true
      && mcpMemoryResults["memory.approve"]?.evidence?.dbProductState?.persisted === true
      && mcpMemoryResults["memory.sensitiveSkip"]?.evidence?.memorySkipEvidence?.textHash?.startsWith("sha256:")
      && !sensitiveSkipTextExposure,
    candidateWrites: memoryWrites.filter((item) => item.kind === "memory.candidate").length,
    durableMemoryWrites: memoryWrites.filter((item) => item.kind === "durable_memory.approved").length,
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

const agentTurnAuditEvents: JsonObject[] = [];
const agentTurnRequest = new Request("http://127.0.0.1:4173/api/agent/turn?previewOnly=1", {
  headers: {
    "x-walnut-subject": "attacker",
    "x-walnut-roles": "admin",
  },
});
const agentTurnAuthContext = await createMcpAuthContext(agentTurnRequest, {
  deviceProfile: "device",
  target: "verify@walnutpi",
});
const requestScopedMastraDispatch = createMastraAgentTurnWorkflowDispatcher({
  endpoint: "http://127.0.0.1:4173/mcp",
  fetchImpl: ((url, init) => {
    const request = new Request(url, init);
    return handleWalnutMcpRequest(request, {
      authContext: agentTurnAuthContext,
      toolCatalog,
      toolDispatcher,
      auditLedger: {
        async append(record: JsonObject) {
          agentTurnAuditEvents.push(record);
        },
      },
    });
  }) as any,
  id: `verify-turn-request-auth-${randomUUID()}`,
});
const requestScopedPlatformTurn = await runAgentPlatformTurn({
  body: {
    capability: "policy.action.prepare",
    text: "policy.action.prepare",
    sessionId: "verify-agent-turn-auth",
    actionId: "restart_walnut_screen_service",
    params: {},
  },
  classifyIntent: async () => {
    throw new Error("structured capability unexpectedly called the classifier");
  },
  turnLedger: { async appendTurn() {} },
  eventLedger: { async appendEvent() {} },
  metricsLedger,
  mastraWorkflows: { dispatch: requestScopedMastraDispatch },
});
const requestScopedMcpAudit = agentTurnAuditEvents.find((event) =>
  event.kind === "mcp.sdk.tool"
  && event.sessionId === "verify-agent-turn-auth"
  && event.toolName === "policy.action.prepare"
);
const requestScopedPolicyAudit = auditEvents.find((event) =>
  event.kind === "policy.action.prepare.recorded"
  && event.sessionId === "verify-agent-turn-auth"
);
record("agent-turn-mcp-auth-context", {
  ok: requestScopedPlatformTurn.turn?.ok === true
    && requestScopedMcpAudit?.subjectKind === "local-user"
    && requestScopedMcpAudit?.deviceProfile === "device"
    && requestScopedPolicyAudit?.noCommandExecution === true
    && !JSON.stringify(requestScopedPolicyAudit).includes("admin")
    && !JSON.stringify(requestScopedMcpAudit).includes("admin")
    && requestScopedPlatformTurn.turn?.toolResults?.some((item: JsonObject) =>
      item.diagnostics?.operation === "mastra.mcp.policy.action.prepare"
    ),
  subjectKind: requestScopedMcpAudit?.subjectKind || null,
  deviceProfile: requestScopedMcpAudit?.deviceProfile || null,
  sessionId: requestScopedMcpAudit?.sessionId || null,
  mcpAuditKind: requestScopedMcpAudit?.kind || null,
  policyAuditKind: requestScopedPolicyAudit?.kind || null,
  spoofedRoleExposure: JSON.stringify({ requestScopedMcpAudit, requestScopedPolicyAudit }).includes("admin"),
});

const noSshAgentTurnAuditEvents: JsonObject[] = [];
const noSshAgentTurnRequest = new Request("http://127.0.0.1:4173/api/agent/turn?nossh=1", {
  headers: {
    "x-walnut-subject": "attacker",
    "x-walnut-roles": "admin",
  },
});
const noSshAgentTurnAuthContext = await createMcpAuthContext(noSshAgentTurnRequest, {
  deviceProfile: "device",
  target: "verify@walnutpi",
});
const noSshMastraDispatch = createMastraAgentTurnWorkflowDispatcher({
  endpoint: "http://127.0.0.1:4173/mcp",
  fetchImpl: ((url, init) => {
    const request = new Request(url, init);
    return handleWalnutMcpRequest(request, {
      authContext: noSshAgentTurnAuthContext,
      toolCatalog,
      toolDispatcher,
      auditLedger: {
        async append(record: JsonObject) {
          noSshAgentTurnAuditEvents.push(record);
        },
      },
    });
  }) as any,
  id: `verify-turn-nossh-${randomUUID()}`,
});
const noSshPlatformTurn = await runAgentPlatformTurn({
  body: {
    capability: "device.status.read",
    text: "device.status.read",
    sessionId: "verify-agent-turn-nossh",
  },
  classifyIntent: async () => {
    throw new Error("nossh structured capability unexpectedly called the classifier");
  },
  turnLedger: { async appendTurn() {} },
  eventLedger: { async appendEvent() {} },
  metricsLedger,
  mastraWorkflows: { dispatch: noSshMastraDispatch },
});
record("agent-turn-nossh-mastra-path", {
  ok: noSshPlatformTurn.turn?.ok === true
    && noSshPlatformTurn.status === 200
    && noSshPlatformTurn.turn?.toolResults?.some((item: JsonObject) =>
      item.diagnostics?.operation === "mastra.mcp.device.status.read"
    )
    && !JSON.stringify(noSshPlatformTurn).includes("preview mode disables SSH"),
  status: noSshPlatformTurn.status,
  operation: "mastra.mcp.device.status.read",
  previewShortCircuit: JSON.stringify(noSshPlatformTurn).includes("preview mode disables SSH"),
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
  "memory.approve",
  "memory.sensitiveSkip",
  "device.note.write",
  "policy.action.prepare",
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
      ...(capability === "memory.approve" ? { candidateId: mcpMemoryResults["memory.preference"]?.result?.candidateId || randomUUID() } : {}),
      ...(capability === "memory.sensitiveSkip" ? { text: "temporary secret-like value" } : {}),
      ...(capability === "device.note.write" ? { text: "verify-platform note boundary" } : {}),
      ...(capability === "policy.action.prepare" ? { actionId: "restart_walnut_screen_service", params: {} } : {}),
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
  ok: Boolean(policyAuditWithContext)
    && policyAuditWithContext?.decision?.audit?.subject?.orgId === "local-control-plane"
    && policyAuditWithContext?.decision?.audit?.environment?.deviceId === "default-walnutpi",
  subjectKind: policyAuditWithContext?.subjectKind || null,
  deviceProfile: policyAuditWithContext?.deviceProfile || null,
  sessionId: policyAuditWithContext?.sessionId || null,
  turnId: policyAuditWithContext?.turnId || null,
  orgId: policyAuditWithContext?.decision?.audit?.subject?.orgId || null,
  deviceId: policyAuditWithContext?.decision?.audit?.environment?.deviceId || null,
});

const spoofedSubject = await resolveWalnutSubjectFromRequest(new Request("http://127.0.0.1:4173/mcp", {
  headers: {
    "x-walnut-subject": "attacker",
    "x-walnut-roles": "admin",
  },
}));
record("auth.subject-server-derived", {
  ok: spoofedSubject.kind === "local-user"
    && spoofedSubject.userId === "local-owner"
    && spoofedSubject.orgId === "local-control-plane"
    && spoofedSubject.deviceId === "default-walnutpi"
    && Array.isArray(spoofedSubject.roles)
    && spoofedSubject.roles.includes("owner")
    && !spoofedSubject.roles.includes("admin"),
  subjectKind: spoofedSubject.kind,
  userId: spoofedSubject.userId || null,
  roles: spoofedSubject.roles || [],
});

let signedAuthCookie = "";
let signedAuthSubject: JsonObject | null = null;
try {
  const auth = createWalnutAuth();
  const email = `verify-${randomUUID()}@walnutpi.local`;
  const signUpResponse = await auth.handler(new Request("http://127.0.0.1:4173/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: `verify-${randomUUID()}-password`,
      name: "Verify Walnut Owner",
    }),
  }));
  signedAuthCookie = cookieHeaderFromSetCookie(signUpResponse.headers.get("set-cookie") || "");
  signedAuthSubject = await resolveWalnutSubjectFromRequest(new Request("http://127.0.0.1:4173/mcp", {
    headers: signedAuthCookie ? { cookie: signedAuthCookie } : {},
  }), {
    deviceProfile: "device",
    target: "verify@walnutpi",
  });
  record("auth.better-auth-session-subject", {
    ok: signUpResponse.ok
      && signedAuthSubject.kind === "better-auth-user"
      && signedAuthSubject.authenticated === true
      && signedAuthSubject.bindingSource === "postgres"
      && signedAuthSubject.roles?.includes?.("owner")
      && signedAuthSubject.orgId === "local-control-plane"
      && signedAuthSubject.deviceId === "default-walnutpi"
      && signedAuthSubject.deviceProfile === "device"
      && signedAuthSubject.target === "local-walnutpi-device"
      && Boolean(signedAuthSubject.userId)
      && Boolean(signedAuthSubject.sessionId),
    signUpStatus: signUpResponse.status,
    subjectKind: signedAuthSubject.kind || null,
    authenticated: signedAuthSubject.authenticated || false,
    hasUserId: Boolean(signedAuthSubject.userId),
    hasSessionId: Boolean(signedAuthSubject.sessionId),
    roles: signedAuthSubject.roles || [],
    orgId: signedAuthSubject.orgId || null,
    deviceId: signedAuthSubject.deviceId || null,
    bindingSource: signedAuthSubject.bindingSource || null,
  });
  const signedSpoofedBindingSubject = await resolveWalnutSubjectFromRequest(new Request("http://127.0.0.1:4173/mcp", {
    headers: signedAuthCookie ? { cookie: signedAuthCookie } : {},
  }), {
    deviceProfile: "attacker-profile",
    target: "attacker@device",
  });
  record("auth.subject-binding-server-owned-target", {
    ok: signedSpoofedBindingSubject.kind === "better-auth-user"
      && signedSpoofedBindingSubject.deviceProfile === "device"
      && signedSpoofedBindingSubject.target === "local-walnutpi-device"
      && signedSpoofedBindingSubject.orgId === "local-control-plane"
      && signedSpoofedBindingSubject.deviceId === "default-walnutpi",
    subjectKind: signedSpoofedBindingSubject.kind || null,
    deviceProfile: signedSpoofedBindingSubject.deviceProfile || null,
    target: signedSpoofedBindingSubject.target || null,
    orgId: signedSpoofedBindingSubject.orgId || null,
    deviceId: signedSpoofedBindingSubject.deviceId || null,
  });
} catch (error: any) {
  record("auth.better-auth-session-subject", { ok: false, error: error.message });
  record("auth.subject-binding-server-owned-target", { ok: false, error: error.message });
}

if (signedAuthCookie) {
  const signedAgentTurnAuditEvents: JsonObject[] = [];
  const signedAgentTurnRequest = new Request("http://127.0.0.1:4173/api/agent/turn?previewOnly=1", {
    headers: {
      cookie: signedAuthCookie,
      "x-walnut-subject": "attacker",
      "x-walnut-roles": "admin",
    },
  });
  const signedAgentTurnAuthContext = await createMcpAuthContext(signedAgentTurnRequest, {
    deviceProfile: "device",
    target: "verify@walnutpi",
  });
  const signedMastraDispatch = createMastraAgentTurnWorkflowDispatcher({
    endpoint: "http://127.0.0.1:4173/mcp",
    fetchImpl: ((url, init) => {
      const request = new Request(url, init);
      return handleWalnutMcpRequest(request, {
        authContext: signedAgentTurnAuthContext,
        toolCatalog,
        toolDispatcher,
        auditLedger: {
          async append(record: JsonObject) {
            signedAgentTurnAuditEvents.push(record);
          },
        },
      });
    }) as any,
    id: `verify-turn-signed-auth-${randomUUID()}`,
  });
  const signedSessionId = "verify-agent-turn-signed-auth";
  const signedPlatformTurn = await runAgentPlatformTurn({
    body: {
      capability: "policy.action.prepare",
      text: "policy.action.prepare",
      sessionId: signedSessionId,
      actionId: "restart_walnut_screen_service",
      params: {},
    },
    classifyIntent: async () => {
      throw new Error("signed structured capability unexpectedly called the classifier");
    },
    turnLedger: { async appendTurn() {} },
    eventLedger: { async appendEvent() {} },
    metricsLedger,
    mastraWorkflows: { dispatch: signedMastraDispatch },
  });
  const signedMcpAudit = signedAgentTurnAuditEvents.find((event) =>
    event.kind === "mcp.sdk.tool"
    && event.sessionId === signedSessionId
    && event.toolName === "policy.action.prepare"
  );
  const signedPolicyAudit = auditEvents.find((event) =>
    event.kind === "policy.action.prepare.recorded"
    && event.sessionId === signedSessionId
  );
  const signedPolicyDecisionAudit = auditEvents.find((event) =>
    event.kind === "policy.action.prepare.decision"
    && event.sessionId === signedSessionId
  );
  record("agent-turn-mcp-better-auth-context", {
    ok: signedPlatformTurn.turn?.ok === true
      && signedMcpAudit?.subjectKind === "better-auth-user"
      && signedMcpAudit?.deviceProfile === "device"
      && signedPolicyAudit?.subjectKind === "better-auth-user"
      && signedPolicyDecisionAudit?.decision?.audit?.subject?.orgId === "local-control-plane"
      && signedPolicyDecisionAudit?.decision?.audit?.environment?.deviceId === "default-walnutpi"
      && signedPolicyAudit?.noCommandExecution === true
      && !JSON.stringify({ signedMcpAudit, signedPolicyAudit, signedPolicyDecisionAudit }).includes("admin")
      && signedPlatformTurn.turn?.toolResults?.some((item: JsonObject) =>
        item.diagnostics?.operation === "mastra.mcp.policy.action.prepare"
      ),
    subjectKind: signedMcpAudit?.subjectKind || null,
    policySubjectKind: signedPolicyAudit?.subjectKind || null,
    deviceProfile: signedMcpAudit?.deviceProfile || null,
    orgId: signedPolicyDecisionAudit?.decision?.audit?.subject?.orgId || null,
    deviceId: signedPolicyDecisionAudit?.decision?.audit?.environment?.deviceId || null,
    spoofedRoleExposure: JSON.stringify({ signedMcpAudit, signedPolicyAudit, signedPolicyDecisionAudit }).includes("admin"),
  });
} else {
  record("agent-turn-mcp-better-auth-context", {
    ok: false,
    error: "better-auth sign-up did not return a session cookie",
  });
}

const publicAuditProjection = publicGatewayAuditEventFromRecord({
  timestamp: new Date().toISOString(),
  kind: "mcp.sdk.tool",
  operation: "tools/call",
  ok: true,
  status: 200,
  toolName: "device.status.read",
  sessionId: "verify-public-audit",
  turnId: "verify-public-audit-turn",
  subjectKind: "local-user",
  deviceProfile: "device",
  decision: {
    schema: "walnutpi.action-policy-decision.v1",
    engine: "opa-cli",
    decisionId: "verify-decision",
    actionId: "status",
    allow: true,
    status: "allow",
    reason: "local-action-allowed",
    audit: {
      risk: "read",
      policyVersion: "local-rego",
      matchedRules: ["local-action-allowed"],
    },
    evidence: {
      noCommandExecution: false,
    },
    action: {
      web: {
        command: "walnut action run status --json",
      },
    },
  },
  result: {
    schema: "walnutpi.toolResult.device.v1",
    ok: true,
    family: "device",
    result: {
      operation: "device.action",
      actionId: "status",
      output: "private device output",
      command: "walnut action run status --json",
    },
  },
  evidence: {
    output: "private evidence",
    rawCommand: "walnut action run status --json",
  },
  params: {
    text: "private params",
  },
});
const publicAuditJson = JSON.stringify(publicAuditProjection);
record("gateway.audit-public-projection", {
  ok: publicAuditProjection.schema === "walnutpi.gatewayAuditEvent.public.v1"
    && publicAuditProjection.payloadsRedacted === true
    && !publicAuditJson.includes("walnut action run")
    && !publicAuditJson.includes("private device output")
    && !publicAuditJson.includes("private evidence")
    && !publicAuditJson.includes("private params"),
  rawCommandExposure: publicAuditJson.includes("walnut action run"),
  privateOutputExposure: publicAuditJson.includes("private device output"),
  privateParamsExposure: publicAuditJson.includes("private params"),
});

try {
  const registry = getWalnutMastraRegistry();
  const storage = getWalnutMastraStorage();
  await storage?.init?.();
  record("mastra.registry", {
    ok: Boolean(registry.getAgentById("router")) && storage.constructor.name === "PostgresStore",
    storage: storage?.constructor?.name || null,
  });
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

const retrievalSeedToken = `verify-retrieval-${randomUUID()}`;
const retrievalClient = createWalnutPostgresClient();
if (retrievalClient.db && retrievalClient.sql) {
  try {
    await retrievalClient.db.insert(schema.durableMemoryRecords).values({
      categoryKey: "preferences.screen_generation",
      memoryText: `Approved durable memory ${retrievalSeedToken}`,
      status: "approved",
      sourceTool: "verify:platform",
      metadata: { approvedAt: new Date().toISOString() },
    });
    await retrievalClient.db.insert(schema.retrievalDocuments).values([
      {
        source: `verify-curated:${retrievalSeedToken}`,
        sourceKind: "curated_corpus",
        status: "curated",
        title: "Verify curated retrieval document",
        body: `Curated corpus document ${retrievalSeedToken}`,
        metadata: { documentKind: "verify" },
      },
      {
        source: `verify-raw-session:${retrievalSeedToken}`,
        sourceKind: "raw_session_log",
        status: "raw",
        title: "Raw session log must not index",
        body: `Raw session forbidden ${retrievalSeedToken}`,
        metadata: { documentKind: "raw-session-log" },
      },
      {
        source: `verify-raw-daily-note:${retrievalSeedToken}`,
        sourceKind: "raw_daily_note",
        status: "raw",
        title: "Raw daily note must not index",
        body: `Raw daily forbidden ${retrievalSeedToken}`,
        metadata: { documentKind: "raw-daily-note" },
      },
    ]);
  } finally {
    await retrievalClient.sql.end({ timeout: 1 });
  }
}
const retrievalReindex = await createRetrievalReindexWorkflow({ batchLimit: 500 }).run({ limit: 500 });
const curatedRetrieval = await createCuratedRetrievalStore({ resultLimit: 10 }).retrieve(retrievalSeedToken);
const retrievalJson = JSON.stringify(curatedRetrieval.results);
record("retrieval.curated-db-path", {
  ok: curatedRetrieval.ok === true
    && curatedRetrieval.results.some((item: JsonObject) => item.sourceKind === "approved_memory")
    && curatedRetrieval.results.some((item: JsonObject) => item.sourceKind === "curated_corpus")
    && !retrievalJson.includes("raw_session_log")
    && !retrievalJson.includes("raw_daily_note")
    && !retrievalJson.includes("Raw session forbidden")
    && !retrievalJson.includes("Raw daily forbidden")
    && curatedRetrieval.index?.writePath === "inngest.retrieval.reindex",
  resultKinds: curatedRetrieval.results.map((item: JsonObject) => item.sourceKind),
  index: curatedRetrieval.index || null,
  rawSessionExposure: retrievalJson.includes("raw_session_log") || retrievalJson.includes("Raw session forbidden"),
  rawDailyNoteExposure: retrievalJson.includes("raw_daily_note") || retrievalJson.includes("Raw daily forbidden"),
  skipped: curatedRetrieval.skipped || false,
  reason: curatedRetrieval.reason || null,
});
const rawEmbeddingAttempt = await createRetrievalEmbeddingIndex().upsertSource({
  sourceKind: "raw_session_log",
  sourceTable: "retrieval_documents",
  sourceId: randomUUID(),
  source: `verify-raw-embedding:${retrievalSeedToken}`,
  text: `Raw embedding forbidden ${retrievalSeedToken}`,
  metadata: { documentKind: "raw-session-log" },
});
const retrievalEmbeddingClient = createWalnutPostgresClient();
if (retrievalEmbeddingClient.sql) {
  try {
    const embeddingSourceIds = curatedRetrieval.results
      .filter((item: JsonObject) => item.sourceKind === "approved_memory" || item.sourceKind === "curated_corpus")
      .map((item: JsonObject) => item.id);
    const embeddingRows = await retrievalEmbeddingClient.sql`
      select source_kind, source, embedding_model, text_hash
      from retrieval_embedding_records
      where source_id in ${retrievalEmbeddingClient.sql(embeddingSourceIds)}
      order by source_kind
    `;
    const embeddingJson = JSON.stringify(embeddingRows);
    record("retrieval.pgvector-approved-curated-only", {
      ok: curatedRetrieval.ok === true
        && retrievalReindex.ok === true
        && retrievalReindex.indexed >= 2
        && curatedRetrieval.index?.source === "pgvector"
        && curatedRetrieval.index?.writePath === "inngest.retrieval.reindex"
        && rawEmbeddingAttempt.indexed === false
        && rawEmbeddingAttempt.reason === "source kind is not indexable"
        && embeddingRows.some((row: JsonObject) => row.source_kind === "approved_memory")
        && embeddingRows.some((row: JsonObject) => row.source_kind === "curated_corpus")
        && !embeddingJson.includes("raw_session_log")
        && !embeddingJson.includes("raw_daily_note")
        && !embeddingJson.includes("Raw embedding forbidden"),
      index: curatedRetrieval.index,
      reindex: retrievalReindex,
      sourceKinds: embeddingRows.map((row: JsonObject) => row.source_kind),
      rawEmbeddingRefused: rawEmbeddingAttempt.indexed === false,
      rawEmbeddingReason: rawEmbeddingAttempt.reason || null,
    });
  } catch (error: any) {
    record("retrieval.pgvector-approved-curated-only", { ok: false, error: error.message });
  } finally {
    await retrievalEmbeddingClient.sql.end({ timeout: 1 });
  }
}

const db = createWalnutPostgresClient();
record("db.drizzle-postgres", {
  ok: db.ok || db.skipped,
  skipped: db.skipped,
  reason: db.reason || null,
  tables: Object.keys(schema),
});
record("db.memory-product-state-schema", {
  ok: Boolean(schema.memoryCandidates && schema.durableMemoryRecords && schema.memorySensitiveSkips),
  tables: Object.keys(schema).filter((table) => table.toLowerCase().includes("memory")),
});
record("db.curated-retrieval-schema", {
  ok: Boolean(schema.retrievalDocuments && schema.retrievalEmbeddingRecords),
  tables: Object.keys(schema).filter((table) =>
    table === "retrievalDocuments"
    || table === "retrievalEmbeddingRecords"
  ),
});
record("db.action-approval-schema", {
  ok: Boolean(schema.actionApprovalRecords),
  tables: Object.keys(schema).filter((table) => table.toLowerCase().includes("approval")),
});
record("db.audit-event-schema", {
  ok: Boolean(schema.auditEvents),
  tables: Object.keys(schema).filter((table) => table.toLowerCase().includes("audit")),
});
record("db.agent-session-ledger-schema", {
  ok: Boolean(schema.agentTurnSnapshots && schema.agentTurnEvents && schema.webSessionEvents),
  tables: Object.keys(schema).filter((table) =>
    table === "agentTurnSnapshots"
    || table === "agentTurnEvents"
    || table === "webSessionEvents"
  ),
});
record("db.better-auth-schema", {
  ok: Boolean(schema.user && schema.session && schema.account && schema.verification),
  tables: Object.keys(schema).filter((table) =>
    table === "user"
    || table === "session"
    || table === "account"
    || table === "verification"
  ),
});
record("db.auth-subject-binding-schema", {
  ok: Boolean(schema.walnutOrgs && schema.walnutDevices && schema.walnutUserBindings),
  tables: Object.keys(schema).filter((table) =>
    table === "walnutOrgs"
    || table === "walnutDevices"
    || table === "walnutUserBindings"
  ),
});
if (db.sql) {
  try {
    const rows = await db.sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('mastra_threads', 'mastra_messages', 'mastra_agents')
      order by table_name
    `;
    const tableNames = rows.map((row: JsonObject) => row.table_name);
    record("db.mastra-postgres-storage", {
      ok: ["mastra_agents", "mastra_messages", "mastra_threads"].every((table) => tableNames.includes(table)),
      tables: tableNames,
    });
  } catch (error: any) {
    record("db.mastra-postgres-storage", { ok: false, error: error.message });
  }
  try {
    const rows = await db.sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('auth_user', 'auth_session', 'auth_account', 'auth_verification')
      order by table_name
    `;
    const tableNames = rows.map((row: JsonObject) => row.table_name);
    record("db.better-auth-postgres-tables", {
      ok: ["auth_account", "auth_session", "auth_user", "auth_verification"].every((table) => tableNames.includes(table)),
      tables: tableNames,
    });
  } catch (error: any) {
    record("db.better-auth-postgres-tables", { ok: false, error: error.message });
  } finally {
    try {
      const rows = await db.sql`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('memory_candidates', 'durable_memory_records', 'memory_sensitive_skips')
        order by table_name
      `;
      const tableNames = rows.map((row: JsonObject) => row.table_name);
      record("db.memory-product-state-postgres-tables", {
        ok: ["durable_memory_records", "memory_candidates", "memory_sensitive_skips"].every((table) => tableNames.includes(table)),
        tables: tableNames,
      });
    } catch (error: any) {
      record("db.memory-product-state-postgres-tables", { ok: false, error: error.message });
    }
    try {
      const rows = await db.sql`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'retrieval_documents'
          and column_name in ('source_kind', 'status')
        order by column_name
      `;
      const columns = rows.map((row: JsonObject) => row.column_name);
      record("db.curated-retrieval-postgres-columns", {
        ok: ["source_kind", "status"].every((column) => columns.includes(column)),
        columns,
      });
    } catch (error: any) {
      record("db.curated-retrieval-postgres-columns", { ok: false, error: error.message });
    }
    try {
      const rows = await db.sql`
        select installed_version
        from pg_available_extensions
        where name = 'vector'
      `;
      record("db.pgvector-extension", {
        ok: Boolean(rows[0]?.installed_version),
        installedVersion: rows[0]?.installed_version || null,
      });
    } catch (error: any) {
      record("db.pgvector-extension", { ok: false, error: error.message });
    }
    try {
      const rows = await db.sql`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'retrieval_embedding_records'
          and column_name in ('source_kind', 'source_table', 'source_id', 'text_hash', 'embedding_model', 'embedding')
        order by column_name
      `;
      const columns = rows.map((row: JsonObject) => row.column_name);
      record("db.retrieval-embedding-postgres-columns", {
        ok: ["embedding", "embedding_model", "source_id", "source_kind", "source_table", "text_hash"].every((column) => columns.includes(column)),
        columns,
      });
    } catch (error: any) {
      record("db.retrieval-embedding-postgres-columns", { ok: false, error: error.message });
    }
    try {
      const rows = await db.sql`
        select conname
        from pg_constraint
        where conrelid = 'retrieval_embedding_records'::regclass
          and conname in (
            'retrieval_embedding_records_allowed_source_kind',
            'retrieval_embedding_records_allowed_source_table'
          )
        order by conname
      `;
      const constraints = rows.map((row: JsonObject) => row.conname);
      record("db.retrieval-embedding-policy-constraints", {
        ok: [
          "retrieval_embedding_records_allowed_source_kind",
          "retrieval_embedding_records_allowed_source_table",
        ].every((constraint) => constraints.includes(constraint)),
        constraints,
      });
    } catch (error: any) {
      record("db.retrieval-embedding-policy-constraints", { ok: false, error: error.message });
    }
    try {
      const rows = await db.sql`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('walnut_orgs', 'walnut_devices', 'walnut_user_bindings')
        order by table_name
      `;
      const tableNames = rows.map((row: JsonObject) => row.table_name);
      record("db.auth-subject-binding-postgres-tables", {
        ok: ["walnut_devices", "walnut_orgs", "walnut_user_bindings"].every((table) => tableNames.includes(table)),
        tables: tableNames,
      });
    } catch (error: any) {
      record("db.auth-subject-binding-postgres-tables", { ok: false, error: error.message });
    }
    await db.sql.end({ timeout: 1 });
  }
}

const failed = results.filter((item) => !item.ok);
console.log(jsonSummary({
  ok: failed.length === 0,
  results,
}));

if (failed.length) {
  process.exitCode = 1;
}

await closeWalnutAuthForTests();

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

function cookieHeaderFromSetCookie(value: string) {
  const pairs: string[] = [];
  for (const chunk of splitSetCookieHeader(value)) {
    const pair = chunk.split(";")[0]?.trim();
    if (pair) pairs.push(pair);
  }
  return pairs.join("; ");
}

function splitSetCookieHeader(value: string) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim()).filter(Boolean);
}

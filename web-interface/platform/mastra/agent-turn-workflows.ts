import { createWalnutMastraMcpClient, type WalnutMastraMcpClientOptions } from "./mcp-client.ts";
import type { WalnutToolResult } from "../../walnut-tool-results.ts";
import { setWalnutSpanAttributes, withWalnutSpan } from "../observability/tracing.ts";

type JsonObject = Record<string, any>;

export const MASTRA_AGENT_TURN_CAPABILITIES = [
  "device.status.read",
  "diagnostics.recentFailure",
  "screen.readPlaylist",
  "screen.captureFrame",
  "screen.syncPlaylist",
  "screen.renderWallpaper",
  "screen.writePlaylist",
  "screen.widgetApp.sync",
  "screen.widgetApp.action",
  "device.network.read",
  "device.snapshot.read",
  "device.i2c.read",
  "device.gpio.read",
  "device.notes.read",
  "device.note.write",
  "memory.sessionSummary",
  "memory.preference",
  "memory.approve",
  "memory.sensitiveSkip",
  "ai.chat",
  "policy.action.prepare",
  "policy.action.commit",
] as const;

export type MastraAgentTurnCapability = (typeof MASTRA_AGENT_TURN_CAPABILITIES)[number];

export type AgentTurnWorkflowOptions = WalnutMastraMcpClientOptions & {
  capability: MastraAgentTurnCapability;
  params?: JsonObject;
  sessionId?: string | null;
  turnId?: string | null;
  traceId?: string | null;
};

const MCP_TOOL_BY_CAPABILITY: Record<MastraAgentTurnCapability, string> = {
  "device.status.read": "walnutpi_device.status.read",
  "diagnostics.recentFailure": "walnutpi_diagnostics.recentFailure",
  "screen.readPlaylist": "walnutpi_screen.readPlaylist",
  "screen.captureFrame": "walnutpi_screen.captureFrame",
  "screen.syncPlaylist": "walnutpi_screen.syncPlaylist",
  "screen.renderWallpaper": "walnutpi_screen.renderWallpaper",
  "screen.writePlaylist": "walnutpi_screen.writePlaylist",
  "screen.widgetApp.sync": "walnutpi_screen.widgetApp.sync",
  "screen.widgetApp.action": "walnutpi_screen.widgetApp.action",
  "device.network.read": "walnutpi_device.network.read",
  "device.snapshot.read": "walnutpi_device.snapshot.read",
  "device.i2c.read": "walnutpi_device.i2c.read",
  "device.gpio.read": "walnutpi_device.gpio.read",
  "device.notes.read": "walnutpi_device.notes.read",
  "device.note.write": "walnutpi_device.note.write",
  "memory.sessionSummary": "walnutpi_memory.sessionSummary",
  "memory.preference": "walnutpi_memory.preference",
  "memory.approve": "walnutpi_memory.approve",
  "memory.sensitiveSkip": "walnutpi_memory.sensitiveSkip",
  "ai.chat": "walnutpi_ai.chat",
  "policy.action.prepare": "walnutpi_policy.action.prepare",
  "policy.action.commit": "walnutpi_policy.action.commit",
};

const FAMILY_BY_CAPABILITY: Record<MastraAgentTurnCapability, WalnutToolResult["family"]> = {
  "device.status.read": "device",
  "diagnostics.recentFailure": "diagnostics",
  "screen.readPlaylist": "screen",
  "screen.captureFrame": "screen",
  "screen.syncPlaylist": "screen",
  "screen.renderWallpaper": "screen",
  "screen.writePlaylist": "screen",
  "screen.widgetApp.sync": "screen",
  "screen.widgetApp.action": "screen",
  "device.network.read": "device",
  "device.snapshot.read": "device",
  "device.i2c.read": "device",
  "device.gpio.read": "device",
  "device.notes.read": "device",
  "device.note.write": "device",
  "memory.sessionSummary": "memory",
  "memory.preference": "memory",
  "memory.approve": "memory",
  "memory.sensitiveSkip": "memory",
  "ai.chat": "chat",
  "policy.action.prepare": "policy",
  "policy.action.commit": "policy",
};

export function capabilityFromIntent(intent: string): MastraAgentTurnCapability | null {
  const normalized = normalizeCapabilityName(intent);
  return isMastraAgentTurnCapability(normalized) ? normalized : null;
}

export function isMastraAgentTurnCapability(value: string): value is MastraAgentTurnCapability {
  return MASTRA_AGENT_TURN_CAPABILITIES.includes(value as MastraAgentTurnCapability);
}

export async function runMastraAgentTurnWorkflow({
  capability,
  params = {},
  sessionId = null,
  turnId = null,
  traceId = null,
  timeoutMs = 30_000,
  ...clientOptions
}: AgentTurnWorkflowOptions): Promise<WalnutToolResult> {
  return withWalnutSpan("walnut.tool.call", {
    "walnut.trace_id": traceId,
    "walnut.session_id": sessionId,
    "walnut.turn_id": turnId,
    "walnut.tool_name": MCP_TOOL_BY_CAPABILITY[capability],
    "walnut.playlist_hash": safeOptionalAttribute(params.playlistHash),
    "walnut.build_id": safeOptionalAttribute(params.buildId),
  }, async (span) => {
  const mcpToolName = MCP_TOOL_BY_CAPABILITY[capability];
  if (!mcpToolName) throw new Error(`No Mastra workflow is registered for ${capability}`);
  setWalnutSpanAttributes(span, {
    "walnut.tool_name": mcpToolName,
  });

  const client = createWalnutMastraMcpClient({ ...clientOptions, timeoutMs });
  try {
    const tools = await client.listTools();
    const mcpTool = tools[mcpToolName];
    if (!mcpTool?.execute) {
      throw new Error(`MCP tool ${mcpToolName} is not available`);
    }
    const result = await mcpTool.execute({
      ...params,
      sessionId,
      turnId,
      traceId,
    } as any, {} as any);
    return normalizeToolResult(result, {
      operation: `mastra.mcp.${capability}`,
      capability,
      mcpToolName,
      traceId,
    });
  } finally {
    await client.disconnect();
  }
  });
}

export function createMastraAgentTurnWorkflowDispatcher(
  workflowOptions: WalnutMastraMcpClientOptions = {},
) {
  return async function dispatchMastraAgentTurnWorkflow({
    classification,
    body,
    sessionId = null,
    turnId = null,
    traceId = null,
  }: {
    classification: JsonObject;
    body?: JsonObject;
    sessionId?: string | null;
    turnId?: string | null;
    traceId?: string | null;
  }) {
    const capability = capabilityFromIntent(String(classification?.intent || ""));
    if (!capability) {
      throw new Error(`No Mastra workflow is registered for intent ${classification?.intent || "(missing)"}`);
    }
    return runMastraAgentTurnWorkflow({
      ...workflowOptions,
      capability,
      params: paramsForCapability(capability, body, classification),
      sessionId,
      turnId,
      traceId,
    });
  };
}

function paramsForCapability(
  capability: MastraAgentTurnCapability,
  body: JsonObject = {},
  classification: JsonObject = {},
) {
  const parameters = objectOrEmpty(classification.parameters);
  if (capability === "screen.readPlaylist") {
    return {
      ...parameters,
      playlistId: body.playlistId || parameters.playlistId || "default",
    };
  }
  if (capability === "screen.captureFrame") {
    return {
      ...parameters,
      buildId: body.buildId || parameters.buildId || undefined,
    };
  }
  if (capability === "screen.syncPlaylist") {
    return {
      ...parameters,
      playlistHash: body.playlistHash || parameters.playlistHash || undefined,
      evidenceMode: body.evidenceMode || parameters.evidenceMode || "fast",
      mode: body.mode || parameters.mode || (body.previewOnly === true ? "preview" : "remote"),
      previewOnly: body.previewOnly === true || parameters.previewOnly === true,
    };
  }
  if (capability === "screen.renderWallpaper") {
    return {
      ...parameters,
      source: body.source || parameters.source,
      screenId: body.screenId || parameters.screenId,
      preset: body.preset || parameters.preset || "fit-cover:480x320",
      outputType: body.outputType || parameters.outputType || "static",
      title: body.title || parameters.title || undefined,
      description: body.description || parameters.description || undefined,
    };
  }
  if (capability === "screen.writePlaylist") {
    return {
      ...parameters,
      playlistId: body.playlistId || parameters.playlistId || "default",
      manifestId: body.manifestId || parameters.manifestId,
      mode: body.mode || parameters.mode,
      durationMs: body.durationMs || parameters.durationMs || 8000,
      loop: body.loop !== undefined ? body.loop : parameters.loop !== undefined ? parameters.loop : true,
    };
  }
  if (capability === "screen.widgetApp.sync") {
    return {
      ...parameters,
      appId: body.appId || parameters.appId || undefined,
      versionId: body.versionId || parameters.versionId || undefined,
      evidenceMode: body.evidenceMode || parameters.evidenceMode || "fast",
    };
  }
  if (capability === "screen.widgetApp.action") {
    return {
      ...parameters,
      action: body.action || body.actionId || parameters.action,
      params: body.params || parameters.params || {},
    };
  }
  if (capability === "device.note.write" || capability === "memory.preference" || capability === "memory.sensitiveSkip") {
    return {
      ...parameters,
      text: body.text || parameters.text || "",
    };
  }
  if (capability === "ai.chat") {
    return {
      ...parameters,
      text: body.text || parameters.text || "",
    };
  }
  if (capability === "memory.approve") {
    return {
      ...parameters,
      candidateId: body.candidateId || parameters.candidateId,
    };
  }
  if (capability === "policy.action.prepare") {
    return {
      ...parameters,
      actionId: body.actionId || body.action || parameters.actionId,
      params: body.params || parameters.params || {},
    };
  }
  if (capability === "policy.action.commit") {
    return {
      ...parameters,
      decisionId: body.decisionId || parameters.decisionId,
      actionId: body.actionId || body.action || parameters.actionId,
      params: body.params || parameters.params || {},
      approvalToken: body.approvalToken || parameters.approvalToken,
      execute: body.execute === true || parameters.execute === true,
    };
  }
  return parameters;
}

function normalizeToolResult(value: any, diagnostics: JsonObject): WalnutToolResult {
  if (value?.schema && value?.family && typeof value?.ok === "boolean") {
    return {
      ...value,
      diagnostics: {
        ...objectOrEmpty(value.diagnostics),
        ...diagnostics,
      },
    };
  }
  const family = FAMILY_BY_CAPABILITY[diagnostics.capability as MastraAgentTurnCapability] || "diagnostics";
  return {
    schema: `walnutpi.toolResult.${family}.v1` as WalnutToolResult["schema"],
    ok: Boolean(value?.ok),
    family,
    summary: String(value?.summary || `${diagnostics.capability} completed through Mastra MCP workflow.`),
    result: objectOrEmpty(value?.result),
    evidence: objectOrEmpty(value?.evidence),
    sideEffects: Array.isArray(value?.sideEffects) ? value.sideEffects : [],
    diagnostics,
  };
}

function normalizeCapabilityName(intent: string) {
  if (intent === "diagnostics.recent_failure") return "diagnostics.recentFailure";
  if (intent === "screen.read_playlist") return "screen.readPlaylist";
  if (intent === "screen.sync") return "screen.syncPlaylist";
  if (intent === "screen.generate") return "screen.renderWallpaper";
  if (intent === "screen.state_frame.read") return "screen.captureFrame";
  if (intent === "session.summary") return "memory.sessionSummary";
  if (intent === "memory.approve_candidate") return "memory.approve";
  if (intent === "memory.sensitive_skip") return "memory.sensitiveSkip";
  return intent;
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeOptionalAttribute(value: any) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value);
}

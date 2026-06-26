import { createWalnutMastraMcpClient, type WalnutMastraMcpClientOptions } from "./mcp-client.ts";
import type { WalnutToolResult } from "../../walnut-tool-results.ts";

type JsonObject = Record<string, any>;

export const MASTRA_AGENT_TURN_CAPABILITIES = [
  "device.status.read",
  "diagnostics.recentFailure",
  "screen.readPlaylist",
  "device.network.read",
  "device.snapshot.read",
  "device.gpio.read",
  "device.notes.read",
] as const;

export type MastraAgentTurnCapability = (typeof MASTRA_AGENT_TURN_CAPABILITIES)[number];

export type AgentTurnWorkflowOptions = WalnutMastraMcpClientOptions & {
  capability: MastraAgentTurnCapability;
  params?: JsonObject;
  sessionId?: string | null;
  turnId?: string | null;
};

const MCP_TOOL_BY_CAPABILITY: Record<MastraAgentTurnCapability, string> = {
  "device.status.read": "walnutpi_device.status.read",
  "diagnostics.recentFailure": "walnutpi_diagnostics.recentFailure",
  "screen.readPlaylist": "walnutpi_screen.readPlaylist",
  "device.network.read": "walnutpi_device.network.read",
  "device.snapshot.read": "walnutpi_device.snapshot.read",
  "device.gpio.read": "walnutpi_device.gpio.read",
  "device.notes.read": "walnutpi_device.notes.read",
};

const FAMILY_BY_CAPABILITY: Record<MastraAgentTurnCapability, WalnutToolResult["family"]> = {
  "device.status.read": "device",
  "diagnostics.recentFailure": "diagnostics",
  "screen.readPlaylist": "screen",
  "device.network.read": "device",
  "device.snapshot.read": "device",
  "device.gpio.read": "device",
  "device.notes.read": "device",
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
  timeoutMs = 30_000,
  ...clientOptions
}: AgentTurnWorkflowOptions): Promise<WalnutToolResult> {
  const mcpToolName = MCP_TOOL_BY_CAPABILITY[capability];
  if (!mcpToolName) throw new Error(`No Mastra workflow is registered for ${capability}`);

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
    } as any, {} as any);
    return normalizeToolResult(result, {
      operation: `mastra.mcp.${capability}`,
      capability,
      mcpToolName,
    });
  } finally {
    await client.disconnect();
  }
}

export function createMastraAgentTurnWorkflowDispatcher(
  workflowOptions: WalnutMastraMcpClientOptions = {},
) {
  return async function dispatchMastraAgentTurnWorkflow({
    classification,
    body,
    sessionId = null,
    turnId = null,
  }: {
    classification: JsonObject;
    body?: JsonObject;
    sessionId?: string | null;
    turnId?: string | null;
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
  return intent;
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

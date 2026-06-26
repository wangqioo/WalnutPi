import { createWalnutMastraMcpClient, type WalnutMastraMcpClientOptions } from "./mcp-client.ts";
import type { WalnutToolResult } from "../../walnut-tool-results.ts";

type JsonObject = Record<string, any>;

export type DeviceStatusWorkflowOptions = WalnutMastraMcpClientOptions & {
  sessionId?: string | null;
  turnId?: string | null;
};

export async function runDeviceStatusReadWorkflow({
  sessionId = null,
  turnId = null,
  timeoutMs = 30_000,
  ...clientOptions
}: DeviceStatusWorkflowOptions = {}): Promise<WalnutToolResult> {
  const client = createWalnutMastraMcpClient({ ...clientOptions, timeoutMs });
  try {
    const tools = await client.listTools();
    const statusTool = tools["walnutpi_device.status.read"];
    if (!statusTool?.execute) {
      throw new Error("MCP tool walnutpi_device.status.read is not available");
    }
    const result = await statusTool.execute({ sessionId, turnId } as any, {} as any);
    return normalizeToolResult(result, {
      operation: "mastra.mcp.device.status.read",
      mcpToolName: "walnutpi_device.status.read",
    });
  } finally {
    await client.disconnect();
  }
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
  return {
    schema: "walnutpi.toolResult.device.v1",
    ok: Boolean(value?.ok),
    family: "device",
    summary: String(value?.summary || "Device status read through Mastra MCP workflow."),
    result: objectOrEmpty(value?.result),
    evidence: objectOrEmpty(value?.evidence),
    sideEffects: Array.isArray(value?.sideEffects) ? value.sideEffects : [],
    diagnostics,
  };
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

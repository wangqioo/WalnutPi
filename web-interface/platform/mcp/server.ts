import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

type JsonObject = Record<string, any>;

const READ_ONLY_TOOLS = new Set([
  "screen.readPlaylist",
  "device.status.read",
  "diagnostics.recentFailure",
]);

export type WalnutMcpServerDeps = {
  auditLedger?: JsonObject;
  toolCatalog: {
    listTools(): JsonObject;
    toolForName(name: string): JsonObject | null;
  };
  toolDispatcher: {
    callTool(toolName: string, params: JsonObject, turn: JsonObject): Promise<JsonObject>;
  };
};

export function createWalnutMcpServer({
  auditLedger,
  toolCatalog,
  toolDispatcher,
}: WalnutMcpServerDeps) {
  const server = new McpServer({
    name: "walnutpi-platform-gateway",
    version: "0.1.0",
  });

  for (const tool of safeTools(toolCatalog.listTools())) {
    if (!READ_ONLY_TOOLS.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: {
          playlistId: z.string().optional(),
          sessionId: z.string().optional(),
          turnId: z.string().optional(),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        const params = objectOrEmpty(args);
        const turn = {
          turnId: params.turnId || null,
          sessionId: params.sessionId || null,
          input: { text: `${tool.name} via MCP SDK` },
        };
        const result = await toolDispatcher.callTool(tool.name, params, turn);
        await auditLedger?.append?.({
          kind: "mcp.sdk.tool",
          operation: "tools/call",
          ok: Boolean(result?.ok),
          toolName: tool.name,
          turnId: turn.turnId,
          sessionId: turn.sessionId,
          result,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: result?.summary || JSON.stringify(result),
            },
          ],
          structuredContent: result,
          isError: result?.ok === false,
        };
      },
    );
  }

  return server;
}

export async function handleWalnutMcpRequest(req: Request, deps: WalnutMcpServerDeps) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = createWalnutMcpServer(deps);
  await server.connect(transport);
  return transport.handleRequest(req);
}

function safeTools(list: JsonObject) {
  return Array.isArray(list?.tools) ? list.tools : [];
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

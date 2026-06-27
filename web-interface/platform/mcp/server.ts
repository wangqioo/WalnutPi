import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { mergeToolAuthContext } from "../../gateway/auth-context.ts";

type JsonObject = Record<string, any>;

const REQUEST_CONTEXT_SCHEMA = {
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  traceId: z.string().optional(),
};

const TOOL_POLICIES: Record<string, {
  destructive: boolean;
  idempotent: boolean;
  inputSchema: Record<string, z.ZodTypeAny>;
  openWorld: boolean;
  readOnly: boolean;
}> = {
  "screen.readPlaylist": {
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    inputSchema: {
      playlistId: z.string().optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "screen.captureFrame": {
    readOnly: true,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      buildId: z.string().optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "screen.syncPlaylist": {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      playlistHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
      evidenceMode: z.enum(["fast", "full"]).optional(),
      mode: z.enum(["remote", "preview"]).optional(),
      previewOnly: z.boolean().optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "screen.renderWallpaper": {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      source: z.object({
        kind: z.enum(["local", "generated"]),
        path: z.string().min(1),
        sourceId: z.string().optional(),
        title: z.string().optional(),
        prompt: z.string().optional(),
        mediaType: z.string().optional(),
        license: z.string().optional(),
      }),
      screenId: z.string().min(1),
      preset: z.enum(["fit-cover:480x320", "fit-contain:480x320"]).optional(),
      outputType: z.enum(["static", "animated"]).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "screen.writePlaylist": {
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      playlistId: z.string().optional(),
      manifestId: z.string().min(1),
      mode: z.enum(["replace", "append"]),
      durationMs: z.number().int().positive().optional(),
      loop: z.boolean().optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "screen.widgetApp.sync": {
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      appId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,96}$/).optional(),
      versionId: z.string().min(1).max(160).optional(),
      evidenceMode: z.enum(["fast", "full"]).optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "screen.widgetApp.action": {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      action: z.string().min(1).max(120),
      params: z.record(z.string(), z.any()).optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "device.status.read": readOnlyToolSchema(),
  "diagnostics.recentFailure": readOnlyToolSchema(),
  "ai.chat": {
    readOnly: true,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      text: z.string().min(1).max(4000),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "device.network.read": readOnlyToolSchema(),
  "device.snapshot.read": readOnlyToolSchema(),
  "device.i2c.read": readOnlyToolSchema(),
  "device.gpio.read": readOnlyToolSchema(),
  "device.notes.read": readOnlyToolSchema(),
  "device.note.write": {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      text: z.string().min(1).max(1000),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "memory.sessionSummary": readOnlyToolSchema(),
  "memory.preference": {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      text: z.string().min(1).max(1000),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "memory.approve": {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      candidateId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "memory.sensitiveSkip": {
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    inputSchema: {
      text: z.string().min(1).max(1000),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "policy.action.prepare": {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      actionId: z.string().min(1),
      params: z.record(z.string(), z.any()).optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
  "policy.action.commit": {
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    inputSchema: {
      decisionId: z.string().min(1),
      actionId: z.string().min(1),
      params: z.record(z.string(), z.any()).optional(),
      approvalToken: z.string().min(1),
      execute: z.boolean().optional(),
      ...REQUEST_CONTEXT_SCHEMA,
    },
  },
};

export type WalnutMcpServerDeps = {
  auditLedger?: JsonObject;
  authContext?: JsonObject;
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
  authContext = {},
  toolCatalog,
  toolDispatcher,
}: WalnutMcpServerDeps) {
  const server = new McpServer({
    name: "walnutpi-platform-gateway",
    version: "0.1.0",
  });

  for (const tool of safeTools(toolCatalog.listTools())) {
    const policy = TOOL_POLICIES[tool.name];
    if (!policy) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: policy.inputSchema,
        annotations: {
          readOnlyHint: policy.readOnly,
          destructiveHint: policy.destructive,
          idempotentHint: policy.idempotent,
          openWorldHint: policy.openWorld,
        },
      },
      async (args) => {
        const params = objectOrEmpty(args);
        const mergedAuthContext = mergeToolAuthContext(authContext, params);
        const turn = {
          turnId: params.turnId || null,
          sessionId: params.sessionId || null,
          traceId: params.traceId || null,
          auth: mergedAuthContext,
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
          traceId: turn.traceId,
          subjectKind: mergedAuthContext.subject?.kind || null,
          deviceProfile: mergedAuthContext.environment?.deviceProfile || null,
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

function readOnlyToolSchema() {
  return {
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    inputSchema: REQUEST_CONTEXT_SCHEMA,
  };
}

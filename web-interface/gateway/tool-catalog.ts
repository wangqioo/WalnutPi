import { actionSummary } from "../action-policy.ts";

type JsonObject = Record<string, any>;

export type GatewayToolDefinition = {
  description: string;
  inputSchema: JsonObject;
  name: string;
  group: "screen" | "device" | "memory" | "diagnostics" | "policy" | "chat";
  route: string;
  actionId?: string | null;
};

const DEVICE_TOOL_NAMES = [
  "device.status.read",
  "device.network.read",
  "device.snapshot.read",
  "device.i2c.read",
  "device.gpio.read",
  "device.notes.read",
  "device.note.write",
];

export function createGatewayToolCatalog({
  policyActions,
}: JsonObject) {
  const actionSummaries = Object.fromEntries(
    Object.entries(policyActions || {}).map(([id, action]) => [id, actionSummary(action as any, id)]),
  );

  const tools = [
    tool("screen.readPlaylist", "screen", "Read a screen playlist envelope and hash.", "/api/screen/workspace/playlist", {
      playlistId: stringSchema("default"),
    }),
    tool("screen.captureFrame", "screen", "Capture a real device frame after sync.", "/api/screen/frame/:buildId", {
      buildId: optionalStringSchema(),
    }),
    tool("screen.syncPlaylist", "screen", "Synchronize the current playlist to the WalnutPi device.", "/api/screen/workspace/sync", {
      playlistHash: stringSchema(),
      evidenceMode: enumSchema(["fast", "full"], "fast"),
      mode: enumSchema(["remote", "preview"], "remote"),
    }),
    tool("screen.renderWallpaper", "screen", "Render a selected Source Asset into a Screen Manifest v2 through the Screen Command DSL.", "/api/screen/workspace/process", {
      source: objectSchema(),
      screenId: stringSchema(),
      preset: enumSchema(["fit-cover:480x320", "fit-contain:480x320"], "fit-cover:480x320"),
      outputType: enumSchema(["static", "animated"], "static"),
      title: optionalStringSchema(),
      description: optionalStringSchema(),
    }),
    tool("screen.writePlaylist", "screen", "Write a Screen Playlist v1 item for an existing Screen Manifest through the Screen Command DSL.", "/api/screen/workspace/playlist", {
      playlistId: stringSchema("default"),
      manifestId: stringSchema(),
      mode: enumSchema(["replace", "append"]),
      durationMs: numberSchema(8000),
      loop: booleanSchema(true),
    }),
    tool("screen.widgetApp.sync", "screen", "Prepare Widget App runtime sync through MCP and OPA before device delivery.", "/api/screen/widget-apps/current/sync", {
      appId: optionalStringSchema(),
      versionId: optionalStringSchema(),
      evidenceMode: enumSchema(["fast", "full"], "fast"),
    }, "screen_widget_app_sync"),
    tool("screen.widgetApp.action", "screen", "Run a Widget App action through the platform policy path.", "/api/screen/widget-apps/current/events", {
      action: stringSchema(),
      params: objectSchema(),
      decisionId: optionalStringSchema(),
      approvalToken: optionalStringSchema(),
      execute: booleanSchema(false),
    }),
    tool("memory.sessionSummary", "memory", "Summarize recent session activity from local ledgers.", "/api/session", {
      sessionId: optionalStringSchema(),
    }),
    tool("memory.preference", "memory", "Capture a durable memory candidate without committing a write.", "/api/session", {
      text: stringSchema(),
    }),
    tool("memory.approve", "memory", "Approve an existing memory candidate into durable memory.", "/api/session", {
      candidateId: stringSchema(),
    }),
    tool("memory.sensitiveSkip", "memory", "Reject sensitive content from durable memory.", "/api/session", {
      text: stringSchema(),
    }),
    tool("diagnostics.recentFailure", "diagnostics", "Summarize the latest local failure evidence.", "/api/metrics", {
      sessionId: optionalStringSchema(),
    }),
    tool("ai.chat", "chat", "Answer a general WalnutPi chat request through the Mastra chat agent.", "/api/agent/turn", {
      text: stringSchema(),
    }),
    tool("policy.action.prepare", "policy", "Prepare a catalog action through OPA before command construction.", "/mcp", {
      actionId: stringSchema(),
      params: objectSchema(),
    }),
    tool("policy.action.commit", "policy", "Commit a prepared catalog action with approval proof and a fresh OPA decision.", "/mcp", {
      decisionId: stringSchema(),
      actionId: stringSchema(),
      params: objectSchema(),
      approvalToken: stringSchema(),
      execute: booleanSchema(false),
    }),
  ];

  for (const name of DEVICE_TOOL_NAMES) {
    tools.push(tool(name, "device", actionDescriptionForSummary(actionSummaries[name]) || "Device action routed through the policy gate.", "/api/action", {
      action: stringSchema(),
    }, toolActionId(name)));
  }

  return {
    listTools() {
      return {
        schema: "walnutpi.gatewayTools.v1",
        tools: tools.map((toolDefinition) => ({
          name: toolDefinition.name,
          group: toolDefinition.group,
          route: toolDefinition.route,
          description: toolDefinition.description,
          inputSchema: toolDefinition.inputSchema,
          actionId: toolDefinition.actionId || null,
        })),
      };
    },
    toolForName(name: string) {
      return tools.find((toolDefinition) => toolDefinition.name === name) || null;
    },
    actionSummaries,
    hasTool(name: string) {
      return Boolean(tools.find((toolDefinition) => toolDefinition.name === name));
    },
    isDeviceTool(name: string) {
      return DEVICE_TOOL_NAMES.includes(name);
    },
    isScreenTool(name: string) {
      return name.startsWith("screen.");
    },
    isMemoryTool(name: string) {
      return name.startsWith("memory.");
    },
    isDiagnosticsTool(name: string) {
      return name.startsWith("diagnostics.");
    },
    isChatTool(name: string) {
      return name.startsWith("ai.");
    },
  };
}

function tool(name: string, group: GatewayToolDefinition["group"], description: string, route: string, inputSchema: JsonObject, actionId?: string | null): GatewayToolDefinition {
  return {
    name,
    group,
    description,
    route,
    inputSchema,
    actionId: actionId || null,
  };
}

function toolActionId(name: string) {
  if (name === "device.status.read") return "status";
  if (name === "device.network.read") return "network";
  if (name === "device.snapshot.read") return "snapshot";
  if (name === "device.i2c.read") return "i2c_scan";
  if (name === "device.gpio.read") return "gpio";
  if (name === "device.notes.read") return "notes";
  if (name === "device.note.write") return "note";
  return null;
}

function actionDescriptionForSummary(summary: any) {
  return String(summary?.reply || summary?.title || "").trim();
}

function stringSchema(defaultValue?: string) {
  return {
    type: "object",
    properties: {
      value: { type: "string", ...(defaultValue !== undefined ? { default: defaultValue } : {}) },
    },
    required: defaultValue === undefined ? ["value"] : [],
    additionalProperties: false,
  };
}

function optionalStringSchema() {
  return {
    type: "object",
    properties: {
      value: { type: "string" },
    },
    additionalProperties: false,
  };
}

function enumSchema(values: string[], defaultValue?: string) {
  return {
    type: "object",
    properties: {
      value: { type: "string", enum: values, ...(defaultValue !== undefined ? { default: defaultValue } : {}) },
    },
    required: defaultValue === undefined ? ["value"] : [],
    additionalProperties: false,
  };
}

function numberSchema(defaultValue?: number) {
  return {
    type: "object",
    properties: {
      value: { type: "number", ...(defaultValue !== undefined ? { default: defaultValue } : {}) },
    },
    required: defaultValue === undefined ? ["value"] : [],
    additionalProperties: false,
  };
}

function booleanSchema(defaultValue?: boolean) {
  return {
    type: "object",
    properties: {
      value: { type: "boolean", ...(defaultValue !== undefined ? { default: defaultValue } : {}) },
    },
    required: defaultValue === undefined ? ["value"] : [],
    additionalProperties: false,
  };
}

function objectSchema() {
  return {
    type: "object",
    additionalProperties: true,
  };
}

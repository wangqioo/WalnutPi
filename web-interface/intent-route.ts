type IntentRouteFields = {
  confidence?: number;
  delivery?: string;
  rule?: string;
  source?: string;
  subject?: string;
};

export type IntentRoute = {
  action: string;
  actionPolicyId: string | null;
  confidence: number;
  delivery: string;
  exposure: string[];
  intent: string;
  parameters: Record<string, any>;
  riskHint: string;
  route: string;
  rule?: string;
  schema: string;
  source: string;
  subject: string;
};

export const CLASSIFIER_INTENTS = [
  "screen.generate",
  "screen.sync",
  "screen.widget_app.create",
  "device.status.read",
  "device.snapshot.read",
  "device.i2c.read",
  "device.network.read",
  "device.gpio.read",
  "device.notes.read",
  "device.note.write",
  "memory.preference",
  "memory.sensitive_skip",
  "policy.system_write",
  "policy.service_restart",
  "policy.maintenance_guidance",
  "diagnostics.recent_failure",
  "screen.state_frame.read",
  "session.summary",
  "terminal.open",
  "terminal.tool",
  "ai.chat",
];

export function intentTypeToRoute(intent: string, fields: IntentRouteFields = {}): IntentRoute {
  const mapped = {
    "screen.generate": ["screen.wallpaper", "generate"],
    "screen.wallpaper.generate": ["screen.wallpaper", "generate"],
    "screen.sync": ["screen.wallpaper", "sync"],
    "screen.widget_app.create": ["screen.widget_app", "create"],
    "device.status.read": ["device.action", "read"],
    "device.snapshot.read": ["device.action", "read"],
    "device.i2c.read": ["device.action", "read"],
    "device.network.read": ["device.action", "read"],
    "device.gpio.read": ["device.action", "read"],
    "device.notes.read": ["memory.notes", "read"],
    "device.note.write": ["memory.notes", "write"],
    "memory.preference": ["memory.notes", "write"],
    "memory.sensitive_skip": ["memory.notes", "refuse"],
    "policy.system_write": ["device.action", "refuse"],
    "policy.service_restart": ["device.action", "confirm"],
    "policy.maintenance_guidance": ["device.action", "refuse"],
    "diagnostics.recent_failure": ["device.action", "read"],
    "screen.state_frame.read": ["device.action", "read"],
    "session.summary": ["ai.chat", "answer"],
    "terminal.open": ["terminal.surface", "open"],
    "terminal.tool": ["terminal.surface", "run_tool"],
    "ai.chat": ["ai.chat", "answer"],
  }[intent] || ["ai.chat", "answer"];
  const route: IntentRoute = {
    schema: "walnutpi.intent.route.v2",
    route: mapped[0],
    action: mapped[1],
    subject: String(fields.subject || "").trim(),
    delivery: fields.delivery || "none",
    riskHint: intent?.startsWith("policy.") ? "high" : intent?.startsWith("device.note.") ? "write" : intent?.startsWith("device.") || intent?.startsWith("diagnostics.") || intent?.startsWith("screen.state_") ? "read" : "none",
    exposure: intent?.startsWith("policy.") ? ["internal", "human_cli"] : intent?.startsWith("device.") || intent?.startsWith("diagnostics.") || intent?.startsWith("screen.state_") ? ["internal", "agent_action"] : ["internal"],
    actionPolicyId: null,
    parameters: {},
    confidence: Number(fields.confidence ?? 0.5),
    source: normalizeIntentSource(fields.source),
    intent: {
      "screen.wallpaper.generate": "screen.generate",
    }[intent] || intent,
  };
  if (fields.rule) route.rule = fields.rule;
  return route;
}

function normalizeIntentSource(source?: string) {
  const normalized = String(source || "").trim();
  return ["ai", "structured"].includes(normalized) ? normalized : "ai";
}

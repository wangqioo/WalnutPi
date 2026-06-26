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
  "screen.readPlaylist",
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
  "diagnostics.recentFailure",
  "diagnostics.recent_failure",
  "screen.state_frame.read",
  "session.summary",
  "ai.chat",
];

export function intentTypeToRoute(intent: string, fields: IntentRouteFields = {}): IntentRoute {
  const mapped = {
    "screen.generate": ["screen.wallpaper", "generate"],
    "screen.wallpaper.generate": ["screen.wallpaper", "generate"],
    "screen.sync": ["screen.wallpaper", "sync"],
    "screen.readPlaylist": ["screen.wallpaper", "read"],
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
    "diagnostics.recentFailure": ["device.action", "read"],
    "diagnostics.recent_failure": ["device.action", "read"],
    "screen.state_frame.read": ["device.action", "read"],
    "session.summary": ["ai.chat", "answer"],
    "ai.chat": ["ai.chat", "answer"],
  }[intent] || ["ai.chat", "answer"];
  const route: IntentRoute = {
    schema: "walnutpi.intent.route.v2",
    route: mapped[0],
    action: mapped[1],
    subject: String(fields.subject || "").trim(),
    delivery: fields.delivery || "none",
    riskHint: intent?.startsWith("policy.") ? "high" : intent?.startsWith("device.note.") ? "write" : readOnlyIntent(intent) ? "read" : "none",
    exposure: intent?.startsWith("policy.") ? ["internal", "human_cli"] : readOnlyIntent(intent) ? ["internal", "agent_action"] : ["internal"],
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

function readOnlyIntent(intent: string) {
  return intent?.startsWith("device.")
    || intent?.startsWith("diagnostics.")
    || intent === "screen.state_frame.read"
    || intent === "screen.readPlaylist";
}

function normalizeIntentSource(source?: string) {
  const normalized = String(source || "").trim();
  return ["ai", "structured"].includes(normalized) ? normalized : "ai";
}

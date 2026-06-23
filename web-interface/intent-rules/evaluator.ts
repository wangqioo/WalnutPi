import { Engine } from "json-rules-engine";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractIntentFacts } from "./facts.ts";

type IntentRouteFields = {
  confidence?: number;
  delivery?: string;
  rule?: string;
  source?: string;
  subject?: string;
};
type IntentRoute = {
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

let cachedEngine: Engine | null = null;
let cachedRules: string | null = null;
let cachedSubjectConfigPath: string | null = null;
let cachedSubjectConfig: { noteWritePrefixes?: string[] } | null = null;

export async function evaluateRuleIntent(text: string, { rulesPath = path.join(import.meta.dir, "rules.json") }: { rulesPath?: string } = {}) {
  const facts = await extractIntentFacts(text);
  const engine = await loadEngine(rulesPath);
  const result = await engine.run(facts);
  const event = result.events[0];
  if (!event) return { classification: null, facts };
  return {
    facts,
    classification: intentTypeToRoute(event.type, {
      subject: await deriveSubject(text, event.type),
      delivery: event.params?.delivery || "none",
      confidence: Number(event.params?.confidence ?? 0.8),
      source: "fallback-rule",
      rule: event.params?.rule || event.type,
    }),
  };
}

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
  return ["ai", "structured", "fallback-rule"].includes(normalized) ? normalized : "fallback-rule";
}

async function loadEngine(rulesPath: string) {
  if (cachedEngine && cachedRules === rulesPath) return cachedEngine;
  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  const engine = new Engine([], { allowUndefinedFacts: true });
  for (const rule of rules) {
    engine.addRule({
      ...rule,
      event: {
        ...rule.event,
        params: {
          ...(rule.event?.params || {}),
          rule: rule.name || rule.event?.type,
        },
      },
    });
  }
  cachedRules = rulesPath;
  cachedEngine = engine;
  return engine;
}

async function deriveSubject(text: string, intent: string) {
  const value = String(text || "").trim();
  if (intent === "device.note.write") {
    for (const prefix of (await loadSubjectConfig()).noteWritePrefixes || []) {
      if (value.toLowerCase().startsWith(prefix.toLowerCase())) {
        return value.slice(prefix.length).replace(/^[:：\s]+/, "").trim() || value;
      }
    }
  }
  return value;
}

async function loadSubjectConfig(configPath = path.join(import.meta.dir, "subject.json")) {
  if (cachedSubjectConfig && cachedSubjectConfigPath === configPath) return cachedSubjectConfig;
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  if (parsed.noteWritePrefixes !== undefined && (!Array.isArray(parsed.noteWritePrefixes) || parsed.noteWritePrefixes.some((item: any) => typeof item !== "string"))) {
    throw new Error("subject noteWritePrefixes must be a string array");
  }
  cachedSubjectConfigPath = configPath;
  cachedSubjectConfig = parsed;
  return parsed;
}

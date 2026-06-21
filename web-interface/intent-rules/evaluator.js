import { Engine } from "json-rules-engine";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractIntentFacts } from "./facts.js";

let cachedEngine = null;
let cachedRules = null;

export async function evaluateRuleIntent(text, { rulesPath = path.join(import.meta.dir, "rules.json") } = {}) {
  const facts = extractIntentFacts(text);
  const engine = await loadEngine(rulesPath);
  const result = await engine.run(facts);
  const event = result.events[0];
  if (!event) return { classification: null, facts };
  return {
    facts,
    classification: intentTypeToRoute(event.type, {
      subject: deriveSubject(text, event.type),
      delivery: event.params?.delivery || "none",
      confidence: Number(event.params?.confidence ?? 0.8),
      source: "rule",
      rule: event.params?.rule || event.type,
    }),
  };
}

export function intentTypeToRoute(intent, fields = {}) {
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
  const route = {
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
    source: fields.source === "ai" ? "ai" : "rule",
    intent: {
      "screen.wallpaper.generate": "screen.generate",
    }[intent] || intent,
  };
  if (intent === "screen.widget_app.create" && /设备|状态|status|快捷/.test(route.subject)) {
    route.parameters.template = "device_status_quick_actions";
  }
  if (fields.rule) route.rule = fields.rule;
  return route;
}

async function loadEngine(rulesPath) {
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

function deriveSubject(text, intent) {
  const value = String(text || "").trim();
  if (intent === "device.note.write") {
    return value.replace(/^(?:记一下|记录|note)\s*[:：]?\s*/i, "").trim() || value;
  }
  if (intent === "screen.generate" || intent === "screen.wallpaper.generate" || intent === "screen.widget_app.create") {
    return value
      .replace(/^(?:请|麻烦|帮我|给我|你|我要|我想|直接开始|直接|先|开始|继续|现在|按这个|就这个|照这个)\s*/i, "")
      .replace(/(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)\s*/i, "")
      .replace(/(?:然后|并且|并|再)?\s*(?:同步|部署|推送|烧录|运行到|显示到)\s*(?:到|至)?\s*(?:核桃派|设备|板子|小屏|屏幕|lvgl|screen)?/ig, "")
      .replace(/[，。,.!！?？；;：:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Screen Workspace output";
  }
  return value;
}

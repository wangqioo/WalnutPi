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
    classification: {
      intent: event.type,
      subject: deriveSubject(text, event.type),
      delivery: event.params?.delivery || "none",
      confidence: Number(event.params?.confidence ?? 0.8),
      source: "rule",
      rule: event.params?.rule || event.type,
    },
  };
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
  if (intent === "screen.generate") {
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

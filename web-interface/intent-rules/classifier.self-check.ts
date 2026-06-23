import assert from "node:assert/strict";
import { createWalnutIntentClassifier } from "./classifier.ts";

let modelCalls = 0;
let modelErrors = 0;
const classifier = createWalnutIntentClassifier({
  aiEnabled: true,
  async classifyWithModel() {
    modelCalls += 1;
    return { intent: "ai.chat", subject: "model route", delivery: "none", confidence: 0.7 };
  },
  async recordModelError() {
    modelErrors += 1;
  },
});

const structured = await classifier.classifyIntent("只读续步", {
  scenario: {
    allowedContinuations: [{ kind: "action.run", action: "status" }],
    constraints: ["read-only-continuation"],
  },
});
assert.equal(structured.classification.intent, "device.snapshot.read");
assert.equal(structured.classification.source, "structured");
assert.equal(modelCalls, 0);

const safety = await classifier.classifyIntent("帮我安装一个系统包并重启核桃派");
assert.equal(safety.classification.intent, "policy.system_write");
assert.equal(safety.classification.source, "fallback-rule");
assert.equal(safety.ruleShortCircuited, true);
assert.equal(modelCalls, 0);

const model = await classifier.classifyIntent("生成一个天气小屏，然后同步到核桃派。");
assert.equal(model.classification.intent, "ai.chat");
assert.equal(model.classification.source, "ai");
assert.equal(model.aiClassifierUsed, true);
assert.equal(modelCalls, 1);

const fallbackClassifier = createWalnutIntentClassifier({
  aiEnabled: false,
  async classifyWithModel() {
    throw new Error("model should not be called");
  },
  async recordModelError() {
    throw new Error("model error should not be recorded");
  },
});
const fallback = await fallbackClassifier.classifyIntent("生成一个天气小屏，然后同步到核桃派。");
assert.equal(fallback.classification.intent, "screen.generate");
assert.equal(fallback.classification.source, "fallback-rule");
assert.equal(fallback.ruleShortCircuited, false);

const modelErrorClassifier = createWalnutIntentClassifier({
  aiEnabled: true,
  async classifyWithModel() {
    throw new Error("model unavailable");
  },
  async recordModelError() {
    modelErrors += 1;
  },
});
const modelErrorFallback = await modelErrorClassifier.classifyIntent("把当前小屏同步到核桃派。");
assert.equal(modelErrorFallback.classification.intent, "screen.sync");
assert.equal(modelErrorFallback.classification.source, "fallback-rule");
assert.equal(modelErrors, 1);

console.log("intent classifier order self-check passed");

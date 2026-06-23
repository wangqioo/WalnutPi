import { intentTypeToRoute } from "./evaluator.ts";
import { classifyFallbackRuleIntent } from "./fallback.ts";
import { classifySafetyRuleIntent } from "./safety.ts";
import { classifyStructuredIntent } from "./structured.ts";

type JsonObject = Record<string, any>;

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

export function createWalnutIntentClassifier({
  aiEnabled,
  classifyWithModel,
  recordModelError,
}: {
  aiEnabled: boolean;
  classifyWithModel: (text: string, telemetry?: JsonObject) => Promise<JsonObject>;
  recordModelError: (error: Error, text: string, telemetry?: JsonObject) => Promise<void>;
}) {
  return {
    async classifyIntent(text: string, telemetry: JsonObject = {}) {
      const structured = classifyStructuredIntent(text, telemetry);
      if (structured) return structured;

      const safetyRule = await classifySafetyRuleIntent(text);
      if (safetyRule) return safetyRule;

      if (aiEnabled) {
        try {
          const aiClassification = normalizeClassifierRoute(await classifyWithModel(text, telemetry), text);
          return {
            classification: aiClassification,
            ruleIntent: null,
            ruleShortCircuited: false,
            aiClassifierUsed: true,
          };
        } catch (error) {
          await recordModelError(error, text, telemetry);
        }
      }

      const fallback = await classifyFallbackRuleIntent(text);
      if (fallback) return fallback;
      throw new Error("intent classifier did not match");
    },
  };
}

function normalizeClassifierRoute(raw: JsonObject, text: string) {
  const intent = String(raw?.intent || "").trim();
  if (!CLASSIFIER_INTENTS.includes(intent)) {
    throw new Error(`AI classifier returned unsupported intent: ${intent || "(missing)"}`);
  }
  const delivery = ["none", "sync_after_preview", "sync_existing"].includes(String(raw?.delivery || "none"))
    ? String(raw?.delivery || "none")
    : "none";
  const confidence = clamp(Number(raw?.confidence ?? 0.7), 0, 1);
  const route = intentTypeToRoute(intent, {
    subject: String(raw?.subject || text || "").trim(),
    delivery,
    confidence,
    source: "ai",
  });
  route.parameters = {};
  return route;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

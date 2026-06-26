import { CLASSIFIER_INTENTS, intentTypeToRoute } from "./intent-route.ts";

type JsonObject = Record<string, any>;

export { CLASSIFIER_INTENTS };

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

      if (!aiEnabled) {
        throw new Error("AI intent classifier is not configured");
      }

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
        throw error;
      }
    },
  };
}

function classifyStructuredIntent(text: string, telemetry: JsonObject = {}) {
  const scenario = telemetry?.scenario && typeof telemetry.scenario === "object" ? telemetry.scenario : null;
  const continuations = Array.isArray(scenario?.allowedContinuations) ? scenario.allowedContinuations : [];
  const constraints = Array.isArray(scenario?.constraints) ? scenario.constraints.map((item: any) => String(item || "")) : [];
  if (!continuations.length || !constraints.includes("read-only-continuation")) return null;
  const intent = continuations
    .map((item: any) => String(item || "").trim())
    .find((item: string) => CLASSIFIER_INTENTS.includes(item) && readOnlyContinuationIntent(item));
  if (!intent) return null;
  return {
    classification: intentTypeToRoute(intent, {
      subject: text,
      delivery: "none",
      confidence: 0.98,
      source: "structured",
      rule: "scenario.read-only-continuation",
    }),
    ruleIntent: null,
    ruleShortCircuited: false,
    aiClassifierUsed: false,
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
  return intentTypeToRoute(intent, {
    subject: String(raw?.subject || text || "").trim(),
    delivery,
    confidence: clamp(Number(raw?.confidence ?? 0.7), 0, 1),
    source: "ai",
  });
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function readOnlyContinuationIntent(intent: string) {
  return intent.startsWith("device.")
    || intent.startsWith("diagnostics.")
    || intent === "screen.state_frame.read"
    || intent === "session.summary";
}

import { intentTypeToRoute } from "./evaluator.ts";

type JsonObject = Record<string, any>;

export function classifyStructuredIntent(text: string, telemetry: JsonObject = {}) {
  const scenario = telemetry?.scenario && typeof telemetry.scenario === "object" ? telemetry.scenario : null;
  const continuations = Array.isArray(scenario?.allowedContinuations) ? scenario.allowedContinuations : [];
  const constraints = Array.isArray(scenario?.constraints) ? scenario.constraints.map((item: any) => String(item || "")) : [];
  if (!continuations.length || !constraints.includes("read-only-continuation")) return null;
  const intent = "device.snapshot.read";
  const classification = intentTypeToRoute(intent, {
    subject: text,
    delivery: "none",
    confidence: 0.98,
    source: "structured",
    rule: "scenario.read-only-continuation",
  });
  return {
    classification,
    ruleIntent: null,
    ruleShortCircuited: false,
    aiClassifierUsed: false,
  };
}

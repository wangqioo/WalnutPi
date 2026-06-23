import { evaluateRuleIntent } from "./evaluator.ts";

export async function classifySafetyRuleIntent(text: string) {
  const evaluated = await evaluateRuleIntent(text);
  const intent = evaluated.classification?.intent || "";
  if (!intent.startsWith("policy.") && intent !== "memory.sensitive_skip") return null;
  return {
    classification: {
      ...evaluated.classification,
      source: "fallback-rule",
    },
    ruleIntent: evaluated.classification,
    ruleShortCircuited: true,
    aiClassifierUsed: false,
  };
}

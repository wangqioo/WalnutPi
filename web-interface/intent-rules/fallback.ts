import { evaluateRuleIntent } from "./evaluator.ts";

export async function classifyFallbackRuleIntent(text: string) {
  const evaluated = await evaluateRuleIntent(text);
  if (!evaluated.classification) return null;
  return {
    classification: {
      ...evaluated.classification,
      source: "fallback-rule",
    },
    ruleIntent: evaluated.classification,
    ruleShortCircuited: false,
    aiClassifierUsed: false,
  };
}

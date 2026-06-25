import { decideActionPolicy, publicPolicyDecision } from "../action-policy-decision.ts";

type JsonObject = Record<string, any>;

export function createOpaEnforcer({ policyManifest }: JsonObject) {
  return {
    decideAction({ actionId, executor, params }: JsonObject) {
      return decideActionPolicy({
        manifest: policyManifest,
        executor,
        actionId,
        params,
      });
    },

    publicDecision(decision: JsonObject) {
      return publicPolicyDecision(decision as any);
    },
  };
}

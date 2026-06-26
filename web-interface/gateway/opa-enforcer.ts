import { decideActionPolicy, publicPolicyDecision } from "../action-policy-decision.ts";

type JsonObject = Record<string, any>;

export function createOpaEnforcer({ policyManifest, opaBoundary = null }: JsonObject) {
  return {
    decideAction({ actionId, executor, params }: JsonObject) {
      return decideActionPolicy({
        manifest: policyManifest,
        executor,
        actionId,
        params,
      });
    },

    async decideActionAsync({ actionId, executor, params }: JsonObject) {
      if (opaBoundary?.decideAction) {
        return opaBoundary.decideAction({
          actionId,
          executor,
          params,
        });
      }
      return this.decideAction({ actionId, executor, params });
    },

    publicDecision(decision: JsonObject) {
      return publicPolicyDecision(decision as any);
    },
  };
}

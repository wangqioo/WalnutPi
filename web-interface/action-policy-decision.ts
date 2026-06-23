import { actionSummary, resolveAction } from "./action-policy.ts";

type JsonObject = Record<string, any>;

export type ActionPolicyDecision = {
  action?: JsonObject;
  actionId: string;
  allow: boolean;
  engine: string;
  parameterValues?: JsonObject;
  reason: string;
  schema: "walnutpi.action-policy-decision.v1";
  status: "allow" | "pending" | "refused";
};

export function decideActionPolicy({
  actionId,
  executor,
  manifest,
  params,
}: {
  actionId: string;
  executor: string;
  manifest: any;
  params?: JsonObject;
}): ActionPolicyDecision {
  const resolved = manifest
    ? resolveAction(manifest, { executor, actionId, params: params || {} })
    : { ok: false, status: "refused", actionId, reason: "policy-manifest-missing" };
  const action = resolved.action;
  const base = {
    schema: "walnutpi.action-policy-decision.v1" as const,
    engine: "local-manifest",
    actionId: resolved.actionId || actionId,
    action,
    parameterValues: resolved.parameterValues || {},
  };
  if (resolved.status === "runnable") {
    return {
      ...base,
      allow: true,
      status: "allow",
      reason: "local-manifest-allowed",
    };
  }
  if (resolved.status === "pending") {
    return {
      ...base,
      allow: false,
      status: "pending",
      reason: "explicit-confirmation-required",
    };
  }
  return {
    ...base,
    allow: false,
    status: "refused",
    reason: resolved.reason || "policy-refused",
  };
}

export function publicPolicyDecision(decision: ActionPolicyDecision) {
  return {
    schema: decision.schema,
    engine: decision.engine,
    actionId: decision.actionId,
    allow: decision.allow,
    status: decision.status,
    reason: decision.reason,
    noCommandExecution: !decision.allow,
  };
}

export function decisionActionSummary(decision: ActionPolicyDecision) {
  return decision.action ? actionSummary(decision.action as any, decision.actionId) : {};
}

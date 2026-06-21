import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeActionPolicyManifest, resolveAction } from "../action-policy.js";
import { policyActionIdsForIntent } from "../action-registry.js";

/**
 * Policy agent — evaluates requested actions against the action policy
 * manifest and returns a decision (refused / pending-confirmation).
 *
 * Plan matching: intent starts with "policy."
 */
export function createPolicyAgent() {
  let cachedActionPolicyManifest = null;

  return {
    matchPlan(classification) {
      const intent = classification?.intent || "";
      if (intent.startsWith("policy.")) {
        return [{ agent: "policy", kind: "policy.decision", policyIntent: intent }];
      }
      return null;
    },

    async run(task, ctx) {
      const { text } = ctx;
      const result = await policyDecisionResult(task.policyIntent || "", text, () => loadManifest());

      ctx.setCompleted(result);
      ctx.setTurnResult(true, result);
      ctx.finishAgent();
      ctx.observeStepResult();
      await ctx.updateTurnTrace();
      await ctx.emitStepDone();
      return { ok: true, status: 200, stepId: ctx.step.id, stepResult: result };
    },
  };

  async function loadManifest() {
    if (cachedActionPolicyManifest) return cachedActionPolicyManifest;
    const manifestDir = path.resolve(import.meta.dirname, "..");
    const manifestPath = path.join(manifestDir, "..", "action-policy-manifest.json");
    cachedActionPolicyManifest = normalizeActionPolicyManifest(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    return cachedActionPolicyManifest;
  }
}

async function policyDecisionResult(policyIntent, text, loadManifest) {
  const manifest = await loadManifest();
  const decisions = (policyActionIdsForIntent(policyIntent) || []).map((actionId) => {
    const action = manifest.actions[actionId] || {};
    const executor = action.allowedExecutors?.includes("walnut-cli") ? "walnut-cli" : action.allowedExecutors?.[0] || "policy";
    const decision = resolveAction(manifest, { executor, actionId });
    return {
      actionId,
      status: decision.status,
      reason: decision.reason || null,
      title: decision.action?.title || manifest.actions[actionId]?.title || actionId,
      risk: decision.action?.risk || manifest.actions[actionId]?.risk || "high",
      mode: decision.action?.mode || manifest.actions[actionId]?.mode || "refused",
      confirmationRequired: Boolean(decision.action?.confirmationRequired),
    };
  });
  const hasPending = decisions.some((item) => item.status === "pending");
  const hasRefused = decisions.some((item) => item.status === "refused");
  const summary = hasPending
    ? "该动作需要显式确认；本轮只生成 policy decision，不执行远程命令。"
    : "该请求包含当前 Agent Action 不允许执行的系统写入；本轮只返回拒绝/人工处理建议。";
  return {
    ok: true,
    summary,
    decisions,
    evidence: {
      policyDecisionEvidence: decisions,
      refusedLocalAction: hasRefused || null,
      pendingLocalAction: hasPending || null,
      pendingOrRefusedReboot: decisions.some((item) => item.actionId.includes("reboot")) || null,
      confirmationTokenOrPendingId: hasPending ? `pending-${decisions.map((item) => item.actionId).join("-")}` : null,
      riskExplanation: summary,
      policyRefusalOrManualGuidance: hasRefused || policyIntent === "policy.maintenance_guidance" ? "manual confirmation required before any cleanup/system write" : null,
      optionalReadOnlyStatus: policyIntent === "policy.maintenance_guidance" ? "read-only status can be checked separately" : null,
      noActionPolicyDecision: policyIntent === "policy.maintenance_guidance" ? true : null,
      noCommandExecution: true,
      noRemoteCommandExecution: true,
      userRequest: text,
    },
  };
}

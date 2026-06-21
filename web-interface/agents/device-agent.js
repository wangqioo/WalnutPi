import {
  actionIdForIntent,
  isObservationReplanRequest,
  normalizeNextTasks,
} from "../action-registry.js";

/**
 * Device agent — handles action.run by delegating remote/terminal execution.
 *
 * Plan matching:
 *   1. Observation-replan subject → snapshot
 *   2. Known intent-to-action mapping → matching action
 */
export function createDeviceAgent() {
  return {
    matchPlan(classification) {
      const subject = classification?.subject || "";
      if (isObservationReplanRequest(subject)) {
        return [{ agent: "device", kind: "action.run", action: "snapshot" }];
      }
      const intent = classification?.intent || "";
      const actionId = actionIdForIntent(intent);
      if (actionId) {
        return [{ agent: "device", kind: "action.run", action: actionId }];
      }
      return null;
    },

    async run(task, ctx) {
      const { body, turn, runAction } = ctx;

      const actionResult = await runAction({
        ...body,
        action: task.action,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        text: body.text,
      });

      if (actionResult.body?.ok && task.action === "snapshot" && isObservationReplanRequest(String(body.text || ""))) {
        actionResult.body = withObservationReplanNextTask(actionResult.body);
      }

      ctx.step.action = task.action;
      const ok = Boolean(actionResult.body?.ok);
      ctx.setStepResult(ok, actionResult.body);
      ctx.setTurnResult(ok, actionResult.body);
      ctx.finishAgent();
      ctx.observeStepResult();
      await ctx.updateTurnTrace();
      await ctx.emitStepDone();
      if (!ok) await ctx.emitTurnDone();
      return { ok, status: actionResult.status || 500, stepId: ctx.step.id, stepResult: ctx.step.result };
    },
  };
}

function withObservationReplanNextTask(result) {
  const existing = normalizeNextTasks(result.nextTasks || result.pendingNext?.nextTasks);
  if (existing.length) return result;
  return {
    ...result,
    summary: result.summary || result.output || "只读观察完成；发现可安全自动继续的只读状态检查。",
    nextTasks: [{ agent: "device", kind: "action.run", action: "status" }],
    evidence: {
      ...(result.evidence || {}),
      observationReplan: {
        mode: "read-only",
        selectedNextTask: "status",
        continuationPolicy: "safe-read-only-only",
      },
    },
  };
}

import {
  actionIdForIntent,
  normalizeNextTasks,
} from "../action-registry.ts";

/**
 * Device agent — handles action.run by delegating remote/terminal execution.
 *
 * Plan matching:
 *   1. Scenario contract with safe continuations → snapshot
 *   2. Known intent-to-action mapping → matching action
 */
export function createDeviceAgent() {
  return {
    matchPlan(classification) {
      const subject = classification?.subject || "";
      if (classification?.scenario?.allowedContinuations?.length) {
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
        requirements: body.requirements,
      });

      if (actionResult.body?.ok && task.action === "snapshot" && body.scenario?.allowedContinuations?.length) {
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
      return { ok, status: actionResult.status || 500, stepId: ctx.step.id, stepResult: ctx.stepResult() };
    },
  };
}

function withObservationReplanNextTask(result) {
  const existing = normalizeNextTasks(result.nextTasks || result.pendingNext?.nextTasks);
  if (existing.length) return result;
  return {
    ...result,
    summary: result.summary || result.output || "read-only observation completed; safe status continuation is available",
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

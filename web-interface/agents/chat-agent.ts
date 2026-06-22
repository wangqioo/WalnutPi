/**
 * Chat agent — explicit AI action handler.
 */
export function createChatAgent() {
  return {
    matchPlan() {
      return [{ agent: "chat", kind: "action.run", action: "ai" }];
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

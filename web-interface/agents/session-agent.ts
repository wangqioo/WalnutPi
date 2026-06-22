/**
 * Session agent — summarizes recent conversation history.
 *
 * Plan matching: intent === "session.summary"
 */
export function createSessionAgent() {
  return {
    matchPlan(classification) {
      if (classification?.intent === "session.summary") {
        return [{ agent: "session", kind: "session.summary" }];
      }
      return null;
    },

    async run(task, ctx) {
      const { turn, sessionId, text, turnLedger } = ctx;
      const previousTurns = (await turnLedger?.readTurns({ sessionId, count: 20 })) || [];
      const result = summarizeSession({ sessionId, previousTurns, currentText: text });

      ctx.setCompleted(result);
      ctx.setTurnResult(true, result);
      ctx.finishAgent();
      ctx.observeStepResult();
      await ctx.updateTurnTrace();
      await ctx.emitStepDone();
      return { ok: true, status: 200, stepId: ctx.step.id, stepResult: result };
    },
  };
}

function summarizeSession({ sessionId, previousTurns, currentText }) {
  const items = previousTurns
    .filter((item) => item.input?.text && item.input.text !== currentText)
    .slice(-8)
    .map((item) => `- ${item.input.text} -> ${item.status}${item.route?.intent ? ` (${item.route.intent})` : ""}`);
  const summary = items.length ? items.join("\n") : "这次会话里还没有可总结的历史请求。";
  return {
    ok: true,
    summary,
    evidence: {
      schema: "walnutpi.session-summary-evidence.v1",
      sessionId,
      eventsReadCount: previousTurns.length,
      summaryResult: "ok",
      noMemoryWrite: true,
      writes: [],
    },
  };
}

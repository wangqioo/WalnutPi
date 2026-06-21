/**
 * Diagnostics agent — reads recent failure diagnostics from turn and metrics ledgers.
 *
 * Plan matching: intent === "diagnostics.recent_failure"
 */
export function createDiagnosticsAgent() {
  return {
    matchPlan(classification) {
      if (classification?.intent === "diagnostics.recent_failure") {
        return [{ agent: "diagnostics", kind: "diagnostics.recent_failure.read" }];
      }
      return null;
    },

    async run(task, ctx) {
      const { sessionId, turnLedger, metricsLedger } = ctx;
      const previousTurns = (await turnLedger?.readTurns({ sessionId, count: 50 })) || [];
      const metricsReport = (await metricsLedger?.report?.(200, { sessionId })) || null;
      const result = recentFailureDiagnosticsResult({ previousTurns, metricsReport });

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

function recentFailureDiagnosticsResult({ previousTurns, metricsReport }) {
  const failedTurn = [...previousTurns].reverse().find((item) => item.status === "failed" || item.result?.ok === false);
  const failedMetric = [...(metricsReport?.events || [])].reverse().find((item) => item.ok === false);
  const operation = failedMetric?.operation || failedTurn?.steps?.findLast?.((step) => step.status === "failed")?.kind || failedTurn?.route?.intent || "none-found";
  const error = failedMetric?.error || failedTurn?.error || failedTurn?.result?.error || failedTurn?.result?.output || "no recent failure found in local ledgers";
  const stage = failedMetric?.stage || failedTurn?.result?.failedStage || failedTurn?.steps?.findLast?.((step) => step.status === "failed")?.kind || "ledger-read";
  const trace = failedMetric?.traceId || failedMetric?.buildId || failedTurn?.turnId || null;
  const summary = failedTurn || failedMetric
    ? `最近失败点：${operation}，阶段：${stage}。`
    : "只读检查了最近 turn/metrics ledger，未找到失败记录。";
  return {
    ok: true,
    summary,
    evidence: {
      diagnosticSummary: summary,
      traceIdOrBuildId: trace || "not-found",
      failedOperation: operation,
      errorMessage: String(error).slice(0, 500),
      stageOrSegments: failedMetric?.segments || stage,
      repairOptions: ["do not retry automatically", "inspect referenced trace", "rerun only after explicit user confirmation"],
    },
  };
}

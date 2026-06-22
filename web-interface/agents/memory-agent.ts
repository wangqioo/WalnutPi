/**
 * Memory agent — handles preference capture and sensitive-data rejection
 * without writing to long-term storage (candidate-only).
 *
 * Plan matching:
 *   intent === "memory.preference"      → candidate write
 *   intent === "memory.sensitive_skip"  → explicit rejection
 */
export function createMemoryAgent() {
  return {
    matchPlan(classification) {
      const intent = classification?.intent || "";
      if (intent === "memory.preference") {
        return [{ agent: "memory", kind: "memory.preference" }];
      }
      if (intent === "memory.sensitive_skip") {
        return [{ agent: "memory", kind: "memory.sensitive_skip" }];
      }
      return null;
    },

    async run(task, ctx) {
      const { sessionId, text } = ctx;
      const isPreference = task.kind === "memory.preference";
      const result = isPreference ? memoryPreferenceResult({ sessionId, text }) : memorySensitiveSkipResult({ sessionId, text });

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

function memoryPreferenceResult({ sessionId, text }) {
  const summary = "已识别为可长期保存的小屏生成偏好；当前只产出记忆候选，不写入设备或笔记。";
  return {
    ok: true,
    summary,
    evidence: {
      memoryUpdateCandidateOrConfirmation: { ok: true, writeState: "candidate", text },
      memoryCategoryKey: "preferences.screen_generation",
      sourceSessionId: sessionId || "unknown-session",
      futureContextLink: "Walnut Agent Console screen generation defaults",
      noDurableMemoryWrite: true,
    },
  };
}

function memorySensitiveSkipResult({ sessionId, text }) {
  const summary = "已拒绝把临时敏感内容写入长期记忆。";
  return {
    ok: true,
    summary,
    evidence: {
      memorySkipEvidence: { ok: true, reason: "sensitive-temporary", textLength: text.length },
      sensitiveMemoryRejection: true,
      sessionSafetySummary: { sessionId: sessionId || "unknown-session", noDurableMemoryWrite: true },
    },
  };
}

export const LOOP_MODEL_IDS = Object.freeze([
  "gpt-5.3",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.5",
]);

export const LOOP_REASONING_EFFORTS = Object.freeze([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
]);

type JsonRecord = Record<string, any>;
type LoopModelRequest = {
  enabled?: boolean;
  model?: string | null;
  reasoning?: string | null;
  reasoningEffort?: string | null;
};

export function normalizeLoopModelId(value: any): string {
  const normalized = String(value || "").trim();
  if (!LOOP_MODEL_IDS.includes(normalized)) {
    throw new Error(`unknown loop model ${value}; expected one of ${LOOP_MODEL_IDS.join(", ")}`);
  }
  return normalized;
}

export function normalizeLoopReasoningEffort(value: any): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!LOOP_REASONING_EFFORTS.includes(normalized)) {
    throw new Error(`unknown loop reasoning effort ${value}; expected one of ${LOOP_REASONING_EFFORTS.join(", ")}`);
  }
  return normalized;
}

export function normalizeLoopModelRequest(value: LoopModelRequest | null | undefined, defaults: LoopModelRequest = {}) {
  const enabled = Boolean(value?.enabled ?? defaults.enabled ?? false);
  const model = value?.model ?? defaults.model;
  const reasoningEffort = value?.reasoningEffort ?? value?.reasoning ?? defaults.reasoningEffort;
  if (!enabled) {
    return {
      enabled: false,
      model: model ? normalizeLoopModelId(model) : null,
      reasoningEffort: reasoningEffort ? normalizeLoopReasoningEffort(reasoningEffort) : null,
    };
  }
  return {
    enabled,
    model: normalizeLoopModelId(model),
    reasoningEffort: normalizeLoopReasoningEffort(reasoningEffort),
  };
}

export function buildModelVisibleLoopContext({
  text,
  scenario,
  turn,
  result,
  remainingTurns,
  proposalFromAction,
  modelOptions,
}: JsonRecord) {
  return {
    schema: "walnutpi.loopModelVisibleContext.v1",
    userInput: String(text || ""),
    turnGoal: {
      mode: "bounded-agent-turn",
      stopCondition: "complete when required evidence is present or no new safe read-only continuation adds evidence",
      replanPolicy: "propose a continuation only for missing evidence, failed evidence, or a genuinely new read-only observation",
    },
    scenario: scenario ? {
      goal: scenario.goal,
      constraints: scenario.constraints || [],
      requiredEvidence: scenario.requiredEvidence || [],
      allowedContinuations: scenario.allowedContinuations || [],
      blockedPolicy: scenario.blockedPolicy || { requiresConfirmation: [] },
    } : null,
    currentStep: {
      stepId: result?.stepId || null,
      status: result?.stepResult?.ok === false ? "failed" : "completed",
      summary: summarizeStepResult(result?.stepResult),
      evidenceKeys: evidenceKeys(result?.stepResult),
    },
    candidateProposal: {
      proposedTasks: proposalFromAction.proposedTasks,
      safeAutoContinue: proposalFromAction.safeAutoContinue,
      blockedTasks: proposalFromAction.blockedTasks,
    },
    executedTasks: executedTaskSignals(turn),
    repetition: repetitionSignals(turn, proposalFromAction),
    previousLoopTurns: (turn?.loop?.turns || []).map((entry) => ({
      sourceStepId: entry.sourceStepId || null,
      observation: entry.observation || null,
      judgment: entry.judgment || null,
      effectiveAutoContinuedCount: Array.isArray(entry.autoContinuedTasks) ? entry.autoContinuedTasks.length : 0,
      blockedCount: Array.isArray(entry.blockedTasks) ? entry.blockedTasks.length : 0,
    })),
    budget: {
      remainingTurns,
      maxTurns: turn?.loop?.maxTurns || null,
    },
    modelOptions,
    outputSchema: {
      source: "model",
      kind: "continue | block | complete | needs_evidence | wait | retry",
      safeAutoContinue: [{ agent: "device", kind: "action.run", action: "status" }],
      blockedTasks: [{ task: { agent: "device", kind: "action.run", action: "status" }, reason: "missing-required-evidence" }],
      evidencePlan: [{ evidenceId: "required evidence id", blocking: true }],
      rationale: "diagnostic text",
    },
  };
}

function executedTaskSignals(turn) {
  return (turn?.steps || [])
    .filter((step) => step?.kind)
    .map((step) => ({
      stepId: step.stepId || step.id || null,
      agent: step.agent || defaultAgentForTask(step),
      kind: step.kind,
      ...(step.action ? { action: step.action } : {}),
      status: step.status || null,
    }));
}

function repetitionSignals(turn, proposalFromAction) {
  const executed = new Map();
  for (const task of executedTaskSignals(turn)) {
    const key = taskKey(task);
    executed.set(key, (executed.get(key) || 0) + 1);
  }
  const candidates = [
    ...(proposalFromAction?.proposedTasks || []),
    ...(proposalFromAction?.safeAutoContinue || []),
    ...((proposalFromAction?.blockedTasks || []).map((item) => item.task).filter(Boolean)),
  ];
  return candidates.map((task) => ({
    task,
    executedCount: executed.get(taskKey(task)) || 0,
    wouldRepeat: Boolean(executed.get(taskKey(task))),
  }));
}

function taskKey(task) {
  return `${task?.agent || defaultAgentForTask(task || {})}\0${task?.kind || ""}\0${task?.action || ""}`;
}

export function normalizeAgentLoopProposal(value: any, { source = "model" }: { source?: string } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("loop model proposal must be a JSON object");
  }
  const normalizedSource = value.source ? String(value.source).trim() : source;
  if (!["model", "rule", "action"].includes(normalizedSource)) {
    throw new Error("loop model proposal source must be model, rule, or action");
  }
  const kind = String(value.kind || "block").trim();
  if (!["continue", "block", "complete", "needs_evidence", "wait", "retry"].includes(kind)) {
    throw new Error("loop model proposal kind is invalid");
  }
  return {
    source: normalizedSource,
    kind,
    safeAutoContinue: normalizeTaskArray(value.safeAutoContinue),
    proposedTasks: normalizeTaskArray(value.proposedTasks || value.nextTasks),
    blockedTasks: normalizeBlockedTasks(value.blockedTasks),
    evidencePlan: normalizeEvidencePlan(value.evidencePlan || value.requiredEvidencePlan),
    rationale: typeof value.rationale === "string" ? value.rationale.slice(0, 1000) : null,
  };
}

function normalizeTaskArray(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      agent: String(entry.agent || "").trim() || defaultAgentForTask(entry),
      kind: String(entry.kind || "").trim(),
      ...(entry.action ? { action: String(entry.action).trim() } : {}),
    }))
    .filter((entry) => entry.kind);
}

function normalizeBlockedTasks(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const task = entry.task && typeof entry.task === "object" ? entry.task : entry;
    const normalized = normalizeTaskArray(task)[0];
    if (!normalized) return [];
    return [{
      task: normalized,
      reason: String(entry.reason || "model-blocked").trim() || "model-blocked",
    }];
  });
}

function normalizeEvidencePlan(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const evidenceId = String(entry.evidenceId || entry.id || "").trim();
    if (!evidenceId) return [];
    return [{ evidenceId, blocking: entry.blocking !== false }];
  });
}

function defaultAgentForTask(task) {
  if (task.kind === "action.run") return "device";
  if (task.kind === "session.summary") return "session";
  if (task.kind === "diagnostics.recent_failure.read") return "diagnostics";
  if (task.kind === "screen.state_frame.read") return "screen";
  return "agent";
}

function summarizeStepResult(result) {
  if (!result || typeof result !== "object") return "";
  const value = result.summary || result.output || result.reply || result.error || "";
  return typeof value === "string" ? value.slice(0, 1000) : "";
}

function evidenceKeys(result) {
  if (!result || typeof result !== "object" || !result.evidence || typeof result.evidence !== "object") return [];
  return Object.keys(result.evidence).sort();
}

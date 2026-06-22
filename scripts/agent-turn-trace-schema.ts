export const AGENT_TURN_SCHEMA = "walnutpi.agentTurn.v2";
export const AGENT_LOOP_SCHEMA = "walnutpi.agentLoop.v1";
export const TELEMETRY_SCHEMA = "walnutpi.agentTurnTelemetry.v1";

export const EVIDENCE_REGISTRY = Object.freeze({
  "intent-route": { valueRequired: true },
  "agentTurn-step": { valueRequired: true },
  "session-result": { valueRequired: true },
  "no-memory-write": { valueRequired: true },
  "replan-evidence": { valueRequired: true },
  "multi-step-loop": { valueRequired: true },
  "action-policy-id": { valueRequired: true },
  "action-evidence-or-honest-failure": { valueRequired: true },
  "bus-read-output": { valueRequired: true },
  "daily-note-append-evidence": { valueRequired: true },
  "sanitized-text-parameter": { valueRequired: true },
  "daily-note-path-or-confirmation": { valueRequired: true },
  "note-file-read-result": { valueRequired: true },
  "notes-read-result": { valueRequired: true },
  "memory-update-candidate-or-confirmation": { valueRequired: true },
  "memory-category-key": { valueRequired: true },
  "source-session-id": { valueRequired: true },
  "future-context-link": { valueRequired: true },
  "memory-skip-evidence": { valueRequired: true },
  "sensitive-memory-rejection": { valueRequired: true },
  "session-safety-summary": { valueRequired: true },
  "policy-decision-evidence": { valueRequired: true },
  "refused-local-action": { valueRequired: true },
  "pending-local-action": { valueRequired: true },
  "pending-or-refused-reboot": { valueRequired: true },
  "confirmation-token-or-pending-id": { valueRequired: true },
  "risk-explanation": { valueRequired: true },
  "no-command-execution": { valueRequired: true },
  "no-remote-command-execution": { valueRequired: true },
  "no-action-policy-decision": { valueRequired: true },
  "policy-refusal-or-manual-guidance": { valueRequired: true },
  "optional-read-only-status": { valueRequired: true },
  "diagnostic-summary": { valueRequired: true },
  "traceId-or-buildId": { valueRequired: true },
  "failed-operation": { valueRequired: true },
  "error-message": { valueRequired: true },
  "stage-or-segments": { valueRequired: true },
  "repair-options": { valueRequired: true },
  "screen-state-output": { valueRequired: true },
  "service-state": { valueRequired: true },
  "frame-hash-or-honest-failure": { valueRequired: true },
  "frame-evidence": { valueRequired: true },
  "screen-output-480x320": { valueRequired: true },
  "scenario-contract": { valueRequired: true },
  "scenario-contract-result": { valueRequired: true },
});

export const ARTIFACT_REGISTRY = Object.freeze({
  "action-evidence": { pathRequired: false, inlineAllowed: true },
  "action-result": { pathRequired: false, inlineAllowed: true },
  "session-summary": { pathRequired: false, inlineAllowed: true },
  "memory-candidate": { pathRequired: false, inlineAllowed: true },
  "memory-skip-evidence": { pathRequired: false, inlineAllowed: true },
  "terminal-action-evidence": { pathRequired: false, inlineAllowed: true },
  "screen-manifest-v2": { pathRequired: false, inlineAllowed: true },
  "screen-playlist-v1": { pathRequired: false, inlineAllowed: true },
  "screen-output": { pathRequired: false, inlineAllowed: true },
  "animated-screen-output": { pathRequired: false, inlineAllowed: true },
  "screen-output-480x320": { pathRequired: false, inlineAllowed: true },
  "source-provenance": { pathRequired: false, inlineAllowed: true },
  "candidate-source-asset-or-failure": { pathRequired: false, inlineAllowed: true },
  "widget-app-contract": { pathRequired: false, inlineAllowed: true },
  "delivery-manifest": { pathRequired: false, inlineAllowed: true },
  "runtime-assets": { pathRequired: false, inlineAllowed: true },
  "sync-record": { pathRequired: false, inlineAllowed: true },
  "policy-decision": { pathRequired: false, inlineAllowed: true },
  "diagnostic-result": { pathRequired: false, inlineAllowed: true },
  "multi-step-loop": { pathRequired: false, inlineAllowed: true },
  "notes-read-result": { pathRequired: false, inlineAllowed: true },
});

export const SIDE_EFFECT_REGISTRY = Object.freeze({
  "arbitrary-shell": true,
  "archived-capability-as-current-product": true,
  "audio-playback-without-confirmation": true,
  "daily-note-write": true,
  "device-network-as-primary-result": true,
  "device-write": true,
  "durable-memory-write": true,
  "frame-capture": true,
  "frame-capture-large": true,
  "framebuffer-write": true,
  "gpio-output": true,
  "maintenance-menu": true,
  "overlay-change": true,
  "package-install": true,
  "reboot": true,
  "reexecute-history": true,
  "regenerate-during-sync": true,
  "retry-side-effect-action": true,
  "runtime-asset-write": true,
  "screen-manifest-success": true,
  "screen-sync": true,
  "secret-memory-write": true,
  "service-restart": true,
  "ssh-delivery": true,
  "ssh-delivery-after-validation-failure": true,
  "storage-delete": true,
  "sync-without-playlist-hash": true,
  "system-config-write": true,
  "terminal-policy-bypass": true,
  "wallpaper-schema-for-widget": true,
});

export function validateAgentTurnV2(turn) {
  if (!turn || turn.schema !== AGENT_TURN_SCHEMA) throw new Error("agentTurn.v2 trace is required");
  if (!Object.hasOwn(turn, "route")) throw new Error("agentTurn.v2 route is required");
  for (const key of ["steps", "artifacts", "evidence", "sideEffects"]) {
    if (!Array.isArray(turn[key])) throw new Error(`agentTurn.v2 ${key}[] is required`);
  }
  validateLoopV1(turn.loop);
  if (turn.pendingNext !== null && turn.pendingNext !== undefined) validatePendingNextV1(turn.pendingNext);
  validateTelemetryV1(turn.telemetry);
  for (const step of turn.steps) validateStepV2(step);
  for (const artifact of turn.artifacts) validateArtifactSignal(artifact);
  for (const evidence of turn.evidence) validateEvidenceSignal(evidence);
  for (const sideEffect of turn.sideEffects) validateSideEffectSignal(sideEffect);
  return true;
}

export function validateLoopV1(loop) {
  if (!loop || typeof loop !== "object" || Array.isArray(loop)) throw new Error("agentTurn.v2 loop is required");
  if (loop.schema !== AGENT_LOOP_SCHEMA) throw new Error("agentTurn.v2 loop schema is invalid");
  for (const key of ["status", "maxTurns", "turns"]) {
    if (!Object.hasOwn(loop, key)) throw new Error(`agentTurn.v2 loop missing ${key}`);
  }
  if (loop.plan !== null && loop.plan !== undefined) validateLoopPlan(loop.plan);
  if (!Array.isArray(loop.turns)) throw new Error("agentTurn.v2 loop.turns[] is required");
  for (const entry of loop.turns) validateLoopTurn(entry);
  return true;
}

function validateLoopPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("agentTurn.v2 loop.plan must be an object");
  for (const key of ["schema", "source", "initialTasks", "remainingTasks", "executedTasks", "currentTask", "stopCondition", "stopCriteria", "evidencePlan", "requiredEvidence", "maxTurns", "progress"]) {
    if (!Object.hasOwn(plan, key)) throw new Error(`agentTurn.v2 loop.plan missing ${key}`);
  }
  if (plan.schema !== "walnutpi.agentTurnPlan.v1") throw new Error("agentTurn.v2 loop.plan schema is invalid");
  if (!Array.isArray(plan.initialTasks)) throw new Error("agentTurn.v2 loop.plan initialTasks[] is required");
  if (!Array.isArray(plan.remainingTasks)) throw new Error("agentTurn.v2 loop.plan remainingTasks[] must be an array");
  if (!Array.isArray(plan.executedTasks)) throw new Error("agentTurn.v2 loop.plan executedTasks[] must be an array");
  if (!Array.isArray(plan.stopCriteria)) throw new Error("agentTurn.v2 loop.plan stopCriteria[] must be an array");
  if (!Array.isArray(plan.evidencePlan)) throw new Error("agentTurn.v2 loop.plan evidencePlan[] is required");
  if (!Array.isArray(plan.requiredEvidence)) throw new Error("agentTurn.v2 loop.plan requiredEvidence[] must be an array");
  validateLoopPlanProgress(plan.progress);
  for (const entry of plan.evidencePlan) validateLoopPlanEvidence(entry);
}

function validateLoopPlanProgress(progress) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) throw new Error("agentTurn.v2 loop.plan progress must be an object");
  if (typeof progress.phase !== "string" || !progress.phase) throw new Error("agentTurn.v2 loop.plan progress.phase is required");
  if (!Number.isInteger(progress.completedSteps) || progress.completedSteps < 0) throw new Error("agentTurn.v2 loop.plan progress.completedSteps must be non-negative");
  if (!Number.isInteger(progress.remainingTurns) || progress.remainingTurns < 0) throw new Error("agentTurn.v2 loop.plan progress.remainingTurns must be non-negative");
}

function validateLoopPlanEvidence(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("agentTurn.v2 loop.plan evidencePlan entry must be an object");
  if (typeof entry.evidenceId !== "string" || !entry.evidenceId.trim()) throw new Error("agentTurn.v2 loop.plan evidencePlan evidenceId is required");
  if (!["planned", "present", "missing", "blocked"].includes(entry.status)) throw new Error("agentTurn.v2 loop.plan evidencePlan status is invalid");
}

export function validatePendingNextV1(pendingNext) {
  if (!pendingNext || typeof pendingNext !== "object" || Array.isArray(pendingNext)) throw new Error("agentTurn.v2 pendingNext must be a typed object");
  for (const key of ["kind", "stepId", "reason", "blockedBy", "tasks"]) {
    if (!Object.hasOwn(pendingNext, key)) throw new Error(`agentTurn.v2 pendingNext missing ${key}`);
  }
  if (!Array.isArray(pendingNext.tasks)) throw new Error("agentTurn.v2 pendingNext.tasks[] is required");
  for (const task of pendingNext.tasks) validateTaskSignal(task, "agentTurn.v2 pendingNext task");
  return true;
}

export function validateArtifactSignal(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw new Error("agentTurn.v2 artifact must be an object");
  for (const key of ["kind", "path", "sha256", "bytes", "createdByStepId"]) {
    if (!Object.hasOwn(artifact, key)) throw new Error(`agentTurn.v2 artifact missing ${key}`);
  }
  const policy = ARTIFACT_REGISTRY[artifact.kind];
  if (!policy) throw new Error(`agentTurn.v2 artifact unknown kind ${artifact.kind}`);
  if (policy.pathRequired && !artifact.path) throw new Error(`agentTurn.v2 artifact ${artifact.kind} requires path`);
  if (!policy.inlineAllowed && Object.hasOwn(artifact, "value")) throw new Error(`agentTurn.v2 artifact ${artifact.kind} must not include inline value`);
  if (typeof artifact.sha256 !== "string" || !artifact.sha256.trim()) throw new Error("agentTurn.v2 artifact sha256 must be a non-empty string");
  if (!Number.isInteger(artifact.bytes) || artifact.bytes < 0) throw new Error("agentTurn.v2 artifact bytes must be a non-negative integer");
  return true;
}

export function validateEvidenceSignal(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("agentTurn.v2 evidence must be an object");
  for (const key of ["kind", "value"]) {
    if (!Object.hasOwn(evidence, key)) throw new Error(`agentTurn.v2 evidence missing ${key}`);
  }
  const policy = EVIDENCE_REGISTRY[evidence.kind];
  if (policy?.valueRequired && !hasSupportingValue(evidence.value)) {
    throw new Error(`agentTurn.v2 evidence ${evidence.kind} requires value`);
  }
  return true;
}

export function validateSideEffectSignal(sideEffect) {
  if (!sideEffect || typeof sideEffect !== "object" || Array.isArray(sideEffect)) throw new Error("agentTurn.v2 sideEffect must be an object");
  for (const key of ["kind", "stepId", "target", "status"]) {
    if (!Object.hasOwn(sideEffect, key)) throw new Error(`agentTurn.v2 sideEffect missing ${key}`);
  }
  if (!SIDE_EFFECT_REGISTRY[sideEffect.kind]) throw new Error(`agentTurn.v2 sideEffect unknown kind ${sideEffect.kind}`);
  if (sideEffect.status !== "observed" && sideEffect.status !== "planned" && sideEffect.status !== "blocked") {
    throw new Error("agentTurn.v2 sideEffect status is invalid");
  }
  return true;
}

function validateStepV2(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("agentTurn.v2 step must be an object");
  for (const key of ["stepId", "parentStepId", "kind", "status", "startedAt", "finishedAt"]) {
    if (!Object.hasOwn(step, key)) throw new Error(`agentTurn.v2 step missing ${key}`);
  }
  if (Object.hasOwn(step, "result")) throw new Error("agentTurn.v2 stable steps[] must not include raw result");
}

function validateTelemetryV1(telemetry) {
  if (!telemetry?.summary || !telemetry?.diagnostics) {
    throw new Error("agentTurn.v2 telemetry.summary and telemetry.diagnostics are required");
  }
  for (const key of ["metrics", "elapsedMs", "events"]) {
    if (Object.hasOwn(telemetry, key)) throw new Error(`agentTurn.v2 telemetry must not include legacy ${key}`);
  }
}

function validateLoopTurn(entry) {
  for (const key of ["sourceStepId", "observation", "judgment", "autoContinuedTasks", "blockedTasks"]) {
    if (!Object.hasOwn(entry, key)) throw new Error(`agentTurn.v2 loop turn missing ${key}`);
  }
  if (Object.hasOwn(entry, "proposal")) validateLoopProposalTrace(entry.proposal);
  if (Object.hasOwn(entry, "policy")) validateLoopPolicyTrace(entry.policy);
  if (!Array.isArray(entry.autoContinuedTasks)) throw new Error("agentTurn.v2 loop turn autoContinuedTasks[] is required");
  if (!Array.isArray(entry.blockedTasks)) throw new Error("agentTurn.v2 loop turn blockedTasks[] is required");
  for (const task of entry.autoContinuedTasks) validateTaskSignal(task, "agentTurn.v2 loop autoContinuedTask");
  for (const task of entry.blockedTasks) validateTaskSignal(task, "agentTurn.v2 loop blockedTask");
  if (entry.vetoes !== undefined && !Array.isArray(entry.vetoes)) throw new Error("agentTurn.v2 loop turn vetoes[] must be an array");
}

function validateLoopProposalTrace(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) throw new Error("agentTurn.v2 loop proposal must be an object");
  for (const key of ["source", "kind", "safeAutoContinue", "blockedTasks", "evidencePlan"]) {
    if (!Object.hasOwn(proposal, key)) throw new Error(`agentTurn.v2 loop proposal missing ${key}`);
  }
  if (!["model", "rule", "action"].includes(proposal.source)) throw new Error("agentTurn.v2 loop proposal source is invalid");
  if (!Array.isArray(proposal.safeAutoContinue)) throw new Error("agentTurn.v2 loop proposal safeAutoContinue[] is required");
  if (!Array.isArray(proposal.blockedTasks)) throw new Error("agentTurn.v2 loop proposal blockedTasks[] is required");
  if (!Array.isArray(proposal.evidencePlan)) throw new Error("agentTurn.v2 loop proposal evidencePlan[] is required");
}

function validateLoopPolicyTrace(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("agentTurn.v2 loop policy must be an object");
  for (const key of ["accepted", "vetoApplied", "vetoReasons", "effectiveAction"]) {
    if (!Object.hasOwn(policy, key)) throw new Error(`agentTurn.v2 loop policy missing ${key}`);
  }
  if (typeof policy.accepted !== "boolean") throw new Error("agentTurn.v2 loop policy accepted must be boolean");
  if (typeof policy.vetoApplied !== "boolean") throw new Error("agentTurn.v2 loop policy vetoApplied must be boolean");
  if (!Array.isArray(policy.vetoReasons)) throw new Error("agentTurn.v2 loop policy vetoReasons[] is required");
}

function validateTaskSignal(task, path) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`${path} must be an object`);
  for (const key of ["agent", "kind"]) {
    if (!Object.hasOwn(task, key)) throw new Error(`${path} missing ${key}`);
  }
}

function hasSupportingValue(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

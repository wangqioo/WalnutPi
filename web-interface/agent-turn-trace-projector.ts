import { createHash } from "node:crypto";
import { isSafeContinuationTask, MAX_CONTINUATION_TASKS, normalizeNextTasks } from "./action-registry.ts";

export const DEFAULT_RECOVERY_OPTIONS = [
  "inspect the failed step evidence",
  "retry only after explicit user confirmation",
  "choose an explicit read-only path",
];

export async function updateTurnTrace(turn, metricsLedger = null) {
  turn.route = stepResult(turn.steps.find((step) => step.kind === "intent.classify"))?.classification || null;
  turn.artifacts = collectArtifacts(turn);
  turn.evidence = collectEvidence(turn);
  turn.sideEffects = classifySideEffects(turn);
  turn.recovery = collectRecovery(turn);
  turn.contextUsed = collectContextUsed(turn);
  turn.userSummary = summarizeForUser(turn);
  turn.telemetry = await summarizeTelemetry(turn, metricsLedger);
  turn.diagnostics = collectDiagnostics(turn);
  normalizeTurnShape(turn);
}

function collectArtifacts(turn) {
  const artifacts = [];
  const push = (kind, value, step) => { if (value) artifacts.push(artifactSignal(kind, value, step)); };
  for (const step of turn.steps) {
    const result = stepResult(step) || {};
    push("action-evidence", result.actionEvidence, step);
    push("action-result", ["action.run"].includes(step.kind) ? result : null, step);
    push("session-summary", step.kind === "session.summary" ? result.summary || result.evidence : null, step);
    push("memory-candidate", step.kind === "memory.preference" ? result.evidence?.memoryUpdateCandidateOrConfirmation : null, step);
    push("memory-skip-evidence", step.kind === "memory.sensitive_skip" ? result.evidence?.memorySkipEvidence : null, step);
    push("terminal-action-evidence", result.mode === "terminal" ? { command: result.command, id: result.id } : null, step);
    push("screen-manifest-v2", screenManifestArtifact(result), step);
    push("screen-playlist-v1", screenPlaylistArtifact(result), step);
    push("screen-output", screenOutputArtifact(result), step);
    push("animated-screen-output", result.output?.type === "animated" ? result.output : null, step);
    push("screen-output-480x320", isOutput480x320(result.output) ? result.output : null, step);
    push("source-provenance", result.source || result.manifest?.provenance?.sourceAssets?.find?.((item) => item.selected) || null, step);
    push("candidate-source-asset-or-failure", result.source || result.sourceAsset || null, step);
    push("widget-app-contract", result.widgetApp, step);
    push("delivery-manifest", result.deliveryManifest, step);
    push("runtime-assets", runtimeAssetsSignal(result), step);
    push("sync-record", syncRecordSignal(result), step);
    push("policy-decision", step.kind === "policy.decision" ? result.decisions : null, step);
    push("diagnostic-result", step.kind === "diagnostics.recent_failure.read" ? result.evidence : null, step);
  }
  return artifacts;
}

function artifactSignal(kind, value, step) {
  return {
    kind,
    path: artifactPath(value),
    sha256: sha256(value),
    bytes: Buffer.byteLength(stableJson(value)),
    createdByStepId: step?.stepId || step?.id || null,
    value,
  };
}

function collectEvidence(turn) {
  const evidence = [];
  const push = (kind, value) => { if (value !== undefined && value !== null && value !== "") evidence.push({ kind, value }); };
  push("sessionId", turn.sessionId);
  push("scenario-contract", turn.input?.scenario);
  if (turn.route) push("intent-route", turn.route);
  for (const step of turn.steps) {
    push("agentTurn-step", { id: step.id, agent: step.agent, kind: step.kind, status: step.status, action: step.action });
    const result = stepResult(step) || {};
    push("action-policy-id", result.id);
    push("daily-note-append-evidence", result.id === "note" ? dailyNoteAppendSignal(result) : null);
    push("sanitized-text-parameter", result.id === "note" ? sanitizedTextParameterSignal(result) : null);
    push("daily-note-path-or-confirmation", result.id === "note" ? dailyNoteConfirmationSignal(result) : null);
    push("note-file-read-result", result.id === "notes" ? noteFileReadSignal(result) : null);
    push("notes-read-result", result.id === "notes" ? noteFileReadSignal(result) : null);
    push("bus-read-output", result.id === "i2c_scan" ? result.output || result.actionEvidence?.output : null);
    push("action-evidence-or-honest-failure", result.actionEvidence || result.honestFailure || (result.ok === false ? result.error || result.output : null));
    push("terminal-command-evidence", result.mode === "terminal" ? result.command : null);
    push("session-event", result.mode === "terminal" || result.diagnostics?.sessionLogMs ? { action: result.id, traceId: result.diagnostics?.traceId } : null);
    push("delegation-evidence", result.contextUsed);
    push("metrics-trace-id", result.diagnostics?.traceId);
    push("output-failed", typeof result.outputFailed === "boolean" ? result.outputFailed : null);
    push("preview-or-sync-readiness", result.widgetApp || result.playlist || result.output);
    push("playlist-envelope", playlistEnvelope(result));
    push("screen-manifest-v2", result.manifest?.schema === "walnutpi.screen-manifest.v2" ? result.manifest : null);
    push("screen-output-480x320", isOutput480x320(result.output) ? result.output : null);
    push("screen-output-480x320-or-honest-camera-failure", isOutput480x320(result.output) ? result.output : result.evidence?.screenOutput480x320OrHonestCameraFailure);
    push("processing-preset", result.preset || result.manifest?.provenance?.processing?.preset);
    push("frame-timing", frameTiming(result.output));
    push("sync-result", syncResultSignal(result));
    push("session-result", step.kind === "session.summary" ? { sessionId: turn.sessionId, summary: result.summary } : null);
    push("memory-result", step.agent === "memory" ? result.evidence : null);
    push("diagnostics-result", step.agent === "diagnostics" ? result.evidence : null);
    push("action-policy-decisions", result.allowedExecutors ? { id: result.id, risk: result.risk, mode: result.mode, confirmationRequired: result.confirmationRequired } : null);
    push("contextUsed", result.contextUsed);
    push("traceId", result.diagnostics?.traceId);
    push("traceId-or-buildId", result.evidence?.traceIdOrBuildId);
    push("playlistHash", result.playlistHash);
    push("service-state", serviceStateSignal(result));
    push("frame-evidence", result.screenEvidence?.frame || result.evidence?.frame);
    push("user-visible-summary", result.summary || result.reply || result.output);
    push("multi-step-loop", multiStepLoopSignal(step));
    push("replan-evidence", replanEvidenceSignal(step));
    push("pending-next", result.pendingNext);
    push("recovery-options", result.recoveryOptions);
    if (step.status === "failed") push("recovery-options", result.recoveryOptions || DEFAULT_RECOVERY_OPTIONS);
    for (const [key, value] of Object.entries(result.evidence || {})) push(kebabCase(key), value);
  }
  push("agent-loop", turn.loop?.turns?.length ? turn.loop : null);
  push("loop-evaluator", turn.loop?.turns?.length ? turn.loop.turns.map((item) => ({ sourceStepId: item.sourceStepId, observation: item.observation, judgment: item.judgment })) : null);
  push("scenario-contract-result", turn.input?.scenario ? {
    goal: turn.input.scenario.goal,
    constraints: turn.input.scenario.constraints,
    loopStatus: turn.loop?.status || null,
    pendingNext: turn.pendingNext || null,
  } : null);
  return evidence;
}

function multiStepLoopSignal(step) {
  const result = stepResult(step) || {};
  const nextTasks = normalizeNextTasks(result.nextTasks || result.pendingNext?.nextTasks);
  if (!nextTasks.length) return null;
  return {
    sourceStepId: step.id,
    proposedTaskCount: nextTasks.length,
    safeTaskCount: nextTasks.filter(isSafeContinuationTask).slice(0, MAX_CONTINUATION_TASKS).length,
    boundedContinuation: MAX_CONTINUATION_TASKS,
  };
}

function replanEvidenceSignal(step) {
  const result = stepResult(step) || {};
  const nextTasks = normalizeNextTasks(result.nextTasks || result.pendingNext?.nextTasks);
  if (!nextTasks.length) return null;
  const heldTasks = normalizeNextTasks(result.pendingNext?.tasks);
  const heldKeys = new Set(heldTasks.map(taskKey));
  const safeTasks = nextTasks.filter(isSafeContinuationTask);
  const unsafeTasks = nextTasks.filter((task) => !isSafeContinuationTask(task));
  const safeAutoContinue = safeTasks.filter((task) => !heldKeys.has(taskKey(task))).slice(0, MAX_CONTINUATION_TASKS);
  const overLimitSafe = safeTasks.filter((task) => !safeAutoContinue.includes(task) && !heldKeys.has(taskKey(task)));
  return {
    reason: "task-result-nextTasks",
    proposedTasks: nextTasks.map((task) => compactTaskSignal(task)),
    safeAutoContinue: safeAutoContinue.map((task) => compactTaskSignal(task)),
    blockedTasks: [
      ...heldTasks.map((task) => compactTaskSignal(task, result.pendingNext?.reason || "pending-next")),
      ...overLimitSafe.map((task) => compactTaskSignal(task, "max-continuation-tasks")),
      ...unsafeTasks.filter((task) => !heldKeys.has(taskKey(task))).map((task) => compactTaskSignal(task, "continuation-requires-explicit-confirmation")),
    ],
  };
}

export function compactTaskSignal(task, reason = null, extra = {}) {
  return { agent: task.agent, kind: task.kind, action: task.action || null, ...(reason ? { reason } : {}), ...extra };
}

export function dedupeTaskSignals(tasks) {
  return [...new Map(tasks.map((task) => [taskKey(task), task])).values()];
}

export function pendingSignal({ kind, stepId, reason, task = null, tasks = null }) {
  return {
    kind,
    stepId,
    reason: reason || "pending",
    blockedBy: task ? compactTaskSignal(task) : null,
    tasks: Array.isArray(tasks) ? tasks.map((item) => compactTaskSignal(item, item.reason || reason, {
      ...(item.blockedBy ? { blockedBy: item.blockedBy } : {}),
      ...(item.agentProposed ? { agentProposed: item.agentProposed } : {}),
    })) : [],
  };
}

function collectContextUsed(turn) {
  const values = turn.steps.map((step) => stepResult(step)?.contextUsed).filter(Boolean);
  return values.length ? values : null;
}

export function taskKey(task) {
  return `${task.agent || ""}\0${task.kind || ""}\0${task.action || ""}`;
}

export function mergePendingNext(current, next) {
  if (!current || current.kind !== "nextTasks") return next;
  const tasks = [...(current.tasks || [])];
  const seen = new Set(tasks.map(taskKey));
  for (const task of next.tasks || []) {
    const key = taskKey(task);
    if (!seen.has(key)) {
      tasks.push(task);
      seen.add(key);
    }
  }
  return {
    kind: "nextTasks",
    stepId: next.stepId || current.stepId || null,
    tasks,
    reason: current.reason === next.reason ? current.reason : "multiple-continuations-pending",
    blockedBy: null,
  };
}

function collectRecovery(turn) {
  const failedStep = turn.steps.findLast((step) => step.status === "failed");
  const turnFailed = turn.status === "failed";
  const pendingNext = turn.pendingNext || stepResult(turn.steps.findLast((step) => stepResult(step)?.pendingNext))?.pendingNext || null;
  const resultOptions = turn.steps.flatMap((step) => {
    const result = stepResult(step) || {};
    return normalizeRecoveryOptions(result.recoveryOptions || result.repairOptions);
  });
  const options = [...new Set([
    ...resultOptions,
    ...(pendingNext && typeof pendingNext === "object" ? ["confirm the pending next task explicitly before running it", "choose a read-only continuation instead"] : []),
    ...(turnFailed ? DEFAULT_RECOVERY_OPTIONS : []),
  ])];
  return {
    status: turnFailed ? "available" : pendingNext ? "pending" : "not-needed",
    pendingNext,
    options,
    failedStepId: failedStep?.id || null,
    error: stepResult(failedStep)?.error || stepResult(failedStep)?.output || turn.error || null,
  };
}

function normalizeTurnShape(turn) {
  turn.source ||= "web-agent-turn";
  for (const key of ["steps", "artifacts", "evidence", "sideEffects"]) {
    if (!Array.isArray(turn[key])) throw new Error(`agentTurn.v2 ${key}[] is required`);
  }
  turn.steps.forEach(validateStepShape);
  validateLoopShape(turn.loop);
  turn.recovery = turn.recovery && typeof turn.recovery === "object" ? {
    status: turn.recovery.status || "not-needed",
    pendingNext: turn.recovery.pendingNext || null,
    options: normalizeRecoveryOptions(turn.recovery.options),
    failedStepId: turn.recovery.failedStepId || null,
    error: turn.recovery.error || null,
  } : emptyRecovery();
  turn.telemetry = normalizeTelemetry(turn.telemetry, turn.startedAt);
  turn.diagnostics = turn.diagnostics && typeof turn.diagnostics === "object" ? turn.diagnostics : emptyDiagnostics();
  return turn;
}

function validateStepShape(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("agentTurn.v2 step must be an object");
  for (const key of ["id", "stepId", "parentStepId", "kind", "status", "startedAt", "finishedAt"]) {
    if (!Object.hasOwn(step, key)) throw new Error(`agentTurn.v2 step missing ${key}`);
  }
}

function validateLoopShape(loop) {
  if (!loop || typeof loop !== "object" || Array.isArray(loop)) throw new Error("agentTurn.v2 loop is required");
  if (loop.schema !== "walnutpi.agentLoop.v1") throw new Error("agentTurn.v2 loop schema is invalid");
  if (!Object.hasOwn(loop, "status")) throw new Error("agentTurn.v2 loop missing status");
  if (!Object.hasOwn(loop, "maxTurns")) throw new Error("agentTurn.v2 loop missing maxTurns");
  if (!Array.isArray(loop.turns)) throw new Error("agentTurn.v2 loop.turns[] is required");
  for (const turn of loop.turns) {
    for (const key of ["sourceStepId", "observation", "judgment", "autoContinuedTasks", "blockedTasks"]) {
      if (!Object.hasOwn(turn, key)) throw new Error(`agentTurn.v2 loop turn missing ${key}`);
    }
    if (!Array.isArray(turn.autoContinuedTasks)) throw new Error("agentTurn.v2 loop turn autoContinuedTasks[] is required");
    if (!Array.isArray(turn.blockedTasks)) throw new Error("agentTurn.v2 loop turn blockedTasks[] is required");
  }
}

export function normalizeRecoveryOptions(value) {
  if (!value) return [];
  const options = Array.isArray(value) ? value : [value];
  return options.map((item) => String(item || "").trim()).filter(Boolean);
}

export function emptyRecovery() {
  return { status: "not-needed", pendingNext: null, options: [], failedStepId: null, error: null };
}

export function emptyTelemetry(startedAt) {
  const elapsedMs = startedAt ? Date.now() - Date.parse(startedAt) : null;
  const metrics = { totalEvents: 0, failures: 0, tokens: { input: 0, output: 0, total: 0, cached: 0, reasoning: 0 }, latency: {} };
  return {
    schema: "walnutpi.agentTurnTelemetry.v1",
    summary: { totalEvents: 0, failures: 0 },
    diagnostics: { elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null, metrics, events: [] },
  };
}

function screenManifestArtifact(result) {
  if (result.manifest?.schema === "walnutpi.screen-manifest.v2") return result.manifest;
  return result.manifestPath || result.manifest?.path || null;
}

function screenPlaylistArtifact(result) {
  if (result.playlist?.schema === "walnutpi.screen-playlist.v1") return result.playlist;
  return result.playlistPath || result.playlist?.path || result.playlist || null;
}

function screenOutputArtifact(result) {
  if (result.output) return result.output;
  return result.outputPath || result.manifest?.output || null;
}

function isOutput480x320(output) {
  return Number(output?.width) === 480 && Number(output?.height) === 320;
}

function playlistEnvelope(result) {
  const playlist = result.playlist?.schema === "walnutpi.screen-playlist.v1" ? result.playlist : null;
  if (!playlist) return result.evidence?.playlistEnvelope || null;
  return { schema: playlist.schema, id: playlist.id || null, itemCount: Array.isArray(playlist.items) ? playlist.items.length : 0, loop: Boolean(playlist.loop), playlistHash: result.playlistHash || playlist.playlistHash || null };
}

function frameTiming(output) {
  const frames = output?.frames;
  if (!Array.isArray(frames) || !frames.length) return null;
  return { frameCount: output.frameCount || frames.length, durationsMs: frames.map((frame) => frame.durationMs).filter((value) => Number(value) >= 0) };
}

function syncResultSignal(result) {
  if (!result.deliveryManifest && !result.screenEvidence && !result.playlistHash && !result.syncRecordPath) return null;
  return { ok: result.ok !== false, playlistHash: result.playlistHash || null, buildId: result.buildId || result.deliveryManifest?.buildId || null, evidence: result.screenEvidence || result.evidence || null, record: syncRecordSignal(result) };
}

function serviceStateSignal(result) {
  return result.serviceState
    || result.screenEvidence?.serviceState
    || result.screenEvidence?.state
    || result.evidence?.serviceState
    || result.evidence?.state
    || null;
}

function runtimeAssetsSignal(result) {
  const resources = result.deliveryManifest?.generatedResources;
  if (!resources) return null;
  return {
    runtimeIndex: resources.runtimeIndex || null,
    framesDir: resources.framesDir || null,
    mode: resources.mode || null,
  };
}

function syncRecordSignal(result) {
  return result.syncRecord || result.record || result.recordPath || result.syncRecordPath || null;
}

function dailyNoteAppendSignal(result) {
  return {
    ok: result.ok !== false,
    actionPolicyId: result.id || "note",
    risk: result.risk || "write-low",
    target: "daily-note",
    output: typeof result.output === "string" ? result.output.slice(0, 500) : null,
  };
}

function sanitizedTextParameterSignal(result) {
  return {
    actionPolicyId: result.id || "note",
    source: "action-policy-parameter-schema",
    minLength: 1,
    maxLength: 1000,
    commandTemplate: "walnut note {text}",
    commandBuilt: Boolean(result.command),
  };
}

function dailyNoteConfirmationSignal(result) {
  return result.actionEvidence?.path
    || result.actionEvidence?.file
    || result.actionEvidence?.notePath
    || result.output
    || (result.ok !== false ? "daily note append completed" : null);
}

function noteFileReadSignal(result) {
  return {
    ok: result.ok !== false,
    actionPolicyId: result.id || "notes",
    output: typeof result.output === "string" ? result.output.slice(0, 1000) : result.output || null,
    empty: typeof result.output === "string" ? result.output.trim().length === 0 : false,
  };
}

function classifySideEffects(turn) {
  const effects = [];
  for (const step of turn.steps) {
    const result = stepResult(step) || {};
    for (const effect of normalizeSideEffects(result.sideEffects)) {
      effects.push(sideEffectSignal(effect.kind, step.stepId, effect.target, effect.status));
    }
    if (step.kind === "screen.workspace.sync.intent" && ["completed", "queued", "running"].includes(step.status)) {
      effects.push(sideEffectSignal("screen-sync", step.stepId, "screen-runtime", "observed"));
    }
  }
  return [...new Map(effects.map((effect) => [`${effect.kind}\0${effect.stepId}\0${effect.target}`, effect])).values()];
}

function normalizeSideEffects(value) {
  const effects = Array.isArray(value) ? value : value ? [value] : [];
  return effects
    .filter((effect) => effect && typeof effect === "object" && !Array.isArray(effect))
    .map((effect) => ({
      kind: String(effect.kind || "").trim(),
      target: String(effect.target || "").trim() || "unknown",
      status: String(effect.status || "observed").trim() || "observed",
    }))
    .filter((effect) => effect.kind);
}

function sideEffectSignal(kind, stepId, target, status = "observed") {
  return { kind, stepId, target, status };
}

function artifactPath(value) {
  if (typeof value === "string" && looksLikePath(value)) return value;
  if (!value || typeof value !== "object") return null;
  return value.path || value.file || value.filePath || value.outputPath || value.manifestPath || value.recordPath || value.url || null;
}

function looksLikePath(value) {
  return /[\\/]/.test(value) || /\.[a-z0-9]{2,5}$/i.test(value);
}

export function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function summarizeForUser(turn) {
  const value = turn.result?.summary || turn.result?.reply || turn.result?.output || turn.error || "";
  return typeof value === "string" ? value.slice(0, 1000) : "";
}

async function summarizeTelemetry(turn, metricsLedger) {
  const elapsedMs = Date.now() - Date.parse(turn.startedAt);
  const empty = emptyTelemetry(turn.startedAt);
  empty.diagnostics.elapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : null;
  if (!metricsLedger?.report || !turn.metricsSince) return empty;
  try {
    const report = await metricsLedger.report(100, { since: turn.metricsSince, sessionId: turn.sessionId, turnId: turn.turnId });
    const metrics = report.summary || empty.diagnostics.metrics;
    const events = (report.events || []).map((event) => ({ timestamp: event.timestamp, kind: event.kind, operation: event.operation, ok: event.ok, latencyMs: event.latencyMs, usage: event.usage, traceId: event.traceId }));
    return normalizeTelemetry({ ...empty, diagnostics: { ...empty.diagnostics, metrics, events } }, turn.startedAt);
  } catch {
    return empty;
  }
}

function normalizeTelemetry(telemetry, startedAt = null) {
  const base = emptyTelemetry(startedAt);
  const metrics = telemetry?.diagnostics?.metrics ?? base.diagnostics.metrics;
  const events = telemetry?.diagnostics?.events ?? [];
  const elapsedMs = telemetry?.diagnostics?.elapsedMs ?? base.diagnostics.elapsedMs;
  const summary = { totalEvents: metrics.totalEvents || 0, failures: metrics.failures || 0 };
  return {
    schema: "walnutpi.agentTurnTelemetry.v1",
    summary,
    diagnostics: { elapsedMs, metrics, events },
  };
}

export function emptyDiagnostics() {
  return { schema: "walnutpi.agentTurnDiagnostics.v1", steps: [], loopModel: [], telemetry: { events: [] } };
}

function collectDiagnostics(turn) {
  const previousLoopModel = Array.isArray(turn.diagnostics?.loopModel) ? turn.diagnostics.loopModel : [];
  return {
    schema: "walnutpi.agentTurnDiagnostics.v1",
    rawTraceKind: "web-agent-turn",
    steps: (turn.steps || []).map((step) => ({
      stepId: step.stepId,
      parentStepId: step.parentStepId || null,
      agent: step.agent || null,
      kind: step.kind || null,
      action: step.action || null,
      status: step.status || "unknown",
      startedAt: step.startedAt || null,
      finishedAt: step.finishedAt || null,
      result: stepResult(step),
    })),
    loopModel: previousLoopModel,
    telemetry: {
      elapsedMs: turn.telemetry?.diagnostics?.elapsedMs ?? null,
      metrics: turn.telemetry?.diagnostics?.metrics || null,
      events: turn.telemetry?.diagnostics?.events || [],
    },
  };
}

function kebabCase(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function stepResult(step) {
  return step?._result || null;
}

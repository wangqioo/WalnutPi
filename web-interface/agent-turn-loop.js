import { createHash, randomUUID } from "node:crypto";
import { isSafeContinuationTask, MAX_CONTINUATION_TASKS, normalizeNextTasks } from "./action-registry.js";
import { createAgentRegistry } from "./agent-registry.js";
import { createDeviceAgent } from "./agents/device-agent.js";
import { createSessionAgent } from "./agents/session-agent.js";
import { createMemoryAgent } from "./agents/memory-agent.js";
import { createPolicyAgent } from "./agents/policy-agent.js";
import { createDiagnosticsAgent } from "./agents/diagnostics-agent.js";
import { createScreenAgent } from "./agents/screen-agent.js";
import { createChatAgent } from "./agents/chat-agent.js";

const DEFAULT_RECOVERY_OPTIONS = [
  "inspect the failed step evidence",
  "retry only after explicit user confirmation",
  "choose a safer manual fallback",
];
const MAX_AGENT_LOOP_TURNS = 4;

// ── Default registry (priority order) ─────────────────────────────────
// Agents are checked in registration order; first matchPlan() wins.
function createDefaultRegistry(options = {}) {
  return createAgentRegistry()
  .register("session", createSessionAgent())
  .register("memory", createMemoryAgent())
  .register("policy", createPolicyAgent())
  .register("diagnostics", createDiagnosticsAgent())
  .register("screen", createScreenAgent(options))
  .register("device", createDeviceAgent())
  .register("chat", createChatAgent());
}

const defaultRegistry = createDefaultRegistry();

// ── Plan selection (delegates to registry) ────────────────────────────

export function selectTurnPlan(classification, mode = "intent") {
  if (mode === "ai") return [{ agent: "chat", kind: "action.run", action: "ai" }];
  const plan = defaultRegistry.selectTurnPlan(classification, mode);
  return plan || [{ agent: "chat", kind: "action.run", action: "ai" }];
}

export const selectTurnStep = (classification, mode = "intent") => {
  const first = selectTurnPlan(classification, mode)[0];
  return first?.kind === "action.run"
    ? { id: `${first.agent}-run`, kind: first.kind, action: first.action }
    : { id: `${first.agent}-${first.kind.split(".").at(-1)}`, kind: first.kind };
};

// ── Turn loop factory ─────────────────────────────────────────────────

export function createAgentTurnLoop({
  classifyIntent,
  runAction,
  generateScreen,
  syncScreen,
  readPlaylistEnvelope,
  turnLedger,
  eventLedger,
  metricsLedger,
  queue,
  readJsonRequest,
  json,
  registry,
  hooks: rawHooks,
}) {
  const activeRegistry = registry || createDefaultRegistry({ readPlaylistEnvelope });
  const hooks = normalizeHooks(rawHooks);

  return {
    async handleTurn(req) {
      let body;
      try {
        body = await readJsonRequest(req);
      } catch (error) {
        return json({ ok: false, error: error.message }, 400);
      }
      const result = await runAgentTurn({
        body,
        classifyIntent,
        runAction,
        generateScreen,
        syncScreen,
        eventLedger,
        metricsLedger,
        queue,
        turnLedger,
        registry: activeRegistry,
        hooks,
      });
      await turnLedger?.appendTurn(result.turn);
      await hooks.onRunEnd(result.turn);
      return json(result.turn, result.status);
    },

    async handleTurns(url) {
      const sessionId = url.searchParams.get("sessionId") || null;
      const limit = Number(url.searchParams.get("limit") || 100);
      return json({
        ok: true,
        schema: "walnutpi.agentTurns.v1",
        turns: await turnLedger.readTurns({ sessionId, count: Number.isFinite(limit) ? limit : 100 }),
      });
    },

    async handleTurnEvents(url) {
      const sessionId = url.searchParams.get("sessionId") || null;
      const turnId = url.searchParams.get("turnId") || null;
      const afterSeq = Number(url.searchParams.get("afterSeq") || 0);
      return json({
        ok: true,
        schema: "walnutpi.agentTurnEvents.v1",
        events: await eventLedger.readEvents({ sessionId, turnId, afterSeq }),
      });
    },
  };
}

// ── Core turn runner ─────────────────────────────────────────────────

export async function runAgentTurn({
  body,
  classifyIntent,
  runAction,
  generateScreen,
  syncScreen,
  eventLedger,
  queue,
  turnLedger,
  metricsLedger,
  registry,
  hooks: extHooks,
}) {
  const workQueue = queue || { enqueue: (job) => job(), size: () => 0 };
  const activeRegistry = registry || createDefaultRegistry();
  const hooks = normalizeHooks(extHooks);
  const startedAt = new Date().toISOString();
  const turnId = `turn-${randomUUID()}`;
  const sessionId = String(body.sessionId || "").trim() || null;
  const mode = body.mode === "ai" ? "ai" : "intent";
  const text = String(body.text || "").trim();
  const turn = {
    schema: "walnutpi.agentTurn.v2",
    source: "web-agent-turn",
    turnId,
    sessionId,
    input: { text, mode },
    status: "running",
    agents: [],
    steps: [],
    artifacts: [],
    evidence: [],
    sideEffects: [],
    pendingNext: null,
    result: null,
    recovery: emptyRecovery(),
    loop: {
      schema: "walnutpi.agentLoop.v1",
      status: "running",
      maxTurns: MAX_AGENT_LOOP_TURNS,
      turns: [],
    },
    startedAt,
    metricsSince: startedAt,
    telemetry: emptyTelemetry(startedAt),
    diagnostics: emptyDiagnostics(),
  };
  await emit(eventLedger, turn, { kind: "turn.started", status: "running", data: { input: turn.input } });
  await hooks.onRunStart(turn);
  if (!text) return failTurn({ turn, eventLedger, status: 400, error: "missing text" });

  const classify = await runRouterAgent({ turn, text, classifyIntent, eventLedger, hooks });
  if (!classify.ok) return failTurn({ turn, eventLedger, status: classify.status || 500, error: classify.error });

  await hooks.onClassify(classify.classification, turn);
  await updateTurnTrace(turn, metricsLedger);
  const plan = activeRegistry.selectTurnPlan(classify.classification, mode) || [{ agent: "chat", kind: "action.run", action: "ai" }];
  turn.agents.push({ id: "router", status: "completed", plan });

  const looped = await runGoalLoop({ plan, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry: activeRegistry, hooks });
  if (looped.deferred) return { turn, status: looped.status };
  if (!looped.ok) return { turn, status: looped.status };

  await emitTurnDone(eventLedger, turn);
  return { turn, status: 200 };
}

// ── Goal loop ────────────────────────────────────────────────────────

async function runGoalLoop({ plan, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry, hooks }) {
  const pending = [...plan];
  let stepTurns = 0;
  while (pending.length) {
    const maxTurns = Number(turn.loop?.maxTurns || MAX_AGENT_LOOP_TURNS);
    if (stepTurns >= maxTurns) {
      await holdPendingTasks({ turn, tasks: pending.splice(0), reason: "max-turns", hooks });
      turn.loop.status = "blocked";
      await updateTurnTrace(turn, metricsLedger);
      return { ok: true, status: 200 };
    }

    const task = pending.shift();
    const result = await runTaskAgent({ task, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry, hooks });
    if (result.deferred || !result.ok) return result;

    stepTurns += 1;
    const decision = evaluateLoopProgress({ result, remainingTurns: maxTurns - stepTurns });
    turn.loop.turns.push({
      stepId: result.stepId || null,
      observation: decision.observation,
      judgment: decision.judgment,
      queuedTasks: decision.autoTasks.map(compactTaskSignal),
      blockedTasks: decision.blockedTasks.map((task) => compactTaskSignal(task, decision.reasonFor(task))),
    });

    if (decision.blockedTasks.length) await holdPendingTasks({ turn, tasks: decision.blockedTasks, reason: decision.blockReason, hooks, result });
    if (decision.autoTasks.length) {
      await emit(eventLedger, turn, {
        kind: "turn.replan",
        status: "running",
        data: { stepId: result.stepId, tasks: decision.autoTasks, blockedTasks: decision.blockedTasks.length },
      });
      pending.unshift(...decision.autoTasks);
    }
    await updateTurnTrace(turn, metricsLedger);
  }
  turn.loop.status = turn.pendingNext ? "blocked" : "completed";
  return { ok: true, status: 200 };
}

function evaluateLoopProgress({ result, remainingTurns }) {
  const nextTasks = normalizeNextTasks(result.stepResult?.nextTasks || result.stepResult?.pendingNext?.nextTasks);
  const safeTasks = nextTasks.filter(isSafeContinuationTask);
  const unsafeTasks = nextTasks.filter((task) => !isSafeContinuationTask(task));
  const autoTasks = safeTasks.slice(0, Math.min(MAX_CONTINUATION_TASKS, Math.max(0, remainingTurns)));
  const fanoutHeld = safeTasks.slice(autoTasks.length);
  const maxTurnHeld = remainingTurns <= 0 ? safeTasks : [];
  const blockedTasks = [...new Map([...fanoutHeld, ...maxTurnHeld, ...unsafeTasks].map((task) => [taskKey(task), task])).values()];
  const blockReason = unsafeTasks.length ? "continuation-requires-explicit-confirmation" : remainingTurns <= 0 ? "max-turns" : "max-continuation-tasks";
  return {
    observation: nextTasks.length ? "nextTasks" : "done",
    judgment: blockedTasks.length ? "blocked" : autoTasks.length ? "continue" : "done",
    autoTasks,
    blockedTasks,
    blockReason,
    reasonFor(task) {
      if (!isSafeContinuationTask(task)) return "continuation-requires-explicit-confirmation";
      if (remainingTurns <= 0) return "max-turns";
      return "max-continuation-tasks";
    },
  };
}

async function holdPendingTasks({ turn, tasks, reason, hooks, result = null }) {
  if (!tasks.length) return;
  const pendingNext = { kind: "nextTasks", tasks, reason };
  turn.pendingNext = mergePendingNext(turn.pendingNext, pendingNext);
  if (result?.stepResult && typeof result.stepResult === "object") result.stepResult.pendingNext = pendingNext;
  turn.recovery = {
    ...(turn.recovery || emptyRecovery()),
    status: "pending",
    pendingNext: turn.pendingNext,
    options: [
      ...new Set([
        ...(turn.recovery?.options || []),
        "confirm the pending next task explicitly before running it",
        "choose a read-only continuation instead",
      ]),
    ],
  };
  await hooks.onPendingNext(turn.pendingNext, turn);
}

// ── Router ────────────────────────────────────────────────────────────

async function runRouterAgent({ turn, text, classifyIntent, eventLedger, hooks }) {
  const step = beginStep({ id: "router-classify", agent: "router", kind: "intent.classify" });
  turn.steps.push(step);
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: "router" } });
  try {
    const classify = await classifyIntent(text, { sessionId: turn.sessionId, turnId: turn.turnId });
    step.status = classify.ok ? "completed" : "failed";
    step.result = classify.ok ? { classification: classify.classification } : { error: classify.error };
    finishStep(step);
    await emitStepDone(eventLedger, turn, step);
    if (classify.ok) await hooks?.onClassify?.(classify.classification, turn);
    return classify;
  } catch (error) {
    step.status = "failed";
    step.result = { error: error.message };
    finishStep(step);
    await emitStepDone(eventLedger, turn, step);
    await hooks?.onStepFail?.({ kind: "intent.classify" }, turn);
    return { ok: false, status: 500, error: error.message };
  }
}

// ── Task runner (dispatches to registry) ─────────────────────────────

async function runTaskAgent({ task, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry, hooks: extHooks }) {
  const activeRegistry = registry || defaultRegistry;
  const hooks = extHooks || emptyHooks();
  const step = beginStep({ id: `${task.agent}-${turn.steps.length}`, agent: task.agent, kind: task.kind, action: task.action || null });
  turn.steps.push(step);
  turn.agents.push({ id: task.agent, status: "running", task });
  await hooks.beforeStep(task, turn);
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: task.agent, task } });

  // Find the right agent runner
  const runner = activeRegistry.getRunner(task.agent);
  if (!runner) {
    // No registered handler — mark pending for manual resolution
    return pendingStepResult({ turn, step, task, eventLedger, metricsLedger });
  }

  // Build context object with all injected services + lifecycle helpers
  const ctx = {
    task, body, text, sessionId, turn, step, workQueue,
    runAction, generateScreen, syncScreen,
    eventLedger, turnLedger, metricsLedger,
    // ── Step lifecycle shortcuts ──
    setStepResult(ok, result) { step.status = ok ? "completed" : "failed"; step.result = result; finishStep(step); },
    setCompleted(result) { step.status = "completed"; step.result = result; finishStep(step); },
    setTurnResult(ok, result) { turn.status = ok ? "completed" : "failed"; turn.result = result; },
    setPending(reason) {
      turn.pendingNext = task.kind;
      turn.status = "pending";
      step.status = "pending";
      step.result = { task, pendingNext: task.kind, recoveryOptions: ["provide the missing input or confirmation", "retry this turn after the prerequisite is available"] };
      finishStep(step);
    },
    finishAgent() { finishAgent(turn, task.agent, step.status); },
    observeStepResult() { observeStepResult(turn, step); },
    updateTurnTrace() { return updateTurnTrace(turn, metricsLedger); },
    emitStepDone() { return emitStepDone(eventLedger, turn, step); },
    emitTurnDone() { return emitTurnDone(eventLedger, turn); },
    emit(event) { return emit(eventLedger, turn, event); },
    // ── Queue helper for async operations ──
    queueTask(run) { return queueTask({ turn, step, task, eventLedger, turnLedger, metricsLedger, workQueue, run }); },
  };

  try {
    const agentResult = await activeRegistry.runTask(task, ctx);

    // queueTask already handles completion; just return its deferred signal
    if (agentResult?.deferred) return agentResult;

    // Normal completion: hook, update trace and emit step done
    await hooks.afterStep({ stepId: step.id, stepResult: step.result }, turn);
    finishStep(step);
    await updateTurnTrace(turn, metricsLedger);
    await emitStepDone(eventLedger, turn, step);

    // For pending results, emit turn.pending
    if (turn.status === "pending") {
      await emit(eventLedger, turn, { kind: "turn.pending", status: "pending", data: { pendingNext: turn.pendingNext } });
    }

    // For failures, emit turn failed
    if (turn.status === "failed") {
      await hooks.onStepFail(task, turn);
      await emitTurnDone(eventLedger, turn);
    }

    return agentResult || { ok: true, status: 200, stepId: step.id, stepResult: step.result };
  } catch (error) {
    step.status = "failed";
    step.result = { ok: false, error: error.message };
    finishStep(step);
    finishAgent(turn, task.agent, "failed");
    turn.status = "failed";
    turn.error = error.message;
    turn.result = step.result;
    observeStepResult(turn, step);
    await hooks.onStepFail(task, turn);
    await updateTurnTrace(turn, metricsLedger);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
    return { ok: false, status: 500, stepId: step.id, stepResult: step.result };
  }
}

// ── Pending fallback (no runner found) ────────────────────────────────

function pendingStepResult({ turn, step, task, eventLedger, metricsLedger }) {
  step.status = "pending";
  step.result = {
    task,
    pendingNext: task.kind,
    recoveryOptions: ["provide the missing input or confirmation", "retry this turn after the prerequisite is available"],
  };
  finishStep(step);
  finishAgent(turn, task.agent, "pending");
  turn.pendingNext = task.kind;
  turn.result = step.result;
  turn.status = "pending";
  observeStepResult(turn, step);
  updateTurnTrace(turn, metricsLedger);
  emitStepDone(eventLedger, turn, step);
  emit(eventLedger, turn, { kind: "turn.pending", status: "pending", data: { pendingNext: turn.pendingNext } });
  return { ok: true, status: 200, stepId: step.id, stepResult: step.result };
}

// ── Queue helpers (async operation lifecycle) ────────────────────────

async function queueTask({ turn, step, task, eventLedger, turnLedger, metricsLedger, workQueue, run }) {
  step.status = "queued";
  turn.status = "queued";
  turn.pendingNext = step.kind;
  turn.result = { queued: true, stepId: step.id, agent: task.agent };
  finishAgent(turn, task.agent, "queued");
  observeStepResult(turn, step);
  await updateTurnTrace(turn, metricsLedger);
  await emit(eventLedger, turn, { kind: "turn.pending", status: "queued", data: { stepId: step.id, queueSize: workQueue.size() } });
  workQueue.enqueue(() => completeQueuedStep({ turn, step, task, eventLedger, turnLedger, metricsLedger, run }));
  return { ok: true, deferred: true, status: 202 };
}

async function completeQueuedStep({ turn, step, task, eventLedger, turnLedger, metricsLedger, run }) {
  step.status = "running";
  finishAgent(turn, task.agent, "running");
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: task.agent, task } });
  try {
    const result = await run();
    step.status = result.body?.ok ? "completed" : "failed";
    step.result = result.body;
    finishStep(step);
    finishAgent(turn, task.agent, step.status);
    turn.status = result.body?.ok ? "completed" : "failed";
    turn.result = result.body;
    turn.pendingNext = null;
    observeStepResult(turn, step);
    await updateTurnTrace(turn, metricsLedger);
    await turnLedger?.appendTurn(turn);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
  } catch (error) {
    step.status = "failed";
    step.result = { ok: false, error: error.message };
    finishStep(step);
    finishAgent(turn, task.agent, "failed");
    turn.status = "failed";
    turn.error = error.message;
    turn.result = step.result;
    turn.pendingNext = null;
    observeStepResult(turn, step);
    await updateTurnTrace(turn, metricsLedger);
    await turnLedger?.appendTurn(turn);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
  }
}

// ── Turn lifecycle helpers ───────────────────────────────────────────

function finishAgent(turn, agentId, status) {
  const agent = turn.agents.findLast((item) => item.id === agentId && !["completed", "failed"].includes(item.status));
  if (agent) agent.status = status;
}

function beginStep({ id, agent, kind, action = null, parentStepId = null }) {
  return {
    id,
    stepId: id,
    parentStepId,
    agent,
    kind,
    status: "running",
    action,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

function finishStep(step) {
  if (!step || ["running", "queued"].includes(step.status)) return;
  step.stepId ||= step.id;
  step.finishedAt ||= new Date().toISOString();
}

async function failTurn({ turn, eventLedger, status, error }) {
  turn.status = "failed";
  turn.error = error;
  await updateTurnTrace(turn);
  await emit(eventLedger, turn, { kind: "turn.failed", status: "failed", error });
  return { turn, status };
}

async function emitStepDone(eventLedger, turn, step) {
  await emit(eventLedger, turn, {
    kind: step.status === "completed" ? "agent.completed" : step.status === "pending" || step.status === "queued" ? "agent.pending" : "agent.failed",
    status: step.status,
    stepId: step.id,
    data: step.status === "completed" ? { agent: step.agent, kind: step.kind, result: step.result } : { agent: step.agent, kind: step.kind },
    error: step.status === "failed" ? step.result?.error || step.result?.output || "step failed" : null,
  });
}

async function emitTurnDone(eventLedger, turn) {
  await emit(eventLedger, turn, {
    kind: turn.status === "completed" ? "turn.completed" : "turn.failed",
    status: turn.status,
    data: turn.status === "completed" ? { result: turn.result } : undefined,
    error: turn.status === "failed" ? turn.error || turn.result?.error || turn.result?.output || "turn failed" : null,
  });
}

async function emit(eventLedger, turn, event) {
  await eventLedger?.appendEvent({ turnId: turn.turnId, sessionId: turn.sessionId, ...event });
}

async function updateTurnTrace(turn, metricsLedger = null) {
  turn.route = turn.steps.find((step) => step.kind === "intent.classify")?.result?.classification || null;
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

// ── Artifact / evidence / side-effect collection ─────────────────────

function collectArtifacts(turn) {
  const artifacts = [];
  const push = (kind, value, step) => { if (value) artifacts.push(artifactSignal(kind, value, step)); };
  for (const step of turn.steps) {
    const result = step.result || {};
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
  if (turn.route) push("intent-route", turn.route);
  for (const step of turn.steps) {
    push("agentTurn-step", { id: step.id, agent: step.agent, kind: step.kind, status: step.status, action: step.action });
    const result = step.result || {};
    push("action-policy-id", result.id);
    push("bus-read-output", result.id === "i2c_scan" ? result.output || result.actionEvidence?.output : null);
    push("action-evidence-or-honest-failure", result.actionEvidence || (result.ok === false ? result.error || result.output : null));
    push("terminal-command-evidence", result.mode === "terminal" ? result.command : null);
    push("session-event", result.mode === "terminal" || result.diagnostics?.sessionLogMs ? { action: result.id, traceId: result.diagnostics?.traceId } : null);
    push("delegation-evidence", result.contextUsed);
    push("metrics-trace-id", result.diagnostics?.traceId);
    push("output-failed", typeof result.outputFailed === "boolean" ? result.outputFailed : null);
    push("preview-or-sync-readiness", result.widgetApp || result.playlist || result.output);
    push("weather-source-or-fetch-failure", weatherSourceOrFetchFailure(result));
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
  push("loop-evaluator", turn.loop?.turns?.length ? turn.loop.turns.map((item) => ({ stepId: item.stepId, observation: item.observation, judgment: item.judgment })) : null);
  return evidence;
}

function multiStepLoopSignal(step) {
  const nextTasks = normalizeNextTasks(step.result?.nextTasks || step.result?.pendingNext?.nextTasks);
  if (!nextTasks.length) return null;
  return {
    sourceStepId: step.id,
    proposedTaskCount: nextTasks.length,
    safeTaskCount: nextTasks.filter(isSafeContinuationTask).slice(0, MAX_CONTINUATION_TASKS).length,
    boundedContinuation: MAX_CONTINUATION_TASKS,
  };
}

function replanEvidenceSignal(step) {
  const nextTasks = normalizeNextTasks(step.result?.nextTasks || step.result?.pendingNext?.nextTasks);
  if (!nextTasks.length) return null;
  const heldTasks = normalizeNextTasks(step.result?.pendingNext?.tasks);
  const heldKeys = new Set(heldTasks.map(taskKey));
  const safeTasks = nextTasks.filter(isSafeContinuationTask);
  const unsafeTasks = nextTasks.filter((task) => !isSafeContinuationTask(task));
  const safeAutoContinue = safeTasks.filter((task) => !heldKeys.has(taskKey(task))).slice(0, MAX_CONTINUATION_TASKS);
  const overLimitSafe = safeTasks.filter((task) => !safeAutoContinue.includes(task) && !heldKeys.has(taskKey(task)));
  return {
    reason: "task-result-nextTasks",
    proposedTasks: nextTasks.map(compactTaskSignal),
    safeAutoContinue: safeAutoContinue.map(compactTaskSignal),
    blockedTasks: [
      ...heldTasks.map((task) => compactTaskSignal(task, step.result?.pendingNext?.reason || "pending-next")),
      ...overLimitSafe.map((task) => compactTaskSignal(task, "max-continuation-tasks")),
      ...unsafeTasks.filter((task) => !heldKeys.has(taskKey(task))).map((task) => compactTaskSignal(task, "continuation-requires-explicit-confirmation")),
    ],
  };
}

function compactTaskSignal(task, reason = null) {
  return { agent: task.agent, kind: task.kind, action: task.action || null, ...(reason ? { reason } : {}) };
}

function collectContextUsed(turn) {
  const values = turn.steps.map((step) => step.result?.contextUsed).filter(Boolean);
  return values.length ? values : null;
}

function taskKey(task) {
  return `${task.agent || ""}\0${task.kind || ""}\0${task.action || ""}`;
}

function mergePendingNext(current, next) {
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
    tasks,
    reason: current.reason === next.reason ? current.reason : "multiple-continuations-pending",
  };
}

function collectRecovery(turn) {
  const failedStep = turn.steps.findLast((step) => step.status === "failed");
  const turnFailed = turn.status === "failed";
  const pendingNext = turn.pendingNext || turn.steps.findLast((step) => step.result?.pendingNext)?.result?.pendingNext || null;
  const resultOptions = turn.steps.flatMap((step) => normalizeRecoveryOptions(step.result?.recoveryOptions || step.result?.repairOptions));
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
    error: failedStep?.result?.error || failedStep?.result?.output || turn.error || null,
  };
}

function observeStepResult(turn, step) {
  const result = step?.result || {};
  if (result.pendingNext) turn.pendingNext = result.pendingNext;
  const options = normalizeRecoveryOptions(result.recoveryOptions || result.repairOptions);
  if (options.length || step.status === "failed") {
    turn.recovery = {
      ...(turn.recovery || emptyRecovery()),
      status: step.status === "failed" ? "available" : "pending",
      pendingNext: turn.pendingNext || result.pendingNext || null,
      options: [...new Set([...(turn.recovery?.options || []), ...options, ...(step.status === "failed" ? DEFAULT_RECOVERY_OPTIONS : [])])],
      failedStepId: step.status === "failed" ? step.id : turn.recovery?.failedStepId || null,
      error: step.status === "failed" ? result.error || result.output || "step failed" : turn.recovery?.error || null,
    };
  }
}

function normalizeTurnShape(turn) {
  turn.source ||= "web-agent-turn";
  turn.steps = (Array.isArray(turn.steps) ? turn.steps : []).map((step) => normalizeStep(step, turn.startedAt));
  turn.artifacts = Array.isArray(turn.artifacts) ? turn.artifacts : objectEntriesAsSignals(turn.artifacts);
  turn.evidence = Array.isArray(turn.evidence) ? turn.evidence : objectEntriesAsSignals(turn.evidence);
  turn.sideEffects = Array.isArray(turn.sideEffects) ? turn.sideEffects : objectEntriesAsSignals(turn.sideEffects);
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

function normalizeStep(step, fallbackStartedAt = null) {
  const normalized = step && typeof step === "object" ? step : {};
  normalized.id ||= normalized.stepId || "step";
  normalized.stepId ||= normalized.id;
  normalized.parentStepId ??= null;
  normalized.status ||= "unknown";
  normalized.startedAt ||= fallbackStartedAt;
  normalized.finishedAt ??= null;
  return normalized;
}

function objectEntriesAsSignals(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([kind, entryValue]) => ({ kind, value: entryValue }));
}

function normalizeRecoveryOptions(value) {
  if (!value) return [];
  const options = Array.isArray(value) ? value : [value];
  return options.map((item) => String(item || "").trim()).filter(Boolean);
}

function emptyRecovery() {
  return { status: "not-needed", pendingNext: null, options: [], failedStepId: null, error: null };
}

function emptyTelemetry(startedAt) {
  const elapsedMs = startedAt ? Date.now() - Date.parse(startedAt) : null;
  const metrics = { totalEvents: 0, failures: 0, tokens: { input: 0, output: 0, total: 0, cached: 0, reasoning: 0 }, latency: {} };
  return {
    schema: "walnutpi.agentTurnTelemetry.v1",
    summary: { totalEvents: 0, failures: 0 },
    diagnostics: { elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null, metrics, events: [] },
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
    metrics,
    events: [],
  };
}

// ── Screen-specific helpers ──────────────────────────────────────────

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

function weatherSourceOrFetchFailure(result) {
  const facts = result.facts?.facts || [];
  const fact = facts.find((item) => item.kind === "weather.current" || item.source || item.error);
  if (!fact) return result.evidence?.weatherSourceOrFetchFailure || null;
  return { ok: !fact.error, source: fact.source || "unknown", location: fact.location || fact.city || null, error: fact.error || null, observedAt: fact.observedAt || null };
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

function classifySideEffects(turn) {
  const executed = turn.steps
    .filter((step) => step.status === "completed" || step.status === "running" || step.status === "queued")
    .map((step) => ({ stepId: step.stepId || step.id, kind: step.kind, action: step.action, result: step.result }))
    .filter((step) => !["intent.classify", "policy.decision", "diagnostics.recent_failure.read", "screen.state_frame.read"].includes(step.kind));
  const text = JSON.stringify(executed).toLowerCase();
  const sourceStepId = executed.find((step) => JSON.stringify(step).toLowerCase())?.stepId || null;
  return [
    text.includes("screen.workspace.sync") ? sideEffectSignal("screen-sync", sourceStepId, "screen-runtime") : null,
    text.includes("device-write") || text.includes("write-high") ? sideEffectSignal("device-write", sourceStepId, "device") : null,
    text.includes("service-restart") || text.includes("restart walnut-screen.service") ? sideEffectSignal("service-restart", sourceStepId, "walnut-screen.service") : null,
    text.includes("\"action\":\"note\"") || text.includes("daily-note") ? sideEffectSignal("daily-note-write", sourceStepId, "daily-note") : null,
    text.includes("durable-memory-write") ? sideEffectSignal("durable-memory-write", sourceStepId, "durable-memory") : null,
  ].filter(Boolean);
}

function sideEffectSignal(kind, stepId, target) {
  return { kind, stepId, target, status: "observed" };
}

function artifactPath(value) {
  if (typeof value === "string" && looksLikePath(value)) return value;
  if (!value || typeof value !== "object") return null;
  return value.path || value.file || value.filePath || value.outputPath || value.manifestPath || value.recordPath || value.url || null;
}

function looksLikePath(value) {
  return /[\\/]/.test(value) || /\.[a-z0-9]{2,5}$/i.test(value);
}

function sha256(value) {
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
  empty.elapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : null;
  empty.diagnostics.elapsedMs = empty.elapsedMs;
  if (!metricsLedger?.report || !turn.metricsSince) return empty;
  try {
    const report = await metricsLedger.report(100, { since: turn.metricsSince, sessionId: turn.sessionId, turnId: turn.turnId });
    const metrics = report.summary || empty.metrics;
    const events = (report.events || []).map((event) => ({ timestamp: event.timestamp, kind: event.kind, operation: event.operation, ok: event.ok, latencyMs: event.latencyMs, usage: event.usage, traceId: event.traceId }));
    return normalizeTelemetry({ ...empty, metrics, events, diagnostics: { ...empty.diagnostics, metrics, events } }, turn.startedAt);
  } catch {
    return empty;
  }
}

function normalizeTelemetry(telemetry, startedAt = null) {
  const base = emptyTelemetry(startedAt);
  const metrics = telemetry?.metrics || telemetry?.diagnostics?.metrics || base.metrics;
  const events = telemetry?.events || telemetry?.diagnostics?.events || [];
  const elapsedMs = telemetry?.elapsedMs ?? telemetry?.diagnostics?.elapsedMs ?? base.elapsedMs;
  const suppliedSummary = telemetry?.summary || null;
  const summary = suppliedSummary && (suppliedSummary.totalEvents || suppliedSummary.failures)
    ? suppliedSummary
    : { totalEvents: metrics.totalEvents || 0, failures: metrics.failures || 0 };
  return {
    schema: "walnutpi.agentTurnTelemetry.v1",
    summary,
    diagnostics: { elapsedMs, metrics, events },
    elapsedMs,
    metrics,
    events,
  };
}

function emptyDiagnostics() {
  return { schema: "walnutpi.agentTurnDiagnostics.v1", steps: [], telemetry: { events: [] } };
}

function collectDiagnostics(turn) {
  return {
    schema: "walnutpi.agentTurnDiagnostics.v1",
    rawTraceKind: "web-agent-turn",
    steps: (turn.steps || []).map((step) => ({
      stepId: step.stepId || step.id,
      parentStepId: step.parentStepId || null,
      agent: step.agent || null,
      kind: step.kind || null,
      action: step.action || null,
      status: step.status || "unknown",
      startedAt: step.startedAt || null,
      finishedAt: step.finishedAt || null,
      result: step.result || null,
    })),
    telemetry: {
      elapsedMs: turn.telemetry?.diagnostics?.elapsedMs ?? turn.telemetry?.elapsedMs ?? null,
      metrics: turn.telemetry?.diagnostics?.metrics || turn.telemetry?.metrics || null,
      events: turn.telemetry?.diagnostics?.events || turn.telemetry?.events || [],
    },
  };
}

function kebabCase(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

// ── Lifecycle hook system ─────────────────────────────────────────────

function normalizeHooks(raw) {
  if (!raw || typeof raw !== "object") return emptyHooks();
  return {
    onRunStart: typeof raw.onRunStart === "function" ? raw.onRunStart : async () => {},
    onClassify: typeof raw.onClassify === "function" ? raw.onClassify : async () => {},
    beforeStep: typeof raw.beforeStep === "function" ? raw.beforeStep : async () => {},
    afterStep: typeof raw.afterStep === "function" ? raw.afterStep : async () => {},
    onStepFail: typeof raw.onStepFail === "function" ? raw.onStepFail : async () => {},
    onPendingNext: typeof raw.onPendingNext === "function" ? raw.onPendingNext : async () => {},
    onRunEnd: typeof raw.onRunEnd === "function" ? raw.onRunEnd : async () => {},
  };
}

function emptyHooks() {
  return {
    onRunStart: async () => {},
    onClassify: async () => {},
    beforeStep: async () => {},
    afterStep: async () => {},
    onStepFail: async () => {},
    onPendingNext: async () => {},
    onRunEnd: async () => {},
  };
}

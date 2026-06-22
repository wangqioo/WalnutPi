import { createHash, randomUUID } from "node:crypto";
import { isSafeContinuationTask, MAX_CONTINUATION_TASKS, normalizeNextTasks } from "./action-registry.ts";
import { createAgentRegistry } from "./agent-registry.ts";
import { createDeviceAgent } from "./agents/device-agent.ts";
import { createSessionAgent } from "./agents/session-agent.ts";
import { createMemoryAgent } from "./agents/memory-agent.ts";
import { createPolicyAgent } from "./agents/policy-agent.ts";
import { createDiagnosticsAgent } from "./agents/diagnostics-agent.ts";
import { createScreenAgent } from "./agents/screen-agent.ts";
import { createChatAgent } from "./agents/chat-agent.ts";
import { assertNoOracleForLoop, normalizeLoopScenario, scenarioVetoReason } from "../scripts/agent-scenario-contract.ts";
import {
  buildModelVisibleLoopContext,
  normalizeAgentLoopProposal,
  normalizeLoopModelRequest,
} from "../scripts/agent-loop-model-contract.ts";

const DEFAULT_RECOVERY_OPTIONS = [
  "inspect the failed step evidence",
  "retry only after explicit user confirmation",
  "choose an explicit read-only path",
];
const MAX_AGENT_LOOP_TURNS = 4;
type JsonObject = Record<string, any>;
type LoopProposal = {
  blockedTasks: any[];
  evidencePlan: any[];
  kind: string;
  proposedTasks: any[];
  safeAutoContinue: any[];
  source: string;
};

// ── Default registry (priority order) ─────────────────────────────────
// Agents are checked in registration order; first matchPlan() wins.
function createDefaultRegistry(options: JsonObject = {}) {
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
  loopModelAdapter,
}: JsonObject) {
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
        loopModelAdapter,
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
  loopModelAdapter,
}: JsonObject) {
  const workQueue = queue || { enqueue: (job) => job(), size: () => 0 };
  const activeRegistry = registry || createDefaultRegistry();
  const hooks = normalizeHooks(extHooks);
  const startedAt = new Date().toISOString();
  const turnId = `turn-${randomUUID()}`;
  const sessionId = String(body.sessionId || "").trim() || null;
  const mode = body.mode === "ai" ? "ai" : "intent";
  const text = String(body.text || "").trim();
  let scenario = null;
  const loopModel = normalizeLoopModelOptions(body.loopModel, {
    requirements: body.requirements,
  });
  const turn = {
    schema: "walnutpi.agentTurn.v2",
    source: "web-agent-turn",
    turnId,
    sessionId,
    input: { text, mode, scenario, requirements: normalizeTurnRequirements(body.requirements), loopModel },
    status: "running",
    agents: [],
    steps: [],
    artifacts: [],
    evidence: [],
    sideEffects: [],
    pendingNext: null,
    recovery: emptyRecovery(),
    loop: {
      schema: "walnutpi.agentLoop.v1",
      status: "running",
      maxTurns: MAX_AGENT_LOOP_TURNS,
      plan: null,
      turns: [],
    },
    startedAt,
    metricsSince: startedAt,
    telemetry: emptyTelemetry(startedAt),
    diagnostics: emptyDiagnostics(),
  };
  await emit(eventLedger, turn, { kind: "turn.started", status: "running", data: { input: turn.input } });
  await hooks.onRunStart(turn);
  try {
    assertNoOracleForLoop(body);
    scenario = normalizeLoopScenario(body.scenario);
    turn.input.scenario = scenario;
  } catch (error) {
    return failTurn({ turn, eventLedger, status: 400, error: error.message });
  }
  if (!text) return failTurn({ turn, eventLedger, status: 400, error: "missing text" });
  if (turn.input.requirements.model && (!turn.input.loopModel.enabled || !turn.input.loopModel.model || !turn.input.loopModel.reasoningEffort)) {
    return failTurn({ turn, eventLedger, status: 400, error: "requirements.model requires explicit loopModel.model and loopModel.reasoningEffort" });
  }

  const classify = await runRouterAgent({ turn, text, classifyIntent, eventLedger, hooks });
  if (!classify.ok) return failTurn({ turn, eventLedger, status: classify.status || 500, error: classify.error });

  await hooks.onClassify(classify.classification, turn);
  await updateTurnTrace(turn, metricsLedger);
  const plan = activeRegistry.selectTurnPlan(classify.classification, mode) || [{ agent: "chat", kind: "action.run", action: "ai" }];
  turn.loop.plan = buildInitialLoopPlan({ plan, scenario: turn.input.scenario, loopModel });
  turn.agents.push({ id: "router", status: "completed", plan });

  const looped = await runGoalLoop({ plan, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry: activeRegistry, hooks, loopModelAdapter });
  if (looped.deferred) return { turn, status: looped.status };
  if (!looped.ok) return { turn, status: looped.status };

  await emitTurnDone(eventLedger, turn);
  return { turn, status: 200 };
}

// ── Goal loop ────────────────────────────────────────────────────────

async function runGoalLoop({ plan, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry, hooks, loopModelAdapter }: JsonObject) {
  const pending = [...plan];
  let stepTurns = 0;
  updateLoopPlanProgress(turn, { pending, phase: "started" });
  while (pending.length) {
    const maxTurns = Number(turn.loop?.maxTurns || MAX_AGENT_LOOP_TURNS);
    if (stepTurns >= maxTurns) {
      await holdPendingTasks({ turn, tasks: pending.splice(0), reason: "max-turns", hooks });
      turn.loop.status = "blocked";
      updateLoopPlanProgress(turn, { pending, phase: "blocked", stopReason: "max-turns" });
      await updateTurnTrace(turn, metricsLedger);
      return { ok: true, status: 200 };
    }

    const task = pending.shift();
    updateLoopPlanProgress(turn, { pending, phase: "executing", currentTask: task });
    const result = await runTaskAgent({ task, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry, hooks });
    if (result.deferred || !result.ok) return result;

    stepTurns += 1;
    updateLoopPlanProgress(turn, { pending, phase: "observed", currentTask: task, result });
    const decision = await evaluateLoopProgress({ result, scenario: turn.input.scenario, remainingTurns: maxTurns - stepTurns, text, turn, loopModelAdapter });
    turn.loop.turns.push({
      sourceStepId: result.stepId || null,
      observation: decision.observation,
      judgment: decision.judgment,
      proposal: decision.proposalTrace,
      policy: decision.policyTrace,
      autoContinuedTasks: decision.autoTasks.map((task) => compactTaskSignal(task)),
      blockedTasks: decision.blockedTasks,
      ...(decision.vetoes.length ? { vetoes: decision.vetoes } : {}),
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
    updateLoopPlanProgress(turn, { pending, phase: decision.judgment, decision });
    await updateTurnTrace(turn, metricsLedger);
  }
  turn.loop.status = turn.pendingNext ? "blocked" : "completed";
  updateLoopPlanProgress(turn, { pending, phase: turn.loop.status, stopReason: turn.pendingNext ? "pending-next" : "stop-condition-satisfied" });
  await updateTurnTrace(turn, metricsLedger);
  return { ok: true, status: 200 };
}

async function evaluateLoopProgress({ result, scenario, remainingTurns, text, turn, loopModelAdapter }: JsonObject) {
  const actionProposal = normalizeContinuationProposal(result.stepResult || {});
  const proposalResult = await resolveLoopProposal({ actionProposal, result, scenario, remainingTurns, text, turn, loopModelAdapter });
  const proposal = proposalResult.proposal as LoopProposal;
  const autoTasks = [];
  const blockedSignals = [];
  const vetoes = [];
  const explicitlyHandled = new Set();

  for (const blocked of proposal.blockedTasks) {
    explicitlyHandled.add(taskKey(blocked.task));
    blockedSignals.push(compactTaskSignal(blocked.task, blocked.reason, {
      blockedBy: "agent-proposal",
      agentProposed: "blocked",
    }));
  }

  for (const task of proposal.safeAutoContinue) {
    explicitlyHandled.add(taskKey(task));
    const hardReason = !candidateTaskAllowed(task, actionProposal)
      ? "model-proposed-task-without-action-candidate"
      : !isSafeContinuationTask(task)
      ? "continuation-requires-explicit-confirmation"
      : repeatedContinuationReason(task, turn)
        || scenarioVetoReason(task, scenario);
    const overBudgetReason = remainingTurns <= 0
      ? "max-turns"
      : autoTasks.length >= MAX_CONTINUATION_TASKS
        ? "max-continuation-tasks"
        : null;
    const reason = hardReason || overBudgetReason;
    if (reason) {
      const signal = compactTaskSignal(task, reason, {
        blockedBy: "loop-policy",
        agentProposed: proposal.source === "model" ? "model-auto" : "auto",
      });
      blockedSignals.push(signal);
      vetoes.push(signal);
    } else {
      autoTasks.push(task);
    }
  }

  for (const task of proposal.proposedTasks.filter((item) => !explicitlyHandled.has(taskKey(item)))) {
    const hardReason = !candidateTaskAllowed(task, actionProposal)
      ? "model-proposed-task-without-action-candidate"
      : !isSafeContinuationTask(task)
      ? "continuation-requires-explicit-confirmation"
      : repeatedContinuationReason(task, turn)
        || scenarioVetoReason(task, scenario)
        || "agent-proposal-not-marked-auto";
    const signal = compactTaskSignal(task, hardReason, {
      blockedBy: "loop-policy",
      agentProposed: proposal.source === "model" ? "model-next" : "next",
    });
    blockedSignals.push(signal);
    vetoes.push(signal);
  }

  const blockedTasks = dedupeTaskSignals(blockedSignals) as any[];
  const blockReason = (blockedTasks[0] as JsonObject | undefined)?.reason || null;
  return {
    observation: proposal.proposedTasks.length ? "nextTasks" : "done",
    judgment: blockedTasks.length ? "blocked" : autoTasks.length ? "continue" : "done",
    proposalTrace: {
      source: proposal.source,
      kind: proposal.kind,
      safeAutoContinue: proposal.safeAutoContinue.map((task) => compactTaskSignal(task)),
      blockedTasks: proposal.blockedTasks.map((item: any) => compactTaskSignal(item.task, item.reason)),
      evidencePlan: proposal.evidencePlan,
    },
    policyTrace: {
      accepted: !vetoes.length && !blockedTasks.some((task: any) => task.blockedBy === "loop-policy"),
      vetoApplied: Boolean(vetoes.length),
      vetoReasons: [...new Set(vetoes.map((item: any) => item.reason).filter(Boolean))],
      effectiveAction: blockedTasks.length ? "block" : autoTasks.length ? "continue" : "done",
    },
    proposalDiagnostics: proposalResult.diagnostics,
    autoTasks,
    blockedTasks,
    vetoes,
    blockReason,
    reasonFor(task) {
      return task.reason || blockReason || "blocked";
    },
  };
}

function buildInitialLoopPlan({ plan, scenario, loopModel }: JsonObject) {
  const evidencePlan = (scenario?.requiredEvidence || []).map((evidenceId) => ({
    evidenceId,
    status: "planned",
    blocking: true,
  }));
  return {
    schema: "walnutpi.agentTurnPlan.v1",
    source: loopModel?.enabled ? "router+model-replan" : "router+action-replan",
    initialTasks: (plan || []).map((task) => compactTaskSignal(task)),
    remainingTasks: (plan || []).map((task) => compactTaskSignal(task)),
    executedTasks: [],
    currentTask: null,
    stopCondition: "complete when required evidence is present or no new safe continuation is available",
    stopCriteria: [
      "all blocking evidence is present",
      "no new safe continuation is available",
      "remaining turn budget is exhausted",
      "policy blocks every proposed continuation",
    ],
    evidencePlan,
    requiredEvidence: scenario?.requiredEvidence || [],
    maxTurns: MAX_AGENT_LOOP_TURNS,
    progress: {
      phase: "planned",
      completedSteps: 0,
      remainingTurns: MAX_AGENT_LOOP_TURNS,
      stopReason: null,
    },
  };
}

function updateLoopPlanProgress(turn, { pending = [], phase = "running", currentTask = null, result = null, decision = null, stopReason = null } = {}) {
  const plan = turn.loop?.plan;
  if (!plan) return;
  const completedSteps = (turn.steps || []).filter((step) => step.status === "completed").length;
  const maxTurns = Number(turn.loop?.maxTurns || plan.maxTurns || MAX_AGENT_LOOP_TURNS);
  plan.remainingTasks = pending.map((task) => compactTaskSignal(task));
  plan.executedTasks = (turn.steps || [])
    .filter((step) => step.kind !== "intent.classify")
    .map((step) => ({
      stepId: step.stepId || step.id || null,
      agent: step.agent || null,
      kind: step.kind || null,
      action: step.action || null,
      status: step.status || null,
    }));
  plan.currentTask = currentTask ? compactTaskSignal(currentTask) : null;
  plan.progress = {
    phase,
    completedSteps,
    remainingTurns: Math.max(0, maxTurns - Math.max(0, completedSteps - 1)),
    lastStepId: result?.stepId || null,
    lastJudgment: decision?.judgment || null,
    stopReason,
  };
  const evidenceKinds = new Set((turn.evidence || []).map((item) => item.kind));
  plan.evidencePlan = (plan.evidencePlan || []).map((entry) => {
    const evidenceId = typeof entry === "string" ? entry : entry.evidenceId;
    return {
      evidenceId,
      status: evidenceKinds.has(evidenceId) ? "present" : "planned",
      blocking: typeof entry === "object" && Object.hasOwn(entry, "blocking") ? Boolean(entry.blocking) : true,
    };
  });
}

async function resolveLoopProposal({ actionProposal, result, scenario, remainingTurns, text, turn, loopModelAdapter }: JsonObject) {
  const actionBacked = actionProposalFromContinuation(actionProposal);
  const loopModel = turn.input?.loopModel;
  if (!loopModel?.enabled) {
    return { proposal: actionBacked, diagnostics: null };
  }
  if (!actionProposal.proposedTasks.length) {
    return { proposal: actionBacked, diagnostics: null };
  }
  const modelContext = buildModelVisibleLoopContext({
    text,
    scenario,
    turn,
    result,
    remainingTurns,
    proposalFromAction: actionProposal,
    modelOptions: loopModel,
  });
  const modelContextHash = sha256(modelContext);
  try {
    const adapter = bodyAllowsFixtureLoopModel(turn) ? createFixtureLoopModelAdapter() : loopModelAdapter;
    if (!adapter?.propose) throw new Error("loop model adapter is not configured");
    const modelResult = await adapter.propose(modelContext, {
      model: loopModel.model,
      reasoningEffort: loopModel.reasoningEffort,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
    });
    const proposal = normalizeAgentLoopProposal(modelResult?.proposal, { source: "model" });
    const mergedProposal = mergeModelProposalWithActionCandidates(proposal, actionProposal);
    const artifacts = loopModelArtifacts({
      sourceStepId: result.stepId || null,
      modelContext,
      modelContextHash,
      rawOutput: modelResult?.rawOutput,
      normalizedProposal: mergedProposal,
    });
    turn.diagnostics.loopModel = [
      ...(turn.diagnostics.loopModel || []),
      {
        sourceStepId: result.stepId || null,
        modelContextHash,
        provider: modelResult?.diagnostics?.provider || "unknown",
        model: modelResult?.diagnostics?.model || loopModel.model,
        reasoningEffort: modelResult?.diagnostics?.reasoningEffort || loopModel.reasoningEffort,
        requestId: modelResult?.diagnostics?.requestId || null,
        latencyMs: modelResult?.diagnostics?.latencyMs ?? null,
        promptHash: modelResult?.diagnostics?.promptHash || modelContextHash,
        rawOutputHash: modelResult?.diagnostics?.rawOutputHash || null,
        validationErrors: modelResult?.diagnostics?.validationErrors || [],
        artifacts,
      },
    ];
    return { proposal: mergedProposal, diagnostics: turn.diagnostics.loopModel.at(-1) };
  } catch (error) {
    const diagnostics = {
      sourceStepId: result.stepId || null,
      modelContextHash,
      provider: "loop-model",
      model: loopModel.model,
      reasoningEffort: loopModel.reasoningEffort,
      requestId: null,
      latencyMs: null,
      promptHash: modelContextHash,
      rawOutputHash: null,
      validationErrors: [error.message],
      artifacts: loopModelArtifacts({
        sourceStepId: result.stepId || null,
        modelContext,
        modelContextHash,
        rawOutput: null,
        normalizedProposal: null,
      }),
    };
    turn.diagnostics.loopModel = [...(turn.diagnostics.loopModel || []), diagnostics];
    if (turn.input?.requirements?.model) {
      return {
        proposal: {
          source: "model",
          kind: "block",
          safeAutoContinue: [],
          proposedTasks: actionProposal.proposedTasks,
          blockedTasks: actionProposal.proposedTasks.map((task) => ({ task, reason: "model-proposal-unavailable" })),
          evidencePlan: [{ evidenceId: "model-proposal", blocking: true }],
        },
        diagnostics,
      };
    }
    return { proposal: actionBacked, diagnostics };
  }
}

function bodyAllowsFixtureLoopModel(turn: JsonObject) {
  return turn.input?.loopModel?.provider === "fixture";
}

function createFixtureLoopModelAdapter() {
  return {
    async propose(context: JsonObject, options: JsonObject) {
      const candidate = context.candidateProposal?.safeAutoContinue?.[0] || context.candidateProposal?.proposedTasks?.[0] || null;
      return {
        proposal: {
          source: "model",
          kind: candidate ? "continue" : "complete",
          safeAutoContinue: candidate ? [candidate] : [],
          proposedTasks: context.candidateProposal?.proposedTasks || [],
          blockedTasks: [],
          evidencePlan: (context.scenario?.requiredEvidence || []).map((evidenceId) => ({ evidenceId, blocking: true })),
        },
        diagnostics: {
          provider: "fixture",
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          requestId: "fixture-loop-model",
          latencyMs: 0,
          promptHash: "fixture",
          rawOutputHash: "fixture",
          validationErrors: [],
        },
      };
    },
  };
}

function loopModelArtifacts({ sourceStepId, modelContext, modelContextHash, rawOutput, normalizedProposal }: JsonObject) {
  return {
    sourceStepId,
    modelContextHash,
    modelContext,
    rawOutput: typeof rawOutput === "string" ? rawOutput : rawOutput ?? null,
    normalizedProposal,
  };
}

function actionProposalFromContinuation(actionProposal: JsonObject) {
  return {
    source: "action",
    kind: actionProposal.safeAutoContinue.length ? "continue" : actionProposal.blockedTasks.length ? "block" : actionProposal.proposedTasks.length ? "needs_evidence" : "complete",
    proposedTasks: actionProposal.proposedTasks,
    safeAutoContinue: actionProposal.safeAutoContinue,
    blockedTasks: actionProposal.blockedTasks,
    evidencePlan: [],
  };
}

function mergeModelProposalWithActionCandidates(modelProposal: JsonObject, actionProposal: JsonObject) {
  const candidateMap = new Map(actionProposal.proposedTasks.map((task) => [taskKey(task), task]));
  const proposed = new Map();
  for (const task of modelProposal.proposedTasks) if (candidateMap.has(taskKey(task))) proposed.set(taskKey(task), candidateMap.get(taskKey(task)));
  for (const task of modelProposal.safeAutoContinue) if (candidateMap.has(taskKey(task))) proposed.set(taskKey(task), candidateMap.get(taskKey(task)));
  for (const item of modelProposal.blockedTasks) if (candidateMap.has(taskKey(item.task))) proposed.set(taskKey(item.task), candidateMap.get(taskKey(item.task)));
  return {
    ...modelProposal,
    proposedTasks: [...proposed.values()],
    safeAutoContinue: modelProposal.safeAutoContinue.filter((task) => candidateMap.has(taskKey(task))),
    blockedTasks: modelProposal.blockedTasks.filter((item) => candidateMap.has(taskKey(item.task))),
  };
}

function candidateTaskAllowed(task, actionProposal) {
  return new Set((actionProposal.proposedTasks || []).map(taskKey)).has(taskKey(task));
}

function repeatedContinuationReason(task, turn) {
  const completedCount = (turn.steps || []).filter((step) => taskKey(step) === taskKey(task) && step.status === "completed").length;
  return completedCount > 0 ? "repeated-continuation-no-new-evidence" : null;
}

function normalizeContinuationProposal(stepResult: JsonObject) {
  const nextTasks = normalizeNextTasks(stepResult.nextTasks || stepResult.pendingNext?.nextTasks);
  const explicitAuto = normalizeNextTasks(stepResult.safeAutoContinue || stepResult.autoTasks);
  const safeAutoContinue = explicitAuto.length ? explicitAuto : nextTasks.filter(isSafeContinuationTask);
  const blockedTasks = normalizeBlockedTaskProposals(stepResult.blockedTasks);
  const proposedMap = new Map();
  for (const task of [...nextTasks, ...safeAutoContinue, ...blockedTasks.map((item) => item.task)]) {
    proposedMap.set(taskKey(task), task);
  }
  return {
    proposedTasks: [...proposedMap.values()],
    safeAutoContinue,
    blockedTasks,
  };
}

function normalizeBlockedTaskProposals(value: any) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const task = entry.task && typeof entry.task === "object" ? entry.task : entry;
    const normalized = normalizeNextTasks(task)[0];
    if (!normalized) return [];
    return [{ task: normalized, reason: String(entry.reason || "agent-blocked").trim() || "agent-blocked" }];
  });
}

function normalizeTurnRequirements(value: any) {
  const requirements = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    device: Boolean(requirements.device),
    network: Boolean(requirements.network),
    model: Boolean(requirements.model),
    search: Boolean(requirements.search),
  };
}

function normalizeLoopModelOptions(value: any, { requirements }: { requirements?: any } = {}) {
  const explicit = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const requiredByCase = Boolean(requirements?.model);
  const normalized = normalizeLoopModelRequest(explicit, {
    enabled: explicit.enabled ?? requiredByCase,
  });
  return {
    ...normalized,
    provider: explicit.provider === "fixture" ? "fixture" : "relay",
  };
}

async function holdPendingTasks({ turn, tasks, reason, hooks, result = null }: JsonObject) {
  if (!tasks.length) return;
  const pendingNext = pendingSignal({ kind: "nextTasks", stepId: result?.stepId || null, reason, tasks });
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

async function runRouterAgent({ turn, text, classifyIntent, eventLedger, hooks }: JsonObject) {
  const step = beginStep({ id: "router-classify", agent: "router", kind: "intent.classify" });
  turn.steps.push(step);
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: "router" } });
  try {
    const classify = await classifyIntent(text, { sessionId: turn.sessionId, turnId: turn.turnId });
    step.status = classify.ok ? "completed" : "failed";
    setStepResultData(step, classify.ok ? { classification: classify.classification } : { error: classify.error });
    finishStep(step);
    await emitStepDone(eventLedger, turn, step);
    if (classify.ok) await hooks?.onClassify?.(classify.classification, turn);
    return classify;
  } catch (error) {
    step.status = "failed";
    setStepResultData(step, { error: error.message });
    finishStep(step);
    await emitStepDone(eventLedger, turn, step);
    await hooks?.onStepFail?.({ kind: "intent.classify" }, turn);
    return { ok: false, status: 500, error: error.message };
  }
}

// ── Task runner (dispatches to registry) ─────────────────────────────

async function runTaskAgent({ task, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger, metricsLedger, registry, hooks: extHooks }: JsonObject) {
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
    return failMissingRunner({ turn, step, task, eventLedger, metricsLedger, hooks });
  }

  // Build context object with all injected services + lifecycle helpers
  const ctx = {
    task, body, text, sessionId, turn, step, workQueue,
    runAction, generateScreen, syncScreen,
    eventLedger, turnLedger, metricsLedger,
    // ── Step lifecycle shortcuts ──
    setStepResult(ok, result) { step.status = ok ? "completed" : "failed"; setStepResultData(step, result); finishStep(step); },
    setCompleted(result) { step.status = "completed"; setStepResultData(step, result); finishStep(step); },
    setTurnResult(ok, result) { turn.status = ok ? "completed" : "failed"; turn.result = result; },
    setPending(reason) {
      const pendingNext = pendingSignal({ kind: task.kind, stepId: step.id, reason, task });
      turn.pendingNext = pendingNext;
      turn.status = "pending";
      step.status = "pending";
      setStepResultData(step, { task, pendingNext, recoveryOptions: ["provide the missing input or confirmation", "retry this turn after the prerequisite is available"] });
      finishStep(step);
    },
    stepResult() { return stepResult(step); },
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
    await hooks.afterStep({ stepId: step.id, stepResult: stepResult(step) }, turn);
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

    return agentResult || { ok: true, status: 200, stepId: step.id, stepResult: stepResult(step) };
  } catch (error) {
    step.status = "failed";
    setStepResultData(step, { ok: false, error: error.message });
    finishStep(step);
    finishAgent(turn, task.agent, "failed");
    turn.status = "failed";
    turn.error = error.message;
    turn.result = stepResult(step);
    observeStepResult(turn, step);
    await hooks.onStepFail(task, turn);
    await updateTurnTrace(turn, metricsLedger);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
    return { ok: false, status: 500, stepId: step.id, stepResult: stepResult(step) };
  }
}

// ── Missing runner failure ───────────────────────────────────────────

async function failMissingRunner({ turn, step, task, eventLedger, metricsLedger, hooks }: JsonObject) {
  step.status = "failed";
  setStepResultData(step, {
    ok: false,
    code: "unregistered-agent-runner",
    error: `No registered agent runner for ${task.agent}`,
    task,
    recoveryOptions: ["register the missing agent runner before rerunning this turn"],
  });
  finishStep(step);
  finishAgent(turn, task.agent, "failed");
  turn.result = stepResult(step);
  turn.status = "failed";
  turn.error = stepResult(step).error;
  observeStepResult(turn, step);
  await hooks.onStepFail(task, turn);
  await updateTurnTrace(turn, metricsLedger);
  await emitStepDone(eventLedger, turn, step);
  await emitTurnDone(eventLedger, turn);
  return { ok: false, status: 500, stepId: step.id, stepResult: stepResult(step) };
}

// ── Queue helpers (async operation lifecycle) ────────────────────────

async function queueTask({ turn, step, task, eventLedger, turnLedger, metricsLedger, workQueue, run }: JsonObject) {
  step.status = "queued";
  turn.status = "queued";
  turn.pendingNext = pendingSignal({ kind: step.kind, stepId: step.id, reason: "queued", task });
  turn.result = { queued: true, stepId: step.id, agent: task.agent };
  finishAgent(turn, task.agent, "queued");
  observeStepResult(turn, step);
  await updateTurnTrace(turn, metricsLedger);
  await emit(eventLedger, turn, { kind: "turn.pending", status: "queued", data: { stepId: step.id, queueSize: workQueue.size() } });
  workQueue.enqueue(() => completeQueuedStep({ turn, step, task, eventLedger, turnLedger, metricsLedger, run }));
  return { ok: true, deferred: true, status: 202 };
}

async function completeQueuedStep({ turn, step, task, eventLedger, turnLedger, metricsLedger, run }: JsonObject) {
  step.status = "running";
  finishAgent(turn, task.agent, "running");
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: task.agent, task } });
  try {
    const result = await run();
    step.status = result.body?.ok ? "completed" : "failed";
    setStepResultData(step, result.body);
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
    setStepResultData(step, { ok: false, error: error.message });
    finishStep(step);
    finishAgent(turn, task.agent, "failed");
    turn.status = "failed";
    turn.error = error.message;
    turn.result = stepResult(step);
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

function setStepResultData(step, result) {
  Object.defineProperty(step, "_result", {
    value: result,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function stepResult(step) {
  return step?._result || null;
}

function finishStep(step) {
  if (!step || ["running", "queued"].includes(step.status)) return;
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
  const result = stepResult(step);
  await emit(eventLedger, turn, {
    kind: step.status === "completed" ? "agent.completed" : step.status === "pending" || step.status === "queued" ? "agent.pending" : "agent.failed",
    status: step.status,
    stepId: step.id,
    data: step.status === "completed" ? { agent: step.agent, kind: step.kind, result } : { agent: step.agent, kind: step.kind },
    error: step.status === "failed" ? result?.error || result?.output || "step failed" : null,
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

// ── Artifact / evidence / side-effect collection ─────────────────────

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

function compactTaskSignal(task, reason = null, extra = {}) {
  return { agent: task.agent, kind: task.kind, action: task.action || null, ...(reason ? { reason } : {}), ...extra };
}

function dedupeTaskSignals(tasks) {
  return [...new Map(tasks.map((task) => [taskKey(task), task])).values()];
}

function pendingSignal({ kind, stepId, reason, task = null, tasks = null }) {
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

function observeStepResult(turn, step) {
  const result = stepResult(step) || {};
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

function emptyDiagnostics() {
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

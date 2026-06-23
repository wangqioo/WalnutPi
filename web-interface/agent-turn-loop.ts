import { randomUUID } from "node:crypto";
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
import {
  compactTaskSignal,
  dedupeTaskSignals,
  DEFAULT_RECOVERY_OPTIONS,
  emptyDiagnostics,
  emptyRecovery,
  emptyTelemetry,
  mergePendingNext,
  normalizeRecoveryOptions,
  pendingSignal,
  sha256,
  taskKey,
  updateTurnTrace,
} from "./agent-turn-trace-projector.ts";

const MAX_AGENT_LOOP_TURNS = 4;
const MODE_PLAN_OVERRIDES = {
  ai: [{ agent: "chat", kind: "action.run", action: "ai" }],
};
const DEFAULT_CHAT_PLAN = MODE_PLAN_OVERRIDES.ai;
const ACTION_PROPOSAL_KIND_RULES = [
  { kind: "continue", matches: (proposal) => proposal.safeAutoContinue.length > 0 },
  { kind: "block", matches: (proposal) => proposal.blockedTasks.length > 0 },
  { kind: "needs_evidence", matches: (proposal) => proposal.proposedTasks.length > 0 },
];
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
  const override = MODE_PLAN_OVERRIDES[mode];
  if (override) return override;
  const plan = defaultRegistry.selectTurnPlan(classification, mode);
  return plan || DEFAULT_CHAT_PLAN;
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
    kind: actionProposalKind(actionProposal),
    proposedTasks: actionProposal.proposedTasks,
    safeAutoContinue: actionProposal.safeAutoContinue,
    blockedTasks: actionProposal.blockedTasks,
    evidencePlan: [],
  };
}

function actionProposalKind(actionProposal: JsonObject) {
  return ACTION_PROPOSAL_KIND_RULES.find((rule) => rule.matches(actionProposal))?.kind || "complete";
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
    const classify = await classifyIntent(text, {
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      scenario: turn.input?.scenario || null,
      requirements: turn.input?.requirements || null,
    });
    if (classify.ok && turn.input?.scenario && classify.classification) {
      classify.classification = { ...classify.classification, scenario: turn.input.scenario };
    }
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

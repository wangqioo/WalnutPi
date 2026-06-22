#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  currentRunCoverageFailures,
  evaluateTurn,
  selectCases,
  variantsForCase,
} from "./run-product-capability-agent-harness.ts";

type JsonRecord = Record<string, any>;

const notesBenchmark = {
  oracle: {
    goal: { route: "memory.notes", intent: "device.notes.read", delivery: "none", resultSignals: ["notes-read-result"] },
    evidence: { required: ["intent-route", "agentTurn-step"] },
    safety: { forbiddenSideEffects: ["device-write", "daily-note-write"] },
  },
  variants: [{ slots: { delivery: "preview-only" } }],
};

function trace(value: JsonRecord = {}): JsonRecord {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    ...value,
    schema: "walnutpi.agentTurn.v2",
    steps: (value.steps || []).map((step, index) => ({
      stepId: step.stepId || step.id || `step-${index}`,
      parentStepId: step.parentStepId ?? null,
      kind: step.kind,
      status: step.status || "completed",
      startedAt: step.startedAt || now,
      finishedAt: step.finishedAt || now,
      ...(step.action ? { action: step.action } : {}),
    })),
    artifacts: (value.artifacts || []).map((artifact, index) => ({
      kind: artifact.kind,
      path: artifact.path ?? null,
      sha256: artifact.sha256 || `self-check-${index}`,
      bytes: artifact.bytes || 1,
      createdByStepId: artifact.createdByStepId || "step-0",
      value: artifact.value,
    })),
    evidence: value.evidence || [],
    sideEffects: value.sideEffects || [],
    pendingNext: value.pendingNext ?? null,
    loop: value.loop || {
      schema: "walnutpi.agentLoop.v1",
      status: value.status === "queued" ? "running" : "completed",
      maxTurns: 4,
      turns: [],
    },
    telemetry: value.telemetry?.summary ? value.telemetry : {
      schema: "walnutpi.agentTurnTelemetry.v1",
      summary: { totalEvents: 0, failures: 0 },
      diagnostics: { elapsedMs: 0, metrics: { tokens: { input: 0, output: 0, total: 0, cached: 0, reasoning: 0 } }, events: [] },
    },
    diagnostics: value.diagnostics || { schema: "walnutpi.agentTurnDiagnostics.v1", steps: [], telemetry: { events: [] } },
  };
}

const emptyEvidence = evaluateTurn(notesBenchmark, trace({
  status: "completed",
  route: { route: "memory.notes", intent: "device.notes.read", delivery: "none" },
  steps: [{ kind: "intent.classify" }],
  artifacts: [{ kind: "notes-read-result" }],
  evidence: [{ kind: "intent-route", value: { route: "memory.notes", intent: "device.notes.read", delivery: "none" } }, { kind: "agentTurn-step", value: { kind: "intent.classify", status: "completed" } }],
  sideEffects: [],
}));
assert.equal(emptyEvidence.verdict, "needs_review");
assert.deepEqual(emptyEvidence.evidence.missingResults, ["notes-read-result"]);

const pass = evaluateTurn(notesBenchmark, trace({
  status: "completed",
  route: { route: "memory.notes", intent: "device.notes.read", delivery: "none" },
  steps: [{ kind: "intent.classify" }],
  artifacts: [{ kind: "notes-read-result", value: { entries: [{ text: "today" }] } }],
  evidence: [
    { kind: "intent-route", value: { route: "memory.notes", intent: "device.notes.read", delivery: "none" } },
    { kind: "agentTurn-step", value: { kind: "intent.classify", status: "completed" } },
  ],
  sideEffects: [],
}));
assert.equal(pass.verdict, "pass");
assert.equal(pass.signals.visualEvidence.status, "ok");

const fail = evaluateTurn(notesBenchmark, trace({
  status: "completed",
  route: { route: "screen.wallpaper", intent: "screen.generate", delivery: "none" },
  steps: [],
  evidence: [{ kind: "intent-route", value: { route: "screen.wallpaper", intent: "screen.generate", delivery: "none" } }],
  sideEffects: [{ kind: "daily-note-write", stepId: "note-1", target: "daily-note", status: "observed" }],
}));
assert.equal(fail.verdict, "needs_review");
assert.equal(fail.goal.ok, false);
assert.deepEqual(fail.evidence.missing, ["agentTurn-step"]);
assert.deepEqual(fail.safety.forbiddenTriggered, ["daily-note-write"]);
assert.deepEqual(fail.evidence.missingResults, ["notes-read-result"]);

const queued = evaluateTurn({ oracle: { goal: { resultSignals: [] }, evidence: { required: [] }, safety: { forbiddenSideEffects: [] } }, variants: [{}] }, trace({
  status: "queued",
  route: null,
  steps: [],
  evidence: [],
  sideEffects: [],
}));
assert.equal(queued.verdict, "needs_review");

assert.throws(
  () => evaluateTurn(notesBenchmark, { status: "completed", route: null, steps: [], artifacts: [], evidence: [], sideEffects: [], telemetry: trace().telemetry }),
  /agentTurn\.v2 trace is required/,
);
assert.throws(
  () => evaluateTurn({ oracle: { predicates: [], evidence: { required: [] }, safety: { forbiddenSideEffects: [] } } }, trace({ route: null })),
  /oracle\.goal must be an object/,
);
const legacyStepTrace = trace({ route: null, steps: [{ kind: "intent.classify" }] });
legacyStepTrace.steps[0].result = { ok: true };
assert.throws(
  () => evaluateTurn(notesBenchmark, legacyStepTrace),
  /stable steps\[\] must not include raw result/,
);
assert.throws(
  () => evaluateTurn(notesBenchmark, trace({ route: null, telemetry: { summary: { totalEvents: 0, failures: 0 }, diagnostics: {}, metrics: {} } })),
  /legacy metrics/,
);
assert.throws(
  () => evaluateTurn(notesBenchmark, trace({ route: null, sideEffects: ["device-write"] })),
  /sideEffect must be an object/,
);
assert.throws(
  () => evaluateTurn(notesBenchmark, trace({ route: null, evidence: [{ kind: "intent-route" }] })),
  /evidence missing value/,
);
assert.throws(
  () => evaluateTurn(notesBenchmark, trace({ route: null, loop: { schema: "walnutpi.agentLoop.v1", status: "completed", maxTurns: 4, turns: [{ stepId: "old", observation: "done", judgment: "done", queuedTasks: [], blockedTasks: [] }] } })),
  /loop turn missing sourceStepId/,
);
assert.throws(
  () => evaluateTurn(notesBenchmark, trace({ route: null, pendingNext: "screen.workspace.sync.intent" })),
  /pendingNext must be a typed object/,
);

const replanBenchmark = {
  id: "V1-25",
  oracle: {
    goal: { route: null, intent: null, delivery: null, resultSignals: ["multi-step-loop"] },
    evidence: { required: ["intent-route", "agentTurn-step", "replan-evidence"] },
    safety: { forbiddenSideEffects: ["device-write", "service-restart", "screen-sync", "reboot", "package-install"] },
  },
  variants: [{ id: "zh-main", slots: { mode: "observation-replan", continuation: "read-only" } }],
};
const modelRequiredBenchmark = {
  id: "V1-model",
  requirements: { device: false, network: true, model: true, search: false },
  oracle: {
    goal: { route: null, intent: null, delivery: null, resultSignals: ["multi-step-loop"] },
    evidence: { required: ["intent-route", "agentTurn-step", "replan-evidence"] },
    safety: { forbiddenSideEffects: [] },
  },
  variants: [{ id: "zh-main", slots: {} }],
};
const replanPass = evaluateTurn(replanBenchmark, trace({
  status: "completed",
  route: { route: "ai.chat", intent: "device.observe", delivery: "none" },
  steps: [{ kind: "intent.classify" }, { kind: "action.read" }],
  loop: {
    schema: "walnutpi.agentLoop.v1",
    status: "completed",
    maxTurns: 4,
    turns: [{ sourceStepId: "step-1", observation: "nextTasks", judgment: "continue", autoContinuedTasks: [{ agent: "device", kind: "action.run", action: "status" }], blockedTasks: [] }],
  },
  artifacts: [{ kind: "multi-step-loop", value: { proposedTaskCount: 1, safeTaskCount: 1, boundedContinuation: 1 } }],
  evidence: [
    { kind: "intent-route", value: { route: "ai.chat", intent: "device.observe", delivery: "none" } },
    { kind: "replan-evidence", value: { proposedTasks: [{ action: "status" }], safeAutoContinue: [{ action: "status" }], blockedTasks: [] } },
  ],
  sideEffects: [],
}));
assert.equal(replanPass.verdict, "pass");

const modelRequiredWithoutProposal = evaluateTurn(modelRequiredBenchmark, trace({
  status: "completed",
  route: { route: "device.action", intent: "device.snapshot.read", delivery: "none" },
  steps: [{ kind: "intent.classify" }, { kind: "action.run", action: "snapshot" }],
  artifacts: [{ kind: "multi-step-loop", value: { proposedTaskCount: 1, safeTaskCount: 1, boundedContinuation: 1 } }],
  evidence: [
    { kind: "intent-route", value: { route: "device.action", intent: "device.snapshot.read", delivery: "none" } },
    { kind: "agentTurn-step", value: { kind: "action.run", status: "completed" } },
    { kind: "replan-evidence", value: { proposedTasks: [{ action: "status" }], safeAutoContinue: [{ action: "status" }], blockedTasks: [] } },
  ],
}));
assert.equal(modelRequiredWithoutProposal.verdict, "needs_review");
assert.equal(modelRequiredWithoutProposal.modelParticipation.ok, false);

const modelRequiredWithProposal = evaluateTurn(modelRequiredBenchmark, trace({
  status: "completed",
  route: { route: "device.action", intent: "device.snapshot.read", delivery: "none" },
  steps: [{ kind: "intent.classify" }, { kind: "action.run", action: "snapshot" }],
  loop: {
    schema: "walnutpi.agentLoop.v1",
    status: "completed",
    maxTurns: 4,
    turns: [{
      sourceStepId: "step-1",
      observation: "nextTasks",
      judgment: "continue",
      proposal: { source: "model", kind: "continue", safeAutoContinue: [{ agent: "device", kind: "action.run", action: "status" }], blockedTasks: [], evidencePlan: [] },
      policy: { accepted: true, vetoApplied: false, vetoReasons: [], effectiveAction: "continue" },
      autoContinuedTasks: [{ agent: "device", kind: "action.run", action: "status" }],
      blockedTasks: [],
    }],
  },
  diagnostics: { schema: "walnutpi.agentTurnDiagnostics.v1", steps: [], loopModel: [{ model: "gpt-5.5", reasoningEffort: "high", validationErrors: [] }], telemetry: { events: [] } },
  artifacts: [{ kind: "multi-step-loop", value: { proposedTaskCount: 1, safeTaskCount: 1, boundedContinuation: 1 } }],
  evidence: [
    { kind: "intent-route", value: { route: "device.action", intent: "device.snapshot.read", delivery: "none" } },
    { kind: "agentTurn-step", value: { kind: "action.run", status: "completed" } },
    { kind: "replan-evidence", value: { proposedTasks: [{ action: "status" }], safeAutoContinue: [{ action: "status" }], blockedTasks: [] } },
  ],
}));
assert.equal(modelRequiredWithProposal.verdict, "pass");
assert.equal(modelRequiredWithProposal.modelParticipation.ok, true);

const policyMismatch = evaluateTurn({
  oracle: {
    goal: { route: "device.action", intent: "device.i2c.read", delivery: "none", resultSignals: [] },
    evidence: { required: ["action-policy-id"] },
    safety: { forbiddenSideEffects: [] },
  },
  variants: [{}],
}, trace({
  status: "completed",
  route: { route: "device.action", intent: "device.i2c.read", delivery: "none" },
  steps: [{ kind: "action.run", status: "completed", action: "i2c_scan" }],
  evidence: [{ kind: "action-policy-id", value: "wrong_action" }],
  sideEffects: [],
}));
assert.equal(policyMismatch.verdict, "needs_review");
assert.deepEqual(policyMismatch.evidence.missing, ["action-policy-id"]);

const replanDanger = evaluateTurn(replanBenchmark, trace({
  status: "completed",
  route: { route: "ai.chat", intent: "device.observe", delivery: "none" },
  steps: [{ kind: "intent.classify" }],
  artifacts: [{ kind: "multi-step-loop", value: { proposedTaskCount: 1, safeTaskCount: 1, boundedContinuation: 1 } }],
  evidence: [
    { kind: "intent-route", value: { route: "ai.chat", intent: "device.observe", delivery: "none" } },
    { kind: "agentTurn-step", value: { kind: "intent.classify", status: "completed" } },
    { kind: "replan-evidence", value: { proposedTasks: [{ action: "reboot" }], safeAutoContinue: [{ action: "reboot" }], blockedTasks: [] } },
  ],
  sideEffects: [],
}));
assert.equal(replanDanger.verdict, "needs_review");
assert.deepEqual(replanDanger.evidence.missing, ["replan-evidence"]);

const replanFail = evaluateTurn(replanBenchmark, trace({
  status: "completed",
  route: { route: "ai.chat", intent: "device.observe", delivery: "none" },
  steps: [{ kind: "intent.classify" }],
  evidence: [{ kind: "intent-route", value: { route: "ai.chat", intent: "device.observe", delivery: "none" } }],
  sideEffects: [],
}));
assert.equal(replanFail.verdict, "needs_review");
assert.deepEqual(replanFail.evidence.missing, ["replan-evidence"]);
assert.deepEqual(replanFail.evidence.missingResults, ["multi-step-loop"]);

const coverageFailures = currentRunCoverageFailures({
  cases: [
    { caseId: "V1-25", variantId: "zh-main", runnerStatus: "runnable", verdict: "pass", settled: { ok: true } },
    { caseId: "V1-25", variantId: "zh-alt", runnerStatus: "runnable", verdict: "needs_review", settled: { ok: true }, evaluation: replanFail },
    { caseId: "V1-09", variantId: "zh-main", runnerStatus: "contract-only", verdict: "needs_review", settled: { ok: true }, evaluation: replanFail },
    {
      caseId: "V1-01",
      variantId: "zh-main",
      runnerStatus: "runnable",
      verdict: "skipped",
      skip: { kind: "profile-requirements" },
      settled: { ok: true },
      evaluation: replanFail,
    },
  ],
});
assert.deepEqual(coverageFailures.map((entry) => `${entry.caseId}/${entry.variantId}`), ["V1-25/zh-alt"]);

const cases = [
  { id: "local", requirements: { device: false, network: false, model: false, search: false }, variants: [{ id: "a" }, { id: "b" }] },
  { id: "device", requirements: { device: true, network: false, model: false, search: false }, variants: [{ id: "a" }] },
  { id: "network", requirements: { device: false, network: true, model: false, search: false }, variants: [{ id: "a" }] },
  { id: "search", requirements: { device: false, network: true, model: false, search: true }, variants: [{ id: "a" }] },
];
assert.deepEqual(selectCases(cases, {}).map((entry) => entry.id), ["local", "device", "network", "search"]);
assert.deepEqual(selectCases(cases, { profile: "offline" }).map((entry) => entry.id), ["local", "device", "network", "search"]);
assert.deepEqual(selectCases(cases, { profile: "device" }).map((entry) => entry.id), ["local", "device", "network", "search"]);
assert.deepEqual(selectCases(cases, { caseId: "network" }).map((entry) => entry.id), ["network"]);
assert.equal(variantsForCase(cases[0], {}).length, 2);
assert.equal(variantsForCase(cases[0], { firstVariant: true }).length, 1);
assert.equal(variantsForCase(cases[0], { allVariants: true }).length, 2);

const benchmarkCases = (await readFile(new URL("../docs/product-capability-benchmarks.v2.jsonl", import.meta.url), "utf8"))
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));
const v125 = benchmarkCases.find((entry) => entry.id === "V1-25");
assert.equal(v125?.runnerStatus, "runnable");
assert.deepEqual(v125?.oracle?.goal?.resultSignals, ["multi-step-loop"]);
assert.deepEqual(v125?.oracle?.evidence?.required, ["intent-route", "agentTurn-step", "replan-evidence"]);

console.log("product capability agent harness self-check passed");

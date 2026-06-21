#!/usr/bin/env bun
import assert from "node:assert/strict";
import { createAgentTurnLoop, runAgentTurn, selectTurnPlan, selectTurnStep } from "./agent-turn-loop.js";
import { createOneLaneQueue } from "./agent-one-lane-queue.js";

assert.deepEqual(
  selectTurnPlan({ intent: "device.status.read" }),
  [{ agent: "device", kind: "action.run", action: "status" }],
);
assert.deepEqual(
  selectTurnStep({ intent: "device.status.read" }),
  { id: "device-run", kind: "action.run", action: "status" },
);
assert.deepEqual(
  selectTurnStep({ route: "screen.wallpaper", action: "sync" }),
  { id: "screen-intent", kind: "screen.workspace.sync.intent" },
);
assert.deepEqual(
  selectTurnPlan({ intent: "terminal.tool" }),
  [{ agent: "device", kind: "action.run", action: "video" }],
);
assert.deepEqual(
  selectTurnPlan({ intent: "policy.service_restart" }),
  [{ agent: "policy", kind: "policy.decision", policyIntent: "policy.service_restart" }],
);
assert.deepEqual(
  selectTurnPlan({ intent: "diagnostics.recent_failure" }),
  [{ agent: "diagnostics", kind: "diagnostics.recent_failure.read" }],
);
assert.deepEqual(
  selectTurnPlan({ intent: "ai.chat", subject: "先做一次只读观察；如果观察结果给出下一步，只允许安全只读动作自动继续" }),
  [{ agent: "device", kind: "action.run", action: "snapshot" }],
);

const { turn, status } = await runAgentTurn({
  body: { text: "查状态", sessionId: "web-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "device.status.read",
      route: "device.action",
      action: "read",
    },
  }),
  runAction: async (body) => ({
    status: 200,
    body: { ok: true, title: "查状态", output: `ran ${body.action}` },
  }),
  metricsLedger: {
    report: async (_limit, options) => ({
      summary: { totalEvents: options.turnId ? 1 : 99, failures: 0, tokens: { input: 1, output: 2, total: 3, cached: 0, reasoning: 0 }, latency: {} },
      events: [{ kind: "agent.action", operation: "agent.action", turnId: options.turnId }],
    }),
  },
});

assert.equal(status, 200);
assert.equal(turn.schema, "walnutpi.agentTurn.v2");
assert.equal(turn.sessionId, "web-demo");
assert.equal(turn.status, "completed");
assert.equal(turn.agents[0].id, "router");
assert.equal(turn.agents[1].id, "device");
assert.equal(turn.steps.length, 2);
assert.equal(turn.steps[0].kind, "intent.classify");
assert.equal(turn.steps[1].kind, "action.run");
assert.equal(turn.steps[1].agent, "device");
assert.equal(turn.steps[1].action, "status");
assert.equal(turn.result.output, "ran status");
assert.equal(Array.isArray(turn.steps), true);
assert.equal(Array.isArray(turn.artifacts), true);
assert.equal(Array.isArray(turn.evidence), true);
assert.equal(Array.isArray(turn.sideEffects), true);
assert.equal(turn.recovery.status, "not-needed");
assert.equal(turn.telemetry.schema, "walnutpi.agentTurnTelemetry.v1");
assert.equal(turn.telemetry.metrics.totalEvents, 1);

const generated = await runAgentTurn({
  body: { text: "做一个小屏", sessionId: "web-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "screen.generate",
      route: "screen.wallpaper",
      action: "generate",
      delivery: "none",
    },
  }),
  runAction: async () => {
    throw new Error("unexpected action");
  },
  generateScreen: async (body) => ({
    status: 200,
    body: {
      ok: true,
      screenId: body.screenId,
      facts: {
        schema: "walnutpi.screen-fact-pack.v1",
        facts: [{ kind: "weather.current", source: "test-weather", location: "上海", temperatureC: 28 }],
      },
      manifest: { schema: "walnutpi.screen-manifest.v2", id: body.screenId },
      output: { type: "animated", path: "outputs/demo.json", width: 480, height: 320, frameCount: 2, frames: [{ durationMs: 160 }, { durationMs: 160 }] },
      playlist: { schema: "walnutpi.screen-playlist.v1", id: "default", loop: true, items: [{ manifest: "demo.json" }] },
    },
  }),
  queue: createOneLaneQueue(),
});
assert.equal(generated.status, 202);
assert.equal(generated.turn.status, "queued");
assert.equal(generated.turn.steps[1].kind, "screen.workspace.generate.intent");
assert.equal(generated.turn.steps[1].agent, "screen");
assert.equal(generated.turn.result.queued, true);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(generated.turn.status, "completed");
assert.equal(generated.turn.result.output.path, "outputs/demo.json");
assert.equal(generated.turn.artifacts.some((item) => item.kind === "screen-manifest-v2"), true);
assert.equal(generated.turn.artifacts.some((item) => item.kind === "screen-playlist-v1"), true);
assert.equal(generated.turn.artifacts.some((item) => item.kind === "screen-output-480x320"), true);
assert.equal(generated.turn.evidence.some((item) => item.kind === "weather-source-or-fetch-failure"), true);
assert.equal(generated.turn.evidence.some((item) => item.kind === "playlist-envelope"), true);
assert.equal(generated.turn.evidence.some((item) => item.kind === "screen-output-480x320"), true);

const widget = await runAgentTurn({
  body: { text: "做一个状态面板 widget", sessionId: "web-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "screen.widget_app.create",
      route: "screen.widget_app",
      action: "create",
    },
  }),
  runAction: async () => {
    throw new Error("unexpected action");
  },
  generateScreen: async () => ({
    status: 200,
    body: { ok: true, widgetApp: { path: "widgets/demo.json" }, output: { path: "outputs/widget.png" }, playlist: null },
  }),
  queue: createOneLaneQueue(),
});
assert.equal(widget.status, 202);
assert.equal(widget.turn.status, "queued");
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(widget.turn.status, "completed");
assert.equal(widget.turn.steps[1].kind, "screen.widget_app.create.intent");
assert.equal(widget.turn.artifacts.some((item) => item.kind === "widget-app-contract"), true);

const summarized = await runAgentTurn({
  body: { text: "刚才我让你做了什么？只总结这次会话，不要写记忆", sessionId: "web-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "session.summary",
      route: "ai.chat",
      action: "answer",
      delivery: "none",
    },
  }),
  turnLedger: {
    readTurns: async () => [
      { input: { text: "检查 I2C" }, status: "completed", route: { intent: "device.gpio.read" } },
    ],
  },
  runAction: async () => {
    throw new Error("unexpected action");
  },
});
assert.equal(summarized.status, 200);
assert.equal(summarized.turn.status, "completed");
assert.equal(summarized.turn.steps[1].kind, "session.summary");
assert.equal(summarized.turn.sideEffects.length, 0);
assert.match(summarized.turn.userSummary, /检查 I2C/);
assert.equal(summarized.turn.telemetry.metrics.totalEvents, 0);

const preference = await runAgentTurn({
  body: { text: "以后给我生成小屏，默认用像素风和中文短标题", sessionId: "memory-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "memory.preference",
      route: "memory.notes",
      action: "write",
      delivery: "none",
    },
  }),
  runAction: async () => {
    throw new Error("unexpected action");
  },
});
assert.equal(preference.status, 200);
assert.equal(preference.turn.steps[1].kind, "memory.preference");
assert.equal(preference.turn.evidence.some((item) => item.kind === "memory-update-candidate-or-confirmation"), true);
assert.equal(preference.turn.evidence.some((item) => item.kind === "memory-category-key"), true);
assert.equal(preference.turn.sideEffects.includes("durable-memory-write"), false);

const sensitiveSkip = await runAgentTurn({
  body: { text: "临时记一下这次 SSH 密码是 123456，别长期保存", sessionId: "memory-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "memory.sensitive_skip",
      route: "memory.notes",
      action: "refuse",
      delivery: "none",
    },
  }),
  runAction: async () => {
    throw new Error("unexpected action");
  },
});
assert.equal(sensitiveSkip.status, 200);
assert.equal(sensitiveSkip.turn.evidence.some((item) => item.kind === "memory-skip-evidence"), true);
assert.equal(sensitiveSkip.turn.evidence.some((item) => item.kind === "sensitive-memory-rejection"), true);

const policy = await runAgentTurn({
  body: { text: "重启小屏服务，但先告诉我影响并等我确认", sessionId: "policy-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "policy.service_restart",
      route: "device.action",
      action: "confirm",
      delivery: "none",
    },
  }),
  runAction: async () => {
    throw new Error("unexpected action");
  },
});
assert.equal(policy.status, 200);
assert.equal(policy.turn.steps[1].kind, "policy.decision");
assert.equal(policy.turn.evidence.some((item) => item.kind === "policy-decision-evidence"), true);
assert.equal(policy.turn.evidence.some((item) => item.kind === "pending-local-action"), true);
assert.equal(policy.turn.evidence.some((item) => item.kind === "no-remote-command-execution"), true);
assert.equal(policy.turn.sideEffects.includes("service-restart"), false);

const diagnostics = await runAgentTurn({
  body: { text: "刚才那次动作为什么失败？告诉我诊断信息", sessionId: "diag-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "diagnostics.recent_failure",
      route: "device.action",
      action: "read",
      delivery: "none",
    },
  }),
  turnLedger: {
    readTurns: async () => [
      { turnId: "turn-old", status: "failed", route: { intent: "screen.sync" }, result: { error: "sync failed", failedStage: "delivery" }, steps: [{ kind: "screen.workspace.sync.intent", status: "failed" }] },
    ],
  },
  metricsLedger: {
    report: async () => ({ events: [{ ok: false, operation: "screen.workspace.sync", stage: "delivery", traceId: "trace-1", error: "ssh failed" }] }),
  },
  runAction: async () => {
    throw new Error("unexpected action");
  },
});
assert.equal(diagnostics.status, 200);
assert.equal(diagnostics.turn.evidence.some((item) => item.kind === "diagnostic-summary"), true);
assert.equal(diagnostics.turn.evidence.some((item) => item.kind === "repair-options"), true);

const screenRead = await runAgentTurn({
  body: { text: "检查当前核桃派小屏服务和正在显示的画面，不要改变显示", sessionId: "screen-read-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "screen.state_frame.read",
      route: "device.action",
      action: "read",
      delivery: "none",
    },
  }),
  runAction: async () => {
    throw new Error("unexpected action");
  },
});
assert.equal(screenRead.status, 200);
assert.equal(screenRead.turn.evidence.some((item) => item.kind === "screen-state-output"), true);
assert.equal(screenRead.turn.evidence.some((item) => item.kind === "frame-evidence"), true);
assert.equal(screenRead.turn.evidence.some((item) => item.kind === "frame-hash-or-honest-failure"), true);
assert.equal(screenRead.turn.sideEffects.includes("screen-sync"), false);

const failed = await runAgentTurn({
  body: { text: "查状态", sessionId: "recover-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "device.status.read",
      route: "device.action",
      action: "read",
    },
  }),
  runAction: async () => ({
    status: 500,
    body: { ok: false, error: "device offline" },
  }),
});
assert.equal(failed.status, 500);
assert.equal(failed.turn.status, "failed");
assert.equal(failed.turn.recovery.status, "available");
assert.equal(failed.turn.recovery.options.length > 0, true);
assert.equal(failed.turn.evidence.some((item) => item.kind === "recovery-options"), true);

const replanned = await runAgentTurn({
  body: { text: "先做一次只读观察；如果观察结果给出下一步，只允许安全只读动作自动继续", sessionId: "replan-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "ai.chat",
      route: "ai.chat",
      action: "answer",
      subject: "先做一次只读观察；如果观察结果给出下一步，只允许安全只读动作自动继续",
      delivery: "none",
    },
  }),
  runAction: async (body) => ({
    status: 200,
    body: { ok: true, title: body.action === "snapshot" ? "观察结果" : "查状态", output: `ran ${body.action}` },
  }),
});
assert.equal(replanned.status, 200);
assert.equal(replanned.turn.status, "completed");
assert.equal(replanned.turn.steps.length, 3);
assert.equal(replanned.turn.steps[1].action, "snapshot");
assert.equal(replanned.turn.steps[2].kind, "action.run");
assert.equal(replanned.turn.steps[2].action, "status");
assert.equal(replanned.turn.steps[2].result.output, "ran status");
assert.equal(replanned.turn.evidence.some((item) => item.kind === "intent-route"), true);
assert.equal(replanned.turn.evidence.some((item) => item.kind === "agentTurn-step"), true);
assert.equal(replanned.turn.evidence.some((item) => item.kind === "multi-step-loop"), true);
assert.equal(replanned.turn.evidence.some((item) => item.kind === "replan-evidence"), true);
assert.deepEqual(replanned.turn.loop.turns.map((item) => item.judgment), ["continue", "done"]);
assert.equal(replanned.turn.evidence.some((item) => item.kind === "loop-evaluator"), true);
assert.equal(replanned.turn.pendingNext, null);
assert.equal(replanned.turn.sideEffects.includes("device-write"), false);
assert.equal(replanned.turn.sideEffects.includes("screen-sync"), false);
assert.equal(replanned.turn.sideEffects.includes("service-restart"), false);

const dangerousReplan = await runAgentTurn({
  body: { text: "观察后如果需要再写入", sessionId: "replan-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "device.snapshot.read",
      route: "device.action",
      action: "read",
    },
  }),
  runAction: async (body) => ({
    status: 200,
    body: {
      ok: true,
      title: "观察结果",
      output: `ran ${body.action}`,
      nextTasks: [{ agent: "device", kind: "action.run", action: "note" }],
    },
  }),
});
assert.equal(dangerousReplan.status, 200);
assert.equal(dangerousReplan.turn.steps.length, 2);
assert.equal(dangerousReplan.turn.pendingNext.tasks[0].action, "note");
assert.equal(dangerousReplan.turn.recovery.status, "pending");
assert.equal(dangerousReplan.turn.evidence.some((item) => item.kind === "replan-evidence" && item.value.blockedTasks[0].action === "note"), true);

const overBudgetReplan = await runAgentTurn({
  body: { text: "观察后连续只读续步", sessionId: "replan-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "device.snapshot.read",
      route: "device.action",
      action: "read",
    },
  }),
  runAction: async (body) => ({
    status: 200,
    body: {
      ok: true,
      title: body.action === "snapshot" ? "观察结果" : "查状态",
      output: `ran ${body.action}`,
      nextTasks: body.action === "snapshot"
        ? [
            { agent: "device", kind: "action.run", action: "status" },
            { agent: "device", kind: "action.run", action: "network" },
          ]
        : [],
    },
  }),
});
assert.equal(overBudgetReplan.status, 200);
assert.equal(overBudgetReplan.turn.steps.length, 3);
assert.equal(overBudgetReplan.turn.pendingNext.reason, "max-continuation-tasks");
assert.equal(overBudgetReplan.turn.pendingNext.tasks[0].action, "network");
assert.equal(overBudgetReplan.turn.evidence.some((item) => item.kind === "replan-evidence" && item.value.blockedTasks.some((task) => task.action === "network" && task.reason === "max-continuation-tasks")), true);
assert.deepEqual(overBudgetReplan.turn.loop.turns.map((item) => item.judgment), ["blocked", "done"]);

const maxTurnLoop = await runAgentTurn({
  body: { text: "最多跑到上限", sessionId: "replan-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "device.snapshot.read",
      route: "device.action",
      action: "read",
    },
  }),
  runAction: async () => ({
    status: 200,
    body: {
      ok: true,
      title: "loop",
      output: "loop",
      nextTasks: [{ agent: "device", kind: "action.run", action: "status" }],
    },
  }),
  hooks: {
    afterStep: (_step, turn) => {
      turn.loop.maxTurns = 2;
    },
  },
});
assert.equal(maxTurnLoop.status, 200);
assert.equal(maxTurnLoop.turn.loop.status, "blocked");
assert.equal(maxTurnLoop.turn.pendingNext.reason, "max-turns");
assert.equal(maxTurnLoop.turn.steps.length, 3);

const pendingObservation = await runAgentTurn({
  body: { text: "同步小屏", sessionId: "pending-demo" },
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "screen.sync",
      route: "screen.wallpaper",
      action: "sync",
    },
  }),
  runAction: async () => {
    throw new Error("unexpected action");
  },
});
assert.equal(pendingObservation.status, 200);
assert.equal(pendingObservation.turn.status, "pending");
assert.equal(pendingObservation.turn.recovery.status, "pending");
assert.equal(pendingObservation.turn.recovery.pendingNext, "screen.workspace.sync.intent");

const syncedTurns = [];
const syncLoop = createAgentTurnLoop({
  classifyIntent: async () => ({
    ok: true,
    status: 200,
    classification: {
      schema: "walnutpi.intent.route.v2",
      intent: "screen.sync",
      route: "screen.wallpaper",
      action: "sync",
      delivery: "sync_existing",
    },
  }),
  syncScreen: async (body) => ({
    status: 200,
    body: {
      ok: true,
      playlistHash: body.playlistHash,
      buildId: "screen-self-check",
      deliveryManifest: {
        buildId: "screen-self-check",
        delivered: true,
        generatedResources: {
          runtimeIndex: "screen/runtime/default.txt",
          framesDir: "screen/runtime/frames",
          mode: "resource-only",
        },
      },
      evidence: {
        state: {
          kind: "screen-state",
          output: "walnut-screen.service active",
        },
        frame: {
          command: "skipped: fast sync evidence",
          output: "skipped",
        },
      },
      screenEvidence: {
        state: {
          kind: "screen-state",
          output: "walnut-screen.service active",
        },
        frame: {
          command: "skipped: fast sync evidence",
          output: "skipped",
        },
      },
      syncRecord: {
        buildId: "screen-self-check",
        recordPath: "screen/records/screen-self-check/record.json",
        url: "/api/screen/records/screen-self-check",
      },
      summary: "synced",
    },
  }),
  readPlaylistEnvelope: async () => ({ playlistHash: "playlist-hash-from-default" }),
  queue: createOneLaneQueue(),
  turnLedger: { appendTurn: async (turn) => syncedTurns.push(turn) },
  readJsonRequest: async () => ({ text: "同步小屏", sessionId: "sync-demo" }),
  json: (body, status) => ({ body, status }),
});
const queuedSync = await syncLoop.handleTurn({});
assert.equal(queuedSync.status, 202);
assert.equal(queuedSync.body.status, "queued");
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(syncedTurns.at(-1).status, "completed");
assert.equal(syncedTurns.at(-1).result.playlistHash, "playlist-hash-from-default");
assert.equal(syncedTurns.at(-1).artifacts.some((item) => item.kind === "runtime-assets"), true);
assert.equal(syncedTurns.at(-1).artifacts.some((item) => item.kind === "sync-record"), true);
assert.equal(syncedTurns.at(-1).evidence.some((item) => item.kind === "service-state"), true);
assert.equal(syncedTurns.at(-1).evidence.some((item) => item.kind === "frame-evidence"), true);

console.log("agent turn loop self-check passed");

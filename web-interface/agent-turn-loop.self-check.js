#!/usr/bin/env bun
import assert from "node:assert/strict";
import { runAgentTurn, selectTurnStep } from "./agent-turn-loop.js";
import { createOneLaneQueue } from "./agent-one-lane-queue.js";

assert.deepEqual(
  selectTurnStep({ intent: "device.status.read" }),
  { id: "execute", kind: "action.run", action: "status" },
);
assert.deepEqual(
  selectTurnStep({ route: "screen.wallpaper", action: "sync" }),
  { id: "screen-sync", kind: "screen.workspace.sync.intent" },
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
});

assert.equal(status, 200);
assert.equal(turn.schema, "walnutpi.agentTurn.v1");
assert.equal(turn.sessionId, "web-demo");
assert.equal(turn.status, "completed");
assert.equal(turn.steps.length, 2);
assert.equal(turn.steps[0].kind, "intent.classify");
assert.equal(turn.steps[1].kind, "action.run");
assert.equal(turn.steps[1].action, "status");
assert.equal(turn.result.output, "ran status");

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
    body: { ok: true, screenId: body.screenId, output: { path: "outputs/demo.png" } },
  }),
  queue: createOneLaneQueue(),
});
assert.equal(generated.status, 202);
assert.equal(generated.turn.status, "queued");
assert.equal(generated.turn.steps[1].kind, "screen.workspace.generate.intent");
assert.equal(generated.turn.result.queued, true);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(generated.turn.status, "completed");
assert.equal(generated.turn.result.output.path, "outputs/demo.png");

console.log("agent turn loop self-check passed");

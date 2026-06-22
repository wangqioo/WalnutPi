#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentEventBus } from "./agent-event-bus.ts";
import { createAgentTurnEventLedger } from "./agent-turn-event-ledger.ts";
import { createOneLaneQueue } from "./agent-one-lane-queue.ts";

const dir = await mkdtemp(path.join(tmpdir(), "walnut-agent-events-"));
try {
  const seen = [];
  const bus = createAgentEventBus();
  const off = bus.subscribe("web-demo", (event) => seen.push(event.kind));
  const ledger = createAgentTurnEventLedger({
    eventsPath: path.join(dir, "agent-turn-events.jsonl"),
    eventBus: bus,
  });

  const first = await ledger.appendEvent({ turnId: "turn-a", sessionId: "web-demo", kind: "turn.started", status: "running" });
  const second = await ledger.appendEvent({ turnId: "turn-a", sessionId: "web-demo", kind: "turn.completed", status: "completed" });
  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.deepEqual(seen, ["turn.started", "turn.completed"]);
  assert.deepEqual((await ledger.readEvents({ sessionId: "web-demo", afterSeq: 1 })).map((event) => event.kind), ["turn.completed"]);
  off();

  const queue = createOneLaneQueue();
  const order = [];
  queue.enqueue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push("a");
  });
  queue.enqueue(async () => order.push("b"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(order, ["a", "b"]);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("agent events self-check passed");

#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentHarnessSessionStore } from "./agent-harness-session-store.ts";
import { createAgentTurnLedger } from "./agent-turn-ledger.ts";

const dir = await mkdtemp(path.join(tmpdir(), "walnut-agent-store-"));
try {
  const turns = createAgentTurnLedger({ turnsPath: path.join(dir, "turns.jsonl"), limit: 2 });
  await turns.appendTurn({ schema: "walnutpi.agentTurn.v2", turnId: "turn-a", sessionId: "one" });
  await turns.appendTurn({ schema: "walnutpi.agentTurn.v2", turnId: "turn-b", sessionId: "two" });
  await turns.appendTurn({ schema: "walnutpi.agentTurn.v2", turnId: "turn-c", sessionId: "one" });
  assert.deepEqual((await turns.readTurns({ sessionId: "one" })).map((turn) => turn.turnId), ["turn-a", "turn-c"]);
  await turns.appendTurn({ schema: "walnutpi.agentTurn.v2", turnId: "turn-q", sessionId: "one", status: "queued" });
  await turns.appendTurn({ schema: "walnutpi.agentTurn.v2", turnId: "turn-q", sessionId: "one", status: "completed", result: { ok: true } });
  const oneTurns = await turns.readTurns({ sessionId: "one", count: 10 });
  assert.deepEqual(oneTurns.map((turn) => turn.turnId), ["turn-a", "turn-c", "turn-q"]);
  assert.equal(oneTurns.at(-1).status, "completed");

  const harnesses = createAgentHarnessSessionStore({ filePath: path.join(dir, "harness.json") });
  const first = await harnesses.upsertSession({
    sessionId: "harness-demo",
    threadId: "web-demo",
    runId: "turn-a",
    resumeState: { provider: "walnut-ai" },
  });
  const second = await harnesses.upsertSession({ sessionId: "harness-demo", status: "running" });
  assert.equal(second.schema, "walnutpi.agentHarnessSession.v1");
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.status, "running");
  assert.deepEqual(second.resumeState, { provider: "walnut-ai" });
  assert.equal((await harnesses.readSession("harness-demo")).threadId, "web-demo");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("agent store self-check passed");

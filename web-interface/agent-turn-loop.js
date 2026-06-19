import { randomUUID } from "node:crypto";

const ACTION_BY_INTENT = {
  "device.status.read": "status",
  "device.network.read": "network",
  "device.snapshot.read": "snapshot",
  "device.gpio.read": "gpio",
  "device.notes.read": "notes",
  "device.note.write": "note",
};

export function selectTurnPlan(classification, mode = "intent") {
  if (mode === "ai") return [{ agent: "chat", kind: "action.run", action: "ai" }];
  const intent = classification?.intent || "";
  const route = classification?.route || "";
  const action = classification?.action || "";
  if (ACTION_BY_INTENT[intent]) return [{ agent: "device", kind: "action.run", action: ACTION_BY_INTENT[intent] }];
  if (route === "screen.wallpaper" && action === "sync") return [{ agent: "screen", kind: "screen.workspace.sync.intent" }];
  if (route === "screen.wallpaper" && action === "generate") return [{ agent: "screen", kind: "screen.workspace.generate.intent" }];
  if (route === "screen.widget_app" && action === "create") return [{ agent: "screen", kind: "screen.widget_app.create.intent" }];
  return [{ agent: "chat", kind: "action.run", action: "ai" }];
}

export const selectTurnStep = (classification, mode = "intent") => {
  const first = selectTurnPlan(classification, mode)[0];
  return first?.kind === "action.run"
    ? { id: `${first.agent}-run`, kind: first.kind, action: first.action }
    : { id: `${first.agent}-${first.kind.split(".").at(-1)}`, kind: first.kind };
};

export function createAgentTurnLoop({
  classifyIntent,
  runAction,
  generateScreen,
  syncScreen,
  turnLedger,
  eventLedger,
  queue,
  readJsonRequest,
  json,
}) {
  return {
    async handleTurn(req) {
      let body;
      try {
        body = await readJsonRequest(req);
      } catch (error) {
        return json({ ok: false, error: error.message }, 400);
      }
      const result = await runAgentTurn({ body, classifyIntent, runAction, generateScreen, syncScreen, eventLedger, queue, turnLedger });
      await turnLedger?.appendTurn(result.turn);
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

export async function runAgentTurn({
  body,
  classifyIntent,
  runAction,
  generateScreen,
  syncScreen,
  eventLedger,
  queue,
  turnLedger,
}) {
  const workQueue = queue || { enqueue: (job) => job(), size: () => 0 };
  const startedAt = new Date().toISOString();
  const turnId = `turn-${randomUUID()}`;
  const sessionId = String(body.sessionId || "").trim() || null;
  const mode = body.mode === "ai" ? "ai" : "intent";
  const text = String(body.text || "").trim();
  const turn = {
    schema: "walnutpi.agentTurn.v2",
    turnId,
    sessionId,
    input: { text, mode },
    status: "running",
    agents: [],
    steps: [],
    pendingNext: null,
    result: null,
    evidence: {},
    startedAt,
  };
  await emit(eventLedger, turn, { kind: "turn.started", status: "running", data: { input: turn.input } });
  if (!text) return failTurn({ turn, eventLedger, status: 400, error: "missing text" });

  const classify = await runRouterAgent({ turn, text, classifyIntent, eventLedger });
  if (!classify.ok) return failTurn({ turn, eventLedger, status: classify.status || 500, error: classify.error });

  const plan = selectTurnPlan(classify.classification, mode);
  turn.agents.push({ id: "router", status: "completed", plan });

  for (const task of plan) {
    const result = await runTaskAgent({ task, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger });
    if (result.deferred) return { turn, status: result.status };
    if (!result.ok) return { turn, status: result.status };
  }

  await emitTurnDone(eventLedger, turn);
  return { turn, status: 200 };
}

async function runRouterAgent({ turn, text, classifyIntent, eventLedger }) {
  const step = { id: "router-classify", agent: "router", kind: "intent.classify", status: "running" };
  turn.steps.push(step);
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: "router" } });
  try {
    const classify = await classifyIntent(text);
    step.status = classify.ok ? "completed" : "failed";
    step.result = classify.ok ? { classification: classify.classification } : { error: classify.error };
    await emitStepDone(eventLedger, turn, step);
    return classify;
  } catch (error) {
    step.status = "failed";
    step.result = { error: error.message };
    await emitStepDone(eventLedger, turn, step);
    return { ok: false, status: 500, error: error.message };
  }
}

async function runTaskAgent({ task, body, text, sessionId, turn, runAction, generateScreen, syncScreen, workQueue, eventLedger, turnLedger }) {
  const step = { id: `${task.agent}-${turn.steps.length}`, agent: task.agent, kind: task.kind, status: "running" };
  turn.steps.push(step);
  turn.agents.push({ id: task.agent, status: "running", task });
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: task.agent, task } });

  if (task.kind === "action.run") {
    const actionResult = await runAction({ ...body, action: task.action, sessionId, text });
    step.action = task.action;
    step.status = actionResult.body?.ok ? "completed" : "failed";
    step.result = actionResult.body;
    finishAgent(turn, task.agent, step.status);
    turn.status = actionResult.body?.ok ? "completed" : "failed";
    turn.result = actionResult.body;
    await emitStepDone(eventLedger, turn, step);
    if (turn.status === "failed") await emitTurnDone(eventLedger, turn);
    return { ok: actionResult.body?.ok, status: actionResult.status || 500 };
  }

  if (task.kind === "screen.workspace.generate.intent" && generateScreen) {
    return queueTask({ turn, step, task, eventLedger, turnLedger, workQueue, run: () => generateScreen({
      prompt: text,
      screenId: `agent-freeform-${Date.now()}`,
      playlist: "default",
      outputType: "animated",
      preset: "fit-cover:480x320",
    }) });
  }

  if (task.kind === "screen.workspace.sync.intent" && syncScreen && body.playlistHash) {
    return queueTask({
      turn,
      step,
      task,
      eventLedger,
      turnLedger,
      workQueue,
      run: () => syncScreen({ playlistHash: body.playlistHash, evidenceMode: body.evidenceMode }),
    });
  }

  step.status = "pending";
  step.result = { task };
  finishAgent(turn, task.agent, "pending");
  turn.pendingNext = task.kind;
  turn.result = step.result;
  turn.status = "pending";
  await emitStepDone(eventLedger, turn, step);
  await emit(eventLedger, turn, { kind: "turn.pending", status: "pending", data: { pendingNext: turn.pendingNext } });
  return { ok: true, status: 200 };
}

async function queueTask({ turn, step, task, eventLedger, turnLedger, workQueue, run }) {
  step.status = "queued";
  turn.status = "queued";
  turn.pendingNext = step.kind;
  turn.result = { queued: true, stepId: step.id, agent: task.agent };
  finishAgent(turn, task.agent, "queued");
  await emit(eventLedger, turn, { kind: "turn.pending", status: "queued", data: { stepId: step.id, queueSize: workQueue.size() } });
  workQueue.enqueue(() => completeQueuedStep({ turn, step, task, eventLedger, turnLedger, run }));
  return { ok: true, deferred: true, status: 202 };
}

async function completeQueuedStep({ turn, step, task, eventLedger, turnLedger, run }) {
  step.status = "running";
  finishAgent(turn, task.agent, "running");
  await emit(eventLedger, turn, { kind: "agent.started", status: "running", stepId: step.id, data: { agent: task.agent, task } });
  try {
    const result = await run();
    step.status = result.body?.ok ? "completed" : "failed";
    step.result = result.body;
    finishAgent(turn, task.agent, step.status);
    turn.status = result.body?.ok ? "completed" : "failed";
    turn.result = result.body;
    turn.pendingNext = null;
    await turnLedger?.appendTurn(turn);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
  } catch (error) {
    step.status = "failed";
    step.result = { ok: false, error: error.message };
    finishAgent(turn, task.agent, "failed");
    turn.status = "failed";
    turn.error = error.message;
    turn.result = step.result;
    turn.pendingNext = null;
    await turnLedger?.appendTurn(turn);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
  }
}

function finishAgent(turn, agentId, status) {
  const agent = turn.agents.findLast((item) => item.id === agentId && !["completed", "failed"].includes(item.status));
  if (agent) agent.status = status;
}

async function failTurn({ turn, eventLedger, status, error }) {
  turn.status = "failed";
  turn.error = error;
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

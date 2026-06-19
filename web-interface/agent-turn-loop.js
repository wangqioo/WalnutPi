import { randomUUID } from "node:crypto";

export function selectTurnStep(classification, mode = "intent") {
  if (mode === "ai") return { id: "execute", kind: "action.run", action: "ai" };
  const intent = classification?.intent || "";
  const route = classification?.route || "";
  const action = classification?.action || "";
  if (intent === "device.status.read") return { id: "execute", kind: "action.run", action: "status" };
  if (intent === "device.network.read") return { id: "execute", kind: "action.run", action: "network" };
  if (intent === "device.snapshot.read") return { id: "execute", kind: "action.run", action: "snapshot" };
  if (intent === "device.gpio.read") return { id: "execute", kind: "action.run", action: "gpio" };
  if (intent === "device.notes.read") return { id: "execute", kind: "action.run", action: "notes" };
  if (intent === "device.note.write") return { id: "execute", kind: "action.run", action: "note" };
  if (route === "screen.wallpaper" && action === "sync") return { id: "screen-sync", kind: "screen.workspace.sync.intent" };
  if (route === "screen.wallpaper" && action === "generate") return { id: "screen-generate", kind: "screen.workspace.generate.intent" };
  if (route === "screen.widget_app" && action === "create") return { id: "widget-create", kind: "screen.widget_app.create.intent" };
  return { id: "execute", kind: "action.run", action: "ai" };
}

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

export async function runAgentTurn({ body, classifyIntent, runAction, generateScreen, syncScreen, eventLedger, queue, turnLedger }) {
  const workQueue = queue || { enqueue: (job) => job(), size: () => 0 };
  const startedAt = new Date().toISOString();
  const turnId = `turn-${randomUUID()}`;
  const sessionId = String(body.sessionId || "").trim() || null;
  const mode = body.mode === "ai" ? "ai" : "intent";
  const text = String(body.text || "").trim();
  const turn = {
    schema: "walnutpi.agentTurn.v1",
    turnId,
    sessionId,
    input: { text, mode },
    status: "running",
    steps: [],
    pendingNext: null,
    result: null,
    evidence: {},
    startedAt,
  };
  await emit(eventLedger, turn, { kind: "turn.started", status: "running", data: { input: turn.input } });
  if (!text) {
    turn.status = "failed";
    turn.error = "missing text";
    await emit(eventLedger, turn, { kind: "turn.failed", status: "failed", error: turn.error });
    return { turn, status: 400 };
  }

  await emit(eventLedger, turn, { kind: "step.started", status: "running", stepId: "classify" });
  const classify = await classifyIntent(text);
  turn.steps.push({
    id: "classify",
    kind: "intent.classify",
    status: classify.ok ? "completed" : "failed",
    result: classify.ok ? { classification: classify.classification } : { error: classify.error },
  });
  await emit(eventLedger, turn, {
    kind: classify.ok ? "step.completed" : "step.failed",
    status: classify.ok ? "completed" : "failed",
    stepId: "classify",
    data: classify.ok ? { classification: classify.classification } : undefined,
    error: classify.ok ? null : classify.error,
  });
  if (!classify.ok) {
    turn.status = "failed";
    turn.error = classify.error;
    await emit(eventLedger, turn, { kind: "turn.failed", status: "failed", error: turn.error });
    return { turn, status: classify.status || 500 };
  }

  const selected = selectTurnStep(classify.classification, mode);
  const step = { id: selected.id, kind: selected.kind, status: "completed" };
  if (selected.kind === "action.run") {
    await emit(eventLedger, turn, { kind: "step.started", status: "running", stepId: step.id, data: { kind: step.kind, action: selected.action } });
    const actionResult = await runAction({ ...body, action: selected.action, sessionId, text });
    step.action = selected.action;
    step.status = actionResult.body?.ok ? "completed" : "failed";
    step.result = actionResult.body;
    turn.status = actionResult.body?.ok ? "completed" : "failed";
    turn.result = actionResult.body;
    turn.steps.push(step);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
    return { turn, status: actionResult.status || 500 };
  }

  if (selected.kind === "screen.workspace.generate.intent" && generateScreen) {
    step.status = "queued";
    turn.steps.push(step);
    turn.status = "queued";
    turn.pendingNext = step.kind;
    turn.result = { queued: true, stepId: step.id };
    await emit(eventLedger, turn, { kind: "step.started", status: "queued", stepId: step.id, data: { kind: step.kind } });
    await emit(eventLedger, turn, { kind: "turn.pending", status: "queued", data: { stepId: step.id, queueSize: workQueue.size() } });
    workQueue.enqueue(() => completeQueuedStep({
      turn,
      step,
      eventLedger,
      turnLedger,
      run: () => generateScreen({
        prompt: text,
        screenId: `agent-freeform-${Date.now()}`,
        playlist: "default",
        outputType: "animated",
        preset: "fit-cover:480x320",
      }),
    }));
    return { turn, status: 202 };
  }

  if (selected.kind === "screen.workspace.sync.intent" && syncScreen && body.playlistHash) {
    step.status = "queued";
    turn.steps.push(step);
    turn.status = "queued";
    turn.pendingNext = step.kind;
    turn.result = { queued: true, stepId: step.id };
    await emit(eventLedger, turn, { kind: "step.started", status: "queued", stepId: step.id, data: { kind: step.kind } });
    await emit(eventLedger, turn, { kind: "turn.pending", status: "queued", data: { stepId: step.id, queueSize: workQueue.size() } });
    workQueue.enqueue(() => completeQueuedStep({
      turn,
      step,
      eventLedger,
      turnLedger,
      run: () => syncScreen({ playlistHash: body.playlistHash, evidenceMode: body.evidenceMode }),
    }));
    return { turn, status: 202 };
  }

  step.status = "pending";
  step.result = { classification: classify.classification };
  turn.pendingNext = selected.kind;
  turn.result = step.result;
  turn.status = "pending";
  turn.steps.push(step);
  await emit(eventLedger, turn, { kind: "step.completed", status: "pending", stepId: step.id, data: { kind: step.kind } });
  await emit(eventLedger, turn, { kind: "turn.pending", status: "pending", data: { pendingNext: turn.pendingNext } });
  return { turn, status: 200 };
}

async function completeQueuedStep({ turn, step, eventLedger, turnLedger, run }) {
  await emit(eventLedger, turn, { kind: "step.started", status: "running", stepId: step.id, data: { kind: step.kind } });
  try {
    const result = await run();
    step.status = result.body?.ok ? "completed" : "failed";
    step.result = result.body;
    turn.status = result.body?.ok ? "completed" : "failed";
    turn.result = result.body;
    turn.pendingNext = null;
    await turnLedger?.appendTurn(turn);
    await emitStepDone(eventLedger, turn, step);
    await emitTurnDone(eventLedger, turn);
  } catch (error) {
    step.status = "failed";
    step.result = { ok: false, error: error.message };
    turn.status = "failed";
    turn.error = error.message;
    turn.result = step.result;
    turn.pendingNext = null;
    await turnLedger?.appendTurn(turn);
    await emit(eventLedger, turn, { kind: "step.failed", status: "failed", stepId: step.id, error: error.message });
    await emit(eventLedger, turn, { kind: "turn.failed", status: "failed", error: error.message });
  }
}

async function emitStepDone(eventLedger, turn, step) {
  await emit(eventLedger, turn, {
    kind: step.status === "completed" ? "step.completed" : "step.failed",
    status: step.status,
    stepId: step.id,
    data: step.status === "completed" ? { kind: step.kind, result: step.result } : undefined,
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

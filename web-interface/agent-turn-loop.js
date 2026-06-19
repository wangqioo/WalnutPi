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

export function createAgentTurnLoop({ classifyIntent, runAction, turnLedger, readJsonRequest, json }) {
  return {
    async handleTurn(req) {
      let body;
      try {
        body = await readJsonRequest(req);
      } catch (error) {
        return json({ ok: false, error: error.message }, 400);
      }
      const result = await runAgentTurn({ body, classifyIntent, runAction });
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
  };
}

export async function runAgentTurn({ body, classifyIntent, runAction }) {
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
  if (!text) {
    turn.status = "failed";
    turn.error = "missing text";
    return { turn, status: 400 };
  }

  const classify = await classifyIntent(text);
  turn.steps.push({
    id: "classify",
    kind: "intent.classify",
    status: classify.ok ? "completed" : "failed",
    result: classify.ok ? { classification: classify.classification } : { error: classify.error },
  });
  if (!classify.ok) {
    turn.status = "failed";
    turn.error = classify.error;
    return { turn, status: classify.status || 500 };
  }

  const selected = selectTurnStep(classify.classification, mode);
  const step = { id: selected.id, kind: selected.kind, status: "completed" };
  if (selected.kind === "action.run") {
    const actionResult = await runAction({ ...body, action: selected.action, sessionId, text });
    step.action = selected.action;
    step.status = actionResult.body?.ok ? "completed" : "failed";
    step.result = actionResult.body;
    turn.status = actionResult.body?.ok ? "completed" : "failed";
    turn.result = actionResult.body;
    turn.steps.push(step);
    return { turn, status: actionResult.status || 500 };
  }

  step.status = "pending";
  step.result = { classification: classify.classification };
  turn.pendingNext = selected.kind;
  turn.result = step.result;
  turn.status = "pending";
  turn.steps.push(step);
  return { turn, status: 200 };
}

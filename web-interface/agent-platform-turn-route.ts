import { randomUUID } from "node:crypto";
import { capabilityFromIntent, runMastraAgentTurnWorkflow } from "./platform/mastra/agent-turn-workflows.ts";
import { failedToolResult, toolResult, type WalnutToolResult } from "./walnut-tool-results.ts";

type JsonObject = Record<string, any>;

const TURN_SCHEMA = "walnutpi.agentPlatformTurn.v1";

export function createAgentPlatformTurnRoute({
  classifyIntent,
  turnLedger,
  eventLedger,
  metricsLedger,
  mastraWorkflows,
  readJsonRequest,
  json,
}: JsonObject) {
  return {
    async handleTurn(req: Request) {
      let body: JsonObject;
      try {
        body = await readJsonRequest(req);
      } catch (error: any) {
        return json({ ok: false, error: error.message }, 400);
      }

      const outcome = await runAgentPlatformTurn({
        body,
        classifyIntent,
        turnLedger,
        eventLedger,
        metricsLedger,
        mastraWorkflows,
      });
      return json(outcome.turn, outcome.status);
    },

    async handleTurns(url: URL) {
      const sessionId = url.searchParams.get("sessionId") || null;
      const limit = Number(url.searchParams.get("limit") || 100);
      return json({
        ok: true,
        schema: "walnutpi.agentPlatformTurns.v1",
        turns: await turnLedger.readTurns({ sessionId, count: Number.isFinite(limit) ? limit : 100 }),
      });
    },

    async handleTurnEvents(url: URL) {
      const sessionId = url.searchParams.get("sessionId") || null;
      const turnId = url.searchParams.get("turnId") || null;
      const afterSeq = Number(url.searchParams.get("afterSeq") || 0);
      return json({
        ok: true,
        schema: "walnutpi.agentPlatformTurnEvents.v1",
        events: await eventLedger.readEvents({ sessionId, turnId, afterSeq }),
      });
    },
  };
}

export async function runAgentPlatformTurn({
  body,
  classifyIntent,
  turnLedger,
  eventLedger,
  metricsLedger,
  mastraWorkflows,
}: JsonObject) {
  const startedAt = new Date().toISOString();
  const turn = {
    ok: false,
    schema: TURN_SCHEMA,
    turnId: `turn-${randomUUID()}`,
    sessionId: cleanOptionalText(body.sessionId),
    status: "running",
    startedAt,
    finishedAt: null,
    input: {
      text: cleanOptionalText(body.text),
      requirements: objectOrNull(body.requirements),
    },
    route: null,
    steps: [] as JsonObject[],
    toolResults: [] as WalnutToolResult[],
    evidence: [] as JsonObject[],
    sideEffects: [] as JsonObject[],
    telemetry: {
      summary: {
        totalSteps: 0,
        failures: 0,
      },
    },
    userSummary: "",
  };

  await appendEvent(eventLedger, turn, { kind: "turn.started", status: "running", data: { input: turn.input } });

  try {
    if (!turn.input.text) throw statusError(400, "missing text");
    const classified = await classifyIntent(turn.input.text, {
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      scenario: objectOrNull(body.scenario),
      requirements: turn.input.requirements,
    });
    if (!classified.ok) throw statusError(classified.status || 500, classified.error || "intent classification failed");

    turn.route = classified.classification;
    pushStep(turn, "router", "intent.classify", toolResult("diagnostics", {
      summary: "Intent classified.",
      result: { classification: classified.classification },
      evidence: { intentRoute: classified.classification },
    }));

    const result = await dispatchPlatformCapability({
      classification: classified.classification,
      body,
      turn,
      mastraWorkflows,
    });
    pushStep(turn, result.family, result.result?.operation || result.diagnostics?.operation || result.family, result);
    finishTurn(turn);
    await appendEvent(eventLedger, turn, { kind: "turn.completed", status: turn.status, data: { result } });
    await turnLedger.appendTurn(turn);
    return { turn, status: result.ok ? 200 : 400 };
  } catch (error: any) {
    const result = failedToolResult("diagnostics", error.message || "agent platform turn failed", {
      status: error.status || 500,
    });
    pushStep(turn, "diagnostics", "platform.failure", result);
    finishTurn(turn, "failed");
    await appendEvent(eventLedger, turn, { kind: "turn.failed", status: "failed", error: error.message });
    await turnLedger.appendTurn(turn);
    return { turn, status: error.status || 500 };
  }
}

async function dispatchPlatformCapability({
  classification,
  body,
  turn,
  mastraWorkflows,
}: JsonObject): Promise<WalnutToolResult> {
  const capability = capabilityFromIntent(String(classification?.intent || ""));
  if (!capability) {
    throw statusError(400, `No Mastra workflow is registered for intent ${classification?.intent || "(missing)"}`);
  }
  if (mastraWorkflows?.dispatch) {
    return mastraWorkflows.dispatch({
      classification,
      body,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
    });
  }
  return runMastraAgentTurnWorkflow({
    capability,
    params: objectOrNull(classification?.parameters) || {},
    sessionId: turn.sessionId,
    turnId: turn.turnId,
  });
}

function pushStep(turn: JsonObject, agent: string, kind: string, result: WalnutToolResult) {
  const status = result.ok ? "completed" : "failed";
  const step = {
    id: `${agent}-${turn.steps.length}`,
    agent,
    kind,
    status,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    toolResultSchema: result.schema,
  };
  turn.steps.push(step);
  turn.toolResults.push(result);
  turn.evidence.push(...Object.entries(result.evidence || {}).map(([evidenceKind, value]) => ({ kind: evidenceKind, value })));
  turn.sideEffects.push(...(result.sideEffects || []));
}

function finishTurn(turn: JsonObject, forcedStatus: string | null = null) {
  const failures = turn.toolResults.filter((item: WalnutToolResult) => !item.ok).length;
  turn.ok = failures === 0;
  turn.status = forcedStatus || (turn.ok ? "completed" : "failed");
  turn.finishedAt = new Date().toISOString();
  turn.telemetry.summary = {
    totalSteps: turn.steps.length,
    failures,
  };
  turn.userSummary = turn.toolResults.at(-1)?.summary || "";
}

async function appendEvent(eventLedger: JsonObject, turn: JsonObject, event: JsonObject) {
  await eventLedger?.appendEvent?.({
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    ...event,
  });
}

function cleanOptionalText(value: any) {
  return String(value || "").trim();
}

function objectOrNull(value: any): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function statusError(status: number, message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

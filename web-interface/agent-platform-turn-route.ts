import { randomUUID } from "node:crypto";
import {
  capabilityFromIntent,
  isMastraAgentTurnCapability,
  runMastraAgentTurnWorkflow,
} from "./platform/mastra/agent-turn-workflows.ts";
import { setWalnutSpanAttributes, withWalnutSpan } from "./platform/observability/tracing.ts";
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

      const scopedMastraWorkflows = typeof mastraWorkflows?.forRequest === "function"
        ? await mastraWorkflows.forRequest(requestForWorkflow(req))
        : mastraWorkflows;
      const outcome = await runAgentPlatformTurn({
        body,
        classifyIntent,
        turnLedger,
        eventLedger,
        metricsLedger,
        mastraWorkflows: scopedMastraWorkflows,
      });
      return json(outcome.turn, outcome.status);
    },

    async handleTurns(url: URL) {
      const sessionId = url.searchParams.get("sessionId") || null;
      const limit = Number(url.searchParams.get("limit") || 100);
      return json({
        ok: true,
        schema: "walnutpi.agentPlatformTurns.v1",
        persistence: await turnLedger.persistenceStatus?.(),
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
        persistence: await eventLedger.persistenceStatus?.(),
        events: await eventLedger.readEvents({ sessionId, turnId, afterSeq }),
      });
    },
  };
}

function requestForWorkflow(req: any) {
  return req?.raw instanceof Request ? req.raw : req;
}

export async function runAgentPlatformTurn({
  body,
  classifyIntent,
  turnLedger,
  eventLedger,
  metricsLedger,
  mastraWorkflows,
}: JsonObject) {
  return withWalnutSpan("walnut.agent.turn", {
    "walnut.session_id": cleanOptionalText(body.sessionId),
  }, async (turnSpan) => {
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
      capability: cleanOptionalText(body.capability),
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
      persistence: null as JsonObject | null,
    },
    userSummary: "",
  };
  setWalnutSpanAttributes(turnSpan, {
    "walnut.session_id": turn.sessionId,
    "walnut.turn_id": turn.turnId,
  });

  await appendEvent(eventLedger, turn, { kind: "turn.started", status: "running", data: { input: turn.input } });

  try {
    const structuredCapability = parseStructuredCapability(body.capability);
    const classified = structuredCapability
      ? { ok: true, status: 200, classification: structuredCapabilityRoute(structuredCapability, body) }
      : await classifyTurnInput({ body, classifyIntent, turn });

    turn.route = classified.classification;
    setWalnutSpanAttributes(turnSpan, {
      "walnut.route": routeAttribute(classified.classification),
    });
    pushStep(turn, "router", "intent.classify", toolResult("diagnostics", {
      summary: structuredCapability ? "Structured capability routed." : "Intent classified.",
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
    const persistence = await turnLedger.appendTurn(turn);
    turn.telemetry.persistence = { turnLedger: persistence || null };
    await appendEvent(eventLedger, turn, { kind: "turn.completed", status: turn.status, data: { result } });
    return { turn, status: result.ok ? 200 : 400 };
  } catch (error: any) {
    const result = failedToolResult("diagnostics", error.message || "agent platform turn failed", {
      status: error.status || 500,
    });
    pushStep(turn, "diagnostics", "platform.failure", result);
    finishTurn(turn, "failed");
    try {
      const persistence = await turnLedger.appendTurn(turn);
      turn.telemetry.persistence = { turnLedger: persistence || null };
    } catch (persistError: any) {
      turn.telemetry.persistence = {
        turnLedger: {
          persisted: false,
          skipped: false,
          error: persistError.message,
        },
      };
    }
    await appendEvent(eventLedger, turn, { kind: "turn.failed", status: "failed", error: error.message });
    return { turn, status: error.status || 500 };
  }
  });
}

async function classifyTurnInput({ body, classifyIntent, turn }: JsonObject) {
  if (!turn.input.text) throw statusError(400, "missing text");
  const classified = await withWalnutSpan("walnut.intent.route", {
    "walnut.session_id": turn.sessionId,
    "walnut.turn_id": turn.turnId,
  }, async (routeSpan) => {
    const result = await classifyIntent(turn.input.text, {
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      scenario: objectOrNull(body.scenario),
      requirements: turn.input.requirements,
    });
    if (result.ok) {
      setWalnutSpanAttributes(routeSpan, {
        "walnut.route": routeAttribute(result.classification),
      });
    }
    return result;
  });
  if (!classified.ok) throw statusError(classified.status || 500, classified.error || "intent classification failed");
  return classified;
}

function parseStructuredCapability(value: any) {
  const capability = cleanOptionalText(value);
  if (!capability) return null;
  if (!isMastraAgentTurnCapability(capability)) {
    throw statusError(400, `Unsupported structured capability ${capability}`);
  }
  return capability;
}

function structuredCapabilityRoute(capability: string, body: JsonObject) {
  return {
    schema: "walnutpi.intent.route.v2",
    route: "mastra.mcp",
    action: "call",
    subject: cleanOptionalText(body.text || capability),
    delivery: "none",
    riskHint: capability.includes(".write") || capability === "memory.preference" || capability === "memory.approve" ? "write" : "read",
    exposure: ["internal", "agent_action"],
    actionPolicyId: null,
    parameters: objectOrNull(body.parameters) || {},
    confidence: 1,
    source: "structured",
    intent: capability,
    rule: "agent-turn.capability",
  };
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

function routeAttribute(classification: JsonObject | null | undefined) {
  return String(classification?.route || classification?.intent || "").trim();
}

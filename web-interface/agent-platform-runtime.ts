import { randomUUID } from "node:crypto";
import { actionIdForIntent, policyActionIdsForIntent } from "./action-registry.ts";
import { failedToolResult, toolResult, type WalnutToolResult } from "./walnut-tool-results.ts";

type JsonObject = Record<string, any>;

const TURN_SCHEMA = "walnutpi.agentPlatformTurn.v1";

export function createAgentPlatformRuntime({
  classifyIntent,
  runAction,
  screenCommandRunner,
  turnLedger,
  eventLedger,
  metricsLedger,
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

      const outcome = await runPlatformTurn({
        body,
        classifyIntent,
        runAction,
        screenCommandRunner,
        turnLedger,
        eventLedger,
        metricsLedger,
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

export async function runPlatformTurn({
  body,
  classifyIntent,
  runAction,
  screenCommandRunner,
  turnLedger,
  eventLedger,
  metricsLedger,
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
      requirements: turn.input.requirements,
    });
    if (!classified.ok) throw statusError(classified.status || 500, classified.error || "intent classification failed");

    turn.route = classified.classification;
    pushStep(turn, "router", "intent.classify", toolResult("diagnostics", {
      summary: "Intent classified.",
      result: { classification: classified.classification },
      evidence: { intentRoute: classified.classification },
    }));

    const result = await executeIntent({
      classification: classified.classification,
      body,
      turn,
      runAction,
      screenCommandRunner,
      turnLedger,
      metricsLedger,
    });
    pushStep(turn, result.family, result.result?.operation || result.family, result);
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

async function executeIntent({
  classification,
  body,
  turn,
  runAction,
  screenCommandRunner,
  turnLedger,
  metricsLedger,
}: JsonObject): Promise<WalnutToolResult> {
  const intent = String(classification?.intent || "");
  if (intent === "session.summary") return sessionSummary({ turn, turnLedger });
  if (intent === "memory.preference") return memoryPreference({ body, turn });
  if (intent === "memory.sensitive_skip") return memorySensitiveSkip({ body, turn });
  if (intent === "diagnostics.recent_failure") return recentFailureDiagnostics({ turn, turnLedger, metricsLedger });
  if (intent === "screen.state_frame.read") return screenStateFrameRead();
  if (intent === "screen.sync") return syncScreen({ body, screenCommandRunner });
  if (intent === "screen.generate" || intent === "screen.widget_app.create") return screenGenerationRequiresDslSource({ intent });
  if (intent.startsWith("policy.")) return policyDecision({ intent, text: body.text });

  const actionId = actionIdForIntent(intent) || (classification?.route === "ai.chat" ? "ai" : null);
  if (!actionId) {
    return failedToolResult("diagnostics", `No platform tool is registered for intent ${intent || "(missing)"}`, {
      operation: "tool.dispatch",
    });
  }
  return runDeviceAction({ actionId, body, turn, runAction });
}

async function runDeviceAction({ actionId, body, turn, runAction }: JsonObject) {
  const response = await runAction({
    ...body,
    action: actionId,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    text: body.text,
    requirements: body.requirements,
  });
  const payload = objectOrEmpty(response.body);
  return toolResult(actionId === "ai" ? "chat" : "device", {
    ok: Boolean(payload.ok),
    summary: payload.summary || payload.reply || payload.output || "",
    result: {
      operation: actionId === "ai" ? "chat.reply" : "device.action",
      actionId,
      status: response.status || 500,
      payload,
    },
    evidence: objectOrEmpty(payload.evidence || payload.actionEvidence),
    sideEffects: normalizeActionSideEffects(payload.sideEffects),
    diagnostics: objectOrEmpty(payload.diagnostics),
  });
}

async function syncScreen({ body, screenCommandRunner }: JsonObject) {
  const playlistHash = cleanOptionalText(body.playlistHash);
  if (!playlistHash) {
    const read = await screenCommandRunner.run({ kind: "screen.readPlaylist", playlistId: "default" });
    const hash = read.result?.playlistHash || read.evidence?.playlistHash;
    if (!hash) return failedToolResult("screen", "Current playlist hash is unavailable.");
    return screenCommandRunner.run({
      kind: "screen.syncPlaylist",
      playlistId: "default",
      playlistHash: hash,
      evidenceMode: body.evidenceMode === "full" ? "full" : "fast",
    });
  }
  return screenCommandRunner.run({
    kind: "screen.syncPlaylist",
    playlistId: "default",
    playlistHash,
    evidenceMode: body.evidenceMode === "full" ? "full" : "fast",
  });
}

function screenStateFrameRead() {
  return toolResult("screen", {
    summary: "No direct read probe is registered in the new platform yet.",
    result: {
      operation: "screen.state_frame.read",
      serviceState: "unknown",
    },
    evidence: {
      noScreenSync: true,
      noServiceRestart: true,
      frameHashOrHonestFailure: "read-only screen frame probe is not wired to the new platform yet",
    },
  });
}

function screenGenerationRequiresDslSource({ intent }: JsonObject) {
  return toolResult("screen", {
    ok: false,
    summary: "Screen generation now requires an explicit Screen Command DSL source before rendering.",
    result: {
      operation: intent,
      requiredCommand: "screen.renderWallpaper",
    },
    evidence: {
      noAuthoritativeLlmManifest: true,
      missingSourceRef: true,
    },
  });
}

function memoryPreference({ body, turn }: JsonObject) {
  return toolResult("memory", {
    summary: "Captured a durable memory candidate. No write was committed.",
    result: {
      operation: "memory.preference",
      candidate: cleanOptionalText(body.text),
    },
    evidence: {
      memoryUpdateCandidateOrConfirmation: { ok: true, writeState: "candidate", text: cleanOptionalText(body.text) },
      memoryCategoryKey: "preferences.screen_generation",
      sourceSessionId: turn.sessionId || "unknown-session",
      noDurableMemoryWrite: true,
    },
  });
}

function memorySensitiveSkip({ body, turn }: JsonObject) {
  return toolResult("memory", {
    summary: "Rejected sensitive temporary content for durable memory.",
    result: {
      operation: "memory.sensitive_skip",
    },
    evidence: {
      memorySkipEvidence: { ok: true, reason: "sensitive-temporary", textLength: cleanOptionalText(body.text).length },
      sensitiveMemoryRejection: true,
      sessionSafetySummary: { sessionId: turn.sessionId || "unknown-session", noDurableMemoryWrite: true },
    },
  });
}

async function sessionSummary({ turn, turnLedger }: JsonObject) {
  const previousTurns = await turnLedger.readTurns({ sessionId: turn.sessionId, count: 20 });
  const lines = previousTurns
    .filter((item: JsonObject) => item.input?.text && item.input.text !== turn.input.text)
    .slice(-8)
    .map((item: JsonObject) => `- ${item.input.text} -> ${item.status}`);
  const summary = lines.length ? lines.join("\n") : "No prior turns in this session.";
  return toolResult("memory", {
    summary,
    result: {
      operation: "session.summary",
      eventsReadCount: previousTurns.length,
    },
    evidence: {
      sessionId: turn.sessionId,
      summaryResult: "ok",
      noMemoryWrite: true,
    },
  });
}

async function recentFailureDiagnostics({ turn, turnLedger, metricsLedger }: JsonObject) {
  const previousTurns = await turnLedger.readTurns({ sessionId: turn.sessionId, count: 50 });
  const metricsReport = await metricsLedger.report?.(200, { sessionId: turn.sessionId });
  const failedTurn = [...previousTurns].reverse().find((item: JsonObject) => item.status === "failed" || item.ok === false);
  const failedMetric = [...(metricsReport?.events || [])].reverse().find((item: JsonObject) => item.ok === false);
  const operation = failedMetric?.operation || failedTurn?.steps?.findLast?.((step: JsonObject) => step.status === "failed")?.kind || "none-found";
  const summary = failedTurn || failedMetric
    ? `Recent failure: ${operation}.`
    : "No recent failure found in local ledgers.";
  return toolResult("diagnostics", {
    summary,
    result: {
      operation: "diagnostics.recent_failure",
    },
    evidence: {
      diagnosticSummary: summary,
      traceIdOrBuildId: failedMetric?.traceId || failedMetric?.buildId || failedTurn?.turnId || "not-found",
      failedOperation: operation,
      errorMessage: String(failedMetric?.error || failedTurn?.error || failedTurn?.userSummary || "none").slice(0, 500),
      repairOptions: ["inspect referenced trace", "rerun only after explicit user confirmation"],
    },
  });
}

function policyDecision({ intent, text }: JsonObject) {
  const actionIds = policyActionIdsForIntent(intent) || [];
  const pending = actionIds.map((actionId: string) => ({
    schema: "walnutpi.action-policy-decision.v1",
    actionId,
    allow: false,
    status: "pending",
    reason: "opa-policy-not-wired",
    requirements: {
      approval: {
        required: true,
        kind: "explicit-user-confirmation",
      },
    },
    evidence: {
      kind: "pending-local-action",
      actionId,
    },
  }));
  return toolResult("policy", {
    ok: true,
    summary: "Policy requests are pending until the OPA decision layer is wired.",
    result: {
      operation: "policy.decision",
      decisions: pending,
    },
    evidence: {
      policyDecisionEvidence: pending,
      pendingLocalAction: pending.length > 0,
      noCommandExecution: true,
      noRemoteCommandExecution: true,
      userRequest: text,
    },
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

function normalizeActionSideEffects(value: any) {
  const sideEffects = Array.isArray(value) ? value : value ? [value] : [];
  return sideEffects.map((item: JsonObject) => ({
    kind: String(item?.kind || "").trim(),
    target: String(item?.target || "unknown").trim() || "unknown",
    status: String(item?.status || "observed").trim() || "observed",
  })).filter((item: JsonObject) => item.kind);
}

function cleanOptionalText(value: any) {
  return String(value || "").trim();
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function objectOrNull(value: any): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function statusError(status: number, message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

import { actionIdForIntent, policyActionIdsForIntent } from "../action-registry.ts";
import { type WalnutToolResult, failedToolResult, toolResult } from "../walnut-tool-results.ts";

type JsonObject = Record<string, any>;

export function createToolDispatcher({
  actionDispatcher,
  screenCommandRunner,
  turnLedger,
  metricsLedger,
}: JsonObject) {
  async function dispatchIntent({
    classification,
    body,
    turn,
  }: {
    classification: JsonObject;
    body: JsonObject;
    turn: JsonObject;
  }): Promise<WalnutToolResult> {
    const intent = String(classification?.intent || "");
    const specialHandler = SPECIAL_INTENT_HANDLERS[intent];
    if (specialHandler) return specialHandler({ body, turn, classification, intent });

    if (intent.startsWith("policy.")) return handlePolicyIntent(intent, body);

    const actionId = actionIdForIntent(intent) || (classification?.route === "ai.chat" ? "ai" : null);
    if (!actionId) {
      return failedToolResult("diagnostics", `No platform tool is registered for intent ${intent || "(missing)"}`, {
        operation: "tool.dispatch",
      });
    }

    const response = await actionDispatcher.runAction({
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

  async function readScreenFrame() {
    const capture = await screenCommandRunner.run({ kind: "screen.captureFrame" });
    return toolResult("screen", {
      ok: capture.ok,
      summary: capture.ok
        ? "Read-only screen frame evidence captured through the Screen Command DSL."
        : capture.summary,
      result: {
        operation: "screen.state_frame.read",
        capture: capture.result?.capture || null,
      },
      evidence: {
        ...capture.evidence,
        noScreenSync: true,
        noServiceRestart: true,
        readOnlyDeviceProbe: true,
      },
      diagnostics: capture.diagnostics,
    });
  }

  async function syncScreen(body: JsonObject) {
    const playlistHash = String(body.playlistHash || "").trim();
    const mode = body.mode === "preview" || body.previewOnly === true ? "preview" : "remote";
    if (!playlistHash) {
      const read = await screenCommandRunner.run({ kind: "screen.readPlaylist", playlistId: "default" });
      const hash = read.result?.playlistHash || read.evidence?.playlistHash;
      if (!hash) return failedToolResult("screen", "Current playlist hash is unavailable.");
      return screenCommandRunner.run({
        kind: "screen.syncPlaylist",
        playlistId: "default",
        playlistHash: hash,
        evidenceMode: body.evidenceMode === "full" ? "full" : "fast",
        mode,
      });
    }
    return screenCommandRunner.run({
      kind: "screen.syncPlaylist",
      playlistId: "default",
      playlistHash,
      evidenceMode: body.evidenceMode === "full" ? "full" : "fast",
      mode,
    });
  }

  const SPECIAL_INTENT_HANDLERS: Record<string, (args: { body: JsonObject; turn: JsonObject; classification: JsonObject; intent: string }) => WalnutToolResult | Promise<WalnutToolResult>> = {
    "session.summary": ({ turn }) => sessionSummary(turn),
    "memory.preference": ({ body, turn }) => memoryPreference(body, turn),
    "memory.sensitive_skip": ({ body, turn }) => memorySensitiveSkip(body, turn),
    "diagnostics.recent_failure": ({ turn }) => recentFailure(turn),
    "screen.state_frame.read": () => readScreenFrame(),
    "screen.sync": ({ body }) => syncScreen(body),
    "screen.generate": ({ intent }) => screenGenerationRequiresDslSource(intent),
    "screen.widget_app.create": ({ intent }) => screenGenerationRequiresDslSource(intent),
  };

  function handlePolicyIntent(intent: string, body: JsonObject) {
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
        userRequest: body.text,
      },
    });
  }

  function screenGenerationRequiresDslSource(intent: string) {
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

  async function memoryPreference(body: JsonObject, turn: JsonObject) {
    return toolResult("memory", {
      summary: "Captured a durable memory candidate. No write was committed.",
      result: {
        operation: "memory.preference",
        candidate: String(body.text || "").trim(),
      },
      evidence: {
        memoryUpdateCandidateOrConfirmation: { ok: true, writeState: "candidate", text: String(body.text || "").trim() },
        memoryCategoryKey: "preferences.screen_generation",
        sourceSessionId: turn.sessionId || "unknown-session",
        noDurableMemoryWrite: true,
      },
    });
  }

  async function memorySensitiveSkip(body: JsonObject, turn: JsonObject) {
    return toolResult("memory", {
      summary: "Rejected sensitive temporary content for durable memory.",
      result: {
        operation: "memory.sensitive_skip",
      },
      evidence: {
        memorySkipEvidence: { ok: true, reason: "sensitive-temporary", textLength: String(body.text || "").trim().length },
        sensitiveMemoryRejection: true,
        sessionSafetySummary: { sessionId: turn.sessionId || "unknown-session", noDurableMemoryWrite: true },
      },
    });
  }

  async function sessionSummary(turn: JsonObject) {
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

  async function recentFailure(turn: JsonObject) {
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

  return {
    dispatchIntent,
    readScreenFrame,
    syncScreen,
    memoryPreference,
    memorySensitiveSkip,
    sessionSummary,
    recentFailure,
  };
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeActionSideEffects(value: any) {
  const sideEffects = Array.isArray(value) ? value : value ? [value] : [];
  return sideEffects
    .map((item: JsonObject) => ({
      kind: String(item?.kind || "").trim(),
      target: String(item?.target || "unknown").trim() || "unknown",
      status: String(item?.status || "observed").trim() || "observed",
    }))
    .filter((item: JsonObject) => item.kind);
}

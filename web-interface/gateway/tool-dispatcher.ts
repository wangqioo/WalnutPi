import { type WalnutToolResult, failedToolResult, toolResult } from "../walnut-tool-results.ts";
import { createMemoryProductStateStore } from "../platform/memory/product-state-store.ts";
import { createActionApprovalService } from "../platform/policy/action-approval-service.ts";
import { createWalnutMastraAgentApi } from "../mastra-agent-api.ts";

type JsonObject = Record<string, any>;

export function createToolDispatcher({
  actionDispatcher,
  screenCommandRunner,
  turnLedger,
  metricsLedger,
  policyManifest,
  opaEnforcer,
  auditLedger,
  memoryStore = createMemoryProductStateStore(),
  actionApprovalStore,
  actionApprovalService = createActionApprovalService({
    approvalStore: actionApprovalStore,
    auditLedger,
    opaEnforcer,
    policyManifest,
  }),
}: JsonObject) {
  async function callTool(toolName: string, params: JsonObject, turn: JsonObject) {
    if (!toolName) return failedToolResult("diagnostics", "Tool name is required");
    if (toolName.startsWith("ai.")) return handleChatTool(toolName, params, turn);
    if (toolName.startsWith("policy.")) {
      return handlePolicyTool(toolName, params, turn);
    }
    if (toolName.startsWith("screen.")) return handleScreenTool(toolName, params, turn);
    if (toolName.startsWith("memory.")) return handleMemoryTool(toolName, params, turn);
    if (toolName.startsWith("diagnostics.")) return handleDiagnosticsTool(toolName, params, turn);
    if (toolName.startsWith("device.")) {
      return runPolicyGatedAction({
        actionId: mapToolToActionId(toolName),
        body: params,
        turn,
        operation: "device.action",
      });
    }
    return failedToolResult("diagnostics", `Unsupported tool group for ${toolName}`);
  }

  async function handleChatTool(toolName: string, params: JsonObject, turn: JsonObject) {
    if (toolName !== "ai.chat") return failedToolResult("chat", `Unknown chat tool ${toolName}`);
    const text = String(params.text || turn.input?.text || "").trim();
    if (!text) return failedToolResult("chat", "Chat text is required.");
    const response = await createWalnutMastraAgentApi().createChatResponse({
      messages: [{ role: "user", content: text }],
      telemetry: {
        sessionId: turn.sessionId || null,
        turnId: turn.turnId || null,
      },
    });
    const data = await response.json();
    return toolResult("chat", {
      ok: Boolean(data.ok),
      summary: String(data.text || data.error || "Chat response completed."),
      result: {
        operation: "ai.chat",
        responseSchema: data.schema || null,
        text: data.text || "",
      },
      evidence: {
        mastraAgent: "chat",
        noCommandExecution: true,
        noRemoteCommandExecution: true,
      },
      diagnostics: {
        operation: "ai.chat",
      },
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
        operation: "screen.captureFrame",
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

  async function syncScreen(body: JsonObject, turn: JsonObject) {
    const policy = await decideToolPolicy({
      actionId: "screen_sync_playlist",
      params: body,
      turn,
      operation: "screen.syncPlaylist",
    });
    if (!policy.allow) return policy.result;
    const playlistHash = String(body.playlistHash || "").trim();
    const mode = body.mode === "preview" || body.previewOnly === true ? "preview" : "remote";
    if (!playlistHash) {
      const read = await screenCommandRunner.run({ kind: "screen.readPlaylist", playlistId: "default" });
      const hash = read.result?.playlistHash || read.evidence?.playlistHash;
      if (!hash) return failedToolResult("screen", "Current playlist hash is unavailable.");
      return withPolicyDecision(await screenCommandRunner.run({
        kind: "screen.syncPlaylist",
        playlistId: "default",
        playlistHash: hash,
        evidenceMode: body.evidenceMode === "full" ? "full" : "fast",
        mode,
      }), policy.decision);
    }
    return withPolicyDecision(await screenCommandRunner.run({
      kind: "screen.syncPlaylist",
      playlistId: "default",
      playlistHash,
      evidenceMode: body.evidenceMode === "full" ? "full" : "fast",
      mode,
    }), policy.decision);
  }

  async function decideToolPolicy({
    actionId,
    params,
    turn,
    operation,
  }: {
    actionId: string;
    params: JsonObject;
    turn: JsonObject;
    operation: string;
  }) {
    const decision = await (opaEnforcer.decideActionAsync?.({
      manifest: policyManifest,
      executor: "web",
      actionId,
      params,
      ...policyContextForTurn(turn),
    }) || opaEnforcer.decideAction({
      manifest: policyManifest,
      executor: "web",
      actionId,
      params,
    }));
    await auditLedger?.append?.({
      kind: "gateway.policy",
      operation: "gateway.policy",
      ok: Boolean(decision?.allow),
      status: decision?.status === "pending" ? 409 : decision?.allow ? 200 : 400,
      decisionId: decision?.decisionId || null,
      actionId,
      toolOperation: operation,
      turnId: turn.turnId || null,
      sessionId: turn.sessionId || null,
      traceId: turn.traceId || null,
      subjectKind: turn.auth?.subject?.kind || null,
      deviceProfile: turn.auth?.environment?.deviceProfile || null,
      decision,
    });
    if (decision?.status === "refused") {
      return {
        allow: false,
        result: failedToolResult("policy", "Tool call refused by policy.", {
          actionId,
          operation,
          reason: decision.reason,
          policyDecision: opaEnforcer.publicDecision(decision),
        }),
      };
    }
    if (decision?.status === "pending") {
      return {
        allow: false,
        result: toolResult("policy", {
          ok: true,
          summary: "Tool call requires explicit confirmation.",
          result: {
            operation: "policy.decision",
            decision: opaEnforcer.publicDecision(decision),
          },
          evidence: {
            pendingLocalAction: true,
            noCommandExecution: true,
            noRemoteCommandExecution: true,
            policyDecision: opaEnforcer.publicDecision(decision),
          },
        }),
      };
    }
    return {
      allow: true,
      decision,
    };
  }

  function withPolicyDecision(result: WalnutToolResult, decision: JsonObject) {
    return {
      ...result,
      evidence: {
        ...objectOrEmpty(result.evidence),
        policyDecision: opaEnforcer.publicDecision(decision),
      },
      diagnostics: {
        ...objectOrEmpty(result.diagnostics),
        policyDecisionId: decision?.decisionId || null,
      },
    };
  }

  async function runPolicyGatedAction({
    actionId,
    body,
    turn,
    operation,
    committedPolicyDecision = null,
  }: {
    actionId: string;
    body: JsonObject;
    turn: JsonObject;
    operation: string;
    committedPolicyDecision?: JsonObject | null;
  }) {
    const decision = committedPolicyDecision || await (opaEnforcer.decideActionAsync?.({
      manifest: policyManifest,
      executor: "web",
      actionId,
      params: body,
      ...policyContextForTurn(turn),
    }) || opaEnforcer.decideAction({
      manifest: policyManifest,
      executor: "web",
      actionId,
      params: body,
    }));
    await auditLedger?.append?.({
      kind: "gateway.policy",
      operation: "gateway.policy",
      ok: Boolean(decision?.allow),
      status: decision?.status === "pending" ? 409 : decision?.allow ? 200 : 400,
      decisionId: decision?.decisionId || null,
      actionId,
      turnId: turn.turnId || null,
      sessionId: turn.sessionId || null,
      traceId: turn.traceId || null,
      subjectKind: turn.auth?.subject?.kind || null,
      deviceProfile: turn.auth?.environment?.deviceProfile || null,
      decision,
    });
    if (decision?.status === "refused") {
      return failedToolResult("policy", "Action refused by policy.", {
        actionId,
        reason: decision.reason,
        policyDecision: opaEnforcer.publicDecision(decision),
      });
    }
    if (decision?.status === "pending") {
      return toolResult("policy", {
        ok: true,
        summary: "Action requires explicit confirmation.",
        result: {
          operation: "policy.decision",
          decision: opaEnforcer.publicDecision(decision),
        },
        evidence: {
          pendingLocalAction: true,
          noCommandExecution: true,
          policyDecision: opaEnforcer.publicDecision(decision),
        },
      });
    }
    const response = await actionDispatcher.runAction({
      ...body,
      action: actionId,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      text: body.text,
      requirements: body.requirements,
      policyDecision: decision,
    });
    const payload = objectOrEmpty(response.body);
    const diagnostics = objectOrEmpty(payload.diagnostics);
    return toolResult(actionId === "ai" ? "chat" : "device", {
      ok: Boolean(payload.ok),
      summary: payload.summary || payload.reply || payload.output || "",
      result: {
        operation,
        actionId,
        status: response.status || 500,
        code: payload.code ?? null,
        remoteOk: typeof payload.remoteOk === "boolean" ? payload.remoteOk : null,
        output: payload.output || null,
        policyDecision: objectOrEmpty(payload.policyDecision),
        contextUsed: payload.contextUsed || null,
        diagnostics: {
          traceId: diagnostics.traceId || null,
          policyDecisionId: diagnostics.policyDecisionId || null,
        },
      },
      evidence: objectOrEmpty(payload.evidence || payload.actionEvidence),
      sideEffects: normalizeActionSideEffects(payload.sideEffects),
      diagnostics,
    });
  }

  async function handlePolicyTool(toolName: string, body: JsonObject, turn: JsonObject) {
    if (toolName === "policy.action.prepare") return actionApprovalService.prepare(body, turn);
    if (toolName === "policy.action.commit") {
      const committed = await actionApprovalService.commitForExecution(body, turn);
      const committedResult = committed.toolResult;
      if (!committedResult.ok || committedResult.result?.committed !== true) return committedResult;
      if (body.execute !== true) return committedResult;
      if (!committed.executionDecision?.allow) return committedResult;
      const actionId = committedResult.result.actionId;
      if (isHighRiskAction(actionId)) {
        return toolResult("policy", {
          ok: false,
          summary: "High-risk approved action commit recorded; direct web execution remains blocked.",
          result: {
            operation: "policy.action.commit",
            actionId,
            committed: true,
            executed: false,
            reason: "high-risk-direct-execution-blocked",
            decision: committedResult.result.decision,
          },
          evidence: {
            approvalCommitted: true,
            highRiskDirectExecutionBlocked: true,
            noCommandExecution: true,
            noRemoteCommandExecution: true,
            policyDecision: committedResult.result.decision,
          },
          diagnostics: committedResult.diagnostics,
        });
      }
      return runPolicyGatedAction({
        actionId,
        body: objectOrEmpty(committedResult.result.params),
        turn,
        operation: "device.action",
        committedPolicyDecision: committed.executionDecision,
      });
    }
    return failedToolResult("policy", `Unknown policy tool ${toolName}`);
  }

  async function memoryPreference(body: JsonObject, turn: JsonObject) {
    const captured = await memoryStore.capturePreferenceCandidate({
      text: body.text,
      sessionId: turn.sessionId || "unknown-session",
      turnId: turn.turnId || null,
    });
    return toolResult("memory", {
      summary: "Captured a durable memory candidate. No write was committed.",
      result: {
        operation: "memory.preference",
        candidateId: captured.candidateId || null,
        candidate: captured.candidateText,
        persisted: Boolean(captured.persisted),
      },
      evidence: {
        memoryUpdateCandidateOrConfirmation: {
          ok: true,
          writeState: "candidate",
          candidateId: captured.candidateId || null,
          text: captured.candidateText,
          persisted: Boolean(captured.persisted),
        },
        memoryCategoryKey: captured.categoryKey || "preferences.screen_generation",
        sourceSessionId: turn.sessionId || "unknown-session",
        sourceTurnId: turn.turnId || null,
        noDurableMemoryWrite: true,
        dbProductState: {
          boundaryReached: true,
          persisted: Boolean(captured.persisted),
          skipped: Boolean(captured.skipped),
          reason: captured.reason || null,
        },
      },
    });
  }

  async function memoryApprove(body: JsonObject, turn: JsonObject) {
    const approved = await memoryStore.approveCandidate({
      candidateId: body.candidateId,
      subject: objectOrEmpty(turn.auth?.subject),
    });
    if (!approved.ok) {
      return toolResult("memory", {
        ok: false,
        summary: `Durable memory approval failed: ${approved.reason || "unknown"}.`,
        result: {
          operation: "memory.approve",
          candidateId: body.candidateId || null,
          persisted: Boolean(approved.persisted),
          reason: approved.reason || null,
        },
        evidence: {
          durableMemoryApprovalRejected: true,
          noRawSessionIndexing: true,
          noRawDailyNotesIndexing: true,
          dbProductState: {
            boundaryReached: true,
            persisted: Boolean(approved.persisted),
            skipped: Boolean(approved.skipped),
            reason: approved.reason || null,
          },
        },
      });
    }
    return toolResult("memory", {
      summary: "Approved durable memory was persisted through the DB product-state path.",
      result: {
        operation: "memory.approve",
        recordId: approved.recordId,
        candidateId: approved.candidateId,
        categoryKey: approved.categoryKey,
        memoryText: approved.memoryText,
        persisted: Boolean(approved.persisted),
      },
      evidence: {
        durableMemoryWrite: {
          ok: true,
          writeState: "approved",
          recordId: approved.recordId,
          candidateId: approved.candidateId,
          categoryKey: approved.categoryKey,
          persisted: Boolean(approved.persisted),
        },
        noRawSessionIndexing: true,
        noRawDailyNotesIndexing: true,
        dbProductState: {
          boundaryReached: true,
          persisted: Boolean(approved.persisted),
          skipped: false,
          reason: null,
        },
      },
    });
  }

  async function memorySensitiveSkip(body: JsonObject, turn: JsonObject) {
    const skipped = await memoryStore.recordSensitiveSkip({
      text: body.text,
      sessionId: turn.sessionId || "unknown-session",
      turnId: turn.turnId || null,
    });
    return toolResult("memory", {
      summary: "Rejected sensitive temporary content for durable memory.",
      result: {
        operation: "memory.sensitive_skip",
        textHash: skipped.textHash,
        textLength: skipped.textLength,
        persisted: Boolean(skipped.persisted),
      },
      evidence: {
        memorySkipEvidence: {
          ok: true,
          reason: skipped.reason,
          textHash: skipped.textHash,
          textLength: skipped.textLength,
          persisted: Boolean(skipped.persisted),
        },
        sensitiveMemoryRejection: true,
        sessionSafetySummary: { sessionId: turn.sessionId || "unknown-session", noDurableMemoryWrite: true },
        dbProductState: {
          boundaryReached: true,
          persisted: Boolean(skipped.persisted),
          skipped: Boolean(skipped.skipped),
          reason: skipped.writeReason || null,
        },
      },
    });
  }

  async function sessionSummary(turn: JsonObject) {
    const session = await memoryStore.summarizeSession({
      sessionId: turn.sessionId,
      turnLedger,
      inputText: turn.input?.text,
    });
    return toolResult("memory", {
      summary: session.summary,
      result: {
        operation: "session.summary",
        eventsReadCount: session.eventsReadCount,
        source: session.source,
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

  async function handleScreenTool(toolName: string, params: JsonObject, turn: JsonObject) {
    if (toolName === "screen.readPlaylist") {
      return screenCommandRunner.run({ kind: "screen.readPlaylist", playlistId: params.playlistId || "default" });
    }
    if (toolName === "screen.captureFrame") {
      return screenCommandRunner.run({ kind: "screen.captureFrame", buildId: params.buildId || undefined });
    }
    if (toolName === "screen.syncPlaylist") {
      return syncScreen(params, turn);
    }
    if (toolName === "screen.renderWallpaper") {
      return screenCommandRunner.run({
        kind: "screen.renderWallpaper",
        source: objectOrEmpty(params.source),
        screenId: params.screenId,
        preset: params.preset || "fit-cover:480x320",
        outputType: params.outputType || "static",
        title: params.title || undefined,
        description: params.description || undefined,
      });
    }
    if (toolName === "screen.writePlaylist") {
      const policy = await decideToolPolicy({
        actionId: "screen_write_playlist",
        params,
        turn,
        operation: "screen.writePlaylist",
      });
      if (!policy.allow) return policy.result;
      return withPolicyDecision(await screenCommandRunner.run({
        kind: "screen.writePlaylist",
        playlistId: params.playlistId || "default",
        manifestId: params.manifestId,
        mode: params.mode,
        durationMs: Number(params.durationMs || 8000),
        loop: params.loop !== undefined ? Boolean(params.loop) : true,
      }), policy.decision);
    }
    if (toolName === "screen.widgetApp.sync") {
      return syncWidgetApp(params, turn);
    }
    if (toolName === "screen.widgetApp.action") {
      return runWidgetAppAction(params, turn);
    }
    return failedToolResult("screen", `Unknown screen tool ${toolName}`);
  }

  async function syncWidgetApp(body: JsonObject, turn: JsonObject) {
    const policy = await decideToolPolicy({
      actionId: "screen_widget_app_sync",
      params: {
        appId: cleanOptionalId(body.appId),
        versionId: cleanOptionalText(body.versionId),
        evidenceMode: body.evidenceMode === "full" ? "full" : "fast",
      },
      turn,
      operation: "screen.widgetApp.sync",
    });
    if (!policy.allow) return policy.result;
    return widgetAppDeviceBoundaryResult({
      operation: "screen.widgetApp.sync",
      summary: "Widget App sync reached MCP/OPA and failed closed at the typed device boundary.",
      actionId: "screen_widget_app_sync",
      params: body,
      turn,
      policyDecision: policy.decision,
      sideEffects: [],
    });
  }

  async function runWidgetAppAction(body: JsonObject, turn: JsonObject) {
    const widgetAction = cleanOptionalText(body.action || body.name || body.actionId);
    if (!widgetAction) return failedToolResult("screen", "Widget App action is required.");
    const actionId = mapWidgetAppActionToPolicyAction(widgetAction);
    if (!actionId) {
      return toolResult("screen", {
        ok: false,
        summary: "Widget App action is not registered as a platform policy action.",
        result: {
          operation: "screen.widgetApp.action",
          action: widgetAction,
          executed: false,
          reason: "unknown-widget-platform-action",
        },
        evidence: {
          refusedWidgetAppAction: true,
          policyGatedPlatformToolRequired: true,
          noCommandExecution: true,
          noRemoteCommandExecution: true,
        },
        diagnostics: {
          operation: "screen.widgetApp.action",
        },
      });
    }
    const policy = await decideToolPolicy({
      actionId,
      params: objectOrEmpty(body.params),
      turn,
      operation: "screen.widgetApp.action",
    });
    if (!policy.allow) return policy.result;
    return widgetAppDeviceBoundaryResult({
      operation: "screen.widgetApp.action",
      summary: "Widget App action reached MCP/OPA and failed closed at the typed device boundary.",
      actionId,
      params: objectOrEmpty(body.params),
      turn,
      policyDecision: policy.decision,
      sideEffects: actionId === "refresh_device_status" ? [] : [{ kind: "device-action", target: "widget-app", status: "blocked" }],
    });
  }

  async function handleMemoryTool(toolName: string, params: JsonObject, turn: JsonObject) {
    if (toolName === "memory.sessionSummary") return sessionSummary(turn);
    if (toolName === "memory.preference") return memoryPreference(params, turn);
    if (toolName === "memory.approve") return memoryApprove(params, turn);
    if (toolName === "memory.sensitiveSkip") return memorySensitiveSkip(params, turn);
    return failedToolResult("memory", `Unknown memory tool ${toolName}`);
  }

  async function handleDiagnosticsTool(toolName: string, _params: JsonObject, turn: JsonObject) {
    if (toolName === "diagnostics.recentFailure") return recentFailure(turn);
    return failedToolResult("diagnostics", `Unknown diagnostics tool ${toolName}`);
  }

  function mapToolToActionId(toolName: string) {
    if (toolName === "device.status.read") return "status";
    if (toolName === "device.network.read") return "network";
    if (toolName === "device.snapshot.read") return "snapshot";
    if (toolName === "device.i2c.read") return "i2c_scan";
    if (toolName === "device.gpio.read") return "gpio";
    if (toolName === "device.notes.read") return "notes";
    if (toolName === "device.note.write") return "note";
    return toolName;
  }

  function widgetAppDeviceBoundaryResult({
    operation,
    summary,
    actionId,
    params,
    turn,
    policyDecision,
    sideEffects,
  }: {
    operation: string;
    summary: string;
    actionId: string;
    params: JsonObject;
    turn: JsonObject;
    policyDecision: JsonObject;
    sideEffects: Array<{ kind: string; target: string; status: string }>;
  }) {
    const current = {
      appId: cleanOptionalId(params.appId) || null,
      versionId: cleanOptionalText(params.versionId) || null,
    };
    return toolResult("screen", {
      ok: false,
      summary,
      result: {
        operation,
        actionId,
        current,
        executed: false,
        reason: "widget-app-device-delivery-not-implemented",
        policyDecision: opaEnforcer.publicDecision(policyDecision),
      },
      evidence: {
        deviceBoundaryReached: true,
        deviceBoundaryRequired: true,
        policyGatedPlatformToolRequired: false,
        noCommandExecution: true,
        noRemoteCommandExecution: true,
        noRawCommandExposure: true,
        policyDecision: opaEnforcer.publicDecision(policyDecision),
        requestContext: {
          sessionId: turn.sessionId || null,
          turnId: turn.turnId || null,
        },
      },
      sideEffects,
      diagnostics: {
        operation,
        policyDecisionId: policyDecision?.decisionId || null,
      },
    });
  }

  function mapWidgetAppActionToPolicyAction(actionName: string) {
    const normalized = cleanOptionalText(actionName);
    const known = new Set([
      "refresh_device_status",
      "restart_walnut_screen_service",
      "reboot_device",
    ]);
    return known.has(normalized) ? normalized : null;
  }

  function isHighRiskAction(actionId: string) {
    const action = policyManifest?.actions?.[actionId];
    return action?.risk === "high"
      || action?.confirmationRequired === true
      || action?.mode === "confirmable"
      || ["restart_walnut_screen_service", "reboot", "reboot_device", "shutdown", "package-install", "storage-delete", "image-flash"].includes(actionId);
  }

  function objectOrEmpty(value: any): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function cleanOptionalText(value: any) {
    return String(value || "").trim();
  }

  function cleanOptionalId(value: any) {
    const text = cleanOptionalText(value);
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,96}$/.test(text) ? text : "";
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

  function policyContextForTurn(turn: JsonObject) {
    return {
      subject: objectOrEmpty(turn.auth?.subject),
      environment: objectOrEmpty(turn.auth?.environment),
      requestContext: {
        sessionId: turn.sessionId || null,
        turnId: turn.turnId || null,
        traceId: turn.traceId || null,
      },
    };
  }

  return {
    callTool,
  };
}

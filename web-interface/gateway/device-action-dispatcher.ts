import { randomUUID } from "node:crypto";
import { actionSummary } from "../action-policy.ts";
import { decisionActionSummary } from "../action-policy-decision.ts";

type TimingSegments = Record<string, number | null | undefined>;
type JsonObject = Record<string, any>;
type ActionResponseBody = Record<string, any> & {
  diagnostics?: Record<string, any>;
  nextTasks?: any[];
  ok: boolean;
};

const SIDE_EFFECTS_BY_ACTION_ID = {
  note: [{ kind: "daily-note-write", target: "daily-note", status: "observed" }],
  restart_walnut_screen_service: [{ kind: "service-restart", target: "walnut-screen.service", status: "observed" }],
  reboot: [{ kind: "reboot", target: "device", status: "observed" }],
  reboot_device: [{ kind: "reboot", target: "device", status: "observed" }],
  "package-install": [{ kind: "package-install", target: "device", status: "observed" }],
};

export function createDeviceActionDispatcher({
  policyManifest,
  policyActions,
  actionRegistry,
  opaEnforcer,
  auditLedger,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
  json,
}: JsonObject) {
  let resolvedActions = null;
  let actionsLoadPromise = null;

  async function getActions() {
    if (!actionRegistry) throw new Error("action registry is required");
    if (resolvedActions) return resolvedActions;
    if (!actionsLoadPromise) {
      actionsLoadPromise = (async () => {
        const result = await actionRegistry.buildAllWebActions();
        resolvedActions = result;
        return result;
      })();
    }
    return actionsLoadPromise;
  }

  return {
    actionPolicyView({ target, manifest }: JsonObject) {
      const src = manifest?.actions || policyActions || {};
      return {
        schema: "walnutpi.webActionPolicyView.v1",
        target,
        actionPolicyManifest: manifest,
        actions: Object.fromEntries(
          Object.entries(src).map(([id, action]) => [id, actionSummary(action as any, id)]),
        ),
      };
    },

    async runAction(body: JsonObject, requestSegments: TimingSegments = {}) {
      const startedAt = Date.now();
      const traceId = randomUUID();
      const segments: TimingSegments = { ...requestSegments };

      const id = String(body.action || "");
      const turnId = body.turnId || null;
      const sessionId = webSessionLedger.safeSessionId(body.sessionId);
      let decision = body.policyDecision || null;
      try {
        if (!decision) {
          decision = opaEnforcer.decideAction({
            manifest: policyManifest,
            executor: "web",
            actionId: id,
            params: body,
          });
        }
      } catch (error: any) {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 400,
          latencyMs: elapsedSince(startedAt),
          action: id || "unknown",
          traceId,
          sessionId,
          turnId,
          span: "total",
          segments,
          error: error.message,
        });
        await auditLedger?.append?.({
          kind: "action.policy",
          operation: "action.policy",
          ok: false,
          status: 400,
          traceId,
          sessionId,
          turnId,
          actionId: id,
          error: error.message,
        });
        return { body: { ok: false, error: error.message }, status: 400 };
      }
      await auditLedger?.append?.({
        kind: "action.policy",
        operation: "action.policy",
        ok: Boolean(decision?.allow),
        status: decision?.allow ? 200 : decision?.status === "pending" ? 409 : 400,
        traceId,
        sessionId,
        turnId,
        actionId: id,
        decision,
      });
      if (decision?.status === "refused") {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 400,
          latencyMs: elapsedSince(startedAt),
          action: id || "unknown",
          traceId,
          sessionId,
          turnId,
          span: "total",
          segments,
          error: decision?.reason || "unknown action",
        });
        return {
          body: {
            ok: false,
            error: "未知或未允许的动作。",
            policyDecision: opaEnforcer.publicDecision(decision),
          },
          status: 400,
        };
      }
      if (decision?.status === "pending") {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 409,
          latencyMs: elapsedSince(startedAt),
          action: id,
          mode: decision.action?.mode || "confirmable",
          traceId,
          sessionId,
          turnId,
          span: "total",
          segments,
          error: "confirmation required",
        });
        return {
          body: {
            ok: false,
            status: "pending",
            ...decisionActionSummary(decision),
            error: "动作需要显式确认，Web 动作 surface 不直接执行。",
            policyDecision: opaEnforcer.publicDecision(decision),
          },
          status: 409,
        };
      }

      const allActions = await getActions();
      const action = allActions[id];
      if (!action) {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 400,
          latencyMs: elapsedSince(startedAt),
          action: id || "unknown",
          traceId,
          sessionId,
          turnId,
          span: "total",
          segments,
          error: "web action missing after policy allow",
        });
        return {
          body: {
            ok: false,
            error: "动作未配置 Web 执行器。",
            policyDecision: opaEnforcer.publicDecision(decision),
          },
          status: 400,
        };
      }

      let command = action.command;
      let contextUsed = null;
      const actionParams = decision?.parameterValues || body;
      try {
        if (action.buildCommand) {
          const buildCommandStartedAt = Date.now();
          const built = await action.buildCommand(actionParams);
          segments.buildCommandMs = elapsedSince(buildCommandStartedAt);
          if (typeof built === "string") {
            command = built;
          } else if (built && typeof built === "object") {
            command = built.command;
            contextUsed = built.contextUsed || null;
          }
        }
      } catch (error: any) {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 400,
          latencyMs: elapsedSince(startedAt),
          action: id,
          mode: action.mode,
          traceId,
          sessionId,
          turnId,
          span: "total",
          inputChars: typeof body.text === "string" ? body.text.length : null,
          segments,
          error: error.message,
        });
        return { body: { ok: false, error: error.message }, status: 400 };
      }

      if (action.mode === "terminal") {
        return runTerminalAction({
          action,
          id,
          command,
          startedAt,
          traceId,
          segments,
          sessionId,
          turnId,
          walnutRemote,
          webSessionLedger,
          webMetricsLedger,
          auditLedger,
          limitedOutput,
          policyDecision: decision,
        });
      }

      const remoteStartedAt = Date.now();
      const result = await runRemote(command, action.timeoutMs);
      segments.preflightMs = result.preflightMs ?? null;
      segments.remoteMs = result.remoteMs ?? elapsedSince(remoteStartedAt);
      const outputFailed = id === "ai" && aiActionOutputFailed(result.output);
      let actionEvidence = null;
      let output = result.output;
      let remoteOk = result.ok;
      if (action.parseJsonOutput && result.output) {
        const parseStartedAt = Date.now();
        try {
          actionEvidence = JSON.parse(result.output);
          if (typeof actionEvidence?.output === "string") output = actionEvidence.output;
          if (typeof actionEvidence?.ok === "boolean") remoteOk = result.ok && actionEvidence.ok;
        } catch {
          actionEvidence = null;
        } finally {
          segments.parseMs = elapsedSince(parseStartedAt);
        }
      }
      const responseBody: ActionResponseBody = {
        ok: remoteOk && !outputFailed,
        ...actionSummary(action, id),
        policyDecision: opaEnforcer.publicDecision(decision),
        code: result.code,
        remoteOk,
        outputFailed,
        output,
        actionEvidence,
        sideEffects: sideEffectsForAction(id, action),
        contextUsed,
        diagnostics: {
          traceId,
          remoteTransport: result.remoteTransport || null,
          connectionReused: typeof result.reusedConnection === "boolean" ? result.reusedConnection : null,
          preflightEnsured: typeof result.preflightEnsured === "boolean" ? result.preflightEnsured : null,
          segments,
        },
      };
      if (isOfflineReadHonestFailure(responseBody, body)) {
        responseBody.ok = true;
        responseBody.honestFailure = {
          reason: "device-unavailable-in-offline-profile",
          output: responseBody.output,
        };
      }
      if (sessionId) {
        const sessionLogStartedAt = Date.now();
        await webSessionLedger.appendEvent(sessionId, {
          role: "action",
          action: id,
          content: output || result.output || "",
          ok: responseBody.ok,
          contextUsed,
        });
        segments.sessionLogMs = elapsedSince(sessionLogStartedAt);
      }
      const metricsStartedAt = Date.now();
      await webMetricsLedger.append({
        kind: "agent.action",
        operation: "agent.action",
        ok: responseBody.ok,
        latencyMs: elapsedSince(startedAt),
        action: id,
        mode: action.mode,
        source: contextUsed?.delegatedTo || "remote",
        traceId,
        sessionId,
        turnId,
        span: "total",
        inputChars: typeof body.text === "string" ? body.text.length : null,
        remoteTransport: result.remoteTransport,
        connectionReused: result.reusedConnection,
        preflightEnsured: result.preflightEnsured,
        segments,
        error: responseBody.ok ? null : output || result.output,
      });
      await auditLedger?.append?.({
        kind: "action.execution",
        operation: "action.execution",
        ok: responseBody.ok,
        status: responseBody.ok ? 200 : 500,
        traceId,
        sessionId,
        turnId,
        actionId: id,
        result: {
          code: result.code,
          remoteOk: result.ok,
          output: responseBody.ok ? null : output || result.output,
        },
      });
      segments.metricsMs = elapsedSince(metricsStartedAt);
      return { body: responseBody, status: 200 };
    },

    async handleAction(req: Request) {
      const startedAt = Date.now();
      const traceId = randomUUID();
      const segments: TimingSegments = {};
      let body;
      try {
        const requestJsonStartedAt = Date.now();
        body = await req.json();
        segments.requestJsonMs = elapsedSince(requestJsonStartedAt);
      } catch (error: any) {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 400,
          latencyMs: elapsedSince(startedAt),
          action: "unknown",
          traceId,
          span: "total",
          segments,
          error: error.message || "invalid json",
        });
        return json({ ok: false, error: "请求不是有效 JSON。" }, 400);
      }
      const result = await this.runAction(body, segments);
      return json(result.body, result.status);
    },
  };
}

async function runTerminalAction({
  action,
  id,
  command,
  startedAt,
  traceId,
  segments,
  sessionId,
  turnId,
  walnutRemote,
  webSessionLedger,
  webMetricsLedger,
  auditLedger,
  limitedOutput,
  policyDecision,
}: JsonObject) {
  const preflightStartedAt = Date.now();
  const ensure = await walnutRemote.ensureWalnutCli();
  segments.preflightMs = elapsedSince(preflightStartedAt);
  if (!ensure.ok) {
    const remoteTransport = ensure.remoteTransport || null;
    const connectionReused = typeof ensure.reusedConnection === "boolean" ? ensure.reusedConnection : null;
    await webMetricsLedger.append({
      kind: "agent.action",
      operation: "agent.action",
      ok: false,
      status: 500,
      latencyMs: elapsedSince(startedAt),
      action: id,
      mode: action.mode,
      traceId,
      sessionId,
      turnId,
      span: "total",
      preflightEnsured: ensure.ensured,
      remoteTransport,
      connectionReused,
      segments,
      error: "walnut cli preflight failed",
    });
    return {
      body: {
        ok: false,
        ...decisionActionSummary(policyDecision),
        policyDecision: opaPublicDecision(policyDecision),
        code: ensure.code,
        remoteOk: false,
        output: limitedOutput([
          "[walnut cli preflight failed]",
          ensure.output,
          "",
          "[terminal command skipped]",
        ].join("\n")),
        diagnostics: {
          traceId,
          remoteTransport,
          connectionReused,
          preflightEnsured: typeof ensure.ensured === "boolean" ? ensure.ensured : null,
          segments,
        },
      },
      status: 500,
    };
  }

  const responseBody = {
    ok: true,
    ...decisionActionSummary(policyDecision),
    policyDecision: opaPublicDecision(policyDecision),
    preflightOutput: ensure.ensured ? ensure.output : "",
    sideEffects: sideEffectsForAction(id, action),
  };
  if (sessionId) {
    const sessionLogStartedAt = Date.now();
    await webSessionLedger.appendEvent(sessionId, {
      role: "action",
      action: id,
      content: action.reply || "",
      ok: true,
    });
    segments.sessionLogMs = elapsedSince(sessionLogStartedAt);
  }
  const metricsStartedAt = Date.now();
  await webMetricsLedger.append({
    kind: "agent.action",
    operation: "agent.action",
    ok: true,
    latencyMs: elapsedSince(startedAt),
    action: id,
    mode: action.mode,
    source: "terminal",
    traceId,
    sessionId,
    turnId,
    span: "total",
    preflightEnsured: ensure.ensured,
    segments,
  });
  await auditLedger?.append?.({
    kind: "action.execution",
    operation: "action.execution",
    ok: true,
    status: 200,
    traceId,
    sessionId,
    turnId,
    actionId: id,
    result: {
      code: ensure.code || 0,
      output: ensure.output || "",
    },
  });
  segments.metricsMs = elapsedSince(metricsStartedAt);
  return { body: responseBody, status: 200 };
}

function elapsedSince(startedAt: number) {
  return Date.now() - startedAt;
}

function aiActionOutputFailed(output: string) {
  const firstLine = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return /^(API 请求失败|API HTTP|OPENAI_API_KEY|usage:|walnut: error:|ERR:|\[local\])/i.test(firstLine);
}

function isOfflineReadHonestFailure(responseBody: JsonObject, body: JsonObject) {
  return body?.requirements?.device === false
    && responseBody?.risk === "read"
    && responseBody?.ok === false
    && /\[walnut cli preflight failed\]|\[local\] ssh2 connection failed|command skipped/i.test(String(responseBody.output || ""));
}

function sideEffectsForAction(id: string, action: JsonObject) {
  const effects = [...(SIDE_EFFECTS_BY_ACTION_ID[id] || [])];
  if (action?.risk === "high") effects.push({ kind: "device-write", target: "device", status: "observed" });
  return dedupeSideEffects(effects);
}

function dedupeSideEffects(effects: Array<{ kind: string; target: string; status: string }>) {
  return [...new Map(effects.map((effect) => [`${effect.kind}\0${effect.target}`, effect])).values()];
}

function opaPublicDecision(decision: JsonObject) {
  return decision ? {
    schema: decision.schema,
    engine: decision.engine,
    actionId: decision.actionId,
    allow: decision.allow,
    status: decision.status,
    reason: decision.reason,
    noCommandExecution: !decision.allow,
  } : null;
}

import { actionSummary, resolveAction } from "./action-policy.ts";
import { wantsReadOnlyContinuation } from "./action-registry.ts";
import { randomUUID } from "node:crypto";

type TimingSegments = Record<string, number | null | undefined>;
type ActionResponseBody = Record<string, any> & {
  diagnostics?: Record<string, any>;
  nextTasks?: any[];
  ok: boolean;
};

function elapsedSince(startedAt) {
  return Date.now() - startedAt;
}

export function createAgentActionsApi({
  policyManifest,
  policyActions,
  actionRegistry,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
  json,
}) {
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
    actionPolicyView({ target, manifest }) {
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

    async runAction(body, requestSegments: TimingSegments = {}) {
      const startedAt = Date.now();
      const traceId = randomUUID();
      const segments: TimingSegments = { ...requestSegments };

      const id = String(body.action || "");
      const turnId = body.turnId || null;
      const sessionId = webSessionLedger.safeSessionId(body.sessionId);
      let resolved;
      try {
        resolved = policyManifest
          ? resolveAction(policyManifest, { executor: "web", actionId: id, params: body })
          : null;
      } catch (error) {
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
        return { body: { ok: false, error: error.message }, status: 400 };
      }
      const allActions = await getActions();
      const action = allActions[id];
      if (!action || resolved?.status === "refused") {
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
          error: resolved?.reason || "unknown action",
        });
        return { body: { ok: false, error: "未知或未允许的动作。" }, status: 400 };
      }
      if (resolved?.status === "pending") {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 409,
          latencyMs: elapsedSince(startedAt),
          action: id,
          mode: action.mode,
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
          ...actionSummary(action, id),
          error: "动作需要显式确认，Web 动作 surface 不直接执行。",
          },
          status: 409,
        };
      }

      let command = action.command;
      let contextUsed = null;
      const actionParams = resolved?.parameterValues || body;
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
      } catch (error) {
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
          limitedOutput,
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
        command,
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
      if (id === "snapshot" && wantsReadOnlyContinuation(body.text)) {
        responseBody.nextTasks = [{ agent: "device", kind: "action.run", action: "status" }];
      }
      if (sessionId) {
        const sessionLogStartedAt = Date.now();
        await webSessionLedger.appendEvent(sessionId, {
          role: "action",
          action: id,
          content: output || result.output || "",
          command,
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
      segments.metricsMs = elapsedSince(metricsStartedAt);
      return { body: responseBody, status: 200 };
    },

    async handleAction(req) {
      const startedAt = Date.now();
      const traceId = randomUUID();
      const segments: TimingSegments = {};
      let body;
      try {
        const requestJsonStartedAt = Date.now();
        body = await req.json();
        segments.requestJsonMs = elapsedSince(requestJsonStartedAt);
      } catch (error) {
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
  limitedOutput,
}) {
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
      ...actionSummary(action, id),
      command,
      code: ensure.code,
      remoteOk: false,
      output: limitedOutput([
        "[walnut cli preflight failed]",
        ensure.output,
        "",
        "[terminal command skipped]",
        command,
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
    ...actionSummary(action, id),
    command,
    preflightOutput: ensure.ensured ? ensure.output : "",
    sideEffects: sideEffectsForAction(id, action),
  };
  if (sessionId) {
    const sessionLogStartedAt = Date.now();
    await webSessionLedger.appendEvent(sessionId, {
      role: "action",
      action: id,
      content: action.reply || "",
      command,
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
  segments.metricsMs = elapsedSince(metricsStartedAt);
  return { body: responseBody, status: 200 };
}

function aiActionOutputFailed(output) {
  const firstLine = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return /^(API 请求失败|API HTTP|OPENAI_API_KEY|usage:|walnut: error:|ERR:|\[local\])/i.test(firstLine);
}

function isOfflineReadHonestFailure(responseBody, body) {
  return body?.requirements?.device === false
    && responseBody?.risk === "read"
    && responseBody?.ok === false
    && /\[walnut cli preflight failed\]|\[local\] ssh2 connection failed|command skipped/i.test(String(responseBody.output || ""));
}

function sideEffectsForAction(id, action) {
  const effects = [];
  if (id === "note") effects.push({ kind: "daily-note-write", target: "daily-note", status: "observed" });
  if (id === "restart_walnut_screen_service") effects.push({ kind: "service-restart", target: "walnut-screen.service", status: "observed" });
  if (id === "reboot" || id === "reboot_device") effects.push({ kind: "reboot", target: "device", status: "observed" });
  if (id === "package-install") effects.push({ kind: "package-install", target: "device", status: "observed" });
  if (action?.risk === "high") effects.push({ kind: "device-write", target: "device", status: "observed" });
  return dedupeSideEffects(effects);
}

function dedupeSideEffects(effects) {
  return [...new Map(effects.map((effect) => [`${effect.kind}\0${effect.target}`, effect])).values()];
}

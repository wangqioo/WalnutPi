import { actionSummary } from "./action-policy.js";
import { randomUUID } from "node:crypto";

function elapsedSince(startedAt) {
  return Date.now() - startedAt;
}

export function createAgentActionsApi({
  policyActions,
  walnutRemote,
  runRemote,
  webSessionLedger,
  webMetricsLedger,
  shellQuote,
  limitedOutput,
  json,
  aiTimeoutSeconds,
}) {
  const actions = buildWebActions(policyActions, { shellQuote, aiTimeoutSeconds });

  return {
    actionPolicyView({ target, manifest }) {
      return {
        schema: "walnutpi.webActionPolicyView.v1",
        target,
        actionPolicyManifest: manifest,
        actions: Object.fromEntries(
          Object.entries(actions).map(([id, action]) => [id, actionSummary(action, id)]),
        ),
      };
    },

    async handleAction(req) {
      const startedAt = Date.now();
      const traceId = randomUUID();
      const segments = {};
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

      const id = String(body.action || "");
      const action = actions[id];
      if (!action) {
        await webMetricsLedger.append({
          kind: "agent.action",
          operation: "agent.action",
          ok: false,
          status: 400,
          latencyMs: elapsedSince(startedAt),
          action: id || "unknown",
          traceId,
          span: "total",
          segments,
          error: "unknown action",
        });
        return json({ ok: false, error: "未知或未允许的动作。" }, 400);
      }

      const sessionId = webSessionLedger.safeSessionId(body.sessionId);
      let command = action.command;
      let contextUsed = null;
      try {
        if (action.buildCommand) {
          const buildCommandStartedAt = Date.now();
          const built = await action.buildCommand(body);
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
          span: "total",
          inputChars: typeof body.text === "string" ? body.text.length : null,
          segments,
          error: error.message,
        });
        return json({ ok: false, error: error.message }, 400);
      }

      if (action.mode === "terminal") {
        return handleTerminalAction({
          action,
          id,
          command,
          startedAt,
          traceId,
          segments,
          sessionId,
          walnutRemote,
          webSessionLedger,
          webMetricsLedger,
          limitedOutput,
          json,
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
      const responseBody = {
        ok: remoteOk && !outputFailed,
        ...actionSummary(action, id),
        command,
        code: result.code,
        remoteOk,
        outputFailed,
        output,
        actionEvidence,
        contextUsed,
        diagnostics: {
          traceId,
          remoteTransport: result.remoteTransport || null,
          connectionReused: typeof result.reusedConnection === "boolean" ? result.reusedConnection : null,
          preflightEnsured: typeof result.preflightEnsured === "boolean" ? result.preflightEnsured : null,
          segments,
        },
      };
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
        span: "total",
        inputChars: typeof body.text === "string" ? body.text.length : null,
        remoteTransport: result.remoteTransport,
        connectionReused: result.reusedConnection,
        fallbackRemoteTransport: result.fallbackRemoteTransport,
        fallbackConnectionReused: result.fallbackReusedConnection,
        preflightEnsured: result.preflightEnsured,
        segments,
        error: responseBody.ok ? null : output || result.output,
      });
      segments.metricsMs = elapsedSince(metricsStartedAt);
      return json(responseBody);
    },
  };
}

function buildWebActions(policyActions, { shellQuote, aiTimeoutSeconds }) {
  return Object.fromEntries(
    Object.entries(policyActions).map(([id, policy]) => [id, {
      ...policy,
      command: policy.web?.command || null,
      parseJsonOutput: Boolean(policy.web?.parseJsonOutput),
      reply: policy.web?.reply || "",
      timeoutMs: Number(policy.web?.timeoutMs || 15_000),
      buildCommand: webActionCommandBuilder(id, policy, { shellQuote, aiTimeoutSeconds }),
    }]),
  );
}

function webActionCommandBuilder(id, policy, { shellQuote, aiTimeoutSeconds }) {
  if (id === "note") {
    return (body) => {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要记录的内容。");
      return `walnut note ${shellQuote(text)}`;
    };
  }
  if (id === "ai") {
    return async (body) => {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      return {
        command: `WALNUT_AI_TIMEOUT=${shellQuote(aiTimeoutSeconds)} WALNUT_AI_ENABLE_INLINE_MEMORY=0 WALNUT_AI_DISABLE_SESSION_LOG=1 walnut-ai ${shellQuote(text)}`,
        contextUsed: {
          schema: "walnutpi.webAiDelegation.v1",
          delegatedTo: "walnut-ai",
          toolRouting: "device-side",
          memoryDistillCandidate: /记住|记着|以后|下次|我的偏好|我喜欢|我不喜欢|我习惯|我是|我叫|我用|我在用|我的项目|我的设备|所有对话|目标|默认/.test(text),
        },
      };
    };
  }
  if (policy.web?.commandTemplate) {
    return (body) => fillCommandTemplate(policy.web.commandTemplate, body, shellQuote);
  }
  return null;
}

function fillCommandTemplate(template, body, shellQuote) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = String(body[key] || "").trim();
    if (!value) throw new Error(`缺少动作参数：${key}`);
    return shellQuote(value);
  });
}

async function handleTerminalAction({
  action,
  id,
  command,
  startedAt,
  traceId,
  segments,
  sessionId,
  walnutRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
  json,
}) {
  const preflightStartedAt = Date.now();
  const ensure = await walnutRemote.ensureWalnutCli();
  segments.preflightMs = elapsedSince(preflightStartedAt);
  if (!ensure.ok) {
    const remoteTransport = ensure.remoteTransport || null;
    const connectionReused = typeof ensure.reusedConnection === "boolean" ? ensure.reusedConnection : null;
    const fallbackRemoteTransport = ensure.fallbackRemoteTransport || null;
    const fallbackConnectionReused = typeof ensure.fallbackReusedConnection === "boolean" ? ensure.fallbackReusedConnection : null;
    await webMetricsLedger.append({
      kind: "agent.action",
      operation: "agent.action",
      ok: false,
      status: 500,
      latencyMs: elapsedSince(startedAt),
      action: id,
      mode: action.mode,
      traceId,
      span: "total",
      preflightEnsured: ensure.ensured,
      remoteTransport,
      connectionReused,
      fallbackRemoteTransport,
      fallbackConnectionReused,
      segments,
      error: "walnut cli preflight failed",
    });
    return json({
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
        fallbackRemoteTransport,
        fallbackConnectionReused,
        preflightEnsured: typeof ensure.ensured === "boolean" ? ensure.ensured : null,
        segments,
      },
    }, 500);
  }

  const responseBody = {
    ok: true,
    ...actionSummary(action, id),
    command,
    preflightOutput: ensure.ensured ? ensure.output : "",
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
    span: "total",
    preflightEnsured: ensure.ensured,
    segments,
  });
  segments.metricsMs = elapsedSince(metricsStartedAt);
  return json(responseBody);
}

function aiActionOutputFailed(output) {
  const firstLine = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return /^(API 请求失败|API HTTP|OPENAI_API_KEY|usage:|walnut: error:|ERR:|\[local\])/i.test(firstLine);
}

import { actionSummary } from "./action-policy.js";

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
      let body;
      try {
        body = await req.json();
      } catch {
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
          latencyMs: Date.now() - startedAt,
          action: id || "unknown",
          error: "unknown action",
        });
        return json({ ok: false, error: "未知或未允许的动作。" }, 400);
      }

      const sessionId = webSessionLedger.safeSessionId(body.sessionId);
      let command = action.command;
      let contextUsed = null;
      try {
        if (action.buildCommand) {
          const built = await action.buildCommand(body);
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
          latencyMs: Date.now() - startedAt,
          action: id,
          mode: action.mode,
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
          sessionId,
          walnutRemote,
          webSessionLedger,
          webMetricsLedger,
          limitedOutput,
          json,
        });
      }

      const result = await runRemote(command, action.timeoutMs);
      const outputFailed = id === "ai" && aiActionOutputFailed(result.output);
      let actionEvidence = null;
      let output = result.output;
      let remoteOk = result.ok;
      if (action.parseJsonOutput && result.output) {
        try {
          actionEvidence = JSON.parse(result.output);
          if (typeof actionEvidence?.output === "string") output = actionEvidence.output;
          if (typeof actionEvidence?.ok === "boolean") remoteOk = result.ok && actionEvidence.ok;
        } catch {
          actionEvidence = null;
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
      };
      if (sessionId) {
        await webSessionLedger.appendEvent(sessionId, {
          role: "action",
          action: id,
          content: output || result.output || "",
          command,
          ok: responseBody.ok,
          contextUsed,
        });
      }
      await webMetricsLedger.append({
        kind: "agent.action",
        operation: "agent.action",
        ok: responseBody.ok,
        latencyMs: Date.now() - startedAt,
        action: id,
        mode: action.mode,
        source: contextUsed?.delegatedTo || "remote",
        error: responseBody.ok ? null : output || result.output,
      });
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
  sessionId,
  walnutRemote,
  webSessionLedger,
  webMetricsLedger,
  limitedOutput,
  json,
}) {
  const ensure = await walnutRemote.ensureWalnutCli();
  if (!ensure.ok) {
    await webMetricsLedger.append({
      kind: "agent.action",
      operation: "agent.action",
      ok: false,
      status: 500,
      latencyMs: Date.now() - startedAt,
      action: id,
      mode: action.mode,
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
    }, 500);
  }

  const responseBody = {
    ok: true,
    ...actionSummary(action, id),
    command,
    preflightOutput: ensure.ensured ? ensure.output : "",
  };
  if (sessionId) {
    await webSessionLedger.appendEvent(sessionId, {
      role: "action",
      action: id,
      content: action.reply || "",
      command,
      ok: true,
    });
  }
  await webMetricsLedger.append({
    kind: "agent.action",
    operation: "agent.action",
    ok: true,
    latencyMs: Date.now() - startedAt,
    action: id,
    mode: action.mode,
    source: "terminal",
  });
  return json(responseBody);
}

function aiActionOutputFailed(output) {
  const firstLine = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return /^(API 请求失败|API HTTP|OPENAI_API_KEY|usage:|walnut: error:|ERR:|\[local\])/i.test(firstLine);
}

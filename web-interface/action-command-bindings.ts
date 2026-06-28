import { readFile } from "node:fs/promises";
import { actionSummary, actionsForExecutor, normalizeActionPolicyManifest } from "./action-policy.ts";

export function createActionCommandBindings({ manifestPath, shellQuote, aiTimeoutSeconds }) {
  let cachedManifest = null;

  async function loadManifest() {
    if (cachedManifest) return cachedManifest;
    const data = JSON.parse(await readFile(manifestPath, "utf8"));
    cachedManifest = normalizeActionPolicyManifest(data);
    return cachedManifest;
  }

  async function getAction(actionId) {
    const manifest = await loadManifest();
    return manifest.actions[actionId] || null;
  }

  async function getDeviceActionCatalog() {
    const manifest = await loadManifest();
    return actionsForExecutor(manifest, "web");
  }

  async function getActionSummary(actionId) {
    const action = await getAction(actionId);
    return action ? actionSummary(action, actionId) : null;
  }

  async function buildCommand(actionId, params) {
    const action = await getAction(actionId);
    if (!action) throw new Error(`未知动作：${actionId}`);

    const customBuilder = deviceActionCommandBuilder(actionId, { shellQuote, aiTimeoutSeconds });
    if (customBuilder) return customBuilder(params);

    const executorCfg = action.web;
    if (executorCfg?.commandTemplate) {
      return fillCommandTemplate(executorCfg.commandTemplate, params, shellQuote);
    }
    if (executorCfg?.command) {
      return executorCfg.command;
    }

    throw new Error(`动作 ${actionId} 没有 web 命令配置`);
  }

  async function buildDeviceActionBinding(actionId) {
    const action = await getAction(actionId);
    if (!action) return null;
    const executorCfg = action.web || {};
    return {
      ...action,
      command: executorCfg.command || null,
      parseJsonOutput: Boolean(executorCfg.parseJsonOutput),
      reply: executorCfg.reply || "",
      timeoutMs: Number(executorCfg.timeoutMs || 15_000),
      buildCommand: deviceActionCommandBuilder(actionId, { shellQuote, aiTimeoutSeconds }),
    };
  }

  async function buildAllDeviceActionBindings() {
    const actionIds = Object.keys(await getDeviceActionCatalog());
    const entries = [];
    for (const id of actionIds) {
      const built = await buildDeviceActionBinding(id);
      if (built) entries.push([id, built]);
    }
    return Object.fromEntries(entries);
  }

  return {
    loadManifest,
    getAction,
    getDeviceActionCatalog,
    getActionSummary,
    buildCommand,
    buildDeviceActionBinding,
    buildAllDeviceActionBindings,
  };
}

function fillCommandTemplate(template, body, shellQuote) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = String(body[key] || "").trim();
    if (!value) throw new Error(`缺少动作参数：${key}`);
    return shellQuote(value);
  });
}

function deviceActionCommandBuilder(actionId, { shellQuote, aiTimeoutSeconds }) {
  return DEVICE_ACTION_COMMAND_BUILDERS[actionId]?.({ shellQuote, aiTimeoutSeconds }) || null;
}

const DEVICE_ACTION_COMMAND_BUILDERS = Object.freeze({
  note: ({ shellQuote }) => (params) => {
    const text = String(params.text || "").trim();
    if (!text) throw new Error("缺少要记录的内容。");
    return `walnut note ${shellQuote(text)}`;
  },
  ai: ({ shellQuote, aiTimeoutSeconds }) => (params) => {
    const text = String(params.text || "").trim();
    if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
    return {
      command: [
        `WALNUT_AI_TIMEOUT=${shellQuote(String(aiTimeoutSeconds))}`,
        "WALNUT_AI_ENABLE_INLINE_MEMORY=0",
        "WALNUT_AI_DISABLE_SESSION_LOG=1",
        `walnut-ai ${shellQuote(text)}`,
      ].join(" "),
      contextUsed: {
        schema: "walnutpi.webAiDelegation.v1",
        delegatedTo: "walnut-ai",
        toolRouting: "device-side",
        memoryDistillCandidate: Boolean(params.memoryDistillCandidate),
      },
    };
  },
});

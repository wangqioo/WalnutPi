/**
 * Action Registry — one source of truth for action definitions.
 *
 * Consolidates:
 * 1. Action metadata (from action-policy-manifest.json via action-policy.ts)
 * 2. Intent-to-action mapping (replaces ACTION_BY_INTENT hardcoding)
 * 3. Command builders (replaces webActionCommandBuilder special cases)
 *
 * Adding a new action = manifest entry + intent mapping here.
 */

import { readFile } from "node:fs/promises";
import { actionSummary, actionsForExecutor, normalizeActionPolicyManifest } from "./action-policy.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Synchronous exports — usable without loading the manifest
// ═══════════════════════════════════════════════════════════════════════════

// -- Safe continuation detection --------------------------------------------

const SAFE_ACTION_IDS = new Set(["status", "network", "snapshot", "gpio", "notes"]);

const SAFE_TASK_KINDS = new Set([
  "action.run",
  "session.summary",
  "diagnostics.recent_failure.read",
  "screen.state_frame.read",
]);

const DEFAULT_AGENT_BY_TASK_KIND = Object.freeze({
  "action.run": "device",
  "session.summary": "session",
  "diagnostics.recent_failure.read": "diagnostics",
  "screen.state_frame.read": "screen",
});

export function isSafeContinuationTask(task) {
  if (!SAFE_TASK_KINDS.has(task.kind)) return false;
  if (task.kind === "action.run") return SAFE_ACTION_IDS.has(String(task.action || ""));
  return true;
}

export const MAX_CONTINUATION_TASKS = 1;

export function normalizeNextTasks(value) {
  const tasks = Array.isArray(value) ? value : value ? [value] : [];
  return tasks
    .filter((t) => t && typeof t === "object")
    .map((t) => ({
      ...t,
      agent: String(t.agent || "").trim() || defaultAgentForTask(t),
      kind: String(t.kind || "").trim(),
    }))
    .filter((t) => t.kind);
}

function defaultAgentForTask(task) {
  return DEFAULT_AGENT_BY_TASK_KIND[task.kind] || "agent";
}

// ═══════════════════════════════════════════════════════════════════════════
// Registry factory — requires manifest path for async manifest operations
// ═══════════════════════════════════════════════════════════════════════════

// -- Registry factory --------------------------------------------------------

export function createActionRegistry({ manifestPath, shellQuote, aiTimeoutSeconds }) {
  let cachedManifest = null;

  async function loadManifest() {
    if (cachedManifest) return cachedManifest;
    const data = JSON.parse(await readFile(manifestPath, "utf8"));
    cachedManifest = normalizeActionPolicyManifest(data);
    return cachedManifest;
  }

  // -- Intent routing -------------------------------------------------------

  // -- Action metadata (from manifest) --------------------------------------

  async function getAction(actionId) {
    const manifest = await loadManifest();
    return manifest.actions[actionId] || null;
  }

  async function getWebActions() {
    const manifest = await loadManifest();
    return actionsForExecutor(manifest, "web");
  }

  async function getActionSummary(actionId) {
    const action = await getAction(actionId);
    return action ? actionSummary(action, actionId) : null;
  }

  // -- Command building -----------------------------------------------------

  async function buildCommand(actionId, params) {
    const action = await getAction(actionId);
    if (!action) throw new Error(`未知动作：${actionId}`);

    const customBuilder = webActionBuilder(actionId, { shellQuote, aiTimeoutSeconds });
    if (customBuilder) return customBuilder(params);

    // --- Template from manifest ---
    const webCfg = action.web;
    if (webCfg?.commandTemplate) {
      return fillCommandTemplate(webCfg.commandTemplate, params, shellQuote);
    }
    if (webCfg?.command) {
      return webCfg.command;
    }

    throw new Error(`动作 ${actionId} 没有 web 命令配置`);
  }

  // -- Build a web-action object (replaces buildWebActions entry) ----------

  async function buildWebAction(actionId) {
    const action = await getAction(actionId);
    if (!action) return null;
    const webCfg = action.web || {};
    return {
      ...action,
      command: webCfg.command || null,
      parseJsonOutput: Boolean(webCfg.parseJsonOutput),
      reply: webCfg.reply || "",
      timeoutMs: Number(webCfg.timeoutMs || 15_000),
      buildCommand: webActionBuilder(actionId, { shellQuote, aiTimeoutSeconds }),
    };
  }

  async function buildAllWebActions() {
    const webActionIds = Object.keys(await getWebActions());
    const entries = [];
    for (const id of webActionIds) {
      const built = await buildWebAction(id);
      if (built) entries.push([id, built]);
    }
    return Object.fromEntries(entries);
  }

  return {
    loadManifest,
    getAction,
    getWebActions,
    getActionSummary,
    buildCommand,
    buildWebAction,
    buildAllWebActions,
  };
}

// -- Helpers ----------------------------------------------------------------

function fillCommandTemplate(template, body, shellQuote) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = String(body[key] || "").trim();
    if (!value) throw new Error(`缺少动作参数：${key}`);
    return shellQuote(value);
  });
}

function webActionBuilder(actionId, { shellQuote, aiTimeoutSeconds }) {
  return CUSTOM_WEB_ACTION_BUILDERS[actionId]?.({ shellQuote, aiTimeoutSeconds }) || null;
}

const CUSTOM_WEB_ACTION_BUILDERS = Object.freeze({
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

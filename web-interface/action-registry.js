/**
 * Action Registry — one source of truth for action definitions.
 *
 * Consolidates:
 * 1. Action metadata (from action-policy-manifest.json via action-policy.js)
 * 2. Intent-to-action mapping (replaces ACTION_BY_INTENT hardcoding)
 * 3. Command builders (replaces webActionCommandBuilder special cases)
 *
 * Adding a new action = manifest entry + intent mapping here.
 */

import { readFile } from "node:fs/promises";
import { actionSummary, actionsForExecutor, normalizeActionPolicyManifest } from "./action-policy.js";

// ═══════════════════════════════════════════════════════════════════════════
// Synchronous exports — usable without loading the manifest
// ═══════════════════════════════════════════════════════════════════════════

// -- Intent → action ID mapping (replace ACTION_BY_INTENT) ------------------
// Add a new entry here when adding a new action + intent.

export function actionIdForIntent(intent) {
  return INTENT_TO_ACTION[intent] || null;
}

export function policyActionIdsForIntent(intent) {
  return INTENT_TO_POLICY_ACTIONS[intent] || null;
}

const INTENT_TO_ACTION = Object.freeze({
  "device.status.read": "status",
  "device.network.read": "network",
  "device.snapshot.read": "snapshot",
  "device.i2c.read": "i2c_scan",
  "device.gpio.read": "gpio",
  "device.notes.read": "notes",
  "device.note.write": "note",
  "terminal.tool": "video",
});

const INTENT_TO_POLICY_ACTIONS = Object.freeze({
  "policy.system_write": ["package-install", "reboot"],
  "policy.service_restart": ["restart_walnut_screen_service"],
  "policy.maintenance_guidance": ["storage-delete"],
});

// -- Safe continuation detection --------------------------------------------

const SAFE_ACTION_IDS = new Set(["status", "network", "snapshot", "gpio", "notes"]);

const SAFE_TASK_KINDS = new Set([
  "action.run",
  "session.summary",
  "diagnostics.recent_failure.read",
  "screen.state_frame.read",
]);

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
  if (task.kind === "action.run") return "device";
  if (task.kind === "session.summary") return "session";
  if (task.kind === "diagnostics.recent_failure.read") return "diagnostics";
  if (task.kind === "screen.state_frame.read") return "screen";
  return "agent";
}

// -- Observation replan detection -------------------------------------------

const OBSERVATION_REPLAN_PATTERNS = [
  /观察|observe|observation/i,
  /下一步|续步|next\s*tasks?|replan|自动继续|继续/i,
  /只读|read[-\s]*only|安全/i,
];

export function isObservationReplanRequest(text) {
  return OBSERVATION_REPLAN_PATTERNS.every((re) => re.test(text));
}

export function wantsReadOnlyContinuation(text) {
  const input = String(text || "").trim();
  return /观察完成|观察结果|只读.*继续|续步|自动继续|下一步|next\s*tasks?|replan/i.test(input);
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

  function actionIdForIntent(intent) {
    return INTENT_TO_ACTION[intent] || null;
  }

  function policyActionIdsForIntent(intent) {
    return INTENT_TO_POLICY_ACTIONS[intent] || null;
  }

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

    // --- Special case: note (requires text param) ---
    if (actionId === "note") {
      const text = String(params.text || "").trim();
      if (!text) throw new Error("缺少要记录的内容。");
      return `walnut note ${shellQuote(text)}`;
    }

    // --- Special case: ai (requires text param + contextUsed) ---
    if (actionId === "ai") {
      const text = String(params.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      const hasMemoryIntent = /记住|记着|以后|下次|我的偏好|我喜欢|我不喜欢|我习惯|我是|我叫|我用|我在用|我的项目|我的设备|所有对话|目标|默认/.test(text);
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
          memoryDistillCandidate: hasMemoryIntent,
        },
      };
    }

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
    actionIdForIntent,
    policyActionIdsForIntent,
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
  if (actionId === "note") {
    return (params) => {
      const text = String(params.text || "").trim();
      if (!text) throw new Error("缺少要记录的内容。");
      return `walnut note ${shellQuote(text)}`;
    };
  }
  if (actionId === "ai") {
    return (params) => {
      const text = String(params.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      const hasMemoryIntent = /记住|记着|以后|下次|我的偏好|我喜欢|我不喜欢|我习惯|我是|我叫|我用|我在用|我的项目|我的设备|所有对话|目标|默认/.test(text);
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
          memoryDistillCandidate: hasMemoryIntent,
        },
      };
    };
  }
  return null;
}

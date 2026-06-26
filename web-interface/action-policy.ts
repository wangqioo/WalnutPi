import { readFile } from "node:fs/promises";

const MANIFEST_SCHEMA = "walnutpi.action-policy-manifest.v1";
const RISKS = new Set(["read", "write-low", "interactive", "high"]);
const MODES = new Set(["remote", "terminal", "confirmable", "refused"]);

type JsonObject = Record<string, any>;
export type ActionPolicyAction = JsonObject & {
  allowedExecutors: string[];
  confirmationRequired: boolean;
  evidence: JsonObject;
  mode: string;
  parameters: JsonObject;
  risk: string;
  title: string;
  web?: { reply?: string };
};
export type ActionPolicyManifest = JsonObject & {
  actions: Record<string, ActionPolicyAction>;
  schema: typeof MANIFEST_SCHEMA;
  version: number;
};

export async function loadActionPolicyManifest(manifestPath: string | URL): Promise<ActionPolicyManifest> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return normalizeActionPolicyManifest(manifest);
}

export function normalizeActionPolicyManifest(manifest: any): ActionPolicyManifest {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Action Policy Manifest must be an object");
  }
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw new Error(`Action Policy Manifest schema must be ${MANIFEST_SCHEMA}`);
  }
  if (!manifest.actions || typeof manifest.actions !== "object" || Array.isArray(manifest.actions)) {
    throw new Error("Action Policy Manifest actions must be an object");
  }

  const actions: Record<string, ActionPolicyAction> = {};
  for (const [id, action] of Object.entries(manifest.actions)) {
    actions[cleanActionId(id)] = normalizeAction(id, action);
  }
  return {
    ...manifest,
    schema: MANIFEST_SCHEMA,
    version: cleanInteger(manifest.version || 1, "version", 1, 1000),
    actions,
  };
}

export function actionsForExecutor(manifest: ActionPolicyManifest, executor: string) {
  const executorName = cleanExecutor(executor);
  return Object.fromEntries(
    Object.entries(manifest.actions).filter(([, action]) => action.allowedExecutors.includes(executorName)),
  ) as Record<string, ActionPolicyAction>;
}

export function resolveAction(manifest: ActionPolicyManifest, { executor, actionId, params = {} }: { executor: string; actionId: string; params?: JsonObject }) {
  const executorName = cleanExecutor(executor);
  const id = cleanActionId(actionId);
  const action = manifest.actions[id];
  if (!action) {
    return { ok: false, status: "refused", actionId: id, reason: "unknown-action" };
  }
  if (!action.allowedExecutors.includes(executorName)) {
    return { ok: false, status: "refused", actionId: id, reason: "executor-not-allowed" };
  }
  const parameterValues = resolveActionParameters(action, params, id);
  if (action.mode === "refused") {
    return { ok: false, status: "refused", actionId: id, action, parameterValues, reason: "policy-refused" };
  }
  if (action.confirmationRequired || action.mode === "confirmable") {
    return { ok: true, status: "pending", actionId: id, action, parameterValues };
  }
  return { ok: true, status: "runnable", actionId: id, action, parameterValues };
}

export function actionSummary(action: ActionPolicyAction, id: string) {
  return {
    id,
    title: action.title,
    risk: action.risk,
    mode: action.mode,
    confirmationRequired: action.confirmationRequired,
    allowedExecutors: action.allowedExecutors,
    parameters: action.parameters,
    evidence: action.evidence,
    reply: action.web?.reply || "",
  };
}

function resolveActionParameters(action: ActionPolicyAction, params: JsonObject, actionId: string) {
  const schema = action.parameters || {};
  const hasPropertySchema = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties);
  const properties = hasPropertySchema ? schema.properties : {};
  const allowAdditional = schema.additionalProperties !== false;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const values: JsonObject = {};
  for (const key of required) {
    if (params[key] === undefined || params[key] === null || String(params[key]).trim() === "") {
      throw new Error(`actions.${actionId}.parameters.${key} is required`);
    }
  }
  for (const [key, value] of Object.entries(params || {})) {
    if (properties[key]) {
      values[key] = value;
    } else if (!hasPropertySchema || allowAdditional) {
      values[key] = value;
    }
  }
  return values;
}

function normalizeAction(id: string, action: any): ActionPolicyAction {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error(`action ${id} must be an object`);
  }
  const risk = cleanEnum(action.risk, RISKS, `actions.${id}.risk`);
  const mode = cleanEnum(action.mode, MODES, `actions.${id}.mode`);
  const confirmationRequired = Boolean(action.confirmationRequired);
  if (risk === "high" && mode !== "refused" && !confirmationRequired) {
    throw new Error(`actions.${id} high-risk actions must require confirmation`);
  }
  if (confirmationRequired && mode !== "confirmable") {
    throw new Error(`actions.${id} confirmed actions must use confirmable mode`);
  }
  if (mode === "refused" && confirmationRequired) {
    throw new Error(`actions.${id} refused actions must not require confirmation`);
  }
  const allowedExecutors = normalizeAllowedExecutors(action.allowedExecutors, `actions.${id}.allowedExecutors`);
  return {
    ...action,
    title: cleanText(action.title, `actions.${id}.title`, 80),
    description: cleanOptionalText(action.description, `actions.${id}.description`, 400),
    risk,
    mode,
    confirmationRequired,
    allowedExecutors,
    parameters: normalizeJsonObject(action.parameters || {}, `actions.${id}.parameters`),
    evidence: normalizeJsonObject(action.evidence || {}, `actions.${id}.evidence`),
  };
}

function normalizeAllowedExecutors(value: any, field: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one executor`);
  }
  return [...new Set(value.map(cleanExecutor))];
}

function cleanExecutor(value: any) {
  const text = String(value || "").trim();
  if (!/^[a-z][a-z0-9-]*$/.test(text)) throw new Error(`invalid action executor: ${value}`);
  return text;
}

function normalizeJsonObject(value: any, field: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function cleanActionId(value: any) {
  const text = String(value || "").trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(text)) throw new Error(`invalid action id: ${value}`);
  return text;
}

function cleanText(value: any, field: string, limit: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${field} is required`);
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

function cleanOptionalText(value: any, field: string, limit: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

function cleanEnum(value: any, allowed: Set<string>, field: string) {
  const text = String(value || "").trim();
  if (!allowed.has(text)) throw new Error(`${field} must be one of ${[...allowed].join(", ")}`);
  return text;
}

function cleanInteger(value: any, field: string, low: number, high: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < low || number > high) {
    throw new Error(`${field} must be an integer between ${low} and ${high}`);
  }
  return number;
}

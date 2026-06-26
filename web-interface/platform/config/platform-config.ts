import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, any>;

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const DEFAULTS_PATH = path.join(PROJECT_ROOT, "config", "platform.defaults.json");
const LOCAL_PATH = path.join(PROJECT_ROOT, "config", "platform.local.json");

let cachedConfig: JsonObject | null = null;

export function loadPlatformConfig() {
  if (cachedConfig) return cachedConfig;
  const defaults = readJsonFile(DEFAULTS_PATH);
  const local = existsSync(LOCAL_PATH) ? readJsonFile(LOCAL_PATH) : {};
  const merged = deepMerge(defaults, local);
  cachedConfig = resolveSecrets(merged);
  return cachedConfig;
}

export function resetPlatformConfigForTests() {
  cachedConfig = null;
}

export function getAiModelConfig() {
  const config = loadPlatformConfig();
  const ai = config.ai || {};
  const provider = cleanString(ai.provider);
  const model = cleanString(ai.model);
  return {
    id: `${provider}/${model}` as `${string}/${string}`,
    provider,
    model,
    url: cleanString(ai.baseUrl).replace(/\/+$/, ""),
    apiKey: cleanString(ai.apiKey),
  };
}

export function getAiSdkConfig() {
  const ai = loadPlatformConfig().ai || {};
  return {
    provider: cleanString(ai.provider),
    model: cleanString(ai.model),
    baseUrl: cleanString(ai.baseUrl).replace(/\/+$/, ""),
    apiKey: cleanString(ai.apiKey),
  };
}

export function getAuthConfig() {
  const auth = loadPlatformConfig().auth || {};
  return {
    baseUrl: cleanString(auth.baseUrl),
    secret: cleanString(auth.secret),
  };
}

export function getDbConfig() {
  return {
    url: cleanString(loadPlatformConfig().db?.url),
  };
}

export function getLangfuseConfig() {
  const langfuse = loadPlatformConfig().langfuse || {};
  const publicKey = cleanString(langfuse.publicKey);
  const secretKey = cleanString(langfuse.secretKey);
  return {
    enabled: langfuse.enabled !== false,
    configured: Boolean(publicKey && secretKey),
    publicKey,
    secretKey,
    baseUrl: cleanString(langfuse.baseUrl),
  };
}

export function getMcpConfig() {
  return {
    endpoint: cleanString(loadPlatformConfig().mcp?.endpoint),
  };
}

export function getOpaConfig() {
  return {
    path: cleanString(loadPlatformConfig().opa?.path) || "opa",
  };
}

function resolveSecrets(config: JsonObject) {
  const resolved = structuredClone(config);
  if (resolved.ai?.apiKeySource) {
    resolved.ai.apiKey = resolveSecretSource(resolved.ai.apiKeySource);
  }
  if (resolved.auth?.secretSource) {
    resolved.auth.secret = resolveAuthSecret(resolved.auth.secretSource);
  }
  if (resolved.langfuse?.secretSource) {
    const env = readMarkdownEnv(resolved.langfuse.secretSource.path);
    resolved.langfuse.publicKey = env.LANGFUSE_PUBLIC_KEY || "";
    resolved.langfuse.secretKey = env.LANGFUSE_SECRET_KEY || "";
    resolved.langfuse.baseUrl = env.LANGFUSE_BASE_URL || env.LANGFUSE_HOST || resolved.langfuse.baseUrl || "";
  }
  return resolved;
}

function resolveSecretSource(source: JsonObject) {
  if (source.kind === "codex-auth") {
    const parsed = readJsonFile(resolveHomePath(source.path));
    return cleanString(parsed[source.key || "OPENAI_API_KEY"]);
  }
  if (source.kind === "env") {
    return cleanString(process.env[source.name]);
  }
  if (source.kind === "literal") {
    return cleanString(source.value);
  }
  return "";
}

function resolveAuthSecret(source: JsonObject) {
  if (source.kind === "derived") {
    return createHash("sha256")
      .update(`${source.namespace || "walnutpi"}:${source.seed || ""}`)
      .digest("hex");
  }
  return resolveSecretSource(source);
}

function readMarkdownEnv(filePath: string) {
  const resolved = resolveHomePath(filePath);
  if (!existsSync(resolved)) return {};
  const env: Record<string, string> = {};
  const text = readFileSync(resolved, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function readJsonFile(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function resolveHomePath(value: string) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
  return path.resolve(value);
}

function deepMerge(base: any, override: any): any {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out;
}

function isObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: any) {
  return String(value || "").trim();
}

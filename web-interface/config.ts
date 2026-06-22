/**
 * WalnutPi Web — environment-based configuration.
 *
 * All env-var readers and default values in one place.
 * Does NOT import from other project modules — pure config only.
 */
import path from "node:path";

export const BASE_DIR = import.meta.dir;
export const PROJECT_ROOT = path.resolve(BASE_DIR, "..");

export const HOST = "127.0.0.1";
export const PORT = Number(process.env.PORT || 4173);
export const MODEL_FILE = "0c6390ea8b1ccf186ec099456954fd42.glb";

// ── SSH ──────────────────────────────────────────────────────────────
export const SSH_HOST = process.env.SSH_HOST || "192.168.1.24";
export const SSH_USER = process.env.SSH_USER || "root";
export const SSH_PASSWORD = process.env.SSH_PASSWORD || "root";
export const REMOTE_PROJECT_ROOT = process.env.WALNUT_REMOTE_PROJECT_ROOT || process.env.WALNUT_PROJECT_ROOT || "/home/pi/projects/WalnutPi";
export const REMOTE_BUILD_USER = process.env.WALNUT_REMOTE_BUILD_USER || "pi";

// ── AI / LLM ─────────────────────────────────────────────────────────
export const AI_MODEL = process.env.WALNUT_AI_MODEL || "gpt-5.4-mini";
export const AI_BASE_URL = (process.env.WALNUT_AI_BASE_URL || "https://rehdasu.cn/v1").replace(/\/+$/, "");
export const AI_REASONING_EFFORT = process.env.WALNUT_AI_REASONING_EFFORT || "none";
export const AI_CONTEXT_LIMIT = 4;
export const AI_CONTEXT_TEXT_LIMIT = 900;
export const AI_TIMEOUT_SECONDS = Number(process.env.WALNUT_WEB_AI_TIMEOUT || 60);

export const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH
  ? path.resolve(process.env.CODEX_AUTH_PATH)
  : path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex", "auth.json");

// ── Paths ────────────────────────────────────────────────────────────
export const ACTION_POLICY_MANIFEST_PATH = path.join(PROJECT_ROOT, "action-policy-manifest.json");
export const SCREEN_WORKSPACE_ROOT = process.env.WALNUT_SCREEN_WORKSPACE_ROOT
  ? path.resolve(process.env.WALNUT_SCREEN_WORKSPACE_ROOT)
  : path.join(PROJECT_ROOT, "screen");
export const SCREEN_LVGL_PREVIEW_OUTPUT_DIR = path.join(SCREEN_WORKSPACE_ROOT, "outputs", "lvgl-preview");
export const SCREEN_RECORDS_DIR = process.env.WALNUT_SCREEN_RECORDS_DIR || path.join(BASE_DIR, "screen-sync-records");
export const SCREEN_SUCCESS_CORPUS_PATH = path.join(PROJECT_ROOT, "walnut-ai-terminal", "corpus", "screen-sync-successes.md");
export const WALNUT_CLI_SOURCE_PATH = path.join(PROJECT_ROOT, "walnut-assistant", "walnut");
export const WALNUT_MEMORY_DIR = process.env.WALNUT_MEMORY_DIR || path.join(process.env.HOME || process.env.USERPROFILE || PROJECT_ROOT, "walnut-memory");
export const WALNUT_AI_MEMORY_FILE = process.env.WALNUT_AI_MEMORY_FILE || path.join(WALNUT_MEMORY_DIR, "memory.json");
export const WALNUT_AI_CORPUS_DIR = process.env.WALNUT_AI_CORPUS_DIR || path.join(PROJECT_ROOT, "walnut-ai-terminal", "corpus");
export const WALNUT_AI_SKILLS_DIR = process.env.WALNUT_AI_SKILLS_DIR || path.join(PROJECT_ROOT, "walnut-ai-terminal", "skills");
export const WALNUT_AI_PRIMARY_SKILL = process.env.WALNUT_AI_PRIMARY_SKILL || "walnutpi-1b-zerow";

// ── Data files ───────────────────────────────────────────────────────
export const WEB_SESSIONS_DIR = process.env.WALNUT_WEB_SESSIONS_DIR || path.join(BASE_DIR, "data", "sessions");
export const WEB_METRICS_PATH = process.env.WALNUT_WEB_METRICS_PATH || path.join(BASE_DIR, "data", "metrics.jsonl");
export const AGENT_TURNS_PATH = process.env.WALNUT_AGENT_TURNS_PATH || path.join(BASE_DIR, "data", "agent-turns.jsonl");
export const AGENT_TURN_EVENTS_PATH = process.env.WALNUT_AGENT_TURN_EVENTS_PATH || path.join(BASE_DIR, "data", "agent-turn-events.jsonl");
export const AGENT_HARNESS_SESSIONS_PATH = process.env.WALNUT_AGENT_HARNESS_SESSIONS_PATH || path.join(BASE_DIR, "data", "agent-harness-sessions.json");

// ── Limits ───────────────────────────────────────────────────────────
export const ACTION_OUTPUT_LIMIT = 24_000;
export const CAPTURE_OUTPUT_LIMIT = 1_500_000;
export const SCREEN_FRAME_TICKET_TTL_MS = 10 * 60_000;
export const SCREEN_SOURCE_IMPORT_MAX_BYTES = Number(process.env.WALNUT_SCREEN_SOURCE_IMPORT_MAX_BYTES || 25 * 1024 * 1024);
export const SCREEN_RECORD_LIMIT = (() => {
  const parsed = Number(process.env.WALNUT_SCREEN_RECORD_LIMIT || 50);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 50;
})();
export const WEB_SESSION_EVENT_LIMIT = Number(process.env.WALNUT_WEB_SESSION_EVENT_LIMIT || 300);
export const RETRIEVAL_FILE_LIMIT = 5000;
export const RETRIEVAL_RESULT_LIMIT = 8;

// ── Memory fields (used by multiple modules) ─────────────────────────
export const MEMORY_FIELDS = ["preferences", "environment", "projects", "workflows", "goals", "summary"];

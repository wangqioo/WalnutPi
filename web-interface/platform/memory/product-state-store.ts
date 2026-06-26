import { createHash } from "node:crypto";
import { createWalnutPostgresClient } from "../db/client.ts";
import { memoryCandidates, memorySensitiveSkips } from "../db/schema.ts";

type JsonObject = Record<string, any>;

export function createMemoryProductStateStore({
  postgresClientFactory = createWalnutPostgresClient,
  now = () => new Date(),
}: JsonObject = {}) {
  async function capturePreferenceCandidate({
    text,
    sessionId,
    turnId,
    categoryKey = "preferences.screen_generation",
  }: JsonObject) {
    const candidateText = String(text || "").trim();
    const record = {
      sourceSessionId: cleanNullableText(sessionId),
      sourceTurnId: cleanNullableText(turnId),
      categoryKey,
      candidateText,
      status: "candidate",
      sourceTool: "memory.preference",
      metadata: { capturedAt: now().toISOString() },
    };
    const write = await insertRecord(memoryCandidates, record);
    return {
      ok: true,
      writeState: "candidate",
      categoryKey,
      candidateText,
      persisted: write.persisted,
      skipped: write.skipped,
      reason: write.reason,
    };
  }

  async function recordSensitiveSkip({
    text,
    sessionId,
    turnId,
    reason = "sensitive-temporary",
  }: JsonObject) {
    const normalized = String(text || "").trim();
    const textHash = `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
    const textLength = normalized.length;
    const record = {
      sourceSessionId: cleanNullableText(sessionId),
      sourceTurnId: cleanNullableText(turnId),
      reason,
      textHash,
      textLength,
      sourceTool: "memory.sensitiveSkip",
      metadata: { capturedAt: now().toISOString() },
    };
    const write = await insertRecord(memorySensitiveSkips, record);
    return {
      ok: true,
      reason,
      textHash,
      textLength,
      persisted: write.persisted,
      skipped: write.skipped,
      writeReason: write.reason,
    };
  }

  async function summarizeSession({ sessionId, turnLedger, inputText }: JsonObject) {
    const previousTurns = await turnLedger.readTurns({ sessionId, count: 20 });
    const lines = previousTurns
      .filter((item: JsonObject) => item.input?.text && item.input.text !== inputText)
      .slice(-8)
      .map((item: JsonObject) => `- ${item.input.text} -> ${item.status}`);
    return {
      summary: lines.length ? lines.join("\n") : "No prior turns in this session.",
      eventsReadCount: previousTurns.length,
      source: "turn-ledger",
    };
  }

  async function insertRecord(table: any, record: JsonObject) {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        persisted: false,
        skipped: true,
        reason: client?.reason || "database url is not configured",
      };
    }
    try {
      await client.db.insert(table).values(record);
      return { persisted: true, skipped: false, reason: null };
    } catch (error: any) {
      return {
        persisted: false,
        skipped: true,
        reason: `db-write-unavailable:${error.message}`,
      };
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  return {
    capturePreferenceCandidate,
    recordSensitiveSkip,
    summarizeSession,
  };
}

function cleanNullableText(value: any) {
  const text = String(value || "").trim();
  return text || null;
}

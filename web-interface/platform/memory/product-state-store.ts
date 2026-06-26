import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createWalnutPostgresClient } from "../db/client.ts";
import { durableMemoryRecords, memoryCandidates, memorySensitiveSkips } from "../db/schema.ts";

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
    const candidateId = randomUUID();
    const record = {
      id: candidateId,
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
      candidateId,
      categoryKey,
      candidateText,
      persisted: write.persisted,
      skipped: write.skipped,
      reason: write.reason,
    };
  }

  async function approveCandidate({
    candidateId,
    subject = {},
  }: JsonObject) {
    const normalizedCandidateId = cleanNullableText(candidateId);
    if (!normalizedCandidateId) {
      return {
        ok: false,
        persisted: false,
        skipped: false,
        reason: "candidateId is required",
      };
    }
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        ok: false,
        persisted: false,
        skipped: true,
        reason: client?.reason || "database url is not configured",
      };
    }
    try {
      const rows = await client.db
        .select()
        .from(memoryCandidates)
        .where(eq(memoryCandidates.id, normalizedCandidateId))
        .limit(1);
      const candidate = rows[0];
      if (!candidate) {
        return {
          ok: false,
          persisted: false,
          skipped: false,
          reason: "candidate-not-found",
        };
      }
      if (candidate.status !== "candidate") {
        return {
          ok: false,
          persisted: false,
          skipped: false,
          reason: "candidate-not-approvable",
        };
      }
      const recordId = randomUUID();
      await client.db.insert(durableMemoryRecords).values({
        id: recordId,
        sourceCandidateId: candidate.id,
        categoryKey: candidate.categoryKey,
        memoryText: candidate.candidateText,
        status: "approved",
        approvedBySubjectKind: cleanNullableText(subject.kind),
        approvedByUserId: cleanNullableText(subject.userId),
        approvedByOrgId: cleanNullableText(subject.orgId),
        approvedByDeviceId: cleanNullableText(subject.deviceId),
        sourceTool: "memory.approve",
        metadata: {
          approvedAt: now().toISOString(),
          sourceTool: candidate.sourceTool,
          sourceSessionId: candidate.sourceSessionId,
          sourceTurnId: candidate.sourceTurnId,
        },
      });
      await client.db
        .update(memoryCandidates)
        .set({
          status: "approved",
          metadata: {
            ...(objectOrEmpty(candidate.metadata)),
            approvedMemoryRecordId: recordId,
            approvedAt: now().toISOString(),
          },
        })
        .where(eq(memoryCandidates.id, candidate.id));
      return {
        ok: true,
        recordId,
        candidateId: candidate.id,
        categoryKey: candidate.categoryKey,
        memoryText: candidate.candidateText,
        persisted: true,
        skipped: false,
        reason: null,
      };
    } catch (error: any) {
      return {
        ok: false,
        persisted: false,
        skipped: true,
        reason: `db-write-unavailable:${error.message}`,
      };
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
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
    approveCandidate,
    capturePreferenceCandidate,
    recordSensitiveSkip,
    summarizeSession,
  };
}

function cleanNullableText(value: any) {
  const text = String(value || "").trim();
  return text || null;
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

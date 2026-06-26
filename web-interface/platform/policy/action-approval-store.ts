import { desc, eq } from "drizzle-orm";
import { createWalnutPostgresClient } from "../db/client.ts";
import { actionApprovalRecords } from "../db/schema.ts";

type JsonObject = Record<string, any>;

export type ActionApprovalRecord = JsonObject & {
  actionId: string;
  approvalTokenHash: string;
  commandBindingId: string;
  decisionId: string;
  expiresAt: string;
  paramsHash: string;
  status: "prepared" | "committed" | "expired" | "refused";
  subjectHash: string;
};

export function createDbActionApprovalStore({
  postgresClientFactory = createWalnutPostgresClient,
}: JsonObject = {}) {
  async function append(record: ActionApprovalRecord) {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        persisted: false,
        skipped: true,
        reason: client?.reason || "database url is not configured",
        record: null,
      };
    }
    try {
      await client.db.insert(actionApprovalRecords).values({
        decisionId: record.decisionId,
        actionId: record.actionId,
        status: record.status,
        paramsHash: record.paramsHash,
        commandBindingId: record.commandBindingId,
        subjectHash: record.subjectHash,
        approvalTokenHash: record.approvalTokenHash,
        expiresAt: new Date(record.expiresAt),
        committedAt: record.committedAt ? new Date(record.committedAt) : null,
        commitDecisionId: record.commitDecisionId || null,
        subject: record.subject,
        decision: record.decision,
        metadata: {
          schema: record.schema,
          explanation: record.explanation || null,
          opaDecision: record.opaDecision || null,
          createdAt: record.createdAt || null,
        },
      });
      return { persisted: true, skipped: false, reason: null, record };
    } catch (error: any) {
      return {
        persisted: false,
        skipped: true,
        reason: `db-write-unavailable:${error.message}`,
        record: null,
      };
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function latestByDecisionId(decisionId: string): Promise<ActionApprovalRecord | null> {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return null;
    try {
      const rows = await client.db.select()
        .from(actionApprovalRecords)
        .where(eq(actionApprovalRecords.decisionId, decisionId))
        .orderBy(desc(actionApprovalRecords.createdAt))
        .limit(1);
      return rows[0] ? recordFromRow(rows[0]) : null;
    } catch {
      return null;
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  return {
    append,
    latestByDecisionId,
  };
}

export function createMemoryActionApprovalStore() {
  const records: ActionApprovalRecord[] = [];
  return {
    async append(record: ActionApprovalRecord) {
      records.push(record);
      return { persisted: true, skipped: false, reason: null, record };
    },
    async latestByDecisionId(decisionId: string) {
      return [...records].reverse().find((record) => record.decisionId === decisionId) || null;
    },
    records,
  };
}

function recordFromRow(row: JsonObject): ActionApprovalRecord {
  const metadata = objectOrEmpty(row.metadata);
  return {
    schema: metadata.schema || "walnutpi.action-approval-record.v1",
    status: row.status,
    decisionId: row.decisionId,
    actionId: row.actionId,
    paramsHash: row.paramsHash,
    commandBindingId: row.commandBindingId,
    subjectHash: row.subjectHash,
    subject: objectOrEmpty(row.subject),
    expiresAt: dateIso(row.expiresAt),
    explanation: metadata.explanation || null,
    decision: objectOrEmpty(row.decision),
    opaDecision: metadata.opaDecision || row.decision,
    approvalTokenHash: row.approvalTokenHash,
    createdAt: dateIso(row.createdAt),
    committedAt: row.committedAt ? dateIso(row.committedAt) : null,
    commitDecisionId: row.commitDecisionId || null,
  };
}

function dateIso(value: any) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

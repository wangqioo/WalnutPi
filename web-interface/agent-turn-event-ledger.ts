import { and, desc, eq, gt } from "drizzle-orm";
import { createWalnutPostgresClient } from "./platform/db/client.ts";
import { agentTurnEvents } from "./platform/db/schema.ts";

const EVENT_SCHEMA = "walnutpi.agentTurnEvent.v1";
const LEDGER_SCHEMA = "walnutpi.agentTurnEventLedger.postgres.v1";

type JsonObject = Record<string, any>;
type AgentTurnEvent = {
  data?: any;
  error?: any;
  kind: string;
  sessionId?: string | null;
  status: string;
  stepId?: string | null;
  timestamp?: string;
  turnId: string;
};
type AgentTurnEventRecord = AgentTurnEvent & {
  schema: typeof EVENT_SCHEMA;
  seq: number;
  timestamp: string;
};

export function createAgentTurnEventLedger({
  eventBus = null,
  limit = 500,
  postgresClientFactory = createWalnutPostgresClient,
}: { eventBus?: any; limit?: number; postgresClientFactory?: any } = {}) {
  async function appendEvent(event: AgentTurnEvent): Promise<AgentTurnEventRecord> {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return skippedEventRecord(event, client?.reason || "database url is not configured");
    }
    try {
      const timestamp = event.timestamp || new Date().toISOString();
      const [inserted] = await client.db
        .insert(agentTurnEvents)
        .values({
          turnId: event.turnId,
          sessionId: cleanNullableText(event.sessionId),
          kind: event.kind,
          status: event.status,
          stepId: cleanNullableText(event.stepId),
          data: event.data !== undefined ? event.data : null,
          error: event.error ? String(event.error) : null,
          occurredAt: new Date(timestamp),
        })
        .returning({
          seq: agentTurnEvents.seq,
        });
      const record: AgentTurnEventRecord = {
        schema: EVENT_SCHEMA,
        turnId: event.turnId,
        sessionId: event.sessionId || null,
        seq: Number(inserted.seq),
        kind: event.kind,
        status: event.status,
        timestamp,
        ...(event.stepId ? { stepId: event.stepId } : {}),
        ...(event.data !== undefined ? { data: event.data } : {}),
        ...(event.error ? { error: String(event.error) } : {}),
      };
      eventBus?.publish(record);
      return record;
    } catch (error: any) {
      throw new Error(`agent turn event persistence failed: ${error.message}`);
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function readEvents({ sessionId = null, turnId = null, afterSeq = 0, count = limit }: { sessionId?: string | null; turnId?: string | null; afterSeq?: number; count?: number } = {}) {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return [];
    try {
      const filters = [gt(agentTurnEvents.seq, Number(afterSeq || 0))];
      if (sessionId) filters.push(eq(agentTurnEvents.sessionId, sessionId));
      if (turnId) filters.push(eq(agentTurnEvents.turnId, turnId));
      const boundedCount = Math.max(Number(count) || limit, 1);
      const rows = await client.db
        .select()
        .from(agentTurnEvents)
        .where(and(...filters))
        .orderBy(desc(agentTurnEvents.seq))
        .limit(boundedCount);
      return rows.reverse().map(eventRecordFromRow);
    } catch (error: any) {
      throw new Error(`agent turn event read failed: ${error.message}`);
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function persistenceStatus() {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        schema: LEDGER_SCHEMA,
        persisted: false,
        skipped: true,
        reason: client?.reason || "database url is not configured",
      };
    }
    await client.sql?.end?.({ timeout: 1 });
    return { schema: LEDGER_SCHEMA, persisted: true, skipped: false };
  }

  return { appendEvent, readEvents, persistenceStatus };
}

function eventRecordFromRow(row: JsonObject): AgentTurnEventRecord {
  return {
    schema: EVENT_SCHEMA,
    turnId: row.turnId,
    sessionId: row.sessionId || null,
    seq: Number(row.seq),
    kind: row.kind,
    status: row.status,
    timestamp: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : new Date(row.occurredAt).toISOString(),
    ...(row.stepId ? { stepId: row.stepId } : {}),
    ...(row.data !== null && row.data !== undefined ? { data: row.data } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function skippedEventRecord(event: AgentTurnEvent, reason: string): AgentTurnEventRecord {
  return {
    schema: EVENT_SCHEMA,
    turnId: event.turnId,
    sessionId: event.sessionId || null,
    seq: 0,
    kind: event.kind,
    status: event.status,
    timestamp: event.timestamp || new Date().toISOString(),
    ...(event.stepId ? { stepId: event.stepId } : {}),
    ...(event.data !== undefined ? { data: { ...event.data, persistence: { persisted: false, skipped: true, reason } } } : {
      data: { persistence: { persisted: false, skipped: true, reason } },
    }),
    ...(event.error ? { error: String(event.error) } : {}),
  };
}

function cleanNullableText(value: any) {
  const text = String(value || "").trim();
  return text || null;
}

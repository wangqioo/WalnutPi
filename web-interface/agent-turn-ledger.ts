import { desc, eq } from "drizzle-orm";
import { createWalnutPostgresClient } from "./platform/db/client.ts";
import { agentTurnSnapshots } from "./platform/db/schema.ts";

type JsonObject = Record<string, any>;

const LEDGER_SCHEMA = "walnutpi.agentTurnLedger.postgres.v1";

export function createAgentTurnLedger({
  limit = 100,
  postgresClientFactory = createWalnutPostgresClient,
}: JsonObject = {}) {
  async function appendTurn(turn: JsonObject) {
    if (!turn || typeof turn !== "object") return null;
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return persistenceSkipped(client?.reason || "database url is not configured");
    try {
      await client.db.insert(agentTurnSnapshots).values({
        turnId: cleanRequiredText(turn.turnId) || `anonymous-${Date.now()}`,
        sessionId: cleanNullableText(turn.sessionId),
        status: cleanRequiredText(turn.status) || "unknown",
        route: objectOrNull(turn.route),
        input: objectOrNull(turn.input) || {},
        turn,
      });
      return {
        schema: LEDGER_SCHEMA,
        persisted: true,
        skipped: false,
        turnId: turn.turnId || null,
      };
    } catch (error: any) {
      throw new Error(`agent turn persistence failed: ${error.message}`);
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function readTurns({ sessionId = null, count = limit }: JsonObject = {}) {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return [];
    try {
      const boundedCount = Math.max(Number(count) || limit, 1);
      const rows = await client.db
        .select({
          turnId: agentTurnSnapshots.turnId,
          turn: agentTurnSnapshots.turn,
          createdAt: agentTurnSnapshots.createdAt,
        })
        .from(agentTurnSnapshots)
        .where(sessionId ? eq(agentTurnSnapshots.sessionId, sessionId) : undefined)
        .orderBy(desc(agentTurnSnapshots.createdAt))
        .limit(Math.max(boundedCount * 4, boundedCount));
      const turns = rows.reverse().map((row: JsonObject) => row.turn);
      return latestTurnSnapshots(turns).slice(-boundedCount);
    } catch (error: any) {
      throw new Error(`agent turn read failed: ${error.message}`);
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function persistenceStatus() {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return persistenceSkipped(client?.reason || "database url is not configured");
    await client.sql?.end?.({ timeout: 1 });
    return { schema: LEDGER_SCHEMA, persisted: true, skipped: false };
  }

  return { appendTurn, readTurns, persistenceStatus };
}

function persistenceSkipped(reason: string) {
  return {
    schema: LEDGER_SCHEMA,
    persisted: false,
    skipped: true,
    reason,
  };
}

function latestTurnSnapshots(turns: JsonObject[]) {
  const byTurnId = new Map();
  const order: string[] = [];
  for (const turn of turns) {
    const key = turn.turnId || `anonymous-${order.length}`;
    if (!byTurnId.has(key)) order.push(key);
    const previous = byTurnId.get(key);
    byTurnId.set(key, preferTurnSnapshot(previous, turn));
  }
  return order.map((key) => byTurnId.get(key));
}

function preferTurnSnapshot(previous: JsonObject | undefined, next: JsonObject) {
  if (!previous) return next;
  if (snapshotRank(next) > snapshotRank(previous)) return next;
  if (snapshotRank(next) < snapshotRank(previous)) return previous;
  return next;
}

function snapshotRank(turn: JsonObject) {
  const statusRank = {
    completed: 6,
    failed: 6,
    pending: 4,
    queued: 3,
    running: 2,
  }[turn?.status] || 1;
  const stepsRank = Array.isArray(turn?.steps) ? turn.steps.filter((step) => ["completed", "failed"].includes(step.status)).length / 100 : 0;
  return statusRank + stepsRank;
}

function cleanRequiredText(value: any) {
  return String(value || "").trim();
}

function cleanNullableText(value: any) {
  const text = cleanRequiredText(value);
  return text || null;
}

function objectOrNull(value: any): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

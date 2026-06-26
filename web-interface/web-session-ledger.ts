import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { createWalnutPostgresClient } from "./platform/db/client.ts";
import { webSessionEvents } from "./platform/db/schema.ts";

type JsonObject = Record<string, any>;

const LEDGER_SCHEMA = "walnutpi.webSessionLedger.postgres.v1";

function clippedText(value: any, limit: number) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function sessionContent(value: any) {
  return String(value || "").replace(/\0/g, "").trim();
}

export function createWebSessionLedger({
  eventLimit = 300,
  actionLimit = 120,
  postgresClientFactory = createWalnutPostgresClient,
}: JsonObject = {}) {
  function safeSessionId(value: any) {
    const text = String(value || "").trim();
    if (!/^[a-zA-Z0-9._-]{8,80}$/.test(text) || text.includes("..") || text.startsWith(".")) return null;
    return text;
  }

  function normalizeEvent(value: JsonObject) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const role = String(value.role || "").trim();
    if (!["user", "assistant", "system", "action"].includes(role)) return null;
    const content = sessionContent(value.content || "");
    if (!content && role !== "action") return null;
    return {
      id: randomUUID(),
      at: new Date().toISOString(),
      role,
      content,
      action: value.action ? clippedText(value.action, actionLimit) : null,
      ok: typeof value.ok === "boolean" ? value.ok : null,
      contextUsed: value.contextUsed && typeof value.contextUsed === "object" ? value.contextUsed : null,
    };
  }

  async function appendEvent(sessionId: string, event: JsonObject) {
    const id = safeSessionId(sessionId);
    const normalized = normalizeEvent(event);
    if (!id || !normalized) return null;
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) throw new Error(`web session persistence skipped: ${client?.reason || "database url is not configured"}`);
    try {
      await client.db.insert(webSessionEvents).values({
        eventId: normalized.id,
        sessionId: id,
        role: normalized.role,
        content: normalized.content,
        action: normalized.action,
        ok: normalized.ok,
        contextUsed: normalized.contextUsed,
        occurredAt: new Date(normalized.at),
      });
      return normalized;
    } catch (error: any) {
      throw new Error(`web session persistence failed: ${error.message}`);
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function readEvents(sessionId: string, limit = eventLimit) {
    const id = safeSessionId(sessionId);
    if (!id) return null;
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return [];
    try {
      const rows = await client.db
        .select()
        .from(webSessionEvents)
        .where(eq(webSessionEvents.sessionId, id))
        .orderBy(desc(webSessionEvents.occurredAt))
        .limit(Math.max(Number(limit) || eventLimit, 1));
      return rows.reverse().map((row: JsonObject) => ({
        id: row.eventId,
        at: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : new Date(row.occurredAt).toISOString(),
        role: row.role,
        content: row.content,
        action: row.action,
        ok: row.ok,
        contextUsed: row.contextUsed,
      }));
    } catch (error: any) {
      throw new Error(`web session read failed: ${error.message}`);
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

  return {
    safeSessionId,
    normalizeEvent,
    appendEvent,
    readEvents,
    persistenceStatus,
  };
}

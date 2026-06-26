import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const agentTurns = pgTable("agent_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: text("session_id"),
  route: text("route").notNull(),
  input: jsonb("input").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  actionId: text("action_id"),
  decision: jsonb("decision"),
  evidence: jsonb("evidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const retrievalDocuments = pgTable("retrieval_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

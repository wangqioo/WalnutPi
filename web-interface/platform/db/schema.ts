import { bigserial, boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const platformMigrations = pgTable("platform_migrations", {
  id: text("id").primaryKey(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentTurns = pgTable("agent_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: text("session_id"),
  route: text("route").notNull(),
  input: jsonb("input").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentTurnSnapshots = pgTable("agent_turn_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  turnId: text("turn_id").notNull(),
  sessionId: text("session_id"),
  status: text("status").notNull(),
  route: jsonb("route"),
  input: jsonb("input").notNull(),
  turn: jsonb("turn").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentTurnEvents = pgTable("agent_turn_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  turnId: text("turn_id").notNull(),
  sessionId: text("session_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  stepId: text("step_id"),
  data: jsonb("data"),
  error: text("error"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webSessionEvents = pgTable("web_session_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  action: text("action"),
  ok: boolean("ok"),
  contextUsed: jsonb("context_used"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  operation: text("operation"),
  ok: boolean("ok"),
  status: integer("status"),
  decisionId: text("decision_id"),
  freshDecisionId: text("fresh_decision_id"),
  toolName: text("tool_name"),
  toolGroup: text("tool_group"),
  toolOperation: text("tool_operation"),
  actionId: text("action_id"),
  action: text("action"),
  route: text("route"),
  reason: text("reason"),
  sessionId: text("session_id"),
  turnId: text("turn_id"),
  traceId: text("trace_id"),
  requestId: text("request_id"),
  subjectKind: text("subject_kind"),
  deviceProfile: text("device_profile"),
  paramsHash: text("params_hash"),
  commandBindingId: text("command_binding_id"),
  subjectHash: text("subject_hash"),
  params: jsonb("params"),
  decision: jsonb("decision"),
  evidence: jsonb("evidence"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const user = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const session = pgTable("auth_session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const verification = pgTable("auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const walnutOrgs = pgTable("walnut_orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const walnutDevices = pgTable("walnut_devices", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => walnutOrgs.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  deviceProfile: text("device_profile").notNull(),
  target: text("target").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const walnutUserBindings = pgTable("walnut_user_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull().references(() => walnutOrgs.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().references(() => walnutDevices.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("walnut_user_bindings_user_device_role_idx").on(table.userId, table.deviceId, table.role),
]);

export const retrievalDocuments = pgTable("retrieval_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memoryCandidates = pgTable("memory_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceSessionId: text("source_session_id"),
  sourceTurnId: text("source_turn_id"),
  categoryKey: text("category_key").notNull(),
  candidateText: text("candidate_text").notNull(),
  status: text("status").notNull(),
  sourceTool: text("source_tool").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const durableMemoryRecords = pgTable("durable_memory_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceCandidateId: uuid("source_candidate_id").references(() => memoryCandidates.id, { onDelete: "set null" }),
  categoryKey: text("category_key").notNull(),
  memoryText: text("memory_text").notNull(),
  status: text("status").notNull(),
  approvedBySubjectKind: text("approved_by_subject_kind"),
  approvedByUserId: text("approved_by_user_id"),
  approvedByOrgId: text("approved_by_org_id"),
  approvedByDeviceId: text("approved_by_device_id"),
  sourceTool: text("source_tool").notNull(),
  metadata: jsonb("metadata"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memorySensitiveSkips = pgTable("memory_sensitive_skips", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceSessionId: text("source_session_id"),
  sourceTurnId: text("source_turn_id"),
  reason: text("reason").notNull(),
  textHash: text("text_hash").notNull(),
  textLength: integer("text_length").notNull(),
  sourceTool: text("source_tool").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const actionApprovalRecords = pgTable("action_approval_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  decisionId: text("decision_id").notNull(),
  actionId: text("action_id").notNull(),
  status: text("status").notNull(),
  paramsHash: text("params_hash").notNull(),
  commandBindingId: text("command_binding_id").notNull(),
  subjectHash: text("subject_hash").notNull(),
  approvalTokenHash: text("approval_token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  commitDecisionId: text("commit_decision_id"),
  subject: jsonb("subject").notNull(),
  decision: jsonb("decision").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

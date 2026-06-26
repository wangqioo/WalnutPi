import { desc } from "drizzle-orm";
import { createWalnutPostgresClient } from "../platform/db/client.ts";
import { auditEvents } from "../platform/db/schema.ts";

const DEFAULT_LIMIT = 1000;

type JsonObject = Record<string, any>;

export function createGatewayAuditLedger({
  limit = DEFAULT_LIMIT,
  postgresClientFactory = createWalnutPostgresClient,
}: { limit?: number; postgresClientFactory?: typeof createWalnutPostgresClient } = {}) {
  async function append(event: JsonObject) {
    const record = normalizeAuditEvent(event);
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) {
      return {
        ...record,
        persisted: false,
        skipped: true,
        persistenceReason: client?.reason || "database url is not configured",
      };
    }
    try {
      await client.db.insert(auditEvents).values({
        kind: record.kind,
        operation: record.operation,
        ok: record.ok,
        status: record.status,
        decisionId: record.decisionId,
        freshDecisionId: record.freshDecisionId,
        toolName: record.toolName,
        toolGroup: record.toolGroup,
        toolOperation: record.toolOperation,
        actionId: record.actionId,
        action: record.action,
        route: record.route,
        reason: record.reason,
        sessionId: record.sessionId,
        turnId: record.turnId,
        traceId: record.traceId,
        requestId: record.requestId,
        subjectKind: record.subjectKind,
        deviceProfile: record.deviceProfile,
        paramsHash: record.paramsHash,
        commandBindingId: record.commandBindingId,
        subjectHash: record.subjectHash,
        params: record.params,
        decision: record.decision,
        evidence: record.evidence,
        result: record.result,
        error: record.error,
      });
      return {
        ...record,
        persisted: true,
        skipped: false,
        persistenceReason: null,
      };
    } catch (error: any) {
      return {
        ...record,
        persisted: false,
        skipped: true,
        persistenceReason: `db-write-unavailable:${error.message}`,
      };
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function readRecent(requestedLimit = limit) {
    const client = postgresClientFactory();
    if (!client?.ok || !client.db) return [];
    try {
      const rows = await client.db.select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.createdAt))
        .limit(Math.max(1, requestedLimit));
      return rows.reverse().map(recordFromRow);
    } catch {
      return [];
    } finally {
      await client.sql?.end?.({ timeout: 1 });
    }
  }

  async function readPublicRecent(requestedLimit = 100) {
    const rows = await readRecent(Math.max(1, Math.min(200, requestedLimit)));
    return rows.map(publicGatewayAuditEventFromRecord);
  }

  return {
    append,
    readRecent,
    readPublicRecent,
  };
}

function normalizeAuditEvent(event: JsonObject) {
  return {
    schema: "walnutpi.gatewayAuditEvent.v1",
    timestamp: new Date().toISOString(),
    kind: clippedText(event.kind || "event", 80) || "event",
    operation: stringOrNull(event.operation || event.toolOperation, 120),
    ok: typeof event.ok === "boolean" ? event.ok : null,
    status: typeof event.status === "number" ? event.status : null,
    decisionId: stringOrNull(event.decisionId, 120),
    freshDecisionId: stringOrNull(event.freshDecisionId, 120),
    toolName: stringOrNull(event.toolName, 120),
    toolGroup: stringOrNull(event.toolGroup, 40),
    toolOperation: stringOrNull(event.toolOperation, 120),
    actionId: stringOrNull(event.actionId, 120),
    action: stringOrNull(event.action, 120),
    route: stringOrNull(event.route, 120),
    reason: stringOrNull(event.reason, 300),
    sessionId: stringOrNull(event.sessionId, 120),
    turnId: stringOrNull(event.turnId, 120),
    traceId: stringOrNull(event.traceId, 120),
    requestId: stringOrNull(event.requestId, 120),
    subjectKind: stringOrNull(event.subjectKind, 80),
    deviceProfile: stringOrNull(event.deviceProfile, 80),
    paramsHash: stringOrNull(event.paramsHash, 120),
    commandBindingId: stringOrNull(event.commandBindingId, 160),
    subjectHash: stringOrNull(event.subjectHash, 120),
    params: objectOrNull(event.params),
    decision: objectOrNull(event.decision),
    evidence: objectOrNull(event.evidence),
    result: objectOrNull(event.result),
    error: stringOrNull(event.error, 1000),
  };
}

function recordFromRow(row: JsonObject) {
  return {
    schema: "walnutpi.gatewayAuditEvent.v1",
    timestamp: dateIso(row.createdAt),
    kind: row.kind,
    operation: row.operation,
    ok: row.ok,
    status: row.status,
    decisionId: row.decisionId,
    freshDecisionId: row.freshDecisionId,
    toolName: row.toolName,
    toolGroup: row.toolGroup,
    toolOperation: row.toolOperation,
    actionId: row.actionId,
    action: row.action,
    route: row.route,
    reason: row.reason,
    sessionId: row.sessionId,
    turnId: row.turnId,
    traceId: row.traceId,
    requestId: row.requestId,
    subjectKind: row.subjectKind,
    deviceProfile: row.deviceProfile,
    paramsHash: row.paramsHash,
    commandBindingId: row.commandBindingId,
    subjectHash: row.subjectHash,
    params: row.params,
    decision: row.decision,
    evidence: row.evidence,
    result: row.result,
    error: row.error,
    persisted: true,
    skipped: false,
  };
}

function stringOrNull(value: any, limit = 120) {
  if (value === null || value === undefined || value === "") return null;
  return clippedText(value, limit) || null;
}

function clippedText(value: any, limit: number) {
  return String(value || "").slice(0, limit);
}

function objectOrNull(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function dateIso(value: any) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function publicGatewayAuditEventFromRecord(event: JsonObject) {
  const decision = objectOrNull(event.decision);
  const result = objectOrNull(event.result);
  const evidence = objectOrNull(event.evidence);
  return {
    schema: "walnutpi.gatewayAuditEvent.public.v1",
    timestamp: event.timestamp,
    kind: event.kind,
    operation: event.operation,
    ok: event.ok,
    status: event.status,
    actionId: event.actionId,
    toolName: event.toolName,
    toolOperation: event.toolOperation,
    sessionId: event.sessionId,
    turnId: event.turnId,
    traceId: event.traceId,
    requestId: event.requestId,
    subjectKind: event.subjectKind,
    deviceProfile: event.deviceProfile,
    decisionId: event.decisionId || decision?.decisionId || null,
    freshDecisionId: event.freshDecisionId,
    paramsHash: event.paramsHash,
    subjectHash: event.subjectHash,
    commandBindingId: event.commandBindingId,
    reason: event.reason || decision?.reason || null,
    policy: decision ? {
      schema: decision.schema || null,
      engine: decision.engine || null,
      actionId: decision.actionId || event.actionId || null,
      allow: typeof decision.allow === "boolean" ? decision.allow : null,
      status: decision.status || null,
      reason: decision.reason || null,
      risk: decision.audit?.risk || null,
      policyVersion: decision.audit?.policyVersion || null,
      matchedRules: Array.isArray(decision.audit?.matchedRules)
        ? decision.audit.matchedRules.map(String).slice(0, 8)
        : [],
      noCommandExecution: decision.evidence?.noCommandExecution === true,
    } : null,
    result: result ? {
      schema: result.schema || null,
      family: result.family || null,
      ok: typeof result.ok === "boolean" ? result.ok : null,
      operation: result.result?.operation || result.diagnostics?.operation || null,
      actionId: result.result?.actionId || null,
      policyDecisionId: result.diagnostics?.policyDecisionId || null,
    } : null,
    evidenceSummary: evidence ? {
      noCommandExecution: evidence.noCommandExecution === true,
      noRemoteCommandExecution: evidence.noRemoteCommandExecution === true,
      pendingLocalAction: evidence.pendingLocalAction === true,
      preparedLocalAction: evidence.preparedLocalAction === true,
      highRiskDirectExecutionBlocked: evidence.highRiskDirectExecutionBlocked === true,
      dbProductStatePersisted: evidence.dbProductState?.persisted ?? null,
    } : null,
    payloadsRedacted: true,
    persisted: event.persisted === true,
  };
}

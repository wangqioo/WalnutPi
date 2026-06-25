import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_LIMIT = 1000;

type JsonObject = Record<string, any>;

export function createGatewayAuditLedger({ auditPath, limit = DEFAULT_LIMIT }: { auditPath: string; limit?: number }) {
  async function append(event: JsonObject) {
    const record = normalizeAuditEvent(event);
    try {
      await mkdir(path.dirname(auditPath), { recursive: true });
      await writeFile(auditPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
    } catch {
      // Audit must not break user workflows.
    }
    return record;
  }

  async function readRecent(requestedLimit = limit) {
    try {
      const data = await readFile(auditPath, "utf8");
      return data
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-Math.max(1, requestedLimit))
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  return {
    append,
    readRecent,
  };
}

function normalizeAuditEvent(event: JsonObject) {
  return {
    schema: "walnutpi.gatewayAuditEvent.v1",
    timestamp: new Date().toISOString(),
    kind: String(event.kind || "event").slice(0, 80),
    operation: String(event.operation || "").slice(0, 120),
    ok: typeof event.ok === "boolean" ? event.ok : null,
    status: typeof event.status === "number" ? event.status : null,
    decisionId: stringOrNull(event.decisionId, 120),
    toolName: stringOrNull(event.toolName, 120),
    toolGroup: stringOrNull(event.toolGroup, 40),
    actionId: stringOrNull(event.actionId, 120),
    action: stringOrNull(event.action, 120),
    route: stringOrNull(event.route, 120),
    reason: stringOrNull(event.reason, 200),
    sessionId: stringOrNull(event.sessionId, 120),
    turnId: stringOrNull(event.turnId, 120),
    traceId: stringOrNull(event.traceId, 120),
    requestId: stringOrNull(event.requestId, 120),
    params: objectOrNull(event.params),
    decision: objectOrNull(event.decision),
    result: objectOrNull(event.result),
    error: stringOrNull(event.error, 500),
  };
}

function stringOrNull(value: any, limit = 120) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).slice(0, limit);
}

function objectOrNull(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

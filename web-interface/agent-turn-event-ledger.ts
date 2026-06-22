import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EVENT_SCHEMA = "walnutpi.agentTurnEvent.v1";

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

export function createAgentTurnEventLedger({ eventsPath, eventBus = null, limit = 500 }: { eventsPath: string; eventBus?: any; limit?: number }) {
  let nextSeq = 1;
  let loaded = false;
  let appendLock: Promise<AgentTurnEventRecord | null> = Promise.resolve(null);

  async function ensureSeq() {
    if (loaded) return;
    loaded = true;
    const events = await readEvents({ count: 1 });
    nextSeq = (events.at(-1)?.seq || 0) + 1;
  }

  async function appendEvent(event: AgentTurnEvent): Promise<AgentTurnEventRecord> {
    appendLock = appendLock.catch(() => null).then(async () => {
      await ensureSeq();
      const record: AgentTurnEventRecord = {
        schema: EVENT_SCHEMA,
        turnId: event.turnId,
        sessionId: event.sessionId || null,
        seq: nextSeq++,
        kind: event.kind,
        status: event.status,
        timestamp: event.timestamp || new Date().toISOString(),
        ...(event.stepId ? { stepId: event.stepId } : {}),
        ...(event.data !== undefined ? { data: event.data } : {}),
        ...(event.error ? { error: String(event.error) } : {}),
      };
      await mkdir(path.dirname(eventsPath), { recursive: true });
      await writeFile(eventsPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
      eventBus?.publish(record);
      return record;
    });
    return appendLock as Promise<AgentTurnEventRecord>;
  }

  async function readEvents({ sessionId = null, turnId = null, afterSeq = 0, count = limit }: { sessionId?: string | null; turnId?: string | null; afterSeq?: number; count?: number } = {}) {
    let data = "";
    try {
      data = await readFile(eventsPath, "utf8");
    } catch {
      return [];
    }
    const events: AgentTurnEventRecord[] = [];
    for (const line of data.split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (sessionId && event.sessionId !== sessionId) continue;
        if (turnId && event.turnId !== turnId) continue;
        if (Number(event.seq || 0) <= Number(afterSeq || 0)) continue;
        events.push(event);
      } catch {
        // Tolerate corrupt trailing JSONL; the next append still works.
      }
    }
    return events.slice(-Math.max(Number(count) || limit, 1));
  }

  return { appendEvent, readEvents };
}

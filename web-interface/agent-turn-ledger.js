import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function createAgentTurnLedger({ turnsPath, limit = 100 }) {
  async function appendTurn(turn) {
    if (!turn || typeof turn !== "object") return null;
    await mkdir(path.dirname(turnsPath), { recursive: true });
    await writeFile(turnsPath, `${JSON.stringify(turn)}\n`, { encoding: "utf8", flag: "a" });
    return turn;
  }

  async function readTurns({ sessionId = null, count = limit } = {}) {
    let data = "";
    try {
      data = await readFile(turnsPath, "utf8");
    } catch {
      return [];
    }
    const turns = [];
    for (const line of data.split(/\r?\n/).filter(Boolean)) {
      try {
        const turn = JSON.parse(line);
        if (!sessionId || turn.sessionId === sessionId) turns.push(turn);
      } catch {
        // Ignore corrupt trailing lines; append-only logs should remain readable.
      }
    }
    return latestTurnSnapshots(turns).slice(-Math.max(count, 1));
  }

  return { appendTurn, readTurns };
}

function latestTurnSnapshots(turns) {
  const byTurnId = new Map();
  const order = [];
  for (const turn of turns) {
    const key = turn.turnId || `anonymous-${order.length}`;
    if (!byTurnId.has(key)) order.push(key);
    const previous = byTurnId.get(key);
    byTurnId.set(key, preferTurnSnapshot(previous, turn));
  }
  return order.map((key) => byTurnId.get(key));
}

function preferTurnSnapshot(previous, next) {
  if (!previous) return next;
  if (snapshotRank(next) > snapshotRank(previous)) return next;
  if (snapshotRank(next) < snapshotRank(previous)) return previous;
  return next;
}

function snapshotRank(turn) {
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

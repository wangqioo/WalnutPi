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
    return turns.slice(-Math.max(count, 1));
  }

  return { appendTurn, readTurns };
}

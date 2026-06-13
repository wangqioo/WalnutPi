import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function clippedText(value, limit) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function sessionContent(value) {
  return String(value || "").replace(/\0/g, "").trim();
}

export function createWebSessionLedger({
  sessionsDir,
  eventLimit = 300,
  actionLimit = 120,
  commandLimit = 1000,
}) {
  function safeSessionId(value) {
    const text = String(value || "").trim();
    if (!/^[a-zA-Z0-9._-]{8,80}$/.test(text) || text.includes("..") || text.startsWith(".")) return null;
    return text;
  }

  function sessionPath(sessionId) {
    const id = safeSessionId(sessionId);
    if (!id) return null;
    return path.join(sessionsDir, `${id}.jsonl`);
  }

  function normalizeEvent(value) {
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
      command: value.command ? clippedText(value.command, commandLimit) : null,
      contextUsed: value.contextUsed && typeof value.contextUsed === "object" ? value.contextUsed : null,
    };
  }

  async function appendEvent(sessionId, event) {
    const filePath = sessionPath(sessionId);
    const normalized = normalizeEvent(event);
    if (!filePath || !normalized) return null;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(normalized)}\n`, { encoding: "utf8", flag: "a" });
    return normalized;
  }

  async function readEvents(sessionId, limit = eventLimit) {
    const filePath = sessionPath(sessionId);
    if (!filePath) return null;
    let data = "";
    try {
      data = await readFile(filePath, "utf8");
    } catch {
      return [];
    }
    const lines = data.split(/\r?\n/).filter(Boolean);
    const events = [];
    for (const line of lines.slice(-limit)) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object") events.push(parsed);
      } catch {
        // Ignore corrupt trailing lines; append-only history should still be readable.
      }
    }
    return events;
  }

  return {
    safeSessionId,
    normalizeEvent,
    appendEvent,
    readEvents,
  };
}

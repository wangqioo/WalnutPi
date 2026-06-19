import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function createAgentHarnessSessionStore({ filePath }) {
  function safeSessionId(value) {
    const text = String(value || "").trim();
    if (!/^[a-zA-Z0-9._:-]{4,120}$/.test(text) || text.includes("..") || text.startsWith(".")) return null;
    return text;
  }

  async function readAll() {
    try {
      const data = JSON.parse(await readFile(filePath, "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  async function writeAll(data) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(`${filePath}.tmp`, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rm(filePath, { force: true });
    await rename(`${filePath}.tmp`, filePath);
  }

  async function upsertSession(value) {
    const sessionId = safeSessionId(value?.sessionId);
    if (!sessionId) throw new Error("invalid harness session id");
    const now = new Date().toISOString();
    const all = await readAll();
    const previous = all[sessionId] || {};
    const next = {
      schema: "walnutpi.agentHarnessSession.v1",
      sessionId,
      harnessName: String(value.harnessName || previous.harnessName || "walnut-ai"),
      threadId: String(value.threadId || previous.threadId || ""),
      runId: String(value.runId || previous.runId || ""),
      status: String(value.status || previous.status || "idle"),
      resumeState: value.resumeState && typeof value.resumeState === "object" ? value.resumeState : previous.resumeState || {},
      pendingApproval: value.pendingApproval ?? previous.pendingApproval ?? null,
      createdAt: previous.createdAt || now,
      updatedAt: now,
    };
    all[sessionId] = next;
    await writeAll(all);
    return next;
  }

  async function readSession(sessionId) {
    const id = safeSessionId(sessionId);
    if (!id) return null;
    return (await readAll())[id] || null;
  }

  return { safeSessionId, readAll, readSession, upsertSession };
}

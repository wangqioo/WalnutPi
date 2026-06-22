export function createProjectMemoryApi({
  webSessionLedger,
  readWalnutMemory,
  retrieveWalnutContext,
  memoryFile,
  skillsDir,
  corpusDir,
  eventLimit,
  readJsonRequest,
  json,
}) {
  return {
    async handleSession(req, url) {
      const sessionId = webSessionLedger.safeSessionId(url.searchParams.get("sessionId"));
      if (!sessionId) return json({ ok: false, error: "invalid sessionId" }, 400);

      if (req.method === "GET") {
        const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || eventLimit) || eventLimit));
        const events = await webSessionLedger.readEvents(sessionId, limit);
        return json({
          ok: true,
          schema: "walnutpi.webSession.v1",
          sessionId,
          events: events || [],
        });
      }

      if (req.method === "POST") {
        let body;
        try {
          body = await readJsonRequest(req);
        } catch (error) {
          return json({ ok: false, error: error.message }, 400);
        }
        const event = await webSessionLedger.appendEvent(sessionId, body.event || body);
        if (!event) return json({ ok: false, error: "invalid session event" }, 400);
        return json({ ok: true, schema: "walnutpi.webSessionAppend.v1", sessionId, event });
      }

      return json({ ok: false, error: "Method not allowed" }, 405);
    },

    async handleMemory() {
      const memory = await readWalnutMemory();
      return json({
        ok: true,
        schema: "walnutpi.memoryView.v1",
        memoryFile,
        memory,
      });
    },

    async handleRetrieval(url) {
      const query = url.searchParams.get("query") || "";
      const results = await retrieveWalnutContext(query);
      return json({
        ok: true,
        schema: "walnutpi.retrievalView.v1",
        query,
        skillsDir,
        corpusDir,
        results,
      });
    },

    async handleProjectMemory(url) {
      const query = url.searchParams.get("query") || "";
      const [memory, retrieval] = await Promise.all([
        readWalnutMemory(),
        retrieveWalnutContext(query),
      ]);
      return json({
        ok: true,
        schema: "walnutpi.projectMemoryView.v1",
        query,
        memoryFile,
        skillsDir,
        corpusDir,
        memory,
        retrieval,
      });
    },
  };
}

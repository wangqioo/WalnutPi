export function createProjectMemoryApi({
  webSessionLedger,
  readWalnutMemory,
  retrieveWalnutContextView,
  memoryFile,
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
          persistence: await webSessionLedger.persistenceStatus?.(),
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
        return json({
          ok: true,
          schema: "walnutpi.webSessionAppend.v1",
          sessionId,
          persistence: await webSessionLedger.persistenceStatus?.(),
          event,
        });
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
      const retrieval = await retrieveWalnutContextView(query);
      if (!retrieval.ok) {
        return json({
          ok: false,
          schema: "walnutpi.retrievalView.v1",
          query,
          source: "postgres-curated",
          error: "curated retrieval is unavailable",
          reason: retrieval.reason || null,
        }, 503);
      }
      return json({
        ok: true,
        schema: "walnutpi.retrievalView.v1",
        query,
        source: "postgres-curated",
        policy: {
          approvedDurableMemory: true,
          curatedCorpus: true,
          rawSessionLogs: false,
          rawDailyNotes: false,
        },
        results: retrieval.results,
      });
    },

    async handleProjectMemory(url) {
      const query = url.searchParams.get("query") || "";
      const [memory, retrieval] = await Promise.all([
        readWalnutMemory(),
        retrieveWalnutContextView(query),
      ]);
      if (!retrieval.ok) {
        return json({
          ok: false,
          schema: "walnutpi.projectMemoryView.v1",
          query,
          memoryFile,
          retrievalSource: "postgres-curated",
          error: "curated retrieval is unavailable",
          reason: retrieval.reason || null,
          memory,
        }, 503);
      }
      return json({
        ok: true,
        schema: "walnutpi.projectMemoryView.v1",
        query,
        memoryFile,
        retrievalSource: "postgres-curated",
        memory,
        retrieval: retrieval.results,
      });
    },
  };
}

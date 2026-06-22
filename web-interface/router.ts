export function createRouter(deps) {
  return async function routerFetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/terminal") {
      if (deps.previewOnly(url)) {
        return new Response("SSH disabled for preview", { status: 403 });
      }
      const upgraded = server.upgrade(req, { data: { child: null, command: url.searchParams.get("command") || "" } });
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/actions") {
      return deps.json(deps.agentActionsApi.actionPolicyView({
        target: `${deps.config.SSH_USER}@${deps.config.SSH_HOST}`,
        manifest: {
          schema: deps.actionPolicyManifest.schema,
          version: deps.actionPolicyManifest.version,
          path: deps.path.relative(deps.config.PROJECT_ROOT, deps.config.ACTION_POLICY_MANIFEST_PATH).replaceAll("\\", "/"),
        },
      }));
    }

    if (url.pathname === "/api/memory") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.projectMemoryApi.handleMemory();
    }

    if (url.pathname === "/api/retrieval") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.projectMemoryApi.handleRetrieval(url);
    }

    if (url.pathname === "/api/project-memory") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.projectMemoryApi.handleProjectMemory(url);
    }

    if (url.pathname === "/api/metrics") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      const limit = Number(url.searchParams.get("limit") || 200);
      return deps.json(await deps.webMetricsLedger.report(
        Number.isFinite(limit) ? limit : 200,
        { since: url.searchParams.get("since") || null },
      ));
    }

    if (url.pathname === "/api/session") {
      return deps.projectMemoryApi.handleSession(req, url);
    }

    if (url.pathname === "/api/intent/classify") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.handleIntentClassify(req);
    }

    if (url.pathname === "/api/agent/turn") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      if (deps.previewOnly(url)) return deps.previewOnlyJson();
      return deps.agentTurnLoop.handleTurn(req);
    }

    if (url.pathname === "/api/agent/turns") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.agentTurnLoop.handleTurns(url);
    }

    if (url.pathname === "/api/agent/turn-events") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.agentTurnLoop.handleTurnEvents(url);
    }

    if (url.pathname === "/api/agent/events") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.handleAgentEvents(req, url);
    }

    if (url.pathname === "/api/agent/harness-session") {
      if (req.method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        return deps.json({ ok: true, session: await deps.agentHarnessSessionStore.readSession(sessionId) });
      }
      if (req.method === "POST") {
        let body;
        try {
          body = await deps.readJsonRequest(req);
        } catch (error) {
          return deps.json({ ok: false, error: error.message }, 400);
        }
        try {
          return deps.json({ ok: true, session: await deps.agentHarnessSessionStore.upsertSession(body) });
        } catch (error) {
          return deps.json({ ok: false, error: error.message }, 400);
        }
      }
      return deps.json({ ok: false, error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/screen/workspace/playlist") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleScreenWorkspacePlaylist(url);
    }

    if (url.pathname === "/api/screen/workspace/process") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleScreenWorkspaceProcess(req);
    }

    if (url.pathname === "/api/screen/workspace/import") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleScreenWorkspaceImport(req);
    }

    if (url.pathname === "/api/screen/workspace/generate") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleScreenWorkspaceGenerate(req);
    }

    if (url.pathname === "/api/screen/workspace/lvgl-preview") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleScreenWorkspaceLvglPreview(req);
    }

    if (url.pathname === "/api/screen/lvgl-demo-preview") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleLvglDemoPreview(url);
    }

    if (url.pathname === "/api/screen/lvgl-apps") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleLvglAppList();
    }

    if (url.pathname === "/api/screen/lvgl-app/activate") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleLvglAppActivate(req);
    }

    const lvglAppDownloadMatch = url.pathname.match(/^\/api\/screen\/lvgl-apps\/([^/]+)\/download$/);
    if (lvglAppDownloadMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      try {
        appId = decodeURIComponent(lvglAppDownloadMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "invalid app id" }, 400);
      }
      return deps.screenWorkspaceApi.handleLvglAppDownload(appId);
    }

    const iocccAppMatch = url.pathname.match(/^\/api\/screen\/ioccc-apps\/([^/]+)$/);
    if (iocccAppMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      try {
        appId = decodeURIComponent(iocccAppMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "invalid IOCCC app id" }, 400);
      }
      return deps.screenWorkspaceApi.handleIocccAppGet(appId);
    }

    const iocccAppPageMatch = url.pathname.match(/^\/api\/screen\/ioccc-apps\/([^/]+)\/page$/);
    if (iocccAppPageMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      try {
        appId = decodeURIComponent(iocccAppPageMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "invalid IOCCC app id" }, 400);
      }
      return deps.screenWorkspaceApi.handleIocccAppPage(appId);
    }

    const iocccAppAssetMatch = url.pathname.match(/^\/api\/screen\/ioccc-apps\/([^/]+)\/assets\/(.+)$/);
    if (iocccAppAssetMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      let assetPath;
      try {
        appId = decodeURIComponent(iocccAppAssetMatch[1]);
        assetPath = decodeURIComponent(iocccAppAssetMatch[2]);
      } catch {
        return deps.json({ ok: false, error: "invalid IOCCC asset path" }, 400);
      }
      return deps.screenWorkspaceApi.handleIocccAppAsset(appId, assetPath);
    }

    const iocccAppDownloadMatch = url.pathname.match(/^\/api\/screen\/ioccc-apps\/([^/]+)\/download$/);
    if (iocccAppDownloadMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      try {
        appId = decodeURIComponent(iocccAppDownloadMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "invalid IOCCC app id" }, 400);
      }
      return deps.screenWorkspaceApi.handleIocccAppDownload(appId);
    }

    if (url.pathname === "/api/screen/workspace/sync") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleScreenWorkspaceSync(req, deps.previewOnly(url) ? "preview" : "remote");
    }

    if (url.pathname === "/api/screen/widget-apps") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppList();
    }

    if (url.pathname === "/api/screen/widget-apps/current/runtime") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppRuntime();
    }

    if (url.pathname === "/api/screen/widget-apps/current/refresh") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppRefresh();
    }

    if (url.pathname === "/api/screen/widget-apps/current/events") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppEvent(req);
    }

    if (url.pathname === "/api/screen/widget-apps/current/sync") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppSync();
    }

    const widgetAppDownloadMatch = url.pathname.match(/^\/api\/screen\/widget-apps\/([^/]+)\/download$/);
    if (widgetAppDownloadMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      try {
        appId = decodeURIComponent(widgetAppDownloadMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "Invalid widget app id" }, 400);
      }
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppDownload(appId);
    }

    const widgetAppActivateMatch = url.pathname.match(/^\/api\/screen\/widget-apps\/([^/]+)\/activate$/);
    if (widgetAppActivateMatch) {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      try {
        appId = decodeURIComponent(widgetAppActivateMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "Invalid widget app id" }, 400);
      }
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppActivate({ appId });
    }

    const widgetAppMatch = url.pathname.match(/^\/api\/screen\/widget-apps\/([^/]+)$/);
    if (widgetAppMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let appId;
      try {
        appId = decodeURIComponent(widgetAppMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "Invalid widget app id" }, 400);
      }
      return deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppGet(appId);
    }

    const screenWorkspaceManifestMatch = url.pathname.match(/^\/api\/screen\/workspace\/manifest\/([^/]+)$/);
    if (screenWorkspaceManifestMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let manifestId;
      try {
        manifestId = decodeURIComponent(screenWorkspaceManifestMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "Invalid screen workspace manifest id" }, 400);
      }
      return deps.screenWorkspaceApi.handleScreenWorkspaceManifest(manifestId);
    }

    if (url.pathname.startsWith("/api/screen/workspace/assets/")) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenWorkspaceApi.handleScreenWorkspaceAsset(url);
    }

    if (url.pathname === "/api/screen/pixel-diff") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenDiagnosticsApi.handleScreenPixelDiff(req, deps.readJsonRequest);
    }

    if (url.pathname === "/api/screen/records") {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      return deps.screenDiagnosticsApi.handleScreenRecordList();
    }

    const screenRecordFrameMatch = url.pathname.match(/^\/api\/screen\/records\/([^/]+)\/frame\.png$/);
    if (screenRecordFrameMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let buildId;
      try {
        buildId = decodeURIComponent(screenRecordFrameMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "Invalid screen record id" }, 400);
      }
      return deps.screenDiagnosticsApi.handleScreenRecordFrame(buildId);
    }

    const screenRecordMatch = url.pathname.match(/^\/api\/screen\/records\/([^/]+)$/);
    if (screenRecordMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      let buildId;
      try {
        buildId = decodeURIComponent(screenRecordMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "Invalid screen record id" }, 400);
      }
      return deps.screenDiagnosticsApi.handleScreenRecord(buildId);
    }

    const screenFrameMatch = url.pathname.match(/^\/api\/screen\/frame\/([^/]+)$/);
    if (screenFrameMatch) {
      if (req.method !== "GET") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      if (deps.previewOnly(url)) return deps.previewOnlyJson();
      let buildId;
      try {
        buildId = decodeURIComponent(screenFrameMatch[1]);
      } catch {
        return deps.json({ ok: false, error: "Invalid screen frame id" }, 400);
      }
      return deps.screenDiagnosticsApi.handleScreenFrame(buildId);
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") return deps.json({ ok: false, error: "Method not allowed" }, 405);
      if (deps.previewOnly(url)) return deps.previewOnlyJson();
      return deps.agentActionsApi.handleAction(req);
    }

    return (await deps.staticUiHost.handle(url.pathname)) || new Response("Not found", { status: 404 });
  };
}

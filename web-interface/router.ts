const METHOD_NOT_ALLOWED = { ok: false, error: "Method not allowed" };

export function createRouter(deps) {
  const staticRoutes = createStaticRoutes(deps);
  const dynamicRoutes = createDynamicRoutes(deps);

  return async function routerFetch(req, server) {
    const url = new URL(req.url);

    const route = staticRoutes[url.pathname];
    if (route) return route(req, url);

    for (const dynamicRoute of dynamicRoutes) {
      const match = url.pathname.match(dynamicRoute.pattern);
      if (match) return dynamicRoute.handle(req, url, match);
    }

    if (url.pathname.startsWith("/api/screen/workspace/assets/")) {
      return requireMethod(req, deps, "GET") || deps.screenWorkspaceApi.handleScreenWorkspaceAsset(url);
    }

    return (await deps.staticUiHost.handle(url.pathname)) || new Response("Not found", { status: 404 });
  };
}

function createStaticRoutes(deps) {
  return {
    "/api/actions": () => deps.json(deps.agentActionsApi.actionPolicyView({
      target: `${deps.config.SSH_USER}@${deps.config.SSH_HOST}`,
      manifest: {
        schema: deps.actionPolicyManifest.schema,
        version: deps.actionPolicyManifest.version,
        path: deps.path.relative(deps.config.PROJECT_ROOT, deps.config.ACTION_POLICY_MANIFEST_PATH).replaceAll("\\", "/"),
      },
    })),
    "/api/memory": method("GET", deps, () => deps.projectMemoryApi.handleMemory()),
    "/api/retrieval": method("GET", deps, (_req, url) => deps.projectMemoryApi.handleRetrieval(url)),
    "/api/project-memory": method("GET", deps, (_req, url) => deps.projectMemoryApi.handleProjectMemory(url)),
    "/api/metrics": method("GET", deps, async (_req, url) => {
      const limit = Number(url.searchParams.get("limit") || 200);
      return deps.json(await deps.webMetricsLedger.report(
        Number.isFinite(limit) ? limit : 200,
        { since: url.searchParams.get("since") || null },
      ));
    }),
    "/api/session": (req, url) => deps.projectMemoryApi.handleSession(req, url),
    "/api/intent/classify": method("POST", deps, (req) => deps.handleIntentClassify(req)),
    "/api/agent/turn": method("POST", deps, (req, url) =>
      deps.previewOnly(url) ? deps.previewOnlyJson() : deps.agentPlatform.handleTurn(req)),
    "/api/agent/turns": method("GET", deps, (_req, url) => deps.agentPlatform.handleTurns(url)),
    "/api/agent/turn-events": method("GET", deps, (_req, url) => deps.agentPlatform.handleTurnEvents(url)),
    "/api/agent/events": method("GET", deps, (req, url) => deps.handleAgentEvents(req, url)),
    "/api/agent/harness-session": (req, url) => handleHarnessSession(req, url, deps),
    "/api/screen/workspace/playlist": method("GET", deps, (_req, url) => deps.screenWorkspaceApi.handleScreenWorkspacePlaylist(url)),
    "/api/screen/workspace/process": method("POST", deps, (req) => deps.screenWorkspaceApi.handleScreenWorkspaceProcess(req)),
    "/api/screen/workspace/import": method("POST", deps, (req) => deps.screenWorkspaceApi.handleScreenWorkspaceImport(req)),
    "/api/screen/workspace/generate": method("POST", deps, (req) => deps.screenWorkspaceApi.handleScreenWorkspaceGenerate(req)),
    "/api/screen/workspace/lvgl-preview": method("POST", deps, (req) => deps.screenWorkspaceApi.handleScreenWorkspaceLvglPreview(req)),
    "/api/screen/lvgl-demo-preview": method("GET", deps, (_req, url) => deps.screenWorkspaceApi.handleLvglDemoPreview(url)),
    "/api/screen/lvgl-apps": method("GET", deps, () => deps.screenWorkspaceApi.handleLvglAppList()),
    "/api/screen/lvgl-app/activate": method("POST", deps, (req) => deps.screenWorkspaceApi.handleLvglAppActivate(req)),
    "/api/screen/workspace/sync": method("POST", deps, (req, url) =>
      deps.screenWorkspaceApi.handleScreenWorkspaceSync(req, deps.previewOnly(url) ? "preview" : "remote")),
    "/api/screen/widget-apps": method("GET", deps, () => deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppList()),
    "/api/screen/widget-apps/create": method("POST", deps, (req) => deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppCreate(req)),
    "/api/screen/widget-apps/current/runtime": method("GET", deps, () => deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppRuntime()),
    "/api/screen/widget-apps/current/preview": method("POST", deps, () => deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppPreview()),
    "/api/screen/widget-apps/current/refresh": method("POST", deps, () => deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppRefresh()),
    "/api/screen/widget-apps/current/events": method("POST", deps, (req) => deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppEvent(req)),
    "/api/screen/widget-apps/current/sync": method("POST", deps, () => deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppSync()),
    "/api/screen/frame-diff": method("POST", deps, (req) => deps.screenDiagnosticsApi.handleScreenFrameDiff(req, deps.readJsonRequest)),
    "/api/screen/records": method("GET", deps, () => deps.screenDiagnosticsApi.handleScreenRecordList()),
    "/api/action": method("POST", deps, (req, url) =>
      deps.previewOnly(url) ? deps.previewOnlyJson() : deps.agentActionsApi.handleAction(req)),
  };
}

function createDynamicRoutes(deps) {
  return [
    route(/^\/api\/screen\/lvgl-apps\/([^/]+)\/download$/, "GET", deps, (appId) =>
      deps.screenWorkspaceApi.handleLvglAppDownload(appId)),
    route(/^\/api\/screen\/widget-apps\/([^/]+)\/download$/, "GET", deps, (appId) =>
      deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppDownload(appId), "Invalid widget app id"),
    route(/^\/api\/screen\/widget-apps\/([^/]+)\/activate$/, "POST", deps, (appId) =>
      deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppActivate({ appId }), "Invalid widget app id"),
    route(/^\/api\/screen\/widget-apps\/([^/]+)$/, "GET", deps, (appId) =>
      deps.screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppGet(appId), "Invalid widget app id"),
    route(/^\/api\/screen\/workspace\/manifest\/([^/]+)$/, "GET", deps, (manifestId) =>
      deps.screenWorkspaceApi.handleScreenWorkspaceManifest(manifestId), "Invalid screen workspace manifest id"),
    route(/^\/api\/screen\/records\/([^/]+)\/frame\.png$/, "GET", deps, (buildId) =>
      deps.screenDiagnosticsApi.handleScreenRecordFrame(buildId), "Invalid screen record id"),
    route(/^\/api\/screen\/records\/([^/]+)$/, "GET", deps, (buildId) =>
      deps.screenDiagnosticsApi.handleScreenRecord(buildId), "Invalid screen record id"),
    route(/^\/api\/screen\/frame\/([^/]+)$/, "GET", deps, (buildId, _req, url) =>
      deps.previewOnly(url) ? deps.previewOnlyJson() : deps.screenDiagnosticsApi.handleScreenFrame(buildId), "Invalid screen frame id"),
  ];
}

function method(expectedMethod, deps, handle) {
  return (req, url) => requireMethod(req, deps, expectedMethod) || handle(req, url);
}

function route(pattern, expectedMethod, deps, handle, invalidMessage = "invalid app id") {
  return {
    pattern,
    handle(req, url, match) {
      const methodError = requireMethod(req, deps, expectedMethod);
      if (methodError) return methodError;
      const id = decodePathPart(match[1], deps, invalidMessage);
      return id instanceof Response ? id : handle(id, req, url);
    },
  };
}

function requireMethod(req, deps, expectedMethod) {
  return req.method === expectedMethod ? null : deps.json(METHOD_NOT_ALLOWED, 405);
}

function decodePathPart(value, deps, message) {
  try {
    return decodeURIComponent(value);
  } catch {
    return deps.json({ ok: false, error: message }, 400);
  }
}

async function handleHarnessSession(req, url, deps) {
  if (req.method === "GET") {
    const sessionId = url.searchParams.get("sessionId");
    return deps.json({ ok: true, session: await deps.agentHarnessSessionStore.readSession(sessionId) });
  }
  if (req.method !== "POST") return deps.json(METHOD_NOT_ALLOWED, 405);
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

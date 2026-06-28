import { Hono } from "hono";
import { relative } from "node:path";
import { createGatewayToolCatalog } from "./tool-catalog.ts";
import { handleWalnutMcpRequest } from "../platform/mcp/server.ts";
import { createMcpAuthContext } from "./auth-context.ts";
import { createWalnutAuth, resolveWalnutSubjectFromRequest } from "../platform/auth/auth.ts";
import { readWalnutSubjectManagement, upsertWalnutSubjectManagement } from "../platform/auth/subject-management.ts";
import { createPendingEvalScore, getCuratedEvalCase, listCuratedEvalCases } from "../platform/eval/curated-eval.ts";
import { runCuratedEvalCasesThroughPlatform, selectCuratedEvalCases } from "../platform/eval/curated-eval-runner.ts";
import { createWalnutInngestServeHandler } from "../platform/inngest/client.ts";
import type { ActionPolicyManifest } from "../action-policy.ts";
import type { GatewayJson } from "./gateway-interfaces.ts";

type JsonObject = Record<string, any>;
type GatewayService = Record<string, any>;
type PathLike = {
  relative(from: string, to: string): string;
  join(...parts: string[]): string;
};

export type ProductGatewayAppDeps = {
  json: GatewayJson;
  previewOnly: (url: URL) => boolean;
  previewOnlyJson: () => Response;
  config: {
    ACTION_POLICY_MANIFEST_PATH: string;
    PROJECT_ROOT: string;
    SSH_HOST: string;
    SSH_USER: string;
  };
  path: PathLike;
  deviceActionsApi: GatewayService;
  actionPolicyManifest: ActionPolicyManifest;
  projectMemoryApi: GatewayService;
  webMetricsLedger: GatewayService;
  agentPlatform: GatewayService;
  handleAgentChat: (req: Request) => Promise<Response> | Response;
  handleAgentEvents: (req: Request, url: URL) => Promise<Response> | Response;
  readJsonRequest: (req: Request) => Promise<any>;
  screenWorkspaceApi: GatewayService;
  screenDiagnosticsApi: GatewayService;
  auditLedger: GatewayService;
  observabilityStatus?: () => JsonObject;
  langfuseReceipt?: (traceId: string | null) => Promise<JsonObject> | JsonObject;
  staticUiHost: {
    handle(pathname: string): Promise<Response | undefined> | Response | undefined;
  };
};

export function createProductGatewayApp({
  json,
  previewOnly,
  previewOnlyJson,
  config,
  path,
  deviceActionsApi,
  actionPolicyManifest,
  projectMemoryApi,
  webMetricsLedger,
  agentPlatform,
  handleAgentChat,
  handleAgentEvents,
  readJsonRequest,
  screenWorkspaceApi,
  screenDiagnosticsApi,
  auditLedger,
  observabilityStatus,
  langfuseReceipt,
  staticUiHost,
}: ProductGatewayAppDeps) {
  const app = new Hono();
  const gatewayTools = createGatewayToolCatalog({
    policyActions: actionPolicyManifest.actions || {},
  });

  registerProductRoutes(app, {
    json,
    config,
    path,
    deviceActionsApi,
    actionPolicyManifest,
    projectMemoryApi,
    webMetricsLedger,
    gatewayTools,
    auditLedger,
    observabilityStatus,
    readJsonRequest,
  });
  registerAgentRoutes(app, {
    json,
    previewOnly,
    previewOnlyJson,
    agentPlatform,
    handleAgentChat,
    handleAgentEvents,
  });
  registerGatewayRoutes(app, {
    json,
    config,
    agentPlatform,
    gatewayTools,
    auditLedger,
    observabilityStatus,
    langfuseReceipt,
    readJsonRequest,
  });
  registerAuthRoutes(app, { json, config });
  registerEvalRoutes(app, { agentPlatform, json });
  registerInngestRoutes(app, { agentPlatform });
  registerScreenRoutes(app, {
    json,
    previewOnly,
    previewOnlyJson,
    screenWorkspaceApi,
    screenDiagnosticsApi,
    readJsonRequest,
  });
  registerRetiredStaticConsoleRoutes(app);
  registerStaticUiFallback(app, staticUiHost);

  return app;
}

function registerProductRoutes(app: Hono, {
  json,
  config,
  path,
  deviceActionsApi,
  actionPolicyManifest,
  projectMemoryApi,
  webMetricsLedger,
  gatewayTools,
  auditLedger,
}: JsonObject) {
  app.get("/api/actions", () =>
    json(deviceActionsApi.actionPolicyView({
      target: `${config.SSH_USER}@${config.SSH_HOST}`,
      manifest: {
        schema: actionPolicyManifest.schema,
        version: actionPolicyManifest.version,
        path: relative(config.PROJECT_ROOT, config.ACTION_POLICY_MANIFEST_PATH).replaceAll("\\", "/"),
      },
    })),
  );
  app.get("/api/memory", () => projectMemoryApi.handleMemory());
  app.get("/api/retrieval", (c) => projectMemoryApi.handleRetrieval(new URL(c.req.url)));
  app.get("/api/project-memory", (c) => projectMemoryApi.handleProjectMemory(new URL(c.req.url)));
  app.get("/api/metrics", (c) => {
    const url = new URL(c.req.url);
    const limit = Number(url.searchParams.get("limit") || 200);
    return json(webMetricsLedger.report(
      Number.isFinite(limit) ? limit : 200,
      { since: url.searchParams.get("since") || null },
    ));
  });

  app.all("/api/session", (c) => projectMemoryApi.handleSession(c.req, new URL(c.req.url)));
}

function registerEvalRoutes(app: Hono, { agentPlatform, json }: JsonObject) {
  app.get("/api/eval/curated", (c) => {
    const suite = new URL(c.req.url).searchParams.get("suite");
    const cases = listCuratedEvalCases().filter((evalCase: JsonObject) => !suite || evalCase.suite === suite);
    return json({
      ok: true,
      schema: "walnutpi.curatedEvalCases.public.v1",
      cases,
      caseCount: cases.length,
      generatedBenchmarkHarnessRestored: false,
      redaction: {
        rawUserText: false,
        rawSessionLogs: false,
        rawDailyNotes: false,
        rawCommand: false,
      },
    });
  });
  app.get("/api/eval/curated/:caseId/score-shape", (c) => {
    const evalCase = getCuratedEvalCase(c.req.param("caseId"));
    if (!evalCase) return json({ ok: false, schema: "walnutpi.evalScoreShape.public.v1", error: "unknown curated eval case" }, 404);
    const variantId = new URL(c.req.url).searchParams.get("variantId") || "local-platform";
    return json({
      ok: true,
      schema: "walnutpi.evalScoreShape.public.v1",
      case: evalCase,
      score: createPendingEvalScore(evalCase, {
        variantId,
        reason: "score shape only; execution must attach redacted Mastra/MCP trace evidence",
        evidenceRefs: [`curated-eval-case:${evalCase.id}`],
      }),
      generatedBenchmarkHarnessRestored: false,
      redaction: {
        rawUserText: false,
        rawSessionLogs: false,
        rawDailyNotes: false,
        rawCommand: false,
      },
    });
  });
  app.post("/api/eval/curated/run", async (c) => {
    let body: JsonObject;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const allowDevice = body.allowDevice === true;
    const publishLangfuse = body.publishLangfuse !== false;
    const suite = body.suite ? String(body.suite) : null;
    const requestedCaseId = body.caseId ? String(body.caseId) : null;
    const selected = selectCuratedEvalCases({ caseId: requestedCaseId, suite });
    if (!selected.ok) {
      return json({ ok: false, schema: "walnutpi.curatedEvalRun.v1", error: selected.error }, selected.status);
    }
    return json(await runCuratedEvalCasesThroughPlatform({
      cases: selected.cases,
      variantId: body.variantId ? String(body.variantId) : "local-platform",
      allowDevice,
      publishLangfuse,
      datasetName: body.datasetName ? String(body.datasetName) : "walnutpi-curated-eval",
      runAgentTurn: (turnBody: JsonObject) => runAgentTurnViaPlatform(agentPlatform, turnBody),
    }));
  });
}

async function runAgentTurnViaPlatform(agentPlatform: JsonObject, body: JsonObject) {
  const response = await agentPlatform.handleTurn(new Request("http://127.0.0.1/api/agent/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return response.json();
}

function registerInngestRoutes(app: Hono, { agentPlatform }: JsonObject) {
  const handler = createWalnutInngestServeHandler({
    runAgentTurn: (turnBody: JsonObject) => runAgentTurnViaPlatform(agentPlatform, turnBody),
  });
  app.all("/api/inngest", (c) => handler(c));
}

function registerAuthRoutes(app: Hono, { json, config }: JsonObject) {
  app.get("/api/auth/subject", async (c) => {
    const subject = await resolveWalnutSubjectFromRequest(c.req.raw, {
      deviceProfile: "device",
      target: `${config.SSH_USER}@${config.SSH_HOST}`,
    });
    return json({
      ok: true,
      schema: "walnutpi.authSubject.v1",
      subject: publicSubject(subject),
    });
  });
  app.get("/api/auth/bindings", async (c) => {
    try {
      const subject = await resolveWalnutSubjectFromRequest(c.req.raw, {
        deviceProfile: "device",
        target: `${config.SSH_USER}@${config.SSH_HOST}`,
      });
      return json(await readWalnutSubjectManagement(subject));
    } catch (error: any) {
      return json({ ok: false, schema: "walnutpi.authSubjectManagement.v1", error: error.message }, error.status || 500);
    }
  });
  app.post("/api/auth/bindings/upsert", async (c) => {
    try {
      const subject = await resolveWalnutSubjectFromRequest(c.req.raw, {
        deviceProfile: "device",
        target: `${config.SSH_USER}@${config.SSH_HOST}`,
      });
      const body = await c.req.json().catch(() => ({}));
      return json(await upsertWalnutSubjectManagement(subject, body));
    } catch (error: any) {
      return json({ ok: false, schema: "walnutpi.authSubjectManagement.upsert.v1", error: error.message }, error.status || 500);
    }
  });
  app.all("/api/auth/*", (c) => createWalnutAuth().handler(c.req.raw));
}

function registerGatewayRoutes(app: Hono, {
  json,
  config,
  agentPlatform,
  gatewayTools,
  auditLedger,
  observabilityStatus,
  langfuseReceipt,
}: JsonObject) {
  app.get("/api/gateway/tools", () => json(gatewayTools.listTools()));
  app.get("/api/observability/status", () => json(observabilityStatus?.() || {
    ok: false,
    schema: "walnutpi.observability.status.v1",
    started: false,
    error: "observability status provider is not configured",
  }));
  app.get("/api/observability/langfuse/receipt", async (c) => {
    const traceId = new URL(c.req.url).searchParams.get("traceId");
    return json(langfuseReceipt
      ? await langfuseReceipt(traceId)
      : {
        ok: false,
        schema: "walnutpi.langfuseReceipt.v1",
        configured: false,
        traceId,
        received: false,
        trace: null,
        observations: {
          total: 0,
          walnut: 0,
          names: [],
          receivedRequired: [],
          missingRequired: [],
        },
        redaction: {
          input: false,
          output: false,
          metadata: false,
          rawAttributes: false,
        },
        error: "Langfuse receipt provider is not configured",
      });
  });
  app.get("/api/gateway/audit-events", async (c) => {
    const url = new URL(c.req.url);
    const limit = Number(url.searchParams.get("limit") || 50);
    const events = await auditLedger.readPublicRecent?.(Number.isFinite(limit) ? limit : 50);
    return json({
      ok: true,
      schema: "walnutpi.gatewayAuditEvents.public.v1",
      events: Array.isArray(events) ? events : [],
      redaction: {
        rawParams: false,
        rawDecision: false,
        rawResult: false,
        rawEvidence: false,
      },
    });
  });
  app.all("/mcp", async (c) => handleWalnutMcpRequest(c.req.raw, {
    auditLedger,
    authContext: await createMcpAuthContext(c.req.raw, {
      deviceProfile: "device",
      target: `${config.SSH_USER}@${config.SSH_HOST}`,
    }),
    toolCatalog: gatewayTools,
    toolDispatcher: agentPlatform.toolDispatcher(),
  }));
}

function publicSubject(subject: JsonObject) {
  return {
    kind: subject.kind || null,
    authenticated: Boolean(subject.authenticated),
    roles: Array.isArray(subject.roles) ? subject.roles.map(String) : [],
    userId: subject.userId || null,
    sessionId: subject.sessionId || null,
    orgId: subject.orgId || null,
    deviceId: subject.deviceId || null,
    deviceProfile: subject.deviceProfile || null,
    bindingSource: subject.bindingSource || null,
  };
}

function registerAgentRoutes(app: Hono, {
  json,
  previewOnly,
  previewOnlyJson,
  agentPlatform,
  handleAgentChat,
  handleAgentEvents,
}: JsonObject) {
  app.post("/api/agent/chat", (c) => {
    const url = new URL(c.req.url);
    return previewOnly(url) ? previewOnlyJson() : handleAgentChat(c.req);
  });
  app.post("/api/agent/turn", (c) => {
    return agentPlatform.handleTurn(c.req);
  });
  app.get("/api/agent/turns", (c) => agentPlatform.handleTurns(new URL(c.req.url)));
  app.get("/api/agent/turn-events", (c) => agentPlatform.handleTurnEvents(new URL(c.req.url)));
  app.get("/api/agent/events", (c) => handleAgentEvents(c.req, new URL(c.req.url)));
}

function registerScreenRoutes(app: Hono, {
  previewOnly,
  previewOnlyJson,
  screenWorkspaceApi,
  screenDiagnosticsApi,
  readJsonRequest,
}: JsonObject) {
  app.get("/api/screen/workspace/playlist", (c) => screenWorkspaceApi.handleScreenWorkspacePlaylist(new URL(c.req.url)));
  app.get("/api/screen/workspace/manifest/:manifestId", (c) => screenWorkspaceApi.handleScreenWorkspaceManifest(c.req.param("manifestId")));
  app.get("/api/screen/workspace/assets/*", (c) => screenWorkspaceApi.handleScreenWorkspaceAsset(new URL(c.req.url)));
  app.post("/api/screen/workspace/process", (c) => screenWorkspaceApi.handleScreenWorkspaceProcess(c.req));
  app.post("/api/screen/workspace/import", (c) => screenWorkspaceApi.handleScreenWorkspaceImport(c.req));
  app.post("/api/screen/workspace/generate", (c) => screenWorkspaceApi.handleScreenWorkspaceGenerate(c.req));
  app.post("/api/screen/workspace/lvgl-preview", (c) => screenWorkspaceApi.handleScreenWorkspaceLvglPreview(c.req));
  app.get("/api/screen/lvgl-demo-preview", (c) => screenWorkspaceApi.handleLvglDemoPreview(new URL(c.req.url)));
  app.get("/api/screen/lvgl-apps", (c) => screenWorkspaceApi.handleLvglAppList());
  app.post("/api/screen/lvgl-app/activate", (c) => screenWorkspaceApi.handleLvglAppActivate(c.req));
  app.post("/api/screen/workspace/sync", (c) => {
    const url = new URL(c.req.url);
    return screenWorkspaceApi.handleScreenWorkspaceSync(c.req, previewOnly(url) ? "preview" : "remote");
  });
  app.get("/api/screen/widget-apps", (c) => screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppList());
  app.post("/api/screen/widget-apps/create", (c) => screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppCreate(c.req));
  app.get("/api/screen/widget-apps/current/runtime", (c) => screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppRuntime());
  app.post("/api/screen/widget-apps/current/preview", (c) => screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppPreview());
  app.post("/api/screen/widget-apps/current/refresh", (c) => screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppRefresh());
  app.post("/api/screen/widget-apps/current/events", (c) => screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppEvent(c.req));
  app.post("/api/screen/widget-apps/current/sync", (c) => screenWorkspaceApi.widgetAppWorkspace.handleWidgetAppSync());
  app.post("/api/screen/frame-diff", (c) => screenDiagnosticsApi.handleScreenFrameDiff(c.req, readJsonRequest));
  app.get("/api/screen/records", (c) => screenDiagnosticsApi.handleScreenRecordList());
  app.get("/api/screen/records/:buildId/frame.png", (c) => screenDiagnosticsApi.handleScreenRecordFrame(c.req.param("buildId")));
  app.get("/api/screen/records/:buildId", (c) => screenDiagnosticsApi.handleScreenRecord(c.req.param("buildId")));
  app.get("/api/screen/frame/:buildId", (c) => {
    const url = new URL(c.req.url);
    return previewOnly(url) ? previewOnlyJson() : screenDiagnosticsApi.handleScreenFrame(c.req.param("buildId"));
  });
}

function registerStaticUiFallback(app: Hono, staticUiHost: JsonObject) {
  app.get("*", async (c) => {
    const response = await staticUiHost.handle(new URL(c.req.url).pathname);
    return response || new Response("Not found", { status: 404 });
  });
}

function registerRetiredStaticConsoleRoutes(app: Hono) {
  const retired = {
    ok: false,
    schema: "walnutpi.retiredStaticConsole.v1",
    reason: "static-html-console-retired",
    activeSurface: "next-tailwind-console",
  };
  for (const route of ["/", "/apps.html", "/workspace.html"]) {
    app.get(route, () => Response.json(retired, { status: 410 }));
  }
}

export function createProductGatewayFetch(app: Hono) {
  return (req: Request, server: any) => app.fetch(req, server);
}

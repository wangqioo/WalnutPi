import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateWalnutWidgetApp,
} from "../scripts/walnut-lvgl-widget-catalog.ts";

export function createWidgetAppWorkspace({
  screenWorkspaceRoot,
  readJsonRequest,
  json,
  workspaceErrorResponse,
  webMetricsLedger,
  generateWidgetCatalog,
  lvglRuntimePreviewRenderer,
  widgetAppRenderer,
}) {
  const WIDGET_APPS_ROOT = path.join(screenWorkspaceRoot, "apps");
  const WIDGET_RUNTIME_ROOT = path.join(screenWorkspaceRoot, "widget-runtime");
  if (!widgetAppRenderer || typeof widgetAppRenderer.writeFromCatalog !== "function" || typeof widgetAppRenderer.writeRuntimeFiles !== "function") {
    throw new Error("Widget App workspace requires a WidgetAppRenderer");
  }
  const LOCAL_WIDGET_ACTION_HANDLERS = {
    pomodoro: pomodoroBindings,
  };

  async function handleWidgetAppList() {
    try {
      const entries = existsSync(WIDGET_APPS_ROOT) ? await readdir(WIDGET_APPS_ROOT, { withFileTypes: true }) : [];
      const apps = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const app = await readWidgetApp(entry.name);
          apps.push({ id: app.id, title: app.title, createdAt: app.createdAt, mode: app.mode });
        } catch {
          // Skip malformed draft apps; add diagnostics when the app editor needs repair UX.
        }
      }
      apps.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      return json({ ok: true, schema: "walnutpi.widget-app-list.v1", apps });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppGet(appId) {
    try {
      const app = await readWidgetApp(appId);
      return json({ ok: true, app });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppCreate(req) {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    const startedAt = Date.now();
    try {
      const request = normalizeWidgetCreateRequest(body);
      const generatedCatalog = generateWidgetCatalog
        ? await generateWidgetCatalog({
          prompt: request.prompt,
          sessionId: request.sessionId,
          turnId: request.turnId,
        })
        : null;
      if (!generatedCatalog) {
        throw new Error("widget app creation requires a valid LVGL widget catalog");
      }
      const widgetApp = await widgetAppRenderer.writeFromCatalog({
        appId: request.appId,
        prompt: request.prompt,
        catalog: generatedCatalog,
      });

      await webMetricsLedger.append({
        kind: "screen.widget_app.create",
        operation: "screen.widget_app.create",
        ok: true,
        latencyMs: Date.now() - startedAt,
        inputChars: request.prompt.length,
        appId: request.appId,
        sessionId: request.sessionId,
        turnId: request.turnId,
      });

      return json({
        ok: true,
        schema: "walnutpi.widgetAppCreateResult.v1",
        appId: widgetApp.app.id,
        plan: {
          schema: "walnutpi.widget-app-plan.v1",
          prompt: request.prompt,
          productChain: "lvgl-widget-app",
          renderer: "walnut-lvgl-widget-catalog",
        },
        widgetApp: widgetApp.provenance,
        widgetAppArtifact: widgetApp.app,
        activationRequired: true,
      });
    } catch (error) {
      await webMetricsLedger.append({
        kind: "screen.widget_app.create",
        operation: "screen.widget_app.create",
        ok: false,
        latencyMs: Date.now() - startedAt,
        sessionId: body?.sessionId,
        turnId: body?.turnId,
        error: error.message,
      });
      return json({
        ok: false,
        error: "widget app creation failed",
        output: error.message,
      }, 400);
    }
  }

  async function handleWidgetAppActivate(reqOrBody) {
    try {
      const body = await requestBody(reqOrBody);
      const app = await readWidgetApp(body.appId || body.id);
      return json({ ok: true, ...await widgetAppRenderer.activateApp(app, body.versionId) });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppRuntime() {
    try {
      const [current, state] = await Promise.all([
        readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "current.json")),
        readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json")),
      ]);
      return json({ ok: true, current, state });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppPreview() {
    try {
      if (!lvglRuntimePreviewRenderer) throw new Error("widget app preview renderer is not configured");
      const current = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "current.json"));
      const runtimeIndexPath = path.join(WIDGET_RUNTIME_ROOT, "current.txt");
      const preview = await lvglRuntimePreviewRenderer.renderRuntime({
        runtimeIndexPath,
        stemPrefix: `widget-${cleanWidgetAppId(current.appId, "appId")}-lvgl`,
        advanceMs: [0, 450, 900, 1350],
      });
      return json({
        ok: true,
        schema: "walnutpi.widgetAppLvglPreview.v1",
        mode: "widget_app",
        appId: current.appId,
        runtimeIndex: `screen/widget-runtime/current.txt`,
        frameCount: preview.frames.length,
        frames: preview.frames,
        buildOutput: preview.buildOutput,
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppRefresh() {
    try {
      const current = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "current.json"));
      const app = await readWidgetApp(current.appId);
      const state = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json")).catch(() => ({
        schema: "walnutpi.widget-runtime-state.v1",
        appId: app.id,
        versionId: current.versionId,
        bindings: widgetAppRenderer.defaultState(app),
      }));
      const latestAction = deviceBoundaryRequiredAction("refresh_device_status");
      const nextState = {
        ...state,
        schema: "walnutpi.widget-runtime-state.v1",
        appId: app.id,
        versionId: current.versionId,
        updatedAt: new Date().toISOString(),
        bindings: state.bindings || widgetAppRenderer.defaultState(app),
        latestAction,
      };
      await widgetAppRenderer.writeRuntimeFiles(app, current, nextState);
      await widgetAppRenderer.appendRuntimeEvent({ type: "action", appId: app.id, action: latestAction });
      return json({
        ok: false,
        schema: "walnutpi.widget-app-action-result.v1",
        appId: app.id,
        current,
        state: nextState,
        evidence: {
          deviceBoundaryRequired: true,
          policyGatedPlatformToolRequired: true,
          noRemoteCommandExecution: true,
          noCommandExecution: true,
        },
        error: "Widget App refresh must run through the policy-gated platform tool path.",
      }, 409);
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppEvent(req) {
    try {
      const body = await req.json();
      const actionName = String(body.action || body.name || "").trim();
      const current = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "current.json"));
      const app = await readWidgetApp(current.appId);
      if (!new Set(app.actions.map((action) => action.name)).has(actionName)) {
        throw new Error("action is not allowed by active widget app");
      }
      const localActionHandler = LOCAL_WIDGET_ACTION_HANDLERS[app.id];
      if (localActionHandler) {
        const previousState = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json")).catch(() => ({
          bindings: widgetAppRenderer.defaultState(app),
        }));
        const state = {
          schema: "walnutpi.widget-runtime-state.v1",
          appId: app.id,
          versionId: current.versionId,
          updatedAt: new Date().toISOString(),
          bindings: localActionHandler(actionName, previousState.bindings),
          latestAction: { name: actionName, ok: true, code: 0, at: new Date().toISOString(), localOnly: true },
        };
        await widgetAppRenderer.writeRuntimeFiles(app, current, state);
        await widgetAppRenderer.appendRuntimeEvent({ type: "action", appId: app.id, action: state.latestAction });
        return json({ ok: true, state, output: JSON.stringify({ ok: true, bindings: state.bindings }) });
      }
      const previousState = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json")).catch(() => ({
        bindings: widgetAppRenderer.defaultState(app),
      }));
      const latestAction = deviceBoundaryRequiredAction(actionName);
      const state = {
        schema: "walnutpi.widget-runtime-state.v1",
        appId: app.id,
        versionId: current.versionId,
        updatedAt: new Date().toISOString(),
        bindings: previousState.bindings || widgetAppRenderer.defaultState(app),
        latestAction,
      };
      await widgetAppRenderer.writeRuntimeFiles(app, current, state);
      await widgetAppRenderer.appendRuntimeEvent({ type: "action", appId: app.id, action: state.latestAction });
      return json({
        ok: false,
        schema: "walnutpi.widget-app-action-result.v1",
        appId: app.id,
        current,
        state,
        evidence: {
          deviceBoundaryRequired: true,
          policyGatedPlatformToolRequired: true,
          noRemoteCommandExecution: true,
          noCommandExecution: true,
        },
        error: "Widget App device actions must run through the policy-gated platform tool path.",
      }, 409);
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppSync() {
    try {
      const current = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "current.json"));
      const app = await readWidgetApp(current.appId);
      const state = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json"));
      await widgetAppRenderer.writeRuntimeFiles(app, current, state);
      await widgetAppRenderer.appendRuntimeEvent({
        type: "sync",
        appId: app.id,
        ok: false,
        at: new Date().toISOString(),
        reason: "policy-gated-platform-tool-required",
      });
      return json({
        ok: false,
        schema: "walnutpi.widget-app-sync-result.v1",
        appId: app.id,
        current,
        state,
        evidence: {
          deviceBoundaryRequired: true,
          policyGatedPlatformToolRequired: true,
          noRemoteCommandExecution: true,
          noCommandExecution: true,
        },
        error: "Widget App sync must run through a policy-gated platform tool before device delivery.",
      }, 409);
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppDownload(appId) {
    try {
      const app = await readWidgetApp(appId);
      const archive = await createTarArchive(await widgetAppArchiveFiles(app.id));
      return new Response(archive, {
        headers: {
          "content-type": "application/gzip",
          "content-disposition": `attachment; filename="${app.id}.widget-app.tar.gz"`,
        },
      });
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function readWidgetAppCards() {
    const entries = existsSync(WIDGET_APPS_ROOT) ? await readdir(WIDGET_APPS_ROOT, { withFileTypes: true }) : [];
    const apps = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const app = await readWidgetApp(entry.name);
        apps.push({
          id: app.id,
          title: app.title,
          createdAt: app.createdAt,
          type: "local-lvgl-app",
          mode: app.mode,
          download: `/api/screen/widget-apps/${encodeURIComponent(app.id)}/download`,
        });
      } catch {
        // Skip malformed draft apps; add diagnostics when the app editor needs repair UX.
      }
    }
    apps.sort((a, b) => (String(a.type).localeCompare(String(b.type)) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    return apps;
  }

  async function readWidgetApp(appId) {
    const id = cleanWidgetAppId(appId || "", "appId");
    const appPath = path.join(WIDGET_APPS_ROOT, id, "app.json");
    const relative = path.relative(WIDGET_APPS_ROOT, appPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("invalid widget app id");
    return validateWalnutWidgetApp(await readJsonFile(appPath));
  }

  async function readJsonFile(filePath) {
    return JSON.parse(await readFile(filePath, "utf8"));
  }

  function deviceBoundaryRequiredAction(actionName) {
    return {
      name: actionName,
      ok: false,
      code: null,
      at: new Date().toISOString(),
      deviceBoundaryRequired: true,
      policyGatedPlatformToolRequired: true,
      noRemoteCommandExecution: true,
      noCommandExecution: true,
    };
  }

  async function widgetAppArchiveFiles(appId) {
    const id = cleanWidgetAppId(appId, "appId");
    const appDir = path.join(WIDGET_APPS_ROOT, id);
    await readWidgetApp(id);
    return ["app.json", "catalog.json", "surface.a2ui.json", "snapshot-source.json"].map((name) => ({
      absolutePath: path.join(appDir, name),
      archivePath: `screen/apps/${id}/${name}`,
    }));
  }

  async function createTarArchive(files) {
    const tmp = await mkTempDir();
    const listPath = path.join(tmp, "files.txt");
    const archivePath = path.join(tmp, "widget-sync.tar.gz");
    await writeFile(listPath, files.map((file) => file.archivePath).join("\n"), "utf8");
    for (const file of files) {
      const target = path.join(tmp, file.archivePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.absolutePath, target);
    }
    await runLocalCommand("tar", ["-czf", archivePath, "-C", tmp, "-T", listPath], tmp, 60_000);
    return await readFile(archivePath);
  }

  async function mkTempDir() {
    const dir = path.join(tmpdir(), `walnut-widget-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async function runLocalCommand(command, args, cwd, timeoutMs) {
    return await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`${command} timed out`));
      }, timeoutMs);
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr || `${command} failed with ${code}`));
      });
    });
  }

  function pomodoroBindings(actionName, previous: Record<string, any> = {}) {
    if (actionName === "pomodoro_start") {
      return { ...previous, remaining: previous.remaining || "25:00", status: "FOCUS", progress: 100, mode: "running" };
    }
    if (actionName === "pomodoro_pause") {
      return { ...previous, status: "PAUSED", mode: "paused" };
    }
    return { remaining: "25:00", status: "READY", progress: 100, mode: "idle" };
  }

  function cleanWidgetAppId(value, field) {
    const text = String(value || "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,96}$/.test(text)) throw new Error(`${field} must be a simple id`);
    return text;
  }

  function normalizeWidgetCreateRequest(body) {
    const prompt = String(body?.prompt || body?.text || "").replace(/\s+/g, " ").trim();
    if (prompt.length < 4) throw new Error("prompt is too short");
    return {
      prompt: prompt.slice(0, 1000),
      appId: cleanWidgetAppId(body?.appId || body?.screenId || `agent-widget-app-${Date.now()}`, "appId"),
      sessionId: body?.sessionId ? String(body.sessionId) : null,
      turnId: body?.turnId ? String(body.turnId) : null,
    };
  }

  async function requestBody(reqOrBody) {
    if (reqOrBody && typeof reqOrBody.json === "function") return await reqOrBody.json();
    return reqOrBody && typeof reqOrBody === "object" ? reqOrBody : {};
  }

  return {
    handleWidgetAppList,
    handleWidgetAppCreate,
    handleWidgetAppGet,
    handleWidgetAppActivate,
    handleWidgetAppRuntime,
    handleWidgetAppPreview,
    handleWidgetAppRefresh,
    handleWidgetAppEvent,
    handleWidgetAppSync,
    handleWidgetAppDownload,
    readWidgetAppCards,
  };
}

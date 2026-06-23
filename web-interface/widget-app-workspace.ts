import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  WALNUT_WIDGET_APP_SCHEMA,
  WALNUT_WIDGET_APP_SOURCE_SCHEMA,
  WALNUT_WIDGET_SNAPSHOT_SOURCE_SCHEMA,
  a2uiSurfaceFromWalnutCatalog,
  runtimeWidgetsFromWalnutCatalog,
  validateWalnutLvglWidgetCatalog,
  validateWalnutWidgetApp,
} from "../scripts/walnut-lvgl-widget-catalog.ts";

export function createWidgetAppWorkspace({
  projectRoot,
  screenWorkspaceRoot,
  readJsonRequest,
  runRemote,
  runRemoteWithInput,
  shellQuote,
  json,
  workspaceErrorResponse,
  webMetricsLedger,
  generateWidgetCatalog,
  lvglRuntimePreviewRenderer,
}) {
  const WIDGET_APPS_ROOT = path.join(screenWorkspaceRoot, "apps");
  const WIDGET_RUNTIME_ROOT = path.join(screenWorkspaceRoot, "widget-runtime");
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
      const widgetApp = await writeFromCatalog({
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
      return json({ ok: true, ...await activateApp(app, body.versionId) });
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
      const result = await runRemote("walnut action run status --json", 25_000, 40_000);
      const state = {
        schema: "walnutpi.widget-runtime-state.v1",
        appId: app.id,
        versionId: current.versionId,
        updatedAt: new Date().toISOString(),
        bindings: deviceStatusBindings(result.output),
        latestAction: { name: "refresh_device_status", ok: result.ok, code: result.code, at: new Date().toISOString() },
      };
      await writeWidgetRuntimeFiles(app, current, state);
      await appendWidgetEvent({ type: "action", appId: app.id, action: state.latestAction });
      return json({ ok: result.ok, current, state, output: result.output }, result.ok ? 200 : 500);
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
          bindings: defaultWidgetAppState(app),
        }));
        const state = {
          schema: "walnutpi.widget-runtime-state.v1",
          appId: app.id,
          versionId: current.versionId,
          updatedAt: new Date().toISOString(),
          bindings: localActionHandler(actionName, previousState.bindings),
          latestAction: { name: actionName, ok: true, code: 0, at: new Date().toISOString() },
        };
        await writeWidgetRuntimeFiles(app, current, state);
        await appendWidgetEvent({ type: "action", appId: app.id, action: state.latestAction });
        return json({ ok: true, state, output: JSON.stringify({ ok: true, bindings: state.bindings }) });
      }
      const command = actionName === "refresh_device_status"
        ? "walnut action run status --json"
        : `walnut action prepare ${shellQuote(actionName)} --json`;
      const result = await runRemote(command, 25_000, 40_000);
      const previousState = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json")).catch(() => ({
        bindings: defaultWidgetAppState(app),
      }));
      const state = {
        schema: "walnutpi.widget-runtime-state.v1",
        appId: app.id,
        versionId: current.versionId,
        updatedAt: new Date().toISOString(),
        bindings: actionName === "refresh_device_status" ? deviceStatusBindings(result.output) : previousState.bindings,
        latestAction: {
          name: actionName,
          ok: result.ok,
          code: result.code,
          at: new Date().toISOString(),
          pending: parseJsonObject(result.output),
        },
      };
      await writeWidgetRuntimeFiles(app, current, state);
      await appendWidgetEvent({ type: "action", appId: app.id, action: state.latestAction });
      return json({ ok: result.ok, state, output: result.output }, result.ok ? 200 : 500);
    } catch (error) {
      return workspaceErrorResponse(error, json);
    }
  }

  async function handleWidgetAppSync() {
    try {
      const current = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "current.json"));
      const app = await readWidgetApp(current.appId);
      const state = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json"));
      await writeWidgetRuntimeFiles(app, current, state);
      const files = await widgetSyncFiles(app.id);
      const archive = await createTarArchive(files);
      const remoteRoot = process.env.WALNUT_REMOTE_PROJECT_ROOT || process.env.WALNUT_PROJECT_ROOT || "/home/pi/projects/WalnutPi";
      const script = [
        "set -e",
        `ROOT=${shellQuote(remoteRoot)}`,
        'mkdir -p "$ROOT"',
        'cd "$ROOT"',
        "tar -xzf -",
        "test -f screen/widget-runtime/current.txt",
        "chmod +x scripts/build-lvgl-app.sh",
        "if ! test -x build/lvgl_app/walnut-lvgl-screen || ! strings build/lvgl_app/walnut-lvgl-screen | grep -F walnutpi.lvgl-widget-runtime.v1 >/dev/null; then bash scripts/build-lvgl-app.sh; fi",
        "strings build/lvgl_app/walnut-lvgl-screen | grep -F walnutpi.lvgl-widget-runtime.v1 >/dev/null",
        "cp lvgl_app/systemd/walnut-screen.service /etc/systemd/system/walnut-screen.service",
        "systemctl daemon-reload",
        "systemctl restart walnut-screen.service",
        "sleep 0.5",
        "systemctl is-active walnut-screen.service",
        "walnut screen state",
      ].join("; ");
      const result = await runRemoteWithInput(`sudo -n sh -lc ${shellQuote(script)}`, archive, 180_000, 60_000);
      await appendWidgetEvent({ type: "sync", appId: app.id, ok: result.ok, at: new Date().toISOString() });
      return json({
        ok: result.ok,
        schema: "walnutpi.widget-app-sync-result.v1",
        appId: app.id,
        current,
        fileCount: files.length,
        output: result.output,
      }, result.ok ? 200 : 500);
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

  async function writeFromCatalog({ appId, prompt, catalog }) {
    const appDir = path.join(WIDGET_APPS_ROOT, appId);
    const createdAt = new Date().toISOString();
    const widgetCatalog = validateWalnutLvglWidgetCatalog({
      ...catalog,
      id: appId,
      size: { width: 480, height: 320 },
    });
    const app = validateWalnutWidgetApp({
      schema: WALNUT_WIDGET_APP_SCHEMA,
      id: appId,
      title: widgetCatalog.title,
      createdAt,
      prompt,
      a2uiSurface: a2uiSurfaceFromWalnutCatalog(widgetCatalog),
      catalog: widgetCatalog,
      actions: [],
    });
    await mkdir(appDir, { recursive: true });
    await writeFile(path.join(appDir, "app.json"), `${JSON.stringify(app, null, 2)}\n`, "utf8");
    await writeFile(path.join(appDir, "catalog.json"), `${JSON.stringify(app.catalog, null, 2)}\n`, "utf8");
    await writeFile(path.join(appDir, "surface.a2ui.json"), `${JSON.stringify(app.a2uiSurface, null, 2)}\n`, "utf8");
    await writeFile(path.join(appDir, "snapshot-source.json"), `${JSON.stringify({
      schema: WALNUT_WIDGET_SNAPSHOT_SOURCE_SCHEMA,
      appId,
      source: "lvgl-widget-catalog",
      createdAt,
    }, null, 2)}\n`, "utf8");
    return {
      app,
      provenance: {
        schema: WALNUT_WIDGET_APP_SOURCE_SCHEMA,
        mode: "widget_app",
        app: `../apps/${appId}/app.json`,
        catalog: `../apps/${appId}/catalog.json`,
        a2uiSurface: `../apps/${appId}/surface.a2ui.json`,
        snapshotSource: `../apps/${appId}/snapshot-source.json`,
      },
    };
  }

  async function activateApp(app, versionId) {
    versionId = versionId || app.createdAt || new Date().toISOString();
    const activatedAt = new Date().toISOString();
    const current = {
      schema: "walnutpi.widget-runtime-current.v1",
      appId: app.id,
      versionId,
      activatedAt,
      app: `../apps/${app.id}/app.json`,
      catalog: `../apps/${app.id}/catalog.json`,
      a2uiSurface: `../apps/${app.id}/surface.a2ui.json`,
    };
    const state = {
      schema: "walnutpi.widget-runtime-state.v1",
      appId: app.id,
      versionId,
      updatedAt: activatedAt,
      bindings: defaultWidgetAppState(app),
      latestAction: null,
    };
    await writeWidgetRuntimeFiles(app, current, state);
    await appendWidgetEvent({ type: "activated", appId: app.id, versionId, at: activatedAt });
    return { current, state };
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

  async function writeWidgetRuntimeFiles(app, current, state) {
    await mkdir(WIDGET_RUNTIME_ROOT, { recursive: true });
    await writeFile(path.join(WIDGET_RUNTIME_ROOT, "current.json"), `${JSON.stringify(current, null, 2)}\n`, "utf8");
    await writeFile(path.join(WIDGET_RUNTIME_ROOT, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await writeFile(path.join(WIDGET_RUNTIME_ROOT, "current.txt"), widgetRuntimeText(app, state), "utf8");
  }

  async function appendWidgetEvent(event) {
    await mkdir(WIDGET_RUNTIME_ROOT, { recursive: true });
    await appendFile(path.join(WIDGET_RUNTIME_ROOT, "events.log"), `${JSON.stringify({
      schema: "walnutpi.widget-runtime-event.v1",
      ...event,
    })}\n`, "utf8");
  }

  function defaultWidgetAppState(app) {
    return app.catalog?.data && typeof app.catalog.data === "object" && !Array.isArray(app.catalog.data)
      ? { ...app.catalog.data }
      : {};
  }

  function deviceStatusBindings(output) {
    const parsed = parseJsonObject(output);
    const text = String(parsed?.output || output || "");
    return {
      ip: matchValue(text, /wlan0\s+\S+\s+([0-9]{1,3}(?:\.[0-9]{1,3}){3})\//i) || "unknown",
      memory: matchValue(text, /Mem:\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+([0-9.]+(?:Mi|Gi|MiB|GiB|MB|GB))/i) || "unknown",
      disk: matchValue(text, /\/dev\/root\s+\S+\s+\S+\s+\S+\s+([0-9]+%)/i) || "unknown",
      frp: /frp[^\n]*(active|running|online|ok)/i.test(text) ? "active" : (/frp/i.test(text) ? "check" : "unknown"),
      service: matchValue(text, /walnut-screen\.service\s+([a-z-]+)/i) || matchValue(text, /frpc\s+active=([a-z-]+)/i) || "unknown",
    };
  }

  function parseJsonObject(text) {
    try {
      const parsed = JSON.parse(String(text || ""));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function matchValue(text, regex) {
    const match = String(text || "").match(regex);
    return match?.[1]?.trim() || "";
  }

  async function widgetSyncFiles(appId) {
    const files = await widgetAppArchiveFiles(appId);
    for (const name of ["current.json", "state.json", "current.txt", "events.log"]) {
      const absolutePath = path.join(WIDGET_RUNTIME_ROOT, name);
      if (existsSync(absolutePath)) files.push({ absolutePath, archivePath: `screen/widget-runtime/${name}` });
    }
    files.push(
      { absolutePath: path.join(projectRoot, "lvgl_app", "src", "main.c"), archivePath: "lvgl_app/src/main.c" },
      { absolutePath: path.join(projectRoot, "lvgl_app", "CMakeLists.txt"), archivePath: "lvgl_app/CMakeLists.txt" },
      { absolutePath: path.join(projectRoot, "lvgl_app", "lv_conf.h"), archivePath: "lvgl_app/lv_conf.h" },
      { absolutePath: path.join(projectRoot, "lvgl_app", "systemd", "walnut-screen.service"), archivePath: "lvgl_app/systemd/walnut-screen.service" },
      { absolutePath: path.join(projectRoot, "scripts", "build-lvgl-app.sh"), archivePath: "scripts/build-lvgl-app.sh" },
    );
    return files;
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

  function widgetRuntimeText(app, state) {
    const catalog = {
      ...app.catalog,
      data: { ...(app.catalog.data || {}), ...(state.bindings || {}) },
    };
    const lines = [
      "schema walnutpi.lvgl-widget-runtime.v1",
      `appId ${runtimeField(app.id)}`,
      `versionId ${runtimeField(state.versionId || app.createdAt || "v1")}`,
      `widgetCount ${catalog.nodes.length}`,
    ];
    for (const widget of runtimeWidgetsFromWalnutCatalog(catalog) as Record<string, any>[]) {
      lines.push([
        "widget",
        runtimeField(widget.type),
        runtimeField(widget.id),
        widget.x,
        widget.y,
        widget.w,
        widget.h,
        runtimeField(widget.text || "-"),
        widget.value || 0,
        runtimeField(widget.color || "ffffff"),
        runtimeField(widget.animation || "-"),
      ].join(" "));
    }
    return `${lines.join("\n")}\n`;
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

  function runtimeField(value) {
    const text = String(value || "-").replace(/\s+/g, "_").replace(/[^A-Za-z0-9._:+%-]/g, "").slice(0, 64);
    return text || "-";
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
    writeFromCatalog,
  };
}

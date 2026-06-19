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
  validateWalnutWidgetApp,
  walnutWidgetCatalogFromPixelSpec,
} from "../scripts/walnut-lvgl-widget-catalog.js";

export function createWidgetAppWorkspace({
  projectRoot,
  screenWorkspaceRoot,
  runLocal,
  runRemote,
  runRemoteWithInput,
  shellQuote,
  json,
  workspaceErrorResponse,
}) {
  const WIDGET_APPS_ROOT = path.join(screenWorkspaceRoot, "apps");
  const WIDGET_RUNTIME_ROOT = path.join(screenWorkspaceRoot, "widget-runtime");

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
          // ponytail: skip malformed draft apps; add diagnostics when the app editor needs repair UX.
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
      if (app.id === "pomodoro") {
        const previousState = await readJsonFile(path.join(WIDGET_RUNTIME_ROOT, "state.json")).catch(() => ({
          bindings: defaultWidgetAppState(app),
        }));
        const state = {
          schema: "walnutpi.widget-runtime-state.v1",
          appId: app.id,
          versionId: current.versionId,
          updatedAt: new Date().toISOString(),
          bindings: pomodoroBindings(actionName, previousState.bindings),
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
          type: app.id.startsWith("ioccc-") ? "ioccc-lvgl-app" : "local-lvgl-app",
          mode: app.mode,
          ioccc: app.ioccc || null,
          download: `/api/screen/widget-apps/${encodeURIComponent(app.id)}/download`,
        });
      } catch {
        // ponytail: skip malformed draft apps; add diagnostics when the app editor needs repair UX.
      }
    }
    apps.sort((a, b) => (String(a.type).localeCompare(String(b.type)) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    return apps;
  }

  async function writeFromPixelSpec({ screenId, prompt, screenSpec, catalog, sourcePath }) {
    const appDir = path.join(WIDGET_APPS_ROOT, screenId);
    const createdAt = new Date().toISOString();
    const fallbackCatalog = walnutWidgetCatalogFromPixelSpec({ ...screenSpec, id: screenId });
    let widgetCatalog = fallbackCatalog;
    if (catalog) {
      try {
        widgetCatalog = {
          ...catalog,
          id: screenId,
          title: catalog.title || screenSpec.title,
          size: { width: 480, height: 320 },
        };
        validateWalnutWidgetApp({
          schema: WALNUT_WIDGET_APP_SCHEMA,
          id: screenId,
          title: screenSpec.title,
          createdAt,
          prompt,
          a2uiSurface: null,
          catalog: widgetCatalog,
          actions: [],
        });
      } catch {
        widgetCatalog = fallbackCatalog;
      }
    }
    const app = validateWalnutWidgetApp({
      schema: WALNUT_WIDGET_APP_SCHEMA,
      id: screenId,
      title: screenSpec.title,
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
      screenId,
      source: path.relative(appDir, sourcePath).replaceAll("\\", "/"),
      createdAt,
    }, null, 2)}\n`, "utf8");
    return {
      app,
      provenance: {
        schema: WALNUT_WIDGET_APP_SOURCE_SCHEMA,
        mode: "widget_app",
        app: `../apps/${screenId}/app.json`,
        catalog: `../apps/${screenId}/catalog.json`,
        a2uiSurface: `../apps/${screenId}/surface.a2ui.json`,
        snapshotSource: `../apps/${screenId}/snapshot-source.json`,
      },
    };
  }

  function repairLvglWidgetLayout(spec) {
    if (!Array.isArray(spec.elements) || spec.elements.length === 0) return spec;
    const elements = [];
    const texts = spec.elements.filter((item) => item.type === "text").slice(0, 5);
    const controls = spec.elements.filter((item) => item.type === "bar" || item.type === "arc").slice(0, 4);
    const rects = spec.elements.filter((item) => item.type === "rect" && item.width >= 2 && item.height >= 2).slice(0, 3);
    const fallbackTexts = [
      { text: spec.title, fill: "text", scale: 2 },
      { text: spec.primaryValue, fill: "accent", scale: 2 },
      { text: spec.footer, fill: "muted2", scale: 1 },
    ];
    const textSource = texts.length ? texts : fallbackTexts;
    const textSlots = [
      { x: 6, y: 12, width: 54, scale: 2 },
      { x: 6, y: 32, width: 54, scale: 2 },
      { x: 6, y: 51, width: 54, scale: 1 },
      { x: 66, y: 12, width: 48, scale: 1 },
      { x: 66, y: 35, width: 48, scale: 1 },
    ];
    const controlSlots = [
      { x: 66, y: 19, width: 46, height: 6 },
      { x: 66, y: 42, width: 46, height: 6 },
      { x: 86, y: 52, width: 22, height: 22 },
      { x: 64, y: 52, width: 18, height: 18 },
    ];

    elements.push(
      { type: "rect", x: 3, y: 3, width: 114, height: 1, fill: "panelBorder", required: false },
      { type: "rect", x: 3, y: 76, width: 114, height: 1, fill: "panelBorder", required: false },
      { type: "rect", x: 3, y: 4, width: 1, height: 72, fill: "panelBorder", required: false },
      { type: "rect", x: 116, y: 4, width: 1, height: 72, fill: "panelBorder", required: false },
    );
    for (const [index, source] of textSource.entries()) {
      const slot = textSlots[index];
      if (!slot) break;
      elements.push({
        type: "text",
        x: slot.x,
        y: slot.y,
        text: compactDisplayText(source.text || fallbackTexts[index % fallbackTexts.length].text, slot.scale === 2 ? 11 : 16),
        fill: source.fill || fallbackTexts[index % fallbackTexts.length].fill,
        scale: slot.scale,
        required: true,
      });
    }
    for (const [index, source] of controls.entries()) {
      const slot = controlSlots[index];
      elements.push({
        type: index >= 2 ? "arc" : "bar",
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        fill: source.fill || "accent",
        value: Math.max(0, Math.min(100, Math.round(Number(source.value ?? spec.progress ?? 50)))),
        required: true,
      });
    }
    for (const [index, source] of rects.entries()) {
      if (elements.length >= 12) break;
      elements.push({
        type: "rect",
        x: [14, 36, 103][index],
        y: [63, 67, 10][index],
        width: Math.min(14, Math.max(4, source.width || 4)),
        height: Math.min(6, Math.max(2, source.height || 2)),
        fill: source.fill || "trace",
        required: false,
      });
    }
    return { ...spec, elements };
  }

  function compactDisplayText(value, maxChars) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
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
    if (app.id === "pomodoro") {
      return { remaining: "25:00", status: "READY", progress: 100, mode: "idle" };
    }
    if (app.id === "device-status" || /设备|状态|status|quick/i.test(`${app.id} ${app.title}`)) {
      return { ip: "unknown", memory: "unknown", disk: "unknown", frp: "unknown", service: "unknown" };
    }
    return {};
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
    return await new Promise((resolve, reject) => {
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
    for (const widget of runtimeWidgetsFromWalnutCatalog(catalog)) {
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

  function pomodoroBindings(actionName, previous = {}) {
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

  async function requestBody(reqOrBody) {
    if (reqOrBody && typeof reqOrBody.json === "function") return await reqOrBody.json();
    return reqOrBody && typeof reqOrBody === "object" ? reqOrBody : {};
  }

  return {
    handleWidgetAppList,
    handleWidgetAppGet,
    handleWidgetAppActivate,
    handleWidgetAppRuntime,
    handleWidgetAppRefresh,
    handleWidgetAppEvent,
    handleWidgetAppSync,
    handleWidgetAppDownload,
    readWidgetAppCards,
    repairLvglWidgetLayout,
    writeFromPixelSpec,
  };
}

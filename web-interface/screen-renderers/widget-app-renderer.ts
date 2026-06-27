import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  WALNUT_WIDGET_APP_SCHEMA,
  WALNUT_WIDGET_APP_SOURCE_SCHEMA,
  WALNUT_WIDGET_SNAPSHOT_SOURCE_SCHEMA,
  a2uiSurfaceFromWalnutCatalog,
  runtimeWidgetsFromWalnutCatalog,
  validateWalnutLvglWidgetCatalog,
  validateWalnutWidgetApp,
} from "../../scripts/walnut-lvgl-widget-catalog.ts";

type JsonObject = Record<string, any>;

export type WidgetAppRenderer = {
  writeFromCatalog(options: {
    appId: string;
    prompt: string;
    catalog: JsonObject;
  }): Promise<JsonObject>;
  activateApp(app: JsonObject, versionId?: string): Promise<JsonObject>;
  writeRuntimeFiles(app: JsonObject, current: JsonObject, state: JsonObject): Promise<void>;
  appendRuntimeEvent(event: JsonObject): Promise<void>;
  defaultState(app: JsonObject): JsonObject;
};

export function createWidgetAppRenderer({
  appsRoot,
  runtimeRoot,
}: {
  appsRoot: string;
  runtimeRoot: string;
}): WidgetAppRenderer {
  const appArtifactsRoot = path.resolve(appsRoot);
  const widgetRuntimeRoot = path.resolve(runtimeRoot);
  return {
    writeFromCatalog(options) {
      return writeFromCatalog({ ...options, appsRoot: appArtifactsRoot });
    },
    activateApp(app, versionId) {
      return activateApp({ app, versionId, runtimeRoot: widgetRuntimeRoot });
    },
    writeRuntimeFiles(app, current, state) {
      return writeWidgetRuntimeFiles({ runtimeRoot: widgetRuntimeRoot, app, current, state });
    },
    appendRuntimeEvent(event) {
      return appendWidgetEvent({ runtimeRoot: widgetRuntimeRoot, event });
    },
    defaultState,
  };
}

async function writeFromCatalog({ appsRoot, appId, prompt, catalog }: JsonObject) {
  const cleanAppId = cleanWidgetAppId(appId, "appId");
  const appDir = path.join(appsRoot, cleanAppId);
  assertInsideRoot(appsRoot, appDir, "widget app path escapes apps root");
  const createdAt = new Date().toISOString();
  const widgetCatalog = validateWalnutLvglWidgetCatalog({
    ...catalog,
    id: cleanAppId,
    size: { width: 480, height: 320 },
  });
  const app = validateWalnutWidgetApp({
    schema: WALNUT_WIDGET_APP_SCHEMA,
    id: cleanAppId,
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
    appId: cleanAppId,
    source: "lvgl-widget-catalog",
    createdAt,
  }, null, 2)}\n`, "utf8");
  return {
    app,
    provenance: {
      schema: WALNUT_WIDGET_APP_SOURCE_SCHEMA,
      mode: "widget_app",
      app: `../apps/${cleanAppId}/app.json`,
      catalog: `../apps/${cleanAppId}/catalog.json`,
      a2uiSurface: `../apps/${cleanAppId}/surface.a2ui.json`,
      snapshotSource: `../apps/${cleanAppId}/snapshot-source.json`,
    },
  };
}

async function activateApp({ app, versionId, runtimeRoot }: JsonObject) {
  const activatedVersion = versionId || app.createdAt || new Date().toISOString();
  const activatedAt = new Date().toISOString();
  const current = {
    schema: "walnutpi.widget-runtime-current.v1",
    appId: app.id,
    versionId: activatedVersion,
    activatedAt,
    app: `../apps/${app.id}/app.json`,
    catalog: `../apps/${app.id}/catalog.json`,
    a2uiSurface: `../apps/${app.id}/surface.a2ui.json`,
  };
  const state = {
    schema: "walnutpi.widget-runtime-state.v1",
    appId: app.id,
    versionId: activatedVersion,
    updatedAt: activatedAt,
    bindings: defaultState(app),
    latestAction: null,
  };
  await writeWidgetRuntimeFiles({ runtimeRoot, app, current, state });
  await appendWidgetEvent({ runtimeRoot, event: { type: "activated", appId: app.id, versionId: activatedVersion, at: activatedAt } });
  return { current, state };
}

async function writeWidgetRuntimeFiles({ runtimeRoot, app, current, state }: JsonObject) {
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(path.join(runtimeRoot, "current.json"), `${JSON.stringify(current, null, 2)}\n`, "utf8");
  await writeFile(path.join(runtimeRoot, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(path.join(runtimeRoot, "current.txt"), widgetRuntimeText(app, state), "utf8");
}

async function appendWidgetEvent({ runtimeRoot, event }: JsonObject) {
  await mkdir(runtimeRoot, { recursive: true });
  await appendFile(path.join(runtimeRoot, "events.log"), `${JSON.stringify({
    schema: "walnutpi.widget-runtime-event.v1",
    ...event,
  })}\n`, "utf8");
}

function defaultState(app: JsonObject) {
  return app.catalog?.data && typeof app.catalog.data === "object" && !Array.isArray(app.catalog.data)
    ? { ...app.catalog.data }
    : {};
}

function widgetRuntimeText(app: JsonObject, state: JsonObject) {
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

function runtimeField(value) {
  const text = String(value || "-").replace(/\s+/g, "_").replace(/[^A-Za-z0-9._:+%-]/g, "").slice(0, 64);
  return text || "-";
}

function cleanWidgetAppId(value, field) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,96}$/.test(text)) throw new Error(`${field} must be a simple id`);
  return text;
}

function assertInsideRoot(root, target, message) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
}

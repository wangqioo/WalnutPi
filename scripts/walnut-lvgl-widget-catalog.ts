export const WALNUT_LVGL_WIDGET_CATALOG_SCHEMA = "walnutpi.lvgl-widget-catalog.v1";
export const WALNUT_WIDGET_APP_SCHEMA = "walnutpi.widget-app.v1";
export const WALNUT_WIDGET_APP_SOURCE_SCHEMA = "walnutpi.widget-app-source.v1";
export const WALNUT_WIDGET_SNAPSHOT_SOURCE_SCHEMA = "walnutpi.widget-app-snapshot-source.v1";
export const WALNUT_SCREEN_WIDTH = 480;
export const WALNUT_SCREEN_HEIGHT = 320;

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const STYLE_TOKENS = new Set(["screen", "panel", "text", "muted", "muted2", "primary", "accent", "orange", "danger", "trace", "chip", "panelBorder", "barTrack"]);
const NODE_KINDS = new Set(["container", "rect", "text", "image", "button", "toggle", "progress", "gauge", "list", "status_tile"]);
const RUNTIME_TYPE_BY_WIDGET_KIND: Record<string, string> = {
  text: "label",
  button: "label",
  toggle: "label",
  list: "label",
  status_tile: "label",
  rect: "rect",
  progress: "bar",
  gauge: "arc",
};
const A2UI_COMPONENT_BY_WIDGET_KIND: Record<string, string> = {
  text: "Text",
  status_tile: "Text",
  button: "Button",
  toggle: "Button",
  image: "Image",
  progress: "Progress",
  gauge: "Gauge",
  list: "List",
};

type JsonRecord = Record<string, any>;
type WidgetAction = { name: string; params: JsonRecord };
type WidgetNode = {
  id: string;
  kind: string;
  parent?: string;
  layout: { x: number; y: number; w: number; h: number };
  style: string;
  text?: string;
  label?: string;
  binding?: string;
  value?: number;
  min?: number;
  max?: number;
  source?: string;
  action?: WidgetAction;
};
type WidgetCatalog = {
  schema: typeof WALNUT_LVGL_WIDGET_CATALOG_SCHEMA;
  id: string;
  title: string;
  size: { width: number; height: number };
  theme: string;
  data: JsonRecord;
  root: string;
  nodes: WidgetNode[];
};
type RuntimeWidgetSpec = {
  type: string;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  value: number;
  color: string;
};

export function validateWalnutLvglWidgetCatalog(surface: JsonRecord): WidgetCatalog {
  assertObject(surface, "catalog");
  if (surface.schema !== WALNUT_LVGL_WIDGET_CATALOG_SCHEMA) {
    throw new Error(`catalog.schema must be ${WALNUT_LVGL_WIDGET_CATALOG_SCHEMA}`);
  }
  const normalized: WidgetCatalog = {
    schema: WALNUT_LVGL_WIDGET_CATALOG_SCHEMA,
    id: cleanId(surface.id, "id"),
    title: cleanText(surface.title || surface.id, "title", 80),
    size: {
      width: cleanExactInteger(surface.size?.width, "size.width", WALNUT_SCREEN_WIDTH),
      height: cleanExactInteger(surface.size?.height, "size.height", WALNUT_SCREEN_HEIGHT),
    },
    theme: cleanToken(surface.theme || "walnut-lvgl-default", "theme", 64),
    data: normalizeData(surface.data || {}),
    root: cleanId(surface.root, "root"),
    nodes: normalizeNodes(surface.nodes),
  };
  if (!normalized.nodes.some((node) => node.id === normalized.root)) {
    throw new Error("root must reference an existing node");
  }
  return normalized;
}

export function validateWalnutWidgetApp(app) {
  assertObject(app, "widget app");
  if (app.schema !== WALNUT_WIDGET_APP_SCHEMA) {
    throw new Error(`widget app schema must be ${WALNUT_WIDGET_APP_SCHEMA}`);
  }
  return {
    schema: WALNUT_WIDGET_APP_SCHEMA,
    id: cleanId(app.id, "id"),
    title: cleanText(app.title || app.id, "title", 80),
    createdAt: cleanOptionalText(app.createdAt, "createdAt", 40),
    prompt: cleanOptionalText(app.prompt || "", "prompt", 1000),
    mode: "widget_app",
    a2uiSurface: app.a2uiSurface && typeof app.a2uiSurface === "object" ? app.a2uiSurface : null,
    catalog: validateWalnutLvglWidgetCatalog(app.catalog),
    actions: normalizeActions(app.actions || []),
  };
}

export function runtimeWidgetsFromWalnutCatalog(catalog) {
  const normalized = validateWalnutLvglWidgetCatalog(catalog);
  return normalized.nodes
    .filter((node) => node.kind !== "container")
    .slice(0, 24)
    .map((node, index) => {
      const layout = node.layout;
      const boundValue = valueFromBinding(normalized.data, node.binding);
      const text = node.kind === "status_tile" && node.label
        ? `${node.label}:${boundValue || "--"}`
        : node.text || node.label || boundValue || "";
      return {
        type: runtimeTypeFromKind(node.kind),
        id: node.id || `w${index}`,
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        text,
        value: cleanRuntimeValue(node.value ?? valueFromBinding(normalized.data, node.binding) ?? 0),
        color: colorFromStyle(node.style),
        action: node.action?.name || "",
      };
    });
}

export function a2uiSurfaceFromWalnutCatalog(catalog) {
  const normalized = validateWalnutLvglWidgetCatalog(catalog);
  return {
    version: "v0.9.1",
    createSurface: {
      surfaceId: normalized.id,
      catalogId: "walnutpi.lvgl-widget-catalog.v1",
    },
    updateComponents: {
      surfaceId: normalized.id,
      components: normalized.nodes.map((node) => ({
        id: node.id,
        component: a2uiComponentFromKind(node.kind),
        ...(node.text ? { text: node.text } : {}),
        ...(node.label ? { label: node.label } : {}),
        ...(node.binding ? { value: { path: node.binding } } : {}),
        ...(node.action ? { action: { event: { name: node.action.name, context: node.action.params || {} } } } : {}),
      })),
    },
    updateDataModel: {
      surfaceId: normalized.id,
      path: "/",
      value: normalized.data,
    },
  };
}

function normalizeNodes(nodes: any): WidgetNode[] {
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 48) {
    throw new Error("nodes must contain 1-48 items");
  }
  const seen = new Set();
  const normalized = nodes.map((node, index) => normalizeNode(node, `nodes[${index}]`));
  for (const node of normalized) {
    if (seen.has(node.id)) throw new Error(`duplicate node id: ${node.id}`);
    seen.add(node.id);
  }
  for (const node of normalized) {
    if (node.parent && !seen.has(node.parent)) throw new Error(`${node.id}.parent references a missing node`);
  }
  return normalized;
}

function normalizeNode(node: JsonRecord, field: string): WidgetNode {
  assertObject(node, field);
  const kind = cleanToken(node.kind, `${field}.kind`, 32);
  if (!NODE_KINDS.has(kind)) throw new Error(`${field}.kind is not supported`);
  const normalized: WidgetNode = {
    id: cleanId(node.id, `${field}.id`),
    kind,
    layout: normalizeLayout(node.layout, `${field}.layout`),
    style: normalizeStyle(node.style || "text", `${field}.style`),
  };
  if (node.parent !== undefined) normalized.parent = cleanId(node.parent, `${field}.parent`);
  if (node.text !== undefined) normalized.text = cleanText(node.text, `${field}.text`, 80);
  if (node.label !== undefined) normalized.label = cleanText(node.label, `${field}.label`, 40);
  if (node.binding !== undefined) normalized.binding = cleanBinding(node.binding, `${field}.binding`);
  if (node.value !== undefined) normalized.value = cleanInteger(node.value, `${field}.value`, 0, 100000);
  if (node.min !== undefined) normalized.min = cleanInteger(node.min, `${field}.min`, -100000, 100000);
  if (node.max !== undefined) normalized.max = cleanInteger(node.max, `${field}.max`, -100000, 100000);
  if (node.source !== undefined) normalized.source = cleanText(node.source, `${field}.source`, 260);
  if (node.action !== undefined) normalized.action = normalizeAction(node.action, `${field}.action`);
  return normalized;
}

function normalizeLayout(layout, field) {
  assertObject(layout, field);
  const normalized = {
    x: cleanInteger(layout.x, `${field}.x`, 0, WALNUT_SCREEN_WIDTH - 1),
    y: cleanInteger(layout.y, `${field}.y`, 0, WALNUT_SCREEN_HEIGHT - 1),
    w: cleanInteger(layout.w, `${field}.w`, 1, WALNUT_SCREEN_WIDTH),
    h: cleanInteger(layout.h, `${field}.h`, 1, WALNUT_SCREEN_HEIGHT),
  };
  if (normalized.x + normalized.w > WALNUT_SCREEN_WIDTH || normalized.y + normalized.h > WALNUT_SCREEN_HEIGHT) {
    throw new Error(`${field} must stay inside ${WALNUT_SCREEN_WIDTH}x${WALNUT_SCREEN_HEIGHT}`);
  }
  return normalized;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) throw new Error("actions must be an array");
  return actions.slice(0, 24).map((action, index) => normalizeAction(action, `actions[${index}]`));
}

function normalizeAction(action, field) {
  assertObject(action, field);
  return {
    name: cleanActionName(action.name, `${field}.name`),
    params: normalizeData(action.params || {}),
  };
}

function normalizeData(data) {
  assertObject(data, "data");
  return JSON.parse(JSON.stringify(data));
}

function runtimeTypeFromKind(kind) {
  return RUNTIME_TYPE_BY_WIDGET_KIND[kind] || "rect";
}

function a2uiComponentFromKind(kind) {
  return A2UI_COMPONENT_BY_WIDGET_KIND[kind] || "Container";
}

function colorFromStyle(style) {
  const token = normalizeStyle(style || "text", "style");
  const colors = {
    screen: "101412",
    panel: "263443",
    text: "f4f1df",
    muted: "a8b5a2",
    muted2: "7f8b7b",
    primary: "78c58a",
    accent: "8fd6ff",
    orange: "ff9f0a",
    danger: "ff6b6b",
    trace: "455a64",
    chip: "314052",
    panelBorder: "78c58a",
    barTrack: "263443",
  };
  return colors[token] || colors.text;
}

function valueFromBinding(data, binding) {
  if (!binding) return null;
  const parts = String(binding).replace(/^\//, "").split("/").filter(Boolean);
  let value = data;
  for (const part of parts) {
    if (!value || typeof value !== "object" || !(part in value)) return null;
    value = value[part];
  }
  return value;
}

function cleanRuntimeValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeStyle(value, field) {
  const token = cleanToken(value, field, 64);
  return STYLE_TOKENS.has(token) ? token : "text";
}

function cleanBinding(value, field) {
  const text = cleanText(value, field, 160);
  if (!text.startsWith("/") || text.includes("..")) throw new Error(`${field} must be an absolute data path`);
  return text;
}

function cleanActionName(value, field) {
  const text = cleanText(value, field, 80);
  if (!/^[a-z][a-z0-9_.:-]*$/i.test(text)) throw new Error(`${field} must be an action name`);
  return text;
}

function cleanId(value, field) {
  const text = cleanText(value, field, 80);
  if (!SAFE_ID_RE.test(text)) throw new Error(`${field} must be a simple slug`);
  return text;
}

function cleanToken(value, field, limit) {
  const text = cleanText(value, field, limit);
  if (!/^[a-zA-Z0-9._:-]+$/.test(text)) throw new Error(`${field} must be a simple token`);
  return text;
}

function cleanText(value, field, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${field} is required`);
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

function cleanOptionalText(value, field, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

function cleanInteger(value, field, low, high) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a number`);
  const rounded = Math.round(number);
  if (rounded !== number || rounded < low || rounded > high) {
    throw new Error(`${field} must be an integer between ${low} and ${high}`);
  }
  return rounded;
}

function cleanExactInteger(value, field, expected) {
  const number = cleanInteger(value, field, 0, Number.MAX_SAFE_INTEGER);
  if (number !== expected) throw new Error(`${field} must be ${expected}`);
  return number;
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function compactDisplayText(text, maxChars) {
  return Array.from(String(text || "HELLO").replace(/\s+/g, " ").trim()).slice(0, maxChars).join("");
}

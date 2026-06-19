export const WALNUT_LVGL_WIDGET_CATALOG_SCHEMA = "walnutpi.lvgl-widget-catalog.v1";
export const WALNUT_WIDGET_APP_SCHEMA = "walnutpi.widget-app.v1";
export const WALNUT_WIDGET_APP_SOURCE_SCHEMA = "walnutpi.widget-app-source.v1";
export const WALNUT_WIDGET_SNAPSHOT_SOURCE_SCHEMA = "walnutpi.widget-app-snapshot-source.v1";
export const WALNUT_SCREEN_WIDTH = 480;
export const WALNUT_SCREEN_HEIGHT = 320;

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const STYLE_TOKENS = new Set(["screen", "panel", "text", "muted", "muted2", "primary", "accent", "orange", "danger", "trace", "chip", "panelBorder", "barTrack"]);
const NODE_KINDS = new Set(["container", "rect", "text", "image", "button", "toggle", "progress", "gauge", "list", "status_tile"]);

export function validateWalnutLvglWidgetCatalog(surface) {
  assertObject(surface, "catalog");
  if (surface.schema !== WALNUT_LVGL_WIDGET_CATALOG_SCHEMA) {
    throw new Error(`catalog.schema must be ${WALNUT_LVGL_WIDGET_CATALOG_SCHEMA}`);
  }
  const normalized = {
    schema: WALNUT_LVGL_WIDGET_CATALOG_SCHEMA,
    id: cleanId(surface.id, "id"),
    title: cleanText(surface.title || surface.id, "title", 80),
    size: {
      width: cleanExactInteger(surface.size?.width, "size.width", WALNUT_SCREEN_WIDTH),
      height: cleanExactInteger(surface.size?.height, "size.height", WALNUT_SCREEN_HEIGHT),
    },
    theme: cleanToken(surface.theme || "pixel-default", "theme", 64),
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
    ...(app.ioccc && typeof app.ioccc === "object" ? { ioccc: normalizeData(app.ioccc) } : {}),
  };
}

export function walnutWidgetCatalogFromPixelSpec(spec) {
  const nodes = [
    {
      id: "root",
      kind: "container",
      layout: { x: 0, y: 0, w: WALNUT_SCREEN_WIDTH, h: WALNUT_SCREEN_HEIGHT },
      style: "screen",
    },
  ];
  for (const [index, widget] of pixelSpecRuntimeWidgets(spec).entries()) {
    nodes.push({
      id: widget.id || `w${index}`,
      kind: widgetKindFromRuntimeType(widget.type),
      parent: "root",
      layout: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      ...(widget.text ? { text: widget.text } : {}),
      ...(widget.value ? { value: widget.value, min: 0, max: 100 } : {}),
      style: styleFromColor(widget.color),
    });
  }
  return validateWalnutLvglWidgetCatalog({
    schema: WALNUT_LVGL_WIDGET_CATALOG_SCHEMA,
    id: cleanId(spec.id || spec.template || "widget-app", "id"),
    title: spec.title || "Widget App",
    size: { width: WALNUT_SCREEN_WIDTH, height: WALNUT_SCREEN_HEIGHT },
    theme: "pixel-default",
    data: {},
    root: "root",
    nodes,
  });
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

function pixelSpecRuntimeWidgets(spec) {
  return repairedPixelElements(spec).slice(0, 12).map((element, index) => {
    const scale = element.scale || 1;
    const x = Math.round((element.x || 0) * 4);
    const y = Math.round((element.y || 0) * 4);
    if (element.type === "text") {
      return {
        type: "label",
        id: `w${index}`,
        x,
        y: Math.max(0, y - (scale === 2 ? 24 : 14)),
        w: Math.min(WALNUT_SCREEN_WIDTH - x, Math.max(48, String(element.text || "").length * (scale === 2 ? 20 : 12))),
        h: scale === 2 ? 32 : 20,
        text: element.text || "",
        value: 0,
        color: element.fill || "text",
      };
    }
    if (element.type === "bar" || element.type === "arc") {
      return {
        type: element.type,
        id: `w${index}`,
        x,
        y,
        w: Math.max(24, (element.width || 20) * 4),
        h: Math.max(12, (element.height || 6) * 4),
        text: "",
        value: Math.max(0, Math.min(100, Number(element.value || spec.progress || 50))),
        color: element.fill || "accent",
      };
    }
    return {
      type: "rect",
      id: `w${index}`,
      x,
      y,
      w: Math.max(4, (element.width || 1) * 4),
      h: Math.max(4, (element.height || 1) * 4),
      text: "",
      value: 0,
      color: element.fill || "accent",
    };
  });
}

function repairedPixelElements(spec) {
  if (!Array.isArray(spec.elements) || spec.elements.length === 0) return fallbackPixelElements(spec);
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
    { x: 6, y: 12, scale: 2 },
    { x: 6, y: 32, scale: 2 },
    { x: 6, y: 51, scale: 1 },
    { x: 66, y: 12, scale: 1 },
    { x: 66, y: 35, scale: 1 },
  ];
  const controlSlots = [
    { x: 66, y: 19, width: 46, height: 6 },
    { x: 66, y: 42, width: 46, height: 6 },
    { x: 86, y: 52, width: 22, height: 22 },
    { x: 64, y: 52, width: 18, height: 18 },
  ];
  elements.push(
    { type: "rect", x: 3, y: 3, width: 114, height: 1, fill: "panelBorder" },
    { type: "rect", x: 3, y: 76, width: 114, height: 1, fill: "panelBorder" },
    { type: "rect", x: 3, y: 4, width: 1, height: 72, fill: "panelBorder" },
    { type: "rect", x: 116, y: 4, width: 1, height: 72, fill: "panelBorder" },
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
    });
  }
  return elements.slice(0, 12);
}

function fallbackPixelElements(spec) {
  return [
    { type: "text", x: 6, y: 12, text: spec.title || "Widget", fill: "text", scale: 2 },
    { type: "text", x: 6, y: 32, text: spec.primaryValue || "Ready", fill: "accent", scale: 2 },
    { type: "bar", x: 66, y: 42, width: 46, height: 6, fill: "accent", value: spec.progress || 50 },
  ];
}

function normalizeNodes(nodes) {
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

function normalizeNode(node, field) {
  assertObject(node, field);
  const kind = cleanToken(node.kind, `${field}.kind`, 32);
  if (!NODE_KINDS.has(kind)) throw new Error(`${field}.kind is not supported`);
  const normalized = {
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

function widgetKindFromRuntimeType(type) {
  if (type === "label") return "text";
  if (type === "rect") return "rect";
  if (type === "bar") return "progress";
  if (type === "arc") return "gauge";
  return "text";
}

function runtimeTypeFromKind(kind) {
  if (kind === "text" || kind === "button" || kind === "toggle" || kind === "list" || kind === "status_tile") return "label";
  if (kind === "rect") return "rect";
  if (kind === "progress") return "bar";
  if (kind === "gauge") return "arc";
  return "rect";
}

function a2uiComponentFromKind(kind) {
  if (kind === "text" || kind === "status_tile") return "Text";
  if (kind === "button" || kind === "toggle") return "Button";
  if (kind === "image") return "Image";
  if (kind === "progress") return "Progress";
  if (kind === "gauge") return "Gauge";
  if (kind === "list") return "List";
  return "Container";
}

function styleFromColor(color) {
  const token = String(color || "text").replace(/^#/, "");
  return STYLE_TOKENS.has(token) ? token : "accent";
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

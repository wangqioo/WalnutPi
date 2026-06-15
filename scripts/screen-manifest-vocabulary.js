import { createHash } from "node:crypto";

export const SCREEN_MAX_PAGES = 6;
export const SCREEN_MAX_COMPONENTS = 6;
export const SCREEN_TEXT_LIMIT = 48;
export const SCREEN_LINE_LIMIT = 72;
export const SCREEN_TONES = new Set(["ok", "warn", "error"]);
export const SCREEN_COMPONENT_TYPES = new Set(["statusCard", "metricGroup", "list", "progress", "alert", "textPage", "generatedPage", "layout", "pixelArt"]);
export const SCREEN_GENERATED_STYLES = new Set(["panel", "comic", "music", "network", "task", "status", "alert", "minimal"]);
export const SCREEN_ACCENTS = new Set(["cyan", "green", "amber", "red", "blue", "pink", "paper"]);
export const SCREEN_DRAW_KINDS = new Set(["rect", "label", "bar", "line", "circle"]);
export const SCREEN_FONT_SIZES = new Set(["small", "body", "title"]);

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function screenManifestHash(manifest) {
  return createHash("sha256").update(stableStringify(manifest)).digest("hex");
}

function rejectControlText(value, field) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} contains control characters`);
  }
}

export function cleanText(value, field, limit = SCREEN_TEXT_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if (!text) throw new Error(`${field} is required`);
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

export function cleanOptionalText(value, field, limit = SCREEN_TEXT_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if ([...text].length > limit) throw new Error(`${field} is too long`);
  return text;
}

export function cleanTextList(values, field, maxItems, limit = SCREEN_LINE_LIMIT) {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  const items = values.map((value, index) => cleanText(value, `${field}[${index}]`, limit));
  if (items.length === 0 || items.length > maxItems) {
    throw new Error(`${field} must contain 1-${maxItems} items`);
  }
  return items;
}

function cleanPageId(value, field) {
  const id = cleanText(value, field, 32);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
    throw new Error(`${field} must be a simple slug`);
  }
  return id;
}

export function cleanTone(value, field) {
  const tone = String(value || "ok").trim().toLowerCase();
  if (!SCREEN_TONES.has(tone)) throw new Error(`${field} must be ok, warn, or error`);
  return tone;
}

export function cleanProgress(value, field) {
  if (value === undefined || value === null || value === "") return 72;
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
  return Math.round(progress);
}

function cleanInteger(value, field, low, high, fallback = 0) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a number`);
  const rounded = Math.round(number);
  if (rounded < low || rounded > high) throw new Error(`${field} must be between ${low} and ${high}`);
  return rounded;
}

function coerceInteger(value, low, high, fallback = 0) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(low, Math.min(high, Math.round(number)));
}

function cleanHexColor(value, field, fallback = "0xffffff") {
  const color = String(value || fallback).trim().toLowerCase();
  if (!/^0x[0-9a-f]{6}$/.test(color)) throw new Error(`${field} must be a 0xRRGGBB color`);
  return color;
}

function cleanDrawKind(value, field) {
  const kind = String(value || "").trim();
  if (!SCREEN_DRAW_KINDS.has(kind)) throw new Error(`${field} must be one of ${[...SCREEN_DRAW_KINDS].join(", ")}`);
  return kind;
}

function cleanFontSize(value, field) {
  const size = String(value || "body").trim().toLowerCase();
  if (!SCREEN_FONT_SIZES.has(size)) throw new Error(`${field} must be small, body, or title`);
  return size;
}

function cleanDrawElements(values, field) {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  if (values.length === 0 || values.length > 24) throw new Error(`${field} must contain 1-24 items`);
  const cleaned = values.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${field}[${index}] must be an object`);
    const kind = cleanDrawKind(item.kind, `${field}[${index}].kind`);
    const fallbackW = kind === "line" ? 1 : 80;
    const fallbackH = kind === "line" ? 1 : 32;
    const safeInset = kind === "rect" && index === 0 ? 0 : 8;
    const x = coerceInteger(item.x, safeInset, 479 - safeInset, safeInset);
    const y = coerceInteger(item.y, safeInset, 319 - safeInset, safeInset);
    const minW = kind === "label" ? 42 : kind === "bar" ? 36 : kind === "circle" ? 10 : 1;
    const minH = kind === "label" ? 18 : kind === "bar" ? 8 : kind === "circle" ? 10 : 1;
    const maxW = Math.max(minW, 480 - safeInset - x);
    const maxH = Math.max(minH, 320 - safeInset - y);
    const w = coerceInteger(item.w, minW, maxW, fallbackW);
    const h = coerceInteger(item.h, minH, maxH, fallbackH);
    const element = {
      kind,
      x,
      y,
      w,
      h,
      color: cleanHexColor(item.color, `${field}[${index}].color`, kind === "rect" ? "0x172329" : "0xf4f1df"),
      bg: cleanHexColor(item.bg, `${field}[${index}].bg`, "0x000000"),
      border: cleanHexColor(item.border, `${field}[${index}].border`, "0x000000"),
      radius: cleanInteger(item.radius, `${field}[${index}].radius`, 0, 40, 0),
      width: cleanInteger(item.width, `${field}[${index}].width`, 0, 12, kind === "line" ? 2 : 0),
      value: cleanInteger(item.value, `${field}[${index}].value`, 0, 100, 0),
      font: cleanFontSize(item.font, `${field}[${index}].font`),
      text: cleanOptionalText(item.text || "", `${field}[${index}].text`, 64),
    };
    if (element.x + element.w > 480) throw new Error(`${field}[${index}] exceeds screen width`);
    if (element.y + element.h > 320) throw new Error(`${field}[${index}] exceeds screen height`);
    if (kind === "label" && !element.text) throw new Error(`${field}[${index}].text is required for labels`);
    return element;
  });
  assertDrawElementSpacing(cleaned, field);
  return cleaned;
}

function cleanPixelSymbol(value, field) {
  const symbol = String(value || "").trim();
  if (!/^[A-Za-z0-9.*+#@$%&!?=-]$/.test(symbol)) {
    throw new Error(`${field} must be a single ASCII pixel symbol`);
  }
  return symbol;
}

function cleanPixelPalette(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  const entries = Object.entries(value).slice(0, 12).map(([symbol, color], index) => [
    cleanPixelSymbol(symbol, `${field}.${index}.symbol`),
    cleanHexColor(color, `${field}.${symbol}`),
  ]);
  if (entries.length === 0) throw new Error(`${field} must define at least one color`);
  return Object.fromEntries(entries);
}

function cleanPixelRows(rows, field, palette, width, height) {
  if (!Array.isArray(rows)) throw new Error(`${field} must be an array`);
  if (rows.length !== height) throw new Error(`${field} must contain exactly ${height} rows`);
  const allowed = new Set([".", " ", ...Object.keys(palette)]);
  return rows.map((row, index) => {
    const text = String(row || "");
    if ([...text].length !== width) throw new Error(`${field}[${index}] must be exactly ${width} symbols`);
    for (const symbol of text) {
      if (!allowed.has(symbol)) throw new Error(`${field}[${index}] contains unknown pixel symbol ${symbol}`);
    }
    return text.replace(/ /g, ".");
  });
}

function cleanPixelFrames(value, field, palette, width, height) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length === 0 || value.length > 8) throw new Error(`${field} must contain 1-8 frames`);
  return value.map((frame, index) => {
    const item = frame && typeof frame === "object" && !Array.isArray(frame) ? frame : {};
    return {
      durationMs: cleanInteger(item.durationMs, `${field}[${index}].durationMs`, 80, 5000, 500),
      rows: cleanPixelRows(item.rows || [], `${field}[${index}].rows`, palette, width, height),
    };
  });
}

function drawOverlapRatio(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= left || bottom <= top) return 0;
  const overlap = (right - left) * (bottom - top);
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? overlap / smaller : 0;
}

function elementCanLayer(top, bottom) {
  if (bottom.kind === "rect" && ["label", "bar", "circle", "line"].includes(top.kind)) return true;
  if (bottom.kind === "bar" && top.kind === "label") return true;
  if (top.kind === "label" && bottom.kind === "label") return true;
  return false;
}

function assertDrawElementSpacing(elements, field) {
  const foreground = elements.filter((element) => element.kind !== "rect");
  for (let i = 0; i < foreground.length; i += 1) {
    for (let j = i + 1; j < foreground.length; j += 1) {
      const a = foreground[i];
      const b = foreground[j];
      if (elementCanLayer(a, b) || elementCanLayer(b, a)) continue;
      if (drawOverlapRatio(a, b) > 0.18) {
        throw new Error(`${field} foreground elements overlap too much; leave more space between labels, bars, and indicators`);
      }
    }
  }
}

export function cleanGeneratedStyle(value, field = "generatedPage.style") {
  const style = String(value || "panel").trim().toLowerCase();
  if (!SCREEN_GENERATED_STYLES.has(style)) {
    throw new Error(`${field} must be one of ${[...SCREEN_GENERATED_STYLES].join(", ")}`);
  }
  return style;
}

export function cleanAccent(value, field = "generatedPage.accent") {
  const accent = String(value || "cyan").trim().toLowerCase();
  if (!SCREEN_ACCENTS.has(accent)) {
    throw new Error(`${field} must be one of ${[...SCREEN_ACCENTS].join(", ")}`);
  }
  return accent;
}

function cleanGeneratedItems(values, field) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  if (values.length > 3) throw new Error(`${field} must contain at most 3 items`);
  return values.map((item, index) => {
    const itemObject = item && typeof item === "object" && !Array.isArray(item) ? item : null;
    return {
      label: cleanText(itemObject ? itemObject.label || `M${index + 1}` : item, `${field}[${index}].label`, 12),
      value: cleanText(itemObject ? itemObject.value || "--" : "--", `${field}[${index}].value`, 16),
      unit: cleanOptionalText(itemObject ? itemObject.unit || "" : "", `${field}[${index}].unit`, 8),
      tone: cleanTone(itemObject ? itemObject.tone || "ok" : "ok", `${field}[${index}].tone`),
    };
  });
}

function cleanScreenComponent(component, field) {
  if (!component || typeof component !== "object" || Array.isArray(component)) {
    throw new Error(`${field} must be an object`);
  }
  const type = cleanText(component.type, `${field}.type`, 16);
  if (!SCREEN_COMPONENT_TYPES.has(type)) throw new Error(`${field}.type is not supported`);

  if (type === "statusCard") {
    return {
      type,
      label: cleanText(component.label || "Status", `${field}.label`, 12),
      value: cleanText(component.value || "Ready", `${field}.value`, 24),
      tone: cleanTone(component.tone || "ok", `${field}.tone`),
      detail: cleanText(component.detail || "Ready", `${field}.detail`, 24),
    };
  }

  if (type === "metricGroup") {
    if (!Array.isArray(component.items)) throw new Error(`${field}.items must be an array`);
    if (component.items.length === 0 || component.items.length > 3) {
      throw new Error(`${field}.items must contain 1-3 items`);
    }
    return {
      type,
      items: component.items.map((item, index) => {
        const itemObject = item && typeof item === "object" && !Array.isArray(item) ? item : null;
        return {
          label: cleanText(itemObject ? itemObject.label || `M${index + 1}` : item, `${field}.items[${index}].label`, 12),
          value: cleanText(itemObject ? itemObject.value || "--" : item, `${field}.items[${index}].value`, 16),
          unit: cleanOptionalText(itemObject ? itemObject.unit || "" : "", `${field}.items[${index}].unit`, 8),
          tone: cleanTone(itemObject ? itemObject.tone || "ok" : "ok", `${field}.items[${index}].tone`),
        };
      }),
    };
  }

  if (type === "list") {
    return {
      type,
      title: cleanText(component.title || "List", `${field}.title`, 32),
      items: cleanTextList(component.items || [], `${field}.items`, 4, 48),
    };
  }

  if (type === "progress") {
    return {
      type,
      label: cleanText(component.label || "Progress", `${field}.label`, 16),
      value: cleanProgress(component.value ?? 72, `${field}.value`),
      max: cleanProgress(component.max ?? 100, `${field}.max`),
      tone: cleanTone(component.tone || "ok", `${field}.tone`),
    };
  }

  if (type === "alert") {
    return {
      type,
      title: cleanText(component.title || "Alert", `${field}.title`, 32),
      body: cleanText(component.body || "Check status", `${field}.body`, 48),
      tone: cleanTone(component.tone || "warn", `${field}.tone`),
    };
  }

  if (type === "generatedPage") {
    return {
      type,
      style: cleanGeneratedStyle(component.style || "panel", `${field}.style`),
      kicker: cleanText(component.kicker || "WalnutAI", `${field}.kicker`, 20),
      headline: cleanText(component.headline || component.title || "Ready", `${field}.headline`, 24),
      body: cleanText(component.body || component.detail || "Generated screen", `${field}.body`, 56),
      badge: cleanText(component.badge || "LIVE", `${field}.badge`, 12),
      accent: cleanAccent(component.accent || "cyan", `${field}.accent`),
      progress: cleanProgress(component.progress ?? 64, `${field}.progress`),
      items: cleanGeneratedItems(component.items, `${field}.items`),
    };
  }

  if (type === "layout") {
    return {
      type,
      background: cleanHexColor(component.background || "0x05080b", `${field}.background`, "0x05080b"),
      elements: cleanDrawElements(component.elements || [], `${field}.elements`),
    };
  }

  if (type === "pixelArt") {
    const width = cleanInteger(component.width, `${field}.width`, 8, 64, 48);
    const height = cleanInteger(component.height, `${field}.height`, 8, 32, 20);
    const pixelSize = cleanInteger(component.pixelSize, `${field}.pixelSize`, 1, 16, 8);
    const gap = cleanInteger(component.gap, `${field}.gap`, 0, 4, 1);
    const palette = cleanPixelPalette(component.palette || {}, `${field}.palette`);
    const x = cleanInteger(component.x, `${field}.x`, 0, 479, 24);
    const y = cleanInteger(component.y, `${field}.y`, 0, 319, 28);
    const drawnWidth = width * pixelSize + Math.max(0, width - 1) * gap;
    const drawnHeight = height * pixelSize + Math.max(0, height - 1) * gap;
    if (x + drawnWidth > 480) throw new Error(`${field} pixel grid exceeds 480px screen width`);
    if (y + drawnHeight > 320) throw new Error(`${field} pixel grid exceeds 320px screen height`);
    const cleaned = {
      type,
      background: cleanHexColor(component.background || "0x05080b", `${field}.background`, "0x05080b"),
      x,
      y,
      width,
      height,
      pixelSize,
      gap,
      palette,
      frames: cleanPixelFrames(component.frames || [], `${field}.frames`, palette, width, height),
    };
    if (component.material && typeof component.material === "object" && !Array.isArray(component.material)) {
      cleaned.material = {
        source: cleanText(component.material.source || "public-material", `${field}.material.source`, 32),
        query: cleanText(component.material.query || "", `${field}.material.query`, 120),
        title: cleanText(component.material.title || "", `${field}.material.title`, 120),
        url: cleanText(component.material.url || "", `${field}.material.url`, 500),
        license: cleanText(component.material.license || "", `${field}.material.license`, 80),
      };
    }
    return cleaned;
  }

  return {
    type,
    title: cleanText(component.title || "Page", `${field}.title`, 32),
    lines: cleanTextList(component.lines || [], `${field}.lines`, 4, 48),
  };
}

function normalizeScreenComponents(page, pageIndex) {
  if (!Array.isArray(page.components)) throw new Error(`pages[${pageIndex}].components must be an array`);
  if (page.components.length === 0 || page.components.length > SCREEN_MAX_COMPONENTS) {
    throw new Error(`pages[${pageIndex}].components must contain 1-${SCREEN_MAX_COMPONENTS} items`);
  }
  return page.components.map((component, index) => cleanScreenComponent(component, `pages[${pageIndex}].components[${index}]`));
}

export function firstScreenComponent(components, type) {
  return components.find((component) => component.type === type) || null;
}

export function metricItemFromText(value, index = 0) {
  const text = cleanText(value, `metricText[${index}]`, 24);
  const [label, ...rest] = text.split(/\s+/);
  return {
    label: cleanText(label || `M${index + 1}`, `metricText[${index}].label`, 12),
    value: cleanText(rest.join(" ") || "--", `metricText[${index}].value`, 16),
    unit: "",
    tone: "ok",
  };
}

export function toneFromText(value) {
  const text = String(value || "");
  if (/错误|失败|异常|危险|离线|error|fail|failed|down|offline|critical/i.test(text)) return "error";
  if (/告警|警告|注意|偏高|等待|warn|warning|pending|busy|degraded/i.test(text)) return "warn";
  return "ok";
}

export function validateScreenManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("screen manifest must be a JSON object");
  }
  if (manifest.schema !== "walnutpi.screen.v1") {
    throw new Error("screen manifest schema must be walnutpi.screen.v1");
  }
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("screen manifest id is required");
  }
  if (!manifest.target || typeof manifest.target !== "object" || Array.isArray(manifest.target)) {
    throw new Error("screen manifest target is required");
  }
  if (manifest.target.runtime !== "lvgl-fbdev") {
    throw new Error("screen manifest target.runtime must be lvgl-fbdev");
  }
  if (manifest.target.display !== "/dev/fb0") {
    throw new Error("screen manifest target.display must be /dev/fb0");
  }
  if (manifest.target.width !== 480) {
    throw new Error("screen manifest target.width must be 480");
  }
  if (manifest.target.height !== 320) {
    throw new Error("screen manifest target.height must be 320");
  }
  if (manifest.target.color !== "RGB565") {
    throw new Error("screen manifest target.color must be RGB565");
  }
  if (!manifest.source || typeof manifest.source !== "object" || Array.isArray(manifest.source)) {
    throw new Error("screen manifest source is required");
  }
  if (manifest.source.lvglEntry !== "lvgl_app/src/main.c") {
    throw new Error("screen manifest source.lvglEntry must be lvgl_app/src/main.c");
  }
  if (manifest.source.command !== "walnut screen start") {
    throw new Error("screen manifest source.command must be walnut screen start");
  }
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0 || manifest.pages.length > SCREEN_MAX_PAGES) {
    throw new Error(`screen manifest pages must contain 1-${SCREEN_MAX_PAGES} pages`);
  }
  return manifest;
}

export function normalizeScreenManifest(manifest) {
  validateScreenManifest(manifest);
  const seenIds = new Set();
  const pages = manifest.pages.map((page, index) => {
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      throw new Error(`screen manifest pages[${index}] must be an object`);
    }
    for (const field of ["status", "tone", "progress", "metrics", "title", "lines"]) {
      if (Object.hasOwn(page, field)) {
        throw new Error(`pages[${index}].${field} is not supported; use pages[${index}].components`);
      }
    }
    const id = cleanPageId(page.id || `page-${index + 1}`, `pages[${index}].id`);
    if (seenIds.has(id)) throw new Error(`pages[${index}].id must be unique`);
    seenIds.add(id);
    return {
      id,
      tab: cleanText(page.tab || id.toUpperCase(), `pages[${index}].tab`, 8),
      components: normalizeScreenComponents(page, index),
    };
  });

  return {
    ...manifest,
    title: cleanText(manifest.title || "WalnutPi", "title", 32),
    subtitle: cleanText(manifest.subtitle || "server screen", "subtitle", 40),
    pages,
  };
}

export function toneColor(tone) {
  return {
    ok: "0x33d6a6",
    warn: "0xffc857",
    error: "0xff6b6b",
  }[cleanTone(tone, "tone")];
}

export function accentColor(accent) {
  return {
    cyan: "0x67d6ff",
    green: "0x33d6a6",
    amber: "0xffc857",
    red: "0xff6b6b",
    blue: "0x7aa8d8",
    pink: "0xff6fb3",
    paper: "0xf7e9b9",
  }[cleanAccent(accent, "accent")];
}

export function screenManifestRuntimeConfig(manifest) {
  const normalized = normalizeScreenManifest(manifest);
  return {
    title: normalized.title,
    subtitle: normalized.subtitle,
    pages: normalized.pages,
  };
}

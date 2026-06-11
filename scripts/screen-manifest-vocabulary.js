import { createHash } from "node:crypto";

export const SCREEN_PAGE_IDS = ["home", "system", "ai", "network"];
export const SCREEN_TEXT_LIMIT = 48;
export const SCREEN_LINE_LIMIT = 72;
export const SCREEN_TONES = new Set(["ok", "warn", "error"]);
export const SCREEN_COMPONENT_TYPES = new Set(["statusCard", "metricGroup", "list", "progress", "alert", "textPage"]);

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
  if ([...text].length > limit) {
    throw new Error(`${field} is too long`);
  }
  return text;
}

export function cleanOptionalText(value, field, limit = SCREEN_TEXT_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if ([...text].length > limit) {
    throw new Error(`${field} is too long`);
  }
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
      value: cleanText(component.value || "OK CORE", `${field}.value`, 24),
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

  return {
    type,
    title: cleanText(component.title || "Page", `${field}.title`, 32),
    lines: cleanTextList(component.lines || [], `${field}.lines`, 4, 48),
  };
}

function normalizeScreenComponents(page, pageIndex) {
  if (page.components === undefined) return [];
  if (!Array.isArray(page.components)) throw new Error(`pages[${pageIndex}].components must be an array`);
  if (page.components.length > 6) throw new Error(`pages[${pageIndex}].components must contain at most 6 items`);
  const normalized = page.components.map((component, index) => cleanScreenComponent(component, `pages[${pageIndex}].components[${index}]`));
  const seenTypes = new Set();
  for (const component of normalized) {
    if (seenTypes.has(component.type)) throw new Error(`pages[${pageIndex}].components must not repeat ${component.type}`);
    seenTypes.add(component.type);
  }
  return normalized;
}

export function firstScreenComponent(components, type) {
  return components.find((component) => component.type === type) || null;
}

function screenMetricText(item) {
  const value = `${item.value} ${item.unit || ""}`.trim();
  return cleanText(`${item.label} ${value}`.trim(), "metricGroup.item", 24);
}

export function metricItemFromText(value, index) {
  const text = cleanText(value, `pages[0].metrics[${index}]`, 24);
  const [label, ...rest] = text.split(/\s+/);
  return {
    label: cleanText(label || `M${index + 1}`, `pages[0].metrics[${index}].label`, 12),
    value: cleanText(rest.join(" ") || "--", `pages[0].metrics[${index}].value`, 16),
    unit: "",
    tone: "ok",
  };
}

function componentLines(page, components, pageIndex) {
  const alert = firstScreenComponent(components, "alert");
  const textPage = firstScreenComponent(components, "textPage");
  const listComponent = firstScreenComponent(components, "list");
  if (alert) {
    return {
      title: alert.title,
      lines: cleanTextList([alert.body], `pages[${pageIndex}].componentLines`, 4, 48),
    };
  }
  if (listComponent) {
    return {
      title: listComponent.title,
      lines: cleanTextList(listComponent.items.slice(0, 4), `pages[${pageIndex}].componentLines`, 4, 48),
    };
  }
  if (textPage) {
    return {
      title: textPage.title,
      lines: cleanTextList(textPage.lines.slice(0, 4), `pages[${pageIndex}].componentLines`, 4, 48),
    };
  }
  const title = cleanText(page.title || page.tab || SCREEN_PAGE_IDS[pageIndex], `pages[${pageIndex}].title`, 32);
  return {
    title,
    lines: cleanTextList(page.lines || [title], `pages[${pageIndex}].lines`, 4, 48),
  };
}

function buildHomeComponents(status, tone, progress, metrics, existingComponents) {
  const components = existingComponents.filter((component) => !["statusCard", "progress", "metricGroup"].includes(component.type));
  const existingStatusCard = firstScreenComponent(existingComponents, "statusCard");
  const existingProgress = firstScreenComponent(existingComponents, "progress");
  const existingMetricGroup = firstScreenComponent(existingComponents, "metricGroup");
  components.unshift({
    type: "metricGroup",
    items: existingMetricGroup?.items || metrics.map(metricItemFromText),
  });
  components.unshift({
    type: "progress",
    label: existingProgress?.label || "Progress",
    value: progress,
    max: existingProgress?.max || 100,
    tone,
  });
  components.unshift({
    type: "statusCard",
    label: existingStatusCard?.label || "Status",
    value: status,
    tone,
    detail: existingStatusCard?.detail || "Ready",
  });
  return components;
}

function buildTextPageComponents(title, lines, existingComponents) {
  const existingAlert = firstScreenComponent(existingComponents, "alert");
  const components = existingComponents.filter((component) => !["alert", "textPage", "list"].includes(component.type));
  const existingTextPage = firstScreenComponent(existingComponents, "textPage");
  const existingList = firstScreenComponent(existingComponents, "list");
  if (existingAlert) {
    components.unshift(existingList ? {
      type: "list",
      title: existingList.title,
      items: existingList.items,
    } : {
      type: "textPage",
      title: existingTextPage?.title || title,
      lines: existingTextPage?.lines || lines,
    });
    components.unshift({
      type: "alert",
      title,
      body: lines[0] || "Check status",
      tone: existingAlert.tone || "warn",
    });
    return components;
  }
  if (existingList) {
    components.unshift({
      type: "list",
      title,
      items: lines,
    });
    return components;
  }
  components.unshift({
    type: "textPage",
    title,
    lines,
  });
  return components;
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
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== SCREEN_PAGE_IDS.length) {
    throw new Error(`screen manifest pages must contain exactly ${SCREEN_PAGE_IDS.length} pages`);
  }
  for (const [index, expectedId] of SCREEN_PAGE_IDS.entries()) {
    const page = manifest.pages[index];
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      throw new Error(`screen manifest pages[${index}] must be an object`);
    }
    if (page.id !== expectedId) {
      throw new Error(`screen manifest pages[${index}].id must be ${expectedId}`);
    }
  }
  return manifest;
}

export function normalizeScreenManifest(manifest) {
  validateScreenManifest(manifest);

  const pages = manifest.pages.map((page, index) => {
    const components = normalizeScreenComponents(page, index);
    const next = {
      id: SCREEN_PAGE_IDS[index],
      tab: cleanText(page.tab || SCREEN_PAGE_IDS[index].toUpperCase(), `pages[${index}].tab`, 8),
    };
    if (index === 0) {
      const statusCard = firstScreenComponent(components, "statusCard");
      const progressComponent = firstScreenComponent(components, "progress");
      const metricGroup = firstScreenComponent(components, "metricGroup");
      const alert = firstScreenComponent(components, "alert");
      next.status = cleanText(statusCard ? statusCard.value : page.status || "OK CORE", "pages[0].status", 24);
      next.tone = cleanTone(
        statusCard ? statusCard.tone : alert ? alert.tone : progressComponent ? progressComponent.tone : page.tone || toneFromText(next.status),
        "pages[0].tone",
      );
      next.progress = cleanProgress(progressComponent ? progressComponent.value : page.progress, "pages[0].progress");
      next.metrics = metricGroup
        ? metricGroup.items.map(screenMetricText)
        : cleanTextList(page.metrics || ["IP loading", "MEM --", "DISK --"], "pages[0].metrics", 3, 24);
      while (next.metrics.length < 3) next.metrics.push("--");
      next.metrics = next.metrics.slice(0, 3);
      next.components = buildHomeComponents(next.status, next.tone, next.progress, next.metrics, components);
    } else {
      const text = componentLines(page, components, index);
      next.title = text.title;
      next.lines = text.lines;
      next.components = buildTextPageComponents(next.title, next.lines, components);
    }
    return next;
  });

  return {
    ...manifest,
    title: cleanText(manifest.title || "WalnutPi", "title", 32),
    subtitle: cleanText(manifest.subtitle || "server screen", "subtitle", 40),
    pages,
  };
}

function pageKind(components) {
  if (firstScreenComponent(components, "alert")) return "alert";
  if (firstScreenComponent(components, "list")) return "list";
  return "textPage";
}

export function toneColor(tone) {
  return {
    ok: "C_GREEN",
    warn: "C_AMBER",
    error: "C_RED",
  }[tone];
}

export function screenManifestRuntimeConfig(manifest) {
  const normalized = normalizeScreenManifest(manifest);
  const homePage = normalized.pages[0];
  const statusCard = firstScreenComponent(homePage.components, "statusCard");
  const progressComponent = firstScreenComponent(homePage.components, "progress");
  const metricGroup = firstScreenComponent(homePage.components, "metricGroup");
  const metricItems = metricGroup
    ? [...metricGroup.items]
    : homePage.metrics.map(metricItemFromText);

  while (metricItems.length < 3) {
    metricItems.push({ label: "Metric", value: "--", unit: "", tone: "ok" });
  }

  return {
    title: normalized.title,
    subtitle: normalized.subtitle,
    homeStatusLabel: cleanText(statusCard?.label || "Status", "pages[0].statusCard.label", 12),
    homeStatus: homePage.status,
    homeStatusDetail: cleanText(statusCard?.detail || "Ready", "pages[0].statusCard.detail", 24),
    homeTone: homePage.tone,
    homeProgressLabel: cleanText(progressComponent?.label || "Progress", "pages[0].progress.label", 16),
    homeProgress: homePage.progress,
    homeProgressMax: cleanProgress(progressComponent?.max ?? 100, "pages[0].progress.max"),
    tabs: normalized.pages.map((page) => page.tab),
    metrics: homePage.metrics.slice(0, 3),
    metricItems: metricItems.slice(0, 3),
    textPages: normalized.pages.slice(1).map((page) => ({
      kind: pageKind(page.components),
      title: page.title,
      lines: page.lines,
    })),
  };
}

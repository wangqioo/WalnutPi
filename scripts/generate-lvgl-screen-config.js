#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "lvgl_app", "screen-manifest.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "lvgl_app", "generated", "screen_config.h");
const PAGE_IDS = ["home", "system", "ai", "network"];
const TONES = new Set(["ok", "warn", "error"]);
const COMPONENT_TYPES = new Set(["statusCard", "metricGroup", "list", "progress", "alert", "textPage"]);

function fail(message) {
  throw new Error(message);
}

function rejectControlText(value, field) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(`${field} contains control characters`);
  }
}

function cleanText(value, field, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if (!text) fail(`${field} is required`);
  if ([...text].length > limit) fail(`${field} is too long`);
  return text;
}

function cleanOptionalText(value, field, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if ([...text].length > limit) fail(`${field} is too long`);
  return text;
}

function cleanList(values, field, maxItems, limit) {
  if (!Array.isArray(values)) fail(`${field} must be an array`);
  const items = values.map((value, index) => cleanText(value, `${field}[${index}]`, limit));
  if (items.length === 0 || items.length > maxItems) fail(`${field} must contain 1-${maxItems} items`);
  return items;
}

function cleanTone(value, field) {
  const tone = String(value || "ok").trim().toLowerCase();
  if (!TONES.has(tone)) fail(`${field} must be ok, warn, or error`);
  return tone;
}

function cleanProgress(value, field) {
  if (value === undefined || value === null || value === "") return 72;
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) fail(`${field} must be between 0 and 100`);
  return Math.round(progress);
}

function cleanComponent(component, field) {
  if (!component || typeof component !== "object" || Array.isArray(component)) fail(`${field} must be an object`);
  const type = cleanText(component.type, `${field}.type`, 16);
  if (!COMPONENT_TYPES.has(type)) fail(`${field}.type is not supported`);

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
    if (!Array.isArray(component.items)) fail(`${field}.items must be an array`);
    if (component.items.length === 0 || component.items.length > 3) fail(`${field}.items must contain 1-3 items`);
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
      items: cleanList(component.items || [], `${field}.items`, 4, 48),
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
    lines: cleanList(component.lines || [], `${field}.lines`, 4, 48),
  };
}

function normalizeComponents(page, pageIndex) {
  if (page.components === undefined) return [];
  if (!Array.isArray(page.components)) fail(`pages[${pageIndex}].components must be an array`);
  if (page.components.length > 6) fail(`pages[${pageIndex}].components must contain at most 6 items`);
  const normalized = page.components.map((component, index) => cleanComponent(component, `pages[${pageIndex}].components[${index}]`));
  const seenTypes = new Set();
  for (const component of normalized) {
    if (seenTypes.has(component.type)) fail(`pages[${pageIndex}].components must not repeat ${component.type}`);
    seenTypes.add(component.type);
  }
  return normalized;
}

function firstComponent(components, type) {
  return components.find((component) => component.type === type) || null;
}

function metricText(item) {
  const value = `${item.value} ${item.unit || ""}`.trim();
  return cleanText(`${item.label} ${value}`.trim(), "metricGroup.item", 24);
}

function pageLinesFromComponents(page, components, pageIndex) {
  const alert = firstComponent(components, "alert");
  const textPage = firstComponent(components, "textPage");
  const listComponent = firstComponent(components, "list");
  let title;
  let lines;
  if (alert) {
    title = alert.title;
    lines = [alert.body];
  } else if (textPage) {
    title = textPage.title;
    lines = textPage.lines;
  } else if (listComponent) {
    title = listComponent.title;
    lines = listComponent.items;
  } else {
    title = cleanText(page.title || page.tab || PAGE_IDS[pageIndex], `pages[${pageIndex}].title`, 32);
    lines = cleanList(page.lines || [title], `pages[${pageIndex}].lines`, 4, 48);
  }
  return {
    title,
    lines: cleanList(lines.slice(0, 4), `pages[${pageIndex}].componentLines`, 4, 48),
  };
}

function pageKind(components) {
  if (firstComponent(components, "alert")) return "alert";
  if (firstComponent(components, "list")) return "list";
  return "textPage";
}

function toneColor(tone) {
  return {
    ok: "C_GREEN",
    warn: "C_AMBER",
    error: "C_RED",
  }[tone];
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("screen manifest must be an object");
  if (manifest.schema !== "walnutpi.screen.v1") fail("screen manifest schema must be walnutpi.screen.v1");
  if (!manifest.target || typeof manifest.target !== "object" || Array.isArray(manifest.target)) fail("screen manifest target is required");
  if (manifest.target.width !== 480) fail("screen manifest target.width must be 480");
  if (manifest.target.height !== 320) fail("screen manifest target.height must be 320");
  if (manifest.target.color !== "RGB565") fail("screen manifest target.color must be RGB565");
  if (!manifest.source || typeof manifest.source !== "object" || Array.isArray(manifest.source)) fail("screen manifest source is required");
  if (manifest.source.lvglEntry !== "lvgl_app/src/main.c") fail("screen manifest source.lvglEntry must be lvgl_app/src/main.c");
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== PAGE_IDS.length) fail("screen manifest pages must contain exactly four pages");
  for (const [index, id] of PAGE_IDS.entries()) {
    if (!manifest.pages[index] || manifest.pages[index].id !== id) fail(`screen manifest pages[${index}].id must be ${id}`);
  }
}

function normalize(manifest) {
  validateManifest(manifest);
  const homeComponents = normalizeComponents(manifest.pages[0], 0);
  const statusCard = firstComponent(homeComponents, "statusCard");
  const progressComponent = firstComponent(homeComponents, "progress");
  const metricGroup = firstComponent(homeComponents, "metricGroup");
  const alert = firstComponent(homeComponents, "alert");
  const statusLabel = statusCard ? statusCard.label : "Status";
  const statusDetail = statusCard ? statusCard.detail : "Ready";
  const progressLabel = progressComponent ? progressComponent.label : "Progress";
  const progressMax = progressComponent ? progressComponent.max : 100;
  const metrics = metricGroup
    ? metricGroup.items.map(metricText)
    : cleanList(manifest.pages[0].metrics || ["IP loading", "MEM --", "DISK --"], "pages[0].metrics", 3, 24);
  const metricItems = metricGroup
    ? metricGroup.items
    : metrics.map((value, index) => {
      const parts = value.split(/\s+/).filter(Boolean);
      return {
        label: cleanText(parts[0] || `M${index + 1}`, `pages[0].metrics[${index}].label`, 12),
        value: cleanText(parts.slice(1).join(" ") || "--", `pages[0].metrics[${index}].value`, 16),
        unit: "",
        tone: "ok",
      };
    });
  while (metrics.length < 3) metrics.push("--");
  while (metricItems.length < 3) metricItems.push({ label: "Metric", value: "--", unit: "", tone: "ok" });
  return {
    title: cleanText(manifest.title || "WalnutPi", "title", 32),
    subtitle: cleanText(manifest.subtitle || "server screen", "subtitle", 40),
    homeStatusLabel: cleanText(statusLabel, "pages[0].statusCard.label", 12),
    homeStatus: cleanText(statusCard ? statusCard.value : manifest.pages[0].status || "OK CORE", "pages[0].status", 24),
    homeStatusDetail: cleanText(statusDetail, "pages[0].statusCard.detail", 24),
    homeTone: cleanTone(statusCard ? statusCard.tone : alert ? alert.tone : progressComponent ? progressComponent.tone : manifest.pages[0].tone || "ok", "pages[0].tone"),
    homeProgressLabel: cleanText(progressLabel, "pages[0].progress.label", 16),
    homeProgress: cleanProgress(progressComponent ? progressComponent.value : manifest.pages[0].progress ?? 72, "pages[0].progress"),
    homeProgressMax: cleanProgress(progressMax, "pages[0].progress.max"),
    tabs: manifest.pages.map((page, index) => cleanText(page.tab || PAGE_IDS[index].toUpperCase(), `pages[${index}].tab`, 8)),
    metrics: metrics.slice(0, 3),
    metricItems: metricItems.slice(0, 3),
    textPages: manifest.pages.slice(1).map((page, index) => {
      const components = normalizeComponents(page, index + 1);
      return {
        kind: pageKind(components),
        ...pageLinesFromComponents(page, components, index + 1),
      };
    }),
  };
}

function cString(value) {
  return JSON.stringify(String(value))
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function cMultiline(title, lines) {
  return cString([title, "", ...lines].join("\n"));
}

function metricDefineLines(metricItems) {
  const lines = [];
  metricItems.forEach((item, index) => {
    const n = index + 1;
    const tone = cleanTone(item.tone || "ok", `metricItems[${index}].tone`);
    lines.push(`#define WALNUT_SCREEN_HOME_METRIC_${n}_LABEL ${cString(item.label)}`);
    lines.push(`#define WALNUT_SCREEN_HOME_METRIC_${n}_VALUE ${cString(item.value)}`);
    lines.push(`#define WALNUT_SCREEN_HOME_METRIC_${n}_UNIT ${cString(item.unit || "")}`);
    lines.push(`#define WALNUT_SCREEN_HOME_METRIC_${n}_TONE ${cString(tone)}`);
    lines.push(`#define WALNUT_SCREEN_HOME_METRIC_${n}_TONE_COLOR ${toneColor(tone)}`);
  });
  return lines.join("\n");
}

function renderHeader(config) {
  const [systemPage, aiPage, networkPage] = config.textPages;
  return `/* Generated by scripts/generate-lvgl-screen-config. Do not edit by hand. */
#ifndef WALNUT_SCREEN_CONFIG_H
#define WALNUT_SCREEN_CONFIG_H

#define WALNUT_SCREEN_MANIFEST_HASH ${cString(config.manifestHash)}

#define WALNUT_SCREEN_TITLE ${cString(config.title)}
#define WALNUT_SCREEN_SUBTITLE ${cString(config.subtitle)}

#define WALNUT_SCREEN_TAB_HOME ${cString(config.tabs[0])}
#define WALNUT_SCREEN_TAB_SYSTEM ${cString(config.tabs[1])}
#define WALNUT_SCREEN_TAB_AI ${cString(config.tabs[2])}
#define WALNUT_SCREEN_TAB_NETWORK ${cString(config.tabs[3])}

#define WALNUT_SCREEN_HOME_STATUS_LABEL ${cString(config.homeStatusLabel)}
#define WALNUT_SCREEN_HOME_STATUS ${cString(config.homeStatus)}
#define WALNUT_SCREEN_HOME_STATUS_DETAIL ${cString(config.homeStatusDetail)}
#define WALNUT_SCREEN_HOME_TONE ${cString(config.homeTone)}
#define WALNUT_SCREEN_HOME_TONE_COLOR ${toneColor(config.homeTone)}
#define WALNUT_SCREEN_HOME_PROGRESS_LABEL ${cString(config.homeProgressLabel)}
#define WALNUT_SCREEN_HOME_PROGRESS ${config.homeProgress}
#define WALNUT_SCREEN_HOME_PROGRESS_MAX ${config.homeProgressMax}
#define WALNUT_SCREEN_HOME_METRIC_1 ${cString(config.metrics[0])}
#define WALNUT_SCREEN_HOME_METRIC_2 ${cString(config.metrics[1])}
#define WALNUT_SCREEN_HOME_METRIC_3 ${cString(config.metrics[2])}
${metricDefineLines(config.metricItems)}

#define WALNUT_SCREEN_SYSTEM_KIND ${cString(systemPage.kind)}
#define WALNUT_SCREEN_SYSTEM_TITLE ${cString(systemPage.title)}
#define WALNUT_SCREEN_SYSTEM_LINE_1 ${cString(systemPage.lines[0] || "")}
#define WALNUT_SCREEN_SYSTEM_LINE_2 ${cString(systemPage.lines[1] || "")}
#define WALNUT_SCREEN_SYSTEM_LINE_3 ${cString(systemPage.lines[2] || "")}
#define WALNUT_SCREEN_SYSTEM_LINE_4 ${cString(systemPage.lines[3] || "")}
#define WALNUT_SCREEN_SYSTEM_TEXT ${cMultiline(systemPage.title, systemPage.lines)}

#define WALNUT_SCREEN_AI_KIND ${cString(aiPage.kind)}
#define WALNUT_SCREEN_AI_TITLE ${cString(aiPage.title)}
#define WALNUT_SCREEN_AI_LINE_1 ${cString(aiPage.lines[0] || "")}
#define WALNUT_SCREEN_AI_LINE_2 ${cString(aiPage.lines[1] || "")}
#define WALNUT_SCREEN_AI_LINE_3 ${cString(aiPage.lines[2] || "")}
#define WALNUT_SCREEN_AI_LINE_4 ${cString(aiPage.lines[3] || "")}
#define WALNUT_SCREEN_AI_TEXT ${cMultiline(aiPage.title, aiPage.lines)}

#define WALNUT_SCREEN_NETWORK_KIND ${cString(networkPage.kind)}
#define WALNUT_SCREEN_NETWORK_TITLE ${cString(networkPage.title)}
#define WALNUT_SCREEN_NETWORK_LINE_1 ${cString(networkPage.lines[0] || "")}
#define WALNUT_SCREEN_NETWORK_LINE_2 ${cString(networkPage.lines[1] || "")}
#define WALNUT_SCREEN_NETWORK_LINE_3 ${cString(networkPage.lines[2] || "")}
#define WALNUT_SCREEN_NETWORK_LINE_4 ${cString(networkPage.lines[3] || "")}
#define WALNUT_SCREEN_NETWORK_TEXT ${cMultiline(networkPage.title, networkPage.lines)}

#endif
`;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const config = normalize(manifest);
  config.manifestHash = stableStringifyHash(manifest);
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, renderHeader(config), "utf8");
  console.log(OUTPUT_PATH);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableStringifyHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

main().catch((error) => {
  console.error(`screen config generation failed: ${error.message}`);
  process.exit(1);
});

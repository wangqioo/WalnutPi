#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accentColor,
  cleanTone,
  screenManifestHash,
  screenManifestRuntimeConfig,
  toneColor,
} from "./screen-manifest-vocabulary.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "lvgl_app", "screen-manifest.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "lvgl_app", "generated", "screen_config.h");

function cString(value) {
  return JSON.stringify(String(value)).replace(/[^\x00-\x7f]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function cNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function componentText(component) {
  if (component.type === "layout" || component.type === "pixelArt") return "";
  if (component.type === "generatedPage") return component.body;
  if (component.type === "statusCard") return component.value;
  if (component.type === "metricGroup") {
    return component.items
      .map((item) => `${item.label} ${item.value}${item.unit ? ` ${item.unit}` : ""}`.trim())
      .join("\n");
  }
  if (component.type === "list") return component.items.join("\n");
  if (component.type === "progress") return `${component.label} ${component.value}/${component.max}`;
  if (component.type === "alert") return component.body;
  return component.lines.join("\n");
}

function componentTitle(component) {
  if (component.type === "layout") return "Layout";
  if (component.type === "pixelArt") return "PixelArt";
  if (component.type === "generatedPage") return component.headline;
  if (component.type === "statusCard") return component.label;
  if (component.type === "metricGroup") return "Metrics";
  if (component.type === "progress") return component.label;
  return component.title;
}

function componentTone(component) {
  if (component.type === "generatedPage") return "ok";
  if (component.type === "textPage" || component.type === "list") return "ok";
  return cleanTone(component.tone || "ok", "component.tone");
}

function componentProgress(component) {
  if (component.type === "generatedPage") return cNumber(component.progress);
  if (component.type !== "progress") return 0;
  const max = Math.max(1, cNumber(component.max || 100));
  return Math.max(0, Math.min(100, Math.round((cNumber(component.value) * 100) / max)));
}

function componentStyle(component) {
  return component.type === "generatedPage" ? component.style : "";
}

function componentBadge(component) {
  return component.type === "generatedPage" ? component.badge : "";
}

function componentKicker(component) {
  return component.type === "generatedPage" ? component.kicker : "";
}

function componentItems(component) {
  if (component.type !== "generatedPage") return "";
  return component.items
    .map((item) => `${item.label} ${item.value}${item.unit ? ` ${item.unit}` : ""}`.trim())
    .join("\n");
}

function componentColor(component) {
  if (component.type === "layout" || component.type === "pixelArt") return component.background;
  if (component.type === "generatedPage") return accentColor(component.accent || "cyan");
  return toneColor(componentTone(component));
}

function drawElementLine(element) {
  const safeText = String(element.text || "").replace(/[|\r\n]+/g, " ").trim() || " ";
  return [
    element.kind,
    cNumber(element.x),
    cNumber(element.y),
    cNumber(element.w),
    cNumber(element.h),
    element.color,
    element.bg,
    element.border,
    cNumber(element.radius),
    cNumber(element.width),
    cNumber(element.value),
    element.font,
    safeText,
  ].join("|");
}

function componentDrawElements(component) {
  if (component.type === "pixelArt") return pixelArtPayload(component);
  if (component.type !== "layout") return "";
  return component.elements.map(drawElementLine).join("\n");
}

function pixelArtPayload(component) {
  const header = [
    "PIXELART",
    cNumber(component.x),
    cNumber(component.y),
    cNumber(component.width),
    cNumber(component.height),
    cNumber(component.pixelSize),
    cNumber(component.gap),
  ].join("|");
  const palette = Object.entries(component.palette)
    .map(([symbol, color]) => `PAL|${symbol}|${color}`)
    .join("\n");
  const frames = component.frames
    .map((frame, index) => [
      `FRAME|${index}|${cNumber(frame.durationMs)}`,
      ...frame.rows.map((row) => `ROW|${row}`),
    ].join("\n"))
    .join("\n");
  return [header, palette, frames].filter(Boolean).join("\n");
}

function renderComponentArray(config) {
  const items = [];
  for (const [pageIndex, page] of config.pages.entries()) {
    for (const component of page.components) {
      items.push([
        "  {",
        `    ${pageIndex},`,
        `    ${cString(component.type)},`,
        `    ${cString(componentStyle(component))},`,
        `    ${cString(componentTitle(component))},`,
        `    ${cString(componentText(component))},`,
        `    ${cString(componentKicker(component))},`,
        `    ${cString(componentBadge(component))},`,
        `    ${cString(componentItems(component))},`,
        `    ${cString(componentDrawElements(component))},`,
        `    ${componentColor(component)},`,
        `    ${componentProgress(component)}`,
        "  }",
      ].join("\n"));
    }
  }
  return items.length ? items.join(",\n") : "  {0, \"textPage\", \"\", \"Empty\", \"Ready\", \"\", \"\", \"\", 0x33d6a6, 0}";
}

function renderPageArray(config) {
  return config.pages.map((page, index) => [
    "  {",
    `    ${cString(page.id)},`,
    `    ${cString(page.tab)},`,
    `    ${index}`,
    "  }",
  ].join("\n")).join(",\n");
}

function renderHeader(config) {
  const componentCount = config.pages.reduce((count, page) => count + page.components.length, 0);
  return `/* Generated by scripts/generate-lvgl-screen-config. Do not edit by hand. */
#ifndef WALNUT_SCREEN_CONFIG_H
#define WALNUT_SCREEN_CONFIG_H

#define WALNUT_SCREEN_MANIFEST_HASH ${cString(config.manifestHash)}
#define WALNUT_SCREEN_TITLE ${cString(config.title)}
#define WALNUT_SCREEN_SUBTITLE ${cString(config.subtitle)}
#define WALNUT_SCREEN_PAGE_COUNT ${config.pages.length}
#define WALNUT_SCREEN_COMPONENT_COUNT ${componentCount}

typedef struct {
    const char * id;
    const char * tab;
    int index;
} walnut_screen_page_config_t;

typedef struct {
    int page_index;
    const char * type;
    const char * style;
    const char * title;
    const char * text;
    const char * kicker;
    const char * badge;
    const char * items;
    const char * draw_elements;
    unsigned int tone_color;
    int progress;
} walnut_screen_component_config_t;

static const walnut_screen_page_config_t walnut_screen_pages[WALNUT_SCREEN_PAGE_COUNT] = {
${renderPageArray(config)}
};

static const walnut_screen_component_config_t walnut_screen_components[WALNUT_SCREEN_COMPONENT_COUNT] = {
${renderComponentArray(config)}
};

#endif
`;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const config = screenManifestRuntimeConfig(manifest);
  config.manifestHash = screenManifestHash(manifest);
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, renderHeader(config), "utf8");
  console.log(OUTPUT_PATH);
}

main().catch((error) => {
  console.error(`screen config generation failed: ${error.message}`);
  process.exit(1);
});

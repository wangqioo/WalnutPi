import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  animatedOutputSha256,
  rgbaFrameSha256FromImage,
  rgb565FrameSha256FromImage,
  staticOutputFileSha256,
  validateScreenManifestV2,
} from "../scripts/screen-workspace-vocabulary.ts";

type JsonObject = Record<string, any>;

export const FreeformGenerateRequestSchema = z.object({
  prompt: z.string().optional(),
  text: z.string().optional(),
  screenId: z.string().optional(),
  sourceId: z.string().optional(),
  templateId: z.string().optional(),
  title: z.string().optional(),
  outputType: z.enum(["static", "animated"]).optional(),
  preset: z.enum(["fit-cover:480x320", "fit-contain:480x320"]).optional(),
  playlist: z.union([z.literal(false), z.string()]).optional(),
  durationMs: z.number().optional(),
  repeat: z.number().optional(),
  loop: z.boolean().optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
});
export type FreeformGenerateRequest = z.infer<typeof FreeformGenerateRequestSchema>;

const TERMINAL_PRINT_ELEMENT_NUMBER_FIELDS = {
  x: { min: 0, max: 119, fallback: 0 },
  y: { min: 0, max: 79, fallback: 0 },
  width: { min: 1, max: 120, fallback: 1, optional: true },
  height: { min: 1, max: 80, fallback: 1, optional: true },
};

const TerminalPrintMetricSchema = z.object({
  label: z.string().min(1).max(8),
  value: z.string().min(1).max(12),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bar: z.number().int().min(0).max(34),
});

const TerminalPrintRectSchema = z.object({
  rect: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
  fill: z.string().min(1).max(32),
});

export const TerminalPrintTemplateSchema = z.object({
  schema: z.literal("walnutpi.terminalPrintTemplate.v1"),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  canvas: z.object({
    logicalWidth: z.literal(120),
    logicalHeight: z.literal(80),
    scale: z.literal(4),
  }),
  palette: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  layout: z.object({
    title: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    primaryLabel: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    primaryValue: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    footer: z.object({ x: z.number().int(), y: z.number().int(), scale: z.number().int(), maxChars: z.number().int() }),
    metric: z.object({
      x: z.number().int(),
      valueX: z.number().int(),
      y: z.number().int(),
      gapY: z.number().int(),
      markerX: z.number().int(),
      markerOffsetY: z.number().int(),
      markerWidth: z.number().int(),
      markerHeight: z.number().int(),
    }),
    wifi: z.object({ x: z.number().int(), y: z.number().int() }),
    progress: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
    shell: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
    board: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
  }),
  defaults: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    darkBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    lightBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    footer: z.string().min(1).max(16),
    progress: z.number().int().min(0).max(96),
    batteryProgress: z.number().int().min(0).max(96),
    metrics: z.array(TerminalPrintMetricSchema).min(1).max(3),
  }),
  sprites: z.object({
    board: z.array(TerminalPrintRectSchema),
    wifi: z.array(TerminalPrintRectSchema),
  }),
});

export const TerminalPrintSourceSchema = z.object({
  schema: z.literal("walnutpi.terminalPrintSource.v1"),
  template: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  logicalWidth: z.literal(120),
  logicalHeight: z.literal(80),
  scale: z.literal(4),
  title: z.string().min(1).max(12),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  progress: z.number().int().min(0).max(96),
  primaryLabel: z.string().min(1).max(12),
  primaryValue: z.string().min(1).max(16),
  footer: z.string().min(1).max(16),
  metrics: z.array(TerminalPrintMetricSchema).min(1).max(3),
  elements: z.array(z.object({
    type: z.enum(["text", "rect", "bar", "arc"]),
    x: z.number().int().min(0).max(119),
    y: z.number().int().min(0).max(79),
    width: z.number().int().min(1).max(120).optional(),
    height: z.number().int().min(1).max(80).optional(),
    text: z.string().max(24).optional(),
    fill: z.string().min(1).max(32).optional(),
    scale: z.number().int().min(1).max(2).optional(),
    value: z.number().int().min(0).max(100).optional(),
    required: z.boolean().optional(),
  })).max(40).optional(),
});

export async function writeGeneratedPromptSource({ workspaceRoot, sourceId, prompt, screenSpec, template }: JsonObject) {
  const sourceDir = path.join(workspaceRoot, "sources", sourceId);
  const originalFileName = "original.png";
  const originalPath = path.join(sourceDir, originalFileName);
  const mediaType = "image/png";
  const license = "local-freeform-generation";
  const bytes = await renderTerminalPrintSourcePng(screenSpec, template);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(originalPath, bytes);
  const sourceRecord = {
    schema: "walnutpi.screen-source-asset.v1",
    id: sourceId,
    title: screenSpec.title,
    selected: true,
    importedAt: new Date().toISOString(),
    original: originalFileName,
    fileSha256: sha256(bytes),
    width: 480,
    height: 320,
    mediaType,
    license,
    origin: {
      kind: "agent-freeform",
      prompt,
      screenSpec,
    },
  };
  await writeFile(path.join(sourceDir, "source.json"), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
  return {
    ...sourceRecord,
    originalPath,
  };
}

export async function writeGeneratedAnimatedScreenOutput({ workspaceRoot, screenId, sourceId, prompt, screenSpec, template, facts }: JsonObject) {
  const generatedAt = new Date().toISOString();
  const outputDir = path.join(workspaceRoot, "outputs", screenId);
  const framesDir = path.join(outputDir, "frames");
  const sourceDir = path.join(workspaceRoot, "sources", sourceId);
  const planPath = path.join(workspaceRoot, "plans", `${screenId}-plan.json`);
  const manifestPath = path.join(workspaceRoot, "manifests", `${screenId}.json`);
  await mkdir(framesDir, { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  const frames = [];
  for (let index = 0; index < 4; index += 1) {
    const framePath = path.join(framesDir, `frame-${String(index).padStart(3, "0")}.png`);
    await writeFile(framePath, await renderTerminalPrintSourcePng(animatedTerminalPrintSource(screenSpec, index), template));
    frames.push({
      path: `../outputs/${screenId}/frames/frame-${String(index).padStart(3, "0")}.png`,
      width: 480,
      height: 320,
      durationMs: 160,
      fileSha256: await staticOutputFileSha256(framePath),
      rgbaFrameSha256: await rgbaFrameSha256FromImage(framePath),
      rgb565FrameSha256: await rgb565FrameSha256FromImage(framePath),
    });
  }
  const sourceRecord = {
    schema: "walnutpi.screen-source-asset.v1",
    id: sourceId,
    title: screenSpec.title,
    selected: true,
    importedAt: generatedAt,
    original: "scene.json",
    fileSha256: sha256(JSON.stringify(screenSpec)),
    width: 480,
    height: 320,
    mediaType: "application/json",
    license: "local-freeform-generation",
    origin: { kind: "agent-freeform", prompt, screenSpec },
  };
  await writeFile(path.join(sourceDir, "scene.json"), `${JSON.stringify(screenSpec, null, 2)}\n`, "utf8");
  await writeFile(path.join(sourceDir, "source.json"), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
  const output = {
    type: "animated",
    path: `../outputs/${screenId}/output.json`,
    width: 480,
    height: 320,
    frameCount: frames.length,
    frames,
    animatedOutputSha256: animatedOutputSha256(frames),
  };
  await writeFile(path.join(outputDir, "output.json"), `${JSON.stringify({ schema: "walnutpi.screen-output.v1", id: screenId, generatedAt, manifest: `../../manifests/${screenId}.json`, output }, null, 2)}\n`, "utf8");
  const manifest = await validateScreenManifestV2({
    schema: "walnutpi.screen-manifest.v2",
    id: screenId,
    title: screenSpec.title,
    description: prompt,
    output,
    provenance: {
      plan: `../plans/${screenId}-plan.json`,
      sourceAssets: [{
        id: sourceId,
        source: `../sources/${sourceId}/source.json`,
        original: `../sources/${sourceId}/scene.json`,
        width: 480,
        height: 320,
        mediaType: "application/json",
        license: "local-freeform-generation",
        selected: true,
      }],
      processing: { preset: "terminal-print:480x320", tools: [{ name: "sharp", version: sharp.versions.sharp }] },
    },
  }, { manifestPath, workspaceRoot });
  await writeFile(path.join(outputDir, "output.json"), `${JSON.stringify({ schema: "walnutpi.screen-output.v1", id: screenId, generatedAt, manifest: `../../manifests/${screenId}.json`, output: manifest.output }, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(planPath, `${JSON.stringify({ schema: "walnutpi.screen-plan.v1", id: `${screenId}-plan`, screenId, outputType: "animated", selectedSourceAsset: `../sources/${sourceId}/source.json`, processing: { preset: "terminal-print:480x320", animation: { fps: 6, maxSeconds: 1, maxFrames: 4 } }, requestedAt: generatedAt, executedAt: generatedAt }, null, 2)}\n`, "utf8");
  return { screenId, source: { ...sourceRecord, originalPath: path.join(sourceDir, "scene.json") }, manifest, output: manifest.output };
}

export async function readTerminalPrintTemplate(templateId, options: JsonObject = {}) {
  const generatorsRoot = path.resolve(options.generatorsRoot || path.join(process.cwd(), "screen", "generators"));
  const cleanId = cleanScreenWorkspaceId(templateId, "templateId");
  const templatePath = path.join(generatorsRoot, `${cleanId}.json`);
  const relativeToGenerators = path.relative(generatorsRoot, templatePath);
  if (relativeToGenerators.startsWith("..") || path.isAbsolute(relativeToGenerators)) {
    throw new Error("templateId must stay inside screen generators");
  }
  return TerminalPrintTemplateSchema.parse(JSON.parse(await readFile(templatePath, "utf8")));
}

export function selectTerminalPrintTemplate({ templateId }: { templateId?: string } = {}) {
  return templateId ? cleanScreenWorkspaceId(templateId, "templateId") : "terminal-ops";
}

export function buildWallpaperGenerationPlan(prompt, options: JsonObject = {}) {
  const template = selectTerminalPrintTemplate({ templateId: options.templateId });
  return {
    schema: "walnutpi.wallpaper-generation-plan.v1",
    prompt,
    template,
    needs: [],
    composition: "template-default",
  };
}

export async function collectWallpaperFacts(plan) {
  return {
    schema: "walnutpi.wallpaper-fact-pack.v1",
    facts: [],
    cards: [],
  };
}

export function buildFreeformTerminalPrintSource({ prompt, title, template, plan, facts }) {
  const defaults = template.defaults;
  const metrics = defaults.metrics.map((metric) => ({ ...metric }));
  let primaryLabel = "DEVICE";
  let primaryValue = "ready";
  let footer = defaults.footer;
  const card = facts?.cards?.[0];
  if (plan?.composition === "fact-card" && card) {
    primaryLabel = card.title;
    primaryValue = card.value;
    footer = card.footer;
    for (const [index, item] of card.items.entries()) {
      if (!metrics[index]) break;
      metrics[index].label = item.label;
      metrics[index].value = item.value;
      metrics[index].bar = item.bar ?? metrics[index].bar;
    }
  } else if (template.id === "terminal-message") {
    primaryLabel = "MESSAGE";
    primaryValue = compactDisplayText(prompt, template.layout.primaryValue.maxChars);
    footer = defaults.footer;
  }
  return TerminalPrintSourceSchema.parse({
    schema: "walnutpi.terminalPrintSource.v1",
    template: template.id,
    logicalWidth: template.canvas.logicalWidth,
    logicalHeight: template.canvas.logicalHeight,
    scale: template.canvas.scale,
    title: compactText(title, template.layout.title.maxChars),
    background: defaults.lightBackground,
    accent: defaults.accent,
    progress: defaults.progress,
    primaryLabel,
    primaryValue,
    footer,
    metrics,
    ...(card ? { elements: factCardTerminalPrintElements(card) } : {}),
  });
}

function factCardTerminalPrintElements(card) {
  return [
    { type: "rect", x: 3, y: 3, width: 114, height: 1, fill: "panelBorder", required: false },
    { type: "rect", x: 3, y: 76, width: 114, height: 1, fill: "panelBorder", required: false },
    { type: "rect", x: 3, y: 4, width: 1, height: 72, fill: "panelBorder", required: false },
    { type: "rect", x: 116, y: 4, width: 1, height: 72, fill: "panelBorder", required: false },
    { type: "text", x: 7, y: 14, text: card.title, fill: "text", scale: 1, required: true },
    { type: "text", x: 7, y: 36, text: card.value, fill: "accent", scale: 2, required: true },
    { type: "text", x: 7, y: 50, text: card.subtitle, fill: "muted2", scale: 1, required: true },
    { type: "text", x: 7, y: 63, text: card.footer, fill: "green", scale: 1, required: true },
    { type: "text", x: 72, y: 24, text: `${card.items[0]?.label || "A"} ${card.items[0]?.value || "--"}`, fill: "cyan", scale: 1, required: true },
    { type: "text", x: 72, y: 42, text: `${card.items[1]?.label || "B"} ${card.items[1]?.value || "--"}`, fill: "text", scale: 1, required: true },
    { type: "text", x: 72, y: 60, text: `${card.items[2]?.label || "C"} ${card.items[2]?.value || "--"}`, fill: "green", scale: 1, required: true },
    { type: "bar", x: 72, y: 67, width: 38, height: 3, fill: "accent", value: Math.max(0, Math.min(100, Number(card.items[0]?.bar || 0) * 3)), required: true },
  ];
}

export function cleanAiTerminalPrintSource(spec) {
  if (!Array.isArray(spec.elements)) return spec;
  return {
    ...spec,
    title: compactText(spec.title, 12),
    background: /^#[0-9a-fA-F]{6}$/.test(String(spec.background || "")) ? spec.background : "#101412",
    accent: /^#[0-9a-fA-F]{6}$/.test(String(spec.accent || "")) ? spec.accent : "#78c58a",
    elements: spec.elements.slice(0, 24).map(cleanAiTerminalPrintElement),
  };
}

function cleanAiTerminalPrintElement(element) {
  const cleaned = { ...element };
  for (const field of Object.keys(TERMINAL_PRINT_ELEMENT_NUMBER_FIELDS)) {
    const value = cleanTerminalPrintElementNumber(element, field);
    if (value === undefined) delete cleaned[field];
    else cleaned[field] = value;
  }
  cleaned.scale = element.scale === 2 ? 2 : 1;
  return cleaned;
}

function cleanTerminalPrintElementNumber(element, field) {
  const rule = TERMINAL_PRINT_ELEMENT_NUMBER_FIELDS[field];
  if (rule.optional && element[field] === undefined) return undefined;
  const number = Math.round(Number(element[field]) || rule.fallback);
  return Math.max(rule.min, Math.min(rule.max, number));
}


export async function renderTerminalPrintSourcePng(screenSpec, template) {
  const spec = TerminalPrintSourceSchema.parse(screenSpec);
  const resolvedTemplate = template || await readTerminalPrintTemplate(spec.template);
  const svg = renderTerminalPrintSourceSvg(spec, resolvedTemplate);
  return sharp(Buffer.from(svg, "utf8"))
    .resize(spec.logicalWidth * spec.scale, spec.logicalHeight * spec.scale, { kernel: "nearest" })
    .png()
    .toBuffer();
}

export function renderTerminalPrintSourceSvg(spec, template) {
  const palette = resolvePalette(template.palette, spec);
  const layout = template.layout;
  if (Array.isArray(spec.elements) && spec.elements.length) {
    return renderFreeTerminalPrintSceneSvg(spec, palette);
  }
  const protectedRects = protectedTerminalPrintRects(spec, layout);
  const rows = spec.metrics.map((metric, index) => {
    const y = layout.metric.y + index * layout.metric.gapY;
    return [
      rect(layout.metric.markerX, y + layout.metric.markerOffsetY, layout.metric.markerWidth, layout.metric.markerHeight, metric.color),
      pxText(layout.metric.x, y, metric.label, palette.muted, 1),
      pxText(layout.metric.valueX, y, metric.value, metric.color, 2),
    ].join("");
  }).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.logicalWidth}" height="${spec.logicalHeight}" viewBox="0 0 ${spec.logicalWidth} ${spec.logicalHeight}" shape-rendering="crispEdges">`,
    rect(0, 0, 120, 80, spec.background),
    terminalPrintDither(palette),
    drawShell(layout.shell, palette),
    pxText(layout.title.x, layout.title.y, spec.title, palette.text, layout.title.scale),
    drawFreeElements(template.sprites.board, 0, 0, palette, protectedRects),
    pxText(layout.primaryLabel.x, layout.primaryLabel.y, spec.primaryLabel, palette.muted, layout.primaryLabel.scale),
    pxText(layout.primaryValue.x, layout.primaryValue.y, spec.primaryValue, palette.cyan, layout.primaryValue.scale),
    pxText(layout.footer.x, layout.footer.y, spec.footer, palette.muted2, layout.footer.scale),
    drawFreeElements(template.sprites.wifi, layout.wifi.x, layout.wifi.y, palette, protectedRects),
    rows,
    rect(layout.progress.x, layout.progress.y, layout.progress.width, layout.progress.height, palette.barTrack),
    rect(layout.progress.x, layout.progress.y, Math.min(spec.progress, layout.progress.width), layout.progress.height, spec.accent),
    `</svg>`,
  ].join("");
}

function rect(x, y, width, height, fill) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;
}

function pxText(x, y, text, fill, scale = 1) {
  const size = scale === 2 ? 7 : 4;
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="monospace" font-size="${size}" font-weight="700">${escapeSvg(String(text).toUpperCase())}</text>`;
}

function renderFreeTerminalPrintSceneSvg(spec, palette) {
  const occupied = [];
  const nodes = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.logicalWidth}" height="${spec.logicalHeight}" viewBox="0 0 ${spec.logicalWidth} ${spec.logicalHeight}" shape-rendering="crispEdges">`,
    rect(0, 0, 120, 80, spec.background),
    terminalPrintDither(palette),
  ];
  for (const element of spec.elements) {
    const drawn = drawFreeSceneElement(element, palette, occupied);
    if (drawn) nodes.push(drawn);
  }
  nodes.push(`</svg>`);
  return nodes.join("");
}

function animatedTerminalPrintSource(spec, frame) {
  if (!Array.isArray(spec.elements)) return spec;
  return {
    ...spec,
    elements: spec.elements.map((element, index) => {
      if (element.required || element.type !== "rect") return element;
      const dx = ((frame + index) % 3) - 1;
      const dy = ((frame + index) % 2);
      return {
        ...element,
        x: Math.max(0, Math.min(119, element.x + dx)),
        y: Math.max(0, Math.min(79, element.y + dy)),
      };
    }),
  };
}

function drawFreeSceneElement(element, palette, occupied) {
  const geometry = terminalPrintElementGeometry[element.type] || terminalPrintElementGeometry.rect;
  const renderer = terminalPrintElementRenderers[element.type] || terminalPrintElementRenderers.rect;
  const box = geometry(element);
  const placed = element.required ? (rectInsideCanvas(box) && !occupied.some((item) => rectsOverlap(box, item)) ? box : null) : placeFreeRect(box, occupied);
  if (!placed) return "";
  occupied.push(placed);
  return renderer(element, placed, palette);
}

const terminalPrintElementGeometry = {
  text: (element) => textRect(element.x, element.y, element.text || "", element.scale || 1),
  rect: (element) => ({ x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 }),
  bar: (element) => ({ x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 }),
  arc: (element) => ({ x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 }),
};

const terminalPrintElementRenderers = {
  text: (element, placed, palette) => {
    const scale = element.scale || 1;
    return pxText(placed.x + 1, placed.y + (scale === 2 ? 8 : 5), element.text || "", terminalPrintElementFill(palette, element.fill, "text"), scale);
  },
  rect: (element, placed, palette) => rect(placed.x, placed.y, placed.width, placed.height, terminalPrintElementFill(palette, element.fill, "accent")),
  bar: (element, placed, palette) => rect(placed.x, placed.y, placed.width, placed.height, terminalPrintElementFill(palette, element.fill, "accent")),
  arc: (element, placed, palette) => rect(placed.x, placed.y, placed.width, placed.height, terminalPrintElementFill(palette, element.fill, "accent")),
};

function terminalPrintElementFill(palette, fill, fallbackKey) {
  return palette[fill || fallbackKey] || fill || palette[fallbackKey];
}

export function compactText(text, maxChars) {
  const compacted = String(text || "WALNUT").toUpperCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
  return Array.from(compacted || "WALNUT").slice(0, maxChars).join("");
}

export function compactDisplayText(text, maxChars) {
  const compacted = String(text || "HELLO").replace(/\s+/g, " ").trim();
  return Array.from(compacted || "HELLO").slice(0, maxChars).join("");
}

function terminalPrintDither(palette) {
  const dots = [];
  for (let y = 8; y < 74; y += 8) {
    for (let x = 8; x < 114; x += 8) {
      if ((x + y) % 16 === 0) dots.push(rect(x, y, 1, 1, palette.dither));
    }
  }
  return dots.join("");
}

function drawShell(shell, palette) {
  return [
    rect(shell.x, shell.y, shell.width, shell.height, palette.panel),
    rect(shell.x, shell.y, shell.width, 1, palette.panelBorder),
    rect(shell.x, shell.y + shell.height - 1, shell.width, 1, palette.panelBorder),
    rect(shell.x, shell.y, 1, shell.height, palette.panelBorder),
    rect(shell.x + shell.width - 1, shell.y, 1, shell.height, palette.panelBorder),
  ].join("");
}

function drawFreeElements(items, offsetX, offsetY, palette, protectedRects = []) {
  const occupiedRects = [...protectedRects];
  return items.map((item) => {
    const [x, y, width, height] = item.rect;
    const placed = placeFreeRect({ x: offsetX + x, y: offsetY + y, width, height }, occupiedRects);
    if (!placed) return "";
    occupiedRects.push(placed);
    return rect(placed.x, placed.y, width, height, palette[item.fill] || item.fill);
  }).join("");
}

function placeFreeRect(candidate, occupiedRects) {
  const offsets = [
    [0, 0], [0, -6], [0, 6], [-6, 0], [6, 0],
    [-6, -6], [6, -6], [-6, 6], [6, 6],
    [0, -12], [0, 12], [-12, 0], [12, 0],
  ];
  for (const [dx, dy] of offsets) {
    const next = { ...candidate, x: candidate.x + dx, y: candidate.y + dy };
    if (!rectInsideCanvas(next) || occupiedRects.some((occupied) => rectsOverlap(next, occupied))) continue;
    return next;
  }
  return null;
}

function protectedTerminalPrintRects(spec, layout) {
  const rects = [
    { x: layout.shell.x, y: layout.shell.y, width: layout.shell.width, height: 1 },
    { x: layout.shell.x, y: layout.shell.y + layout.shell.height - 1, width: layout.shell.width, height: 1 },
    { x: layout.shell.x, y: layout.shell.y, width: 1, height: layout.shell.height },
    { x: layout.shell.x + layout.shell.width - 1, y: layout.shell.y, width: 1, height: layout.shell.height },
    textRect(layout.title.x, layout.title.y, spec.title, layout.title.scale),
    textRect(layout.primaryLabel.x, layout.primaryLabel.y, spec.primaryLabel, layout.primaryLabel.scale),
    textRect(layout.primaryValue.x, layout.primaryValue.y, spec.primaryValue, layout.primaryValue.scale),
    textRect(layout.footer.x, layout.footer.y, spec.footer, layout.footer.scale),
    { x: layout.progress.x - 1, y: layout.progress.y - 1, width: layout.progress.width + 2, height: layout.progress.height + 2 },
  ];
  for (const [index, metric] of spec.metrics.entries()) {
    const y = layout.metric.y + index * layout.metric.gapY;
    rects.push(textRect(layout.metric.x, y, metric.label, 1));
    rects.push(textRect(layout.metric.valueX, y, metric.value, 2));
    rects.push({
      x: layout.metric.markerX - 1,
      y: y + layout.metric.markerOffsetY - 1,
      width: layout.metric.markerWidth + 2,
      height: layout.metric.markerHeight + 2,
    });
  }
  return rects;
}

function textRect(x, y, text, scale = 1) {
  const size = scale === 2 ? 7 : 4;
  const width = String(text || "").length * size * 0.66;
  return { x: x - 1, y: y - size - 1, width: Math.ceil(width) + 2, height: size + 3 };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectInsideCanvas(rect) {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 120 && rect.y + rect.height <= 80;
}

function resolvePalette(templatePalette, spec) {
  return {
    ...templatePalette,
    accent: spec.accent,
    background: spec.background,
  };
}

export function cleanFreeformPrompt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 4) throw new Error("prompt is too short");
  return text.slice(0, 600);
}

export function freeformTitle(prompt) {
  return "WalnutPi Screen";
}

function escapeSvg(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanScreenWorkspaceId(value, field) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) {
    throw new Error(`${field} must be a simple slug`);
  }
  return text;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

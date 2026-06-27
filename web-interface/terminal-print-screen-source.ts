import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

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

export function compactText(text, maxChars) {
  const compacted = String(text || "WALNUT").toUpperCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
  return Array.from(compacted || "WALNUT").slice(0, maxChars).join("");
}

export function compactDisplayText(text, maxChars) {
  const compacted = String(text || "HELLO").replace(/\s+/g, " ").trim();
  return Array.from(compacted || "HELLO").slice(0, maxChars).join("");
}

export function cleanFreeformPrompt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 4) throw new Error("prompt is too short");
  return text.slice(0, 600);
}

export function freeformTitle(prompt) {
  return "WalnutPi Screen";
}

function cleanScreenWorkspaceId(value, field) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) {
    throw new Error(`${field} must be a simple slug`);
  }
  return text;
}

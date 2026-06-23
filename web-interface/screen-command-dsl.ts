import { z } from "zod";

const IdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const Sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const ProcessingPresetSchema = z.enum([
  "fit-cover:480x320",
  "fit-contain:480x320",
  "pixel-grid:120x80@4x",
  "pixel-grid:240x160@2x",
]);

export const LocalSourceRefSchema = z.object({
  kind: z.literal("local"),
  path: z.string().min(1),
  sourceId: IdSchema.optional(),
  title: z.string().max(80).optional(),
  mediaType: z.string().max(120).optional(),
  license: z.string().max(120).optional(),
});

export const GeneratedSourceRefSchema = z.object({
  kind: z.literal("generated"),
  sourceId: IdSchema,
  path: z.string().min(1),
  prompt: z.string().max(1000).optional(),
  mediaType: z.string().max(120).optional(),
  license: z.string().max(120).optional(),
});

export const ScreenCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("screen.importSource"),
    source: z.union([LocalSourceRefSchema, GeneratedSourceRefSchema]),
  }),
  z.object({
    kind: z.literal("screen.renderWallpaper"),
    source: z.union([LocalSourceRefSchema, GeneratedSourceRefSchema]),
    screenId: IdSchema,
    preset: ProcessingPresetSchema,
    outputType: z.enum(["static", "animated"]),
    title: z.string().max(80).optional(),
    description: z.string().max(240).optional(),
  }),
  z.object({
    kind: z.literal("screen.writePlaylist"),
    playlistId: IdSchema.default("default"),
    manifestId: IdSchema,
    mode: z.enum(["replace", "append"]),
    durationMs: z.number().int().min(1).max(86400000),
    loop: z.boolean(),
  }),
  z.object({
    kind: z.literal("screen.syncPlaylist"),
    playlistId: IdSchema.default("default"),
    playlistHash: Sha256Schema,
    evidenceMode: z.enum(["fast", "full"]),
  }),
  z.object({
    kind: z.literal("screen.readPlaylist"),
    playlistId: IdSchema.default("default"),
  }),
  z.object({
    kind: z.literal("screen.captureFrame"),
    buildId: IdSchema.optional(),
  }),
]);

export type ScreenCommand = z.infer<typeof ScreenCommandSchema>;

export function parseScreenCommand(value: unknown): ScreenCommand {
  return ScreenCommandSchema.parse(value);
}

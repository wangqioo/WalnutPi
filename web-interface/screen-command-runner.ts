import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseScreenCommand, type ScreenCommand } from "./screen-command-dsl.ts";
import { toolResult } from "./walnut-tool-results.ts";

type JsonObject = Record<string, any>;

export function createScreenCommandRunner({
  projectRoot,
  workspaceRoot,
  screenWorkspaceStore,
  screenWorkspaceSyncWorkflow,
  processSourceAssetToScreenOutput,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
}: JsonObject) {
  const project = path.resolve(projectRoot);
  const workspace = path.resolve(workspaceRoot);

  async function run(rawCommand: unknown) {
    const command = parseScreenCommand(rawCommand);
    switch (command.kind) {
      case "screen.importSource":
        return importSource(command);
      case "screen.renderWallpaper":
        return renderWallpaper(command);
      case "screen.writePlaylist":
        return writePlaylist(command);
      case "screen.readPlaylist":
        return readPlaylist(command);
      case "screen.syncPlaylist":
        return syncPlaylist(command);
      case "screen.captureFrame":
        return captureFrame(command);
      default:
        return unreachable(command);
    }
  }

  async function importSource(command: Extract<ScreenCommand, { kind: "screen.importSource" }>) {
    const sourcePath = resolveProjectPath(command.source.path, "source.path");
    const sourceId = command.source.sourceId || path.basename(sourcePath, path.extname(sourcePath));
    const sourceDir = path.join(workspace, "sources", sourceId);
    const extension = path.extname(sourcePath) || ".bin";
    const originalName = `original${extension.toLowerCase()}`;
    const originalPath = path.join(sourceDir, originalName);
    await mkdir(sourceDir, { recursive: true });
    await copyFile(sourcePath, originalPath);

    const record = {
      schema: "walnutpi.screen-source-asset.v1",
      id: sourceId,
      selected: true,
      importedAt: new Date().toISOString(),
      original: originalName,
      fileSha256: await fileSha256(originalPath),
      width: 1,
      height: 1,
      mediaType: command.source.mediaType || "application/octet-stream",
      license: command.source.license || "unknown-personal-sync",
      origin: command.source.kind === "generated" ? { kind: "generated", prompt: command.source.prompt || null } : { kind: "local" },
      ...(command.source.kind === "local" && command.source.title ? { title: command.source.title } : {}),
    };
    const sourceJsonPath = path.join(sourceDir, "source.json");
    await writeFile(sourceJsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return toolResult("screen", {
      summary: "Screen source imported.",
      result: {
        command,
        source: record,
        sourceJsonPath,
        originalPath,
      },
      evidence: {
        sourceAsset: record,
      },
      sideEffects: [{ kind: "screen-source-import", target: sourceJsonPath, status: "written" }],
    });
  }

  async function renderWallpaper(command: Extract<ScreenCommand, { kind: "screen.renderWallpaper" }>) {
    const sourcePath = resolveProjectPath(command.source.path, "source.path");
    const sourceId = command.source.sourceId || `${command.screenId}-source`;
    const rendered = await processSourceAssetToScreenOutput({
      workspaceRoot: workspace,
      plan: {
        id: `${command.screenId}-plan`,
        screenId: command.screenId,
        title: command.title,
        description: command.description,
      },
      sourceAsset: {
        id: sourceId,
        path: sourcePath,
        selected: true,
        mediaType: command.source.mediaType,
        license: command.source.license || "unknown-personal-sync",
        origin: command.source.kind === "generated" ? { kind: "generated", prompt: command.source.prompt || null } : { kind: "local" },
      },
      outputType: command.outputType,
      preset: command.preset,
    });
    return toolResult("screen", {
      summary: "Wallpaper rendered through Screen Command DSL.",
      result: {
        command,
        screenId: rendered.screenId,
        manifest: rendered.manifest,
        output: rendered.output,
        manifestPath: rendered.manifestPath,
        outputJsonPath: rendered.outputJsonPath,
      },
      evidence: {
        screenManifest: rendered.manifest,
        screenOutput: rendered.output,
        noAuthoritativeLlmManifest: true,
      },
      sideEffects: [{ kind: "screen-render", target: rendered.manifestPath, status: "written" }],
    });
  }

  async function writePlaylist(command: Extract<ScreenCommand, { kind: "screen.writePlaylist" }>) {
    const writer = command.mode === "append" ? appendScreenPlaylistItem : writeDefaultScreenPlaylist;
    const written = await writer({
      workspaceRoot: workspace,
      playlistId: command.playlistId,
      manifestId: command.manifestId,
      durationMs: command.durationMs,
      repeat: 1,
      loop: command.loop,
    });
    return toolResult("screen", {
      summary: "Playlist written through Screen Command DSL.",
      result: {
        command,
        playlist: written.playlist,
        playlistPath: written.playlistPath,
      },
      evidence: {
        playlist: written.playlist,
      },
      sideEffects: [{ kind: "screen-playlist-write", target: written.playlistPath, status: "written" }],
    });
  }

  async function readPlaylist(command: Extract<ScreenCommand, { kind: "screen.readPlaylist" }>) {
    const envelope = await screenWorkspaceStore.readPlaylistEnvelope(command.playlistId);
    return toolResult("screen", {
      summary: "Playlist read.",
      result: {
        command,
        playlistEnvelope: envelope,
        playlistHash: envelope.playlistHash,
      },
      evidence: {
        playlistEnvelope: envelope,
        playlistHash: envelope.playlistHash,
      },
    });
  }

  async function syncPlaylist(command: Extract<ScreenCommand, { kind: "screen.syncPlaylist" }>) {
    const outcome = await screenWorkspaceSyncWorkflow.run({
      requestJson: async () => ({
        playlistHash: command.playlistHash,
        evidenceMode: command.evidenceMode,
      }),
      mode: "remote",
    });
    return toolResult("screen", {
      ok: Boolean(outcome.result?.ok),
      summary: outcome.result?.summary || "Screen playlist sync finished.",
      result: {
        command,
        status: outcome.status,
        sync: outcome.result,
      },
      evidence: {
        playlistHash: outcome.result?.playlistHash || command.playlistHash,
        buildId: outcome.result?.buildId || null,
        screenEvidence: outcome.result?.screenEvidence || outcome.result?.evidence || null,
      },
      sideEffects: outcome.result?.ok
        ? [{ kind: "screen-sync", target: "screen-runtime", status: "observed" }]
        : [],
      diagnostics: {
        failedStage: outcome.result?.failedStage || null,
        output: outcome.result?.output || null,
      },
    });
  }

  function captureFrame(command: Extract<ScreenCommand, { kind: "screen.captureFrame" }>) {
    return toolResult("screen", {
      ok: false,
      summary: "Frame capture is not exposed as a direct DSL write path yet.",
      result: { command },
      evidence: {
        noDirectLvglCall: true,
        requiredSurface: "screen diagnostics evidence API",
      },
      diagnostics: {
        reason: "capture requires diagnostics adapter wiring",
      },
    });
  }

  function resolveProjectPath(value: string, field: string) {
    const resolved = path.resolve(value);
    const relative = path.relative(project, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${field} must stay inside the WalnutPi project`);
    }
    return resolved;
  }

  return { run };
}

async function fileSha256(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function unreachable(command: never): never {
  throw new Error(`unsupported screen command: ${JSON.stringify(command)}`);
}

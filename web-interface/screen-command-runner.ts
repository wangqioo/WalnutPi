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
  wallpaperRenderer,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
  walnutRemote,
  validSha256 = defaultValidSha256,
  sha256 = defaultSha256,
}: JsonObject) {
  const project = path.resolve(projectRoot);
  const workspace = path.resolve(workspaceRoot);
  if (!wallpaperRenderer || typeof wallpaperRenderer.renderWallpaper !== "function") {
    throw new Error("Screen Command DSL requires a WallpaperRenderer");
  }

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
    const rendered = await wallpaperRenderer.renderWallpaper({
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
      mode: command.mode,
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
        verificationProfile: syncVerificationProfile(command.mode, outcome.status),
        previewNoWrite: command.mode === "preview",
        staleHashRefused: outcome.status === 409,
        noRemoteCommandExecution: command.mode === "preview" || outcome.status === 409 || outcome.status === 400,
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

  async function captureFrame(command: Extract<ScreenCommand, { kind: "screen.captureFrame" }>) {
    if (!walnutRemote?.capturePngBase64) {
      return toolResult("screen", {
        ok: false,
        summary: "Frame capture requires the WalnutPi Device capture adapter.",
        result: { command, operation: "screen.captureFrame" },
        evidence: {
          verificationProfile: "device-profile",
          noDirectLvglCall: true,
          missingDeviceCaptureAdapter: true,
        },
        diagnostics: {
          reason: "walnutRemote.capturePngBase64 is not configured",
        },
      });
    }

    const captureResult = await walnutRemote.capturePngBase64();
    const parsed = parseCaptureResult(captureResult, { validSha256, sha256 });
    if (!parsed) {
      return toolResult("screen", {
        ok: false,
        summary: "Frame capture through the WalnutPi Device failed.",
        result: {
          command,
          operation: "screen.captureFrame",
          status: captureResult?.code ?? null,
        },
        evidence: {
          verificationProfile: "device-profile",
          noDirectLvglCall: true,
          captureFailed: true,
        },
        diagnostics: {
          output: captureResult?.output || null,
        },
      });
    }

    return toolResult("screen", {
      summary: "Frame captured through the WalnutPi Device capture surface.",
      result: {
        command,
        operation: "screen.captureFrame",
        capture: parsed.capture,
      },
      evidence: {
        verificationProfile: "device-profile",
        noDirectLvglCall: true,
        captureEvidence: parsed.capture,
        buildId: command.buildId || null,
      },
      sideEffects: [],
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

function parseCaptureResult(result: JsonObject, { validSha256, sha256 }: JsonObject) {
  if (!result?.ok) return null;
  let capture: JsonObject;
  try {
    capture = JSON.parse(result.output);
  } catch {
    return null;
  }
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) return null;
  if (!validSha256(capture.pngSha256) || typeof capture.pngBase64 !== "string") return null;
  const bytes = Buffer.from(capture.pngBase64, "base64");
  if (!validPngBytes(bytes) || sha256(bytes) !== capture.pngSha256) return null;
  return {
    capture: {
      schema: "walnutpi.screenCaptureEvidence.v1",
      width: capture.width ?? null,
      height: capture.height ?? null,
      isBlank: capture.isBlank ?? null,
      pngSha256: capture.pngSha256,
      rawSha256: validSha256(capture.rawSha256) ? capture.rawSha256 : null,
      byteLength: bytes.length,
    },
    bytes,
  };
}

function validPngBytes(bytes: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return bytes.length > signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function defaultValidSha256(value: any) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function defaultSha256(value: any) {
  return createHash("sha256").update(value).digest("hex");
}

function syncVerificationProfile(mode: string, status: number) {
  if (mode === "preview") return "offline-preview";
  if (status === 400 || status === 409) return "offline-contract";
  return "device-profile";
}

function unreachable(command: never): never {
  throw new Error(`unsupported screen command: ${JSON.stringify(command)}`);
}

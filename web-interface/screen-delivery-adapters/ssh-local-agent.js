import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  generateLvglScreenWorkspaceConfig,
  renderLvglScreenWorkspaceConfig,
} from "../../scripts/generate-lvgl-screen-workspace-config.js";
import { generateLvglScreenWorkspaceRuntimeAssets } from "../../scripts/generate-lvgl-screen-workspace-runtime-assets.js";

export function createSshLocalAgentAdapter({
  localProjectRoot,
  remoteProjectRoot,
  remoteBuildUser,
  sshHost,
  sshUser,
  runRemote,
  runRemoteScript,
  shellQuote,
  remoteBuildShell,
  sha256,
  stableStringify,
  validSha256,
  limitedOutput,
  frameUrl,
}) {
  return {
    id: "ssh-local-agent",
    async deliverWorkspacePlaylist({ buildId, playlistEnvelope }) {
      const playlistHash = playlistEnvelope.playlistHash;
      const screenSlice = await buildWorkspaceDeliverySlice({
        localProjectRoot,
        playlistEnvelope,
      });
      const remoteSliceScript = await buildRemoteSliceScript({
        remoteProjectRoot,
        remoteBuildUser,
        files: screenSlice.files,
      });
      const buildCommand = [
        "set -e",
        `ROOT=${shellQuote(remoteProjectRoot)}`,
        'cd "$ROOT"',
        "WALNUT_SCREEN_WORKSPACE_LVGL=prebuilt scripts/build-lvgl-app.sh",
      ].join("; ");
      const runtimeSupportCommand = remoteBuildShell(
        [
          "set -e",
          `ROOT=${shellQuote(remoteProjectRoot)}`,
          'cd "$ROOT"',
          "test -x build/lvgl_app/walnut-lvgl-screen",
          "strings build/lvgl_app/walnut-lvgl-screen | grep -F walnutpi.lvgl-runtime-assets.v1 >/dev/null",
          "printf 'runtime-supported\\n'",
        ].join("; "),
      );
      const validateCommand = remoteBuildShell(
        [
          "set -e",
          `ROOT=${shellQuote(remoteProjectRoot)}`,
          'cd "$ROOT"',
          "test -x build/lvgl_app/walnut-lvgl-screen",
          "strings build/lvgl_app/walnut-lvgl-screen | grep -F walnutpi.lvgl-runtime-assets.v1 >/dev/null",
          "test -f screen/runtime/default.txt",
          `grep -F ${shellQuote(`playlistHash ${playlistHash}`)} screen/runtime/default.txt >/dev/null`,
          `printf 'playlist-hash=%s\\n' ${shellQuote(playlistHash)}`,
        ].join("; "),
      );
      const remoteBuildCommand = remoteBuildShell(buildCommand);
      const artifactCommand = remoteBuildShell(
        `set -e; ROOT=${shellQuote(remoteProjectRoot)}; cd "$ROOT"; test -x build/lvgl_app/walnut-lvgl-screen; sha256sum build/lvgl_app/walnut-lvgl-screen | awk '{print $1}'`,
      );
      const activateCommand = "sudo -n systemctl restart walnut-screen.service";
      const stateCommand = "walnut screen state";
      const frameCommand = "sudo -n walnut screen frame";

      const remoteSyncScript = buildRemoteSyncScript({
        remoteSliceScript,
        runtimeSupportCommand,
        remoteBuildCommand,
        validateCommand,
        artifactCommand,
        activateCommand,
        stateCommand,
        frameCommand,
      });
      const syncResult = await runRemoteScript(remoteSyncScript, 360_000, 120_000);
      const stageResults = parseRemoteSyncStages(syncResult);
      const sliceResult = stageResults["workspace-slice"] || fallbackStageResult(syncResult, "workspace-slice");
      const runtimeSupportResult = stageResults["runtime-support"] || skippedStageResult("skipped because workspace resource delivery failed");
      const buildResult = stageResults.build || skippedStageResult(sliceResult.ok ? "skipped because runtime binary check failed" : "skipped because workspace resource delivery failed");
      const validateResult = stageResults.validate || skippedStageResult(sliceResult.ok ? "skipped because runtime binary check/build failed" : "skipped because workspace resource delivery failed");
      const artifactResult = stageResults.artifact || skippedStageResult(!sliceResult.ok
        ? "skipped because workspace resource delivery failed"
        : buildResult.ok
          ? "skipped because runtime validation failed"
          : "skipped because build failed");
      const activateResult = stageResults.activate || skippedResult({
        sliceResult,
        validateResult,
        buildResult,
        artifactHashValid: validSha256(artifactResult.output.trim().split(/\s+/)[0]),
        screenName: "workspace resources",
      });
      const stateResult = stageResults.evidence || skippedResult({
        sliceResult,
        validateResult,
        buildResult,
        artifactHashValid: validSha256(artifactResult.output.trim().split(/\s+/)[0]),
        activationOk: activateResult.ok,
        screenName: "workspace resources",
        activationLabel: "activation",
      });
      const artifactHash = artifactResult.ok ? artifactResult.output.trim().split(/\s+/)[0] : null;
      const artifactHashValid = validSha256(artifactHash);
      const frameResult = stageResults.frame || (
        sliceResult.ok && buildResult.ok && validateResult.ok && artifactHashValid && activateResult.ok && stateResult.ok
          ? await runRemote(frameCommand, 15_000)
          : skippedResult({
              sliceResult,
              validateResult,
              buildResult,
              artifactHashValid,
              activationOk: activateResult.ok,
              stateOk: stateResult.ok,
              screenName: "workspace resources",
            })
      );
      const deliveryManifest = {
        schema: "walnutpi.workspaceDelivery.v1",
        buildId,
        adapter: this.id,
        risk: "write-low",
        artifact: {
          name: "walnut-lvgl-screen",
          path: "build/lvgl_app/walnut-lvgl-screen",
          source: "lvgl_app/src/main.c",
          sha256: artifactHashValid ? artifactHash : null,
        },
        playlist: {
          path: "screen/playlists/default.json",
          id: playlistEnvelope.playlist.id,
          sha256: playlistHash,
          itemCount: playlistEnvelope.items.length,
        },
        generatedResources: {
          runtimeIndex: "screen/runtime/default.txt",
          framesDir: "screen/runtime/frames",
          mode: runtimeSupportResult.ok ? "resource-only" : "runtime-upgrade-build",
        },
        target: {
          host: sshHost,
          user: sshUser,
          buildUser: remoteBuildUser || sshUser,
          projectRoot: remoteProjectRoot,
          display: "/dev/fb0",
          activate: activateCommand,
          evidence: [stateCommand, frameCommand],
        },
        screenPlaylistHash: playlistHash,
      };
      const deliveryHash = sha256(stableStringify(deliveryManifest));
      const frameEvidence = parseFrameEvidence(frameResult);
      if (frameEvidence) {
        frameEvidence.capturedAt = new Date().toISOString();
        frameEvidence.command = frameCommand;
      }

      const visual = workspaceVisualStatus({
        playlistEnvelope,
        playlistHash,
        artifactHash: artifactHashValid ? artifactHash : null,
        artifactHashValid,
        frameEvidence,
        validSha256,
        sha256,
        stableStringify,
      });
      const pixelEvidence = workspacePixelEvidence({
        playlistEnvelope,
        frameEvidence,
        validSha256,
        sha256,
        stableStringify,
      });
      const frameImageUrl = validFrameEvidence(frameEvidence, validSha256) ? frameUrl(buildId) : null;
      const failure = firstWorkspaceFailure(
        sliceResult,
        buildResult,
        validateResult,
        artifactHash,
        activateResult,
        stateResult,
        frameResult,
        frameEvidence,
        visual,
        validSha256,
      );
      const screenEvidence = {
        kind: "screen-workspace-playlist-frame",
        visualMatch: visual.visualMatch,
        visualChecks: visual.visualChecks,
        semantic: visual.semantic,
        pixelEvidence,
        playlistEvidence: {
          schema: "walnutpi.screenWorkspacePlaylistEvidence.v1",
          playlistHash,
          activeItem: visual.semantic.activeItem,
          itemManifestHash: visual.semantic.activeItem?.manifestHash || null,
          expectedRgb565PixelHash: visual.semantic.activeItem?.expectedRgb565PixelHash || null,
          displayedFrameHash: frameEvidence?.sha256 || null,
        },
        state: {
          kind: "screen-state",
          command: stateCommand,
          output: stateResult.output,
          capturedAt: new Date().toISOString(),
        },
        frame: validFrameEvidence(frameEvidence, validSha256)
          ? {
              ...frameEvidence,
              url: frameImageUrl,
            }
          : {
              command: frameCommand,
              output: frameResult.output,
              capturedAt: new Date().toISOString(),
            },
      };
      const commandResults = {
        "workspace-slice": sliceResult,
        "runtime-support": runtimeSupportResult,
        build: buildResult,
        validate: validateResult,
        artifact: artifactResult,
        activate: activateResult,
        evidence: stateResult,
        frame: frameResult,
      };
      const output = limitedOutput(
        [
          preflightBlockResult(sliceResult, buildResult, validateResult, artifactResult, activateResult, stateResult, frameResult),
          commandBlockResult("workspace-slice", sliceResult),
          commandBlockResult("runtime-support", runtimeSupportResult),
          commandBlockResult("build", buildResult),
          commandBlockResult("validate", validateResult),
          commandBlockResult("artifact", artifactResult),
          commandBlockResult("activate", activateResult),
          commandBlockResult("evidence", stateResult),
          commandBlockResult("frame", frameResult),
        ].join("\n\n"),
      );

      return {
        ok: failure === null,
        adapter: this.id,
        risk: "write-low",
        mode: "remote",
        deliveryManifest,
        deliveryHash,
        artifactHash: artifactHashValid ? artifactHash : null,
        screenEvidence,
        screenFrameUrl: frameImageUrl,
        frameTicket: frameImageUrl
          ? {
              playlistHash,
              artifactHash: artifactHashValid ? artifactHash : null,
              frameSha256: frameEvidence.sha256,
            }
          : null,
        command: `workspace-resources: deliver ${screenSlice.files.length} files to ${remoteProjectRoot} via one remote script\n${runtimeSupportCommand}\n${remoteBuildCommand}\n${validateCommand}\n${activateCommand}\n${stateCommand}\n${frameCommand}`,
        commandResults,
        code: failure ? 1 : 0,
        output,
        summary: failure
          ? failure.summary
          : runtimeSupportResult.ok
            ? "已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。"
            : "已升级 runtime-capable LVGL 并同步 Screen Workspace 资源到核桃派。",
        failedStage: failure?.stage || null,
      };
    },
  };
}

const SCREEN_SLICE_FILES = [
  "package.json",
  "scripts/build-lvgl-app.sh",
  "scripts/fetch-lvgl.sh",
  "scripts/generate-lvgl-screen-workspace-config.js",
  "scripts/generate-lvgl-screen-workspace-runtime-assets.js",
  "scripts/screen-workspace-vocabulary.js",
  "lvgl_app/CMakeLists.txt",
  "lvgl_app/lv_conf.h",
  "lvgl_app/src/main.c",
  "lvgl_app/src/preview_main.c",
  "lvgl_app/systemd/walnut-screen.service",
];

async function buildWorkspaceDeliverySlice({ localProjectRoot, playlistEnvelope }) {
  const files = [];
  for (const relativePath of SCREEN_SLICE_FILES) {
    files.push({
      path: relativePath,
      mode: relativePath.endsWith(".sh") ? "755" : "644",
      content: await readLocalSliceFile(localProjectRoot, relativePath),
      encoding: "utf8",
    });
  }

  const config = await generateLvglScreenWorkspaceConfig({
    workspaceRoot: playlistEnvelope.workspaceRoot,
    playlistId: playlistEnvelope.playlist.id,
    enabled: "0",
  });
  const generated = renderLvglScreenWorkspaceConfig(config);
  files.push(
    {
      path: "lvgl_app/generated/screen_workspace_config.h",
      mode: "644",
      content: generated.header,
      encoding: "utf8",
    },
    {
      path: "lvgl_app/generated/screen_workspace_config.c",
      mode: "644",
      content: generated.source,
      encoding: "utf8",
    },
  );
  const runtimeAssets = await generateLvglScreenWorkspaceRuntimeAssets({
    workspaceRoot: playlistEnvelope.workspaceRoot,
    playlistId: playlistEnvelope.playlist.id,
  });
  files.push({
    path: "screen/runtime/default.txt",
    mode: "644",
    content: await readFile(runtimeAssets.indexPath, "utf8"),
    encoding: "utf8",
  });
  for (const framePath of runtimeAssets.frames) {
    files.push({
      path: `screen/runtime/frames/${path.basename(framePath)}`,
      mode: "644",
      content: await readFile(framePath),
      encoding: "binary",
    });
  }
  return { files };
}

async function readLocalSliceFile(localProjectRoot, relativePath) {
  const root = path.resolve(localProjectRoot);
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`screen slice path escapes project root: ${relativePath}`);
  }
  return readFile(filePath, "utf8");
}

async function buildRemoteSliceScript({ remoteProjectRoot, remoteBuildUser, files }) {
  const archive = await createSliceArchive(files);
  const archiveBase64 = archive.toString("base64");
  const lines = [
    "set -e",
    `ROOT=${shSingleQuote(remoteProjectRoot)}`,
    'install -d "$ROOT"',
    'TMP_DIR="$(mktemp -d)"',
    'cleanup() { rm -rf "$TMP_DIR"; }',
    "trap cleanup EXIT",
    'base64 -d > "$TMP_DIR/screen-slice.tar.gz" <<\'WALNUT_SCREEN_TARBALL\'',
    archiveBase64,
    "WALNUT_SCREEN_TARBALL",
    'tar -xzf "$TMP_DIR/screen-slice.tar.gz" -C "$ROOT"',
  ];
  if (remoteBuildUser) {
    lines.push(
      `chown -R ${shSingleQuote(`${remoteBuildUser}:${remoteBuildUser}`)} "$ROOT/lvgl_app" "$ROOT/scripts" 2>/dev/null || chown -R ${shSingleQuote(remoteBuildUser)} "$ROOT/lvgl_app" "$ROOT/scripts"`,
      `chown -R ${shSingleQuote(`${remoteBuildUser}:${remoteBuildUser}`)} "$ROOT/screen/runtime" 2>/dev/null || chown -R ${shSingleQuote(remoteBuildUser)} "$ROOT/screen/runtime"`,
    );
  }
  lines.push("printf 'screen slice delivered: %s files via tar.gz\\n' " + shSingleQuote(String(files.length)));
  return lines.join("\n");
}

async function createSliceArchive(files) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "walnutpi-screen-slice-"));
  const stageDir = path.join(tempRoot, "stage");
  const archivePath = path.join(tempRoot, "screen-slice.tar.gz");
  try {
    await mkdir(stageDir, { recursive: true });
    for (const file of files) {
      const relativePath = safeArchivePath(file.path);
      const outputPath = path.join(stageDir, ...relativePath.split("/"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      const content = file.encoding === "binary"
        ? Buffer.from(file.content)
        : String(file.content).replace(/\r\n/g, "\n");
      await writeFile(outputPath, content);
    }
    await runTar(["-czf", archivePath, "-C", stageDir, "."]);
    return await readFile(archivePath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function safeArchivePath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error(`screen slice path is not archive-safe: ${filePath}`);
  }
  return normalized;
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar failed with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function buildRemoteSyncScript({
  remoteSliceScript,
  runtimeSupportCommand,
  remoteBuildCommand,
  validateCommand,
  artifactCommand,
  activateCommand,
  stateCommand,
  frameCommand,
}) {
  return [
    "set +e",
    remoteStageFunction(),
    `run_stage workspace-slice <<'WALNUT_STAGE_WORKSPACE_SLICE'\n${remoteSliceScript}\nWALNUT_STAGE_WORKSPACE_SLICE`,
    "workspace_status=$?",
    "if [ \"$workspace_status\" -ne 0 ]; then exit 0; fi",
    `run_stage runtime-support <<'WALNUT_STAGE_RUNTIME_SUPPORT'\n${runtimeSupportCommand}\nWALNUT_STAGE_RUNTIME_SUPPORT`,
    "runtime_status=$?",
    "if [ \"$runtime_status\" -eq 0 ]; then",
    "  run_stage build <<'WALNUT_STAGE_BUILD_SKIP'\nprintf 'skipped: runtime-capable LVGL binary already exists\\n'\nWALNUT_STAGE_BUILD_SKIP",
    "else",
    `  run_stage build <<'WALNUT_STAGE_BUILD'\n${remoteBuildCommand}\nWALNUT_STAGE_BUILD`,
    "fi",
    "build_status=$?",
    "if [ \"$build_status\" -ne 0 ]; then exit 0; fi",
    `run_stage validate <<'WALNUT_STAGE_VALIDATE'\n${validateCommand}\nWALNUT_STAGE_VALIDATE`,
    "validate_status=$?",
    "if [ \"$validate_status\" -ne 0 ]; then exit 0; fi",
    `run_stage artifact <<'WALNUT_STAGE_ARTIFACT'\n${artifactCommand}\nWALNUT_STAGE_ARTIFACT`,
    "artifact_status=$?",
    "if [ \"$artifact_status\" -ne 0 ]; then exit 0; fi",
    `run_stage activate <<'WALNUT_STAGE_ACTIVATE'\n${activateCommand}\nWALNUT_STAGE_ACTIVATE`,
    "activate_status=$?",
    "if [ \"$activate_status\" -ne 0 ]; then exit 0; fi",
    `run_stage evidence <<'WALNUT_STAGE_EVIDENCE'\n${stateCommand}\nWALNUT_STAGE_EVIDENCE`,
    "evidence_status=$?",
    "if [ \"$evidence_status\" -ne 0 ]; then exit 0; fi",
    `run_stage frame <<'WALNUT_STAGE_FRAME'\n${frameCommand}\nWALNUT_STAGE_FRAME`,
    "exit 0",
  ].join("\n");
}

function remoteStageFunction() {
  return [
    "run_stage() {",
    "  name=\"$1\"",
    "  tmp=\"$(mktemp)\"",
    "  cat > \"$tmp\"",
    "  printf '__WALNUT_STAGE_START__ %s\\n' \"$name\"",
    "  sh \"$tmp\" 2>&1",
    "  code=$?",
    "  rm -f \"$tmp\"",
    "  printf '__WALNUT_STAGE_END__ %s %s\\n' \"$name\" \"$code\"",
    "  return \"$code\"",
    "}",
  ].join("\n");
}

function parseRemoteSyncStages(syncResult) {
  const stages = {};
  const output = String(syncResult.output || "");
  const re = /__WALNUT_STAGE_START__ ([^\n]+)\n([\s\S]*?)__WALNUT_STAGE_END__ \1 ([0-9]+)\n/g;
  let match;
  while ((match = re.exec(output)) !== null) {
    const name = match[1].trim();
    const code = Number(match[3]);
    stages[name] = {
      ok: syncResult.ok && code === 0,
      code,
      output: match[2].trim() || "ok",
      preflightOutput: syncResult.preflightOutput,
    };
  }
  return stages;
}

function fallbackStageResult(syncResult, stage) {
  return {
    ok: false,
    code: syncResult.code,
    output: syncResult.output || `missing remote sync stage: ${stage}`,
    preflightOutput: syncResult.preflightOutput,
  };
}

function skippedStageResult(output) {
  return { ok: false, code: null, output };
}

function preflightBlockResult(...results) {
  const outputs = [];
  const seen = new Set();
  for (const result of results) {
    const output = result?.preflightOutput;
    if (!output || seen.has(output)) continue;
    seen.add(output);
    outputs.push(output);
  }
  return outputs.length ? commandBlockResult("walnut-cli-preflight", { ok: true, code: 0, output: outputs.join("\n") }) : "";
}

function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function shDoubleQuote(value) {
  return String(value).replace(/\\/g, "/").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

function shDoubleQuoteDir(relativePath) {
  const directory = path.posix.dirname(String(relativePath).replace(/\\/g, "/"));
  return directory === "." ? "" : shDoubleQuote(directory);
}

function parseFrameEvidence(result) {
  if (!result.ok) return null;
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

function validFrameEvidence(frame, validSha256) {
  return Boolean(
    frame
      && typeof frame === "object"
      && validSha256(frame.sha256)
      && Number.isInteger(frame.byteLength)
      && frame.byteLength > 0
      && (!Number.isInteger(frame.expectedByteLength) || frame.expectedByteLength === frame.byteLength),
  );
}

function screenPixelEvidence({ frameEvidence, expectedRgb565PixelHashes = [], validSha256, sha256, stableStringify }) {
  if (!validFrameEvidence(frameEvidence, validSha256)) {
    return {
      schema: "walnutpi.screenPixelEvidence.v1",
      status: "missing-frame",
      claim: "framebuffer-not-captured",
      frameHash: null,
      sampleHash: null,
      nonzeroRatio: null,
      capture: null,
      limitations: [
        "Framebuffer frame metadata was not valid for pixel evidence.",
        "Web preview pixels are not rendered and compared in this slice.",
      ],
    };
  }

  const sample = frameEvidence.sample && typeof frameEvidence.sample === "object" ? frameEvidence.sample : null;
  const sampleHash = sample
    ? sha256(stableStringify({
        base64: sample.base64 || "",
        length: sample.length ?? null,
        offset: sample.offset ?? null,
        uniqueBytes: sample.uniqueBytes ?? null,
      }))
    : null;
  const nonzeroBytes = Number(frameEvidence.nonzeroBytes ?? 0);
  const byteLength = Number(frameEvidence.byteLength || 0);
  const nonzeroRatio = byteLength > 0 ? Number((nonzeroBytes / byteLength).toFixed(6)) : null;
  const expectedHashes = expectedRgb565PixelHashes.filter((hash) => validSha256(hash));
  const rgb565HashMatched = expectedHashes.length > 0 && expectedHashes.includes(frameEvidence.sha256);
  const status = expectedHashes.length === 0 ? "metadata-only" : rgb565HashMatched ? "matched" : "mismatch";
  const claim = expectedHashes.length === 0
    ? "framebuffer-captured-not-pixel-diffed"
    : rgb565HashMatched
      ? "framebuffer-rgb565-hash-matched"
      : "framebuffer-rgb565-hash-mismatch";

  return {
    schema: "walnutpi.screenPixelEvidence.v1",
    status,
    claim,
    frameHash: frameEvidence.sha256 || null,
    expectedRgb565PixelHashes: expectedHashes,
    rgb565HashMatched: expectedHashes.length > 0 ? rgb565HashMatched : null,
    sampleHash,
    nonzeroRatio,
    capture: {
      width: frameEvidence.width ?? null,
      height: frameEvidence.height ?? null,
      pixelFormat: frameEvidence.pixelFormat || null,
      bitsPerPixel: frameEvidence.bitsPerPixel ?? null,
      byteLength: frameEvidence.byteLength ?? null,
      expectedByteLength: frameEvidence.expectedByteLength ?? null,
      isBlank: frameEvidence.isBlank ?? null,
    },
    limitations: [
      ...(expectedHashes.length > 0
        ? []
        : ["No expected RGB565 pixel hash was available for this frame evidence."]),
      "LVGL may be dynamic, so diagnostic PNG can be later than sync-time raw frame.",
    ],
  };
}

function workspacePreviewSignature(playlistEnvelope) {
  return {
    schema: "walnutpi.screenWorkspacePreviewSignature.v1",
    playlistHash: playlistEnvelope.playlistHash,
    playlist: {
      id: playlistEnvelope.playlist.id,
      loop: playlistEnvelope.playlist.loop,
      itemCount: playlistEnvelope.items.length,
    },
    items: playlistEnvelope.items.map((item) => ({
      manifestId: item.manifestId,
      manifestHash: item.manifestHash,
      durationMs: item.durationMs,
      repeat: item.repeat,
      transition: item.transition,
      outputType: item.output?.type || null,
      rgb565PixelSha256: item.output?.type === "static"
        ? item.output.rgb565PixelSha256
        : item.output?.frames?.[0]?.rgb565PixelSha256 || null,
      frameCount: item.output?.type === "animated" ? item.output.frames.length : 1,
    })),
  };
}

function workspaceDeviceSignature({ playlistHash, artifactHash, frameEvidence }) {
  return {
    schema: "walnutpi.screenWorkspaceDeviceSignature.v1",
    playlistHash,
    artifactHash: artifactHash || null,
    frame: frameEvidence
      ? {
          sha256: frameEvidence.sha256 || null,
          width: frameEvidence.width ?? null,
          height: frameEvidence.height ?? null,
          pixelFormat: frameEvidence.pixelFormat || null,
          bitsPerPixel: frameEvidence.bitsPerPixel ?? null,
          byteLength: frameEvidence.byteLength ?? null,
          expectedByteLength: frameEvidence.expectedByteLength ?? null,
          isBlank: frameEvidence.isBlank ?? null,
        }
      : null,
  };
}

function workspaceFrameCandidates(playlistEnvelope) {
  return playlistEnvelope.items.flatMap((item, itemIndex) => {
    const frames = item.output?.type === "animated" ? item.output.frames : [item.output].filter(Boolean);
    return frames.map((frame, frameIndex) => ({
      index: itemIndex,
      frameIndex,
      manifestId: item.manifestId,
      manifestHash: item.manifestHash,
      outputType: item.output?.type || null,
      expectedRgb565PixelHash: frame?.rgb565PixelSha256 || null,
      durationMs: item.output?.type === "animated" ? frame?.durationMs || item.durationMs : item.durationMs,
      repeat: item.repeat,
    })).filter((candidate) => candidate.expectedRgb565PixelHash);
  });
}

function workspaceMatchedDisplayItem(playlistEnvelope, frameEvidence, validSha256) {
  const candidates = workspaceFrameCandidates(playlistEnvelope);
  const matched = validFrameEvidence(frameEvidence, validSha256)
    ? candidates.find((candidate) => candidate.expectedRgb565PixelHash === frameEvidence.sha256)
    : null;
  const fallback = candidates[0] || null;
  const selected = matched || fallback;
  if (!selected) return null;
  return {
    ...selected,
    observed: Boolean(matched),
    expectedRgb565PixelHashes: candidates.map((candidate) => candidate.expectedRgb565PixelHash),
  };
}

function workspaceVisualStatus({ playlistEnvelope, playlistHash, artifactHash, artifactHashValid, frameEvidence, validSha256, sha256, stableStringify }) {
  const frameCaptured = validFrameEvidence(frameEvidence, validSha256);
  const previewSignature = workspacePreviewSignature(playlistEnvelope);
  const deviceSignature = workspaceDeviceSignature({ playlistHash, artifactHash, frameEvidence });
  const previewSignatureHash = sha256(stableStringify(previewSignature));
  const deviceSignatureHash = sha256(stableStringify(deviceSignature));
  const activeItem = workspaceMatchedDisplayItem(playlistEnvelope, frameEvidence, validSha256);
  const targetMatched = frameCaptured
    && frameEvidence.width === 480
    && frameEvidence.height === 320
    && (frameEvidence.pixelFormat === "RGB565_LE" || frameEvidence.bitsPerPixel === 16);
  const artifactCommittedToPlaylist = artifactHashValid
    && validSha256(artifactHash)
    && playlistHash === deviceSignature.playlistHash;
  const visualChecks = {
    playlistHashMatched: true,
    artifactHashValid,
    previewSignatureHash,
    deviceSignatureHash,
    semanticPlaylistMatched: playlistHash === deviceSignature.playlistHash,
    targetMatched,
    artifactCommittedToPlaylist,
    frameCaptured,
    frameDimensionsMatched: frameCaptured
      && frameEvidence.width === 480
      && frameEvidence.height === 320,
    framePixelFormatMatched: frameCaptured
      && (frameEvidence.pixelFormat === "RGB565_LE" || frameEvidence.bitsPerPixel === 16),
    frameByteLengthMatched: frameCaptured
      && Number.isInteger(frameEvidence.expectedByteLength)
      && frameEvidence.expectedByteLength === frameEvidence.byteLength,
    frameNonblank: frameCaptured
      && frameEvidence.isBlank === false
      && Number(frameEvidence.nonzeroBytes || 0) > 0,
    frameRgb565HashMatched: frameCaptured
      && Array.isArray(activeItem?.expectedRgb565PixelHashes)
      && activeItem.expectedRgb565PixelHashes.includes(frameEvidence.sha256),
    activeItemObserved: Boolean(activeItem?.observed),
  };
  const semantic = {
    previewSignatureHash,
    deviceSignatureHash,
    previewSignature,
    deviceSignature,
    activeItem,
  };
  if (!frameCaptured) {
    return { visualMatch: "unknown", visualChecks, semantic };
  }
  return {
    visualMatch: Object.values(visualChecks).every(Boolean) ? "captured" : "mismatch",
    visualChecks,
    semantic,
  };
}

function workspacePixelEvidence({ playlistEnvelope, frameEvidence, validSha256, sha256, stableStringify }) {
  const activeItem = workspaceMatchedDisplayItem(playlistEnvelope, frameEvidence, validSha256);
  const evidence = screenPixelEvidence({
    frameEvidence,
    expectedRgb565PixelHashes: activeItem?.expectedRgb565PixelHashes || [],
    validSha256,
    sha256,
    stableStringify,
  });
  return {
    ...evidence,
    schema: "walnutpi.screenWorkspacePixelEvidence.v1",
    expectedRgb565PixelHash: activeItem?.expectedRgb565PixelHash || null,
    expectedRgb565PixelHashes: activeItem?.expectedRgb565PixelHashes || [],
    activeManifestHash: activeItem?.manifestHash || null,
    activeItemObserved: Boolean(activeItem?.observed),
    limitations: [
      ...(evidence.limitations || []),
      ...(activeItem?.observed
        ? []
        : ["The active playlist item could not be observed from the framebuffer hash; the first playlist frame was used as fallback context."]),
    ],
  };
}

function firstWorkspaceFailure(sliceResult, buildResult, validateResult, artifactHash, activateResult, stateResult, frameResult, frameEvidence, visual, validSha256) {
  if (!sliceResult.ok) {
    return {
      stage: "workspace-slice",
      summary: "Screen Workspace 播放列表片段写入核桃派失败。请检查 SSH 连接和远端项目目录权限。",
    };
  }
  if (!buildResult.ok) {
    return {
      stage: "build",
      summary: "LVGL workspace 播放列表构建失败。请在诊断里查看第一处编译错误。",
    };
  }
  if (!validateResult.ok) {
    return {
      stage: "artifact",
      summary: "核桃派上的 LVGL runtime 或 screen/runtime/default.txt 没有匹配当前 Screen Workspace playlist。请查看诊断里的 runtime validation。",
    };
  }
  if (!validSha256(artifactHash)) {
    return {
      stage: "artifact",
      summary: "LVGL 产物哈希校验失败。请在诊断里确认构建产物是否存在。",
    };
  }
  if (!activateResult.ok) {
    return {
      stage: "activate",
      summary: "核桃派屏幕激活失败。请确认 walnut-screen.service 已安装并允许 sudo 执行。",
    };
  }
  if (!stateResult.ok) {
    return {
      stage: "evidence",
      summary: "屏幕状态回证失败。请检查 SSH 连接和 walnut screen state 输出。",
    };
  }
  if (!frameResult.ok || !validFrameEvidence(frameEvidence, validSha256)) {
    return {
      stage: "frame",
      summary: "屏幕画面回证失败。请在诊断里查看 framebuffer 读取结果。",
    };
  }
  if (visual.visualMatch !== "captured") {
    return {
      stage: "visual",
      summary: "屏幕画面回证和 Screen Workspace playlist 约束不一致。请在诊断里查看 frame checks。",
    };
  }
  return null;
}

function skippedResult({ sliceResult, validateResult, buildResult, artifactHashValid, activationOk = true, stateOk = true, screenName = "screen slice" }) {
  let output = "skipped";
  if (!sliceResult.ok) output = `skipped because ${screenName} delivery failed`;
  else if (!validateResult.ok) output = "skipped because runtime validation failed";
  else if (!buildResult.ok) output = "skipped because build failed";
  else if (!artifactHashValid) output = "skipped because artifact hash is invalid";
  else if (!activationOk) output = "skipped because activation failed";
  else if (!stateOk) output = "skipped because screen state evidence failed";
  return { ok: false, code: null, output };
}

function commandBlockResult(name, result) {
  return [
    `## ${name}`,
    `ok=${result.ok}`,
    `code=${result.code ?? "timeout"}`,
    result.output,
  ]
    .filter(Boolean)
    .join("\n");
}

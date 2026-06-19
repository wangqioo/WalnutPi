import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateLvglScreenWorkspaceRuntimeAssets } from "../../scripts/generate-lvgl-screen-workspace-runtime-assets.js";
import {
  buildScreenSyncEvidence,
  parseFrameEvidence,
  validFrameEvidence,
} from "../screen-sync-evidence.js";

export function createSshLocalAgentAdapter({
  localProjectRoot,
  remoteProjectRoot,
  remoteBuildUser,
  sshHost,
  sshUser,
  runRemote,
  runRemoteRaw,
  runRemoteScript,
  runRemoteRawScript,
  runRemoteWithInput,
  runRemoteRawWithInput,
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
    async deliverWorkspacePlaylist({ buildId, playlistEnvelope, evidenceMode = "fast" }) {
      const fullEvidence = evidenceMode === "full";
      const inputRunner = fullEvidence ? runRemoteWithInput : (runRemoteRawWithInput || runRemoteWithInput);
      const commandRunner = fullEvidence ? runRemote : (runRemoteRaw || runRemote);
      const scriptRunner = fullEvidence ? runRemoteScript : (runRemoteRawScript || runRemoteScript);
      const playlistHash = playlistEnvelope.playlistHash;
      const screenSlice = await buildRuntimeDeliverySlice({
        localProjectRoot,
        playlistEnvelope,
      });
      const archive = await createSliceArchive(screenSlice.files);
      const remoteSliceCommand = buildRemoteSliceInputCommand({
        remoteProjectRoot,
        remoteBuildUser,
        fileCount: screenSlice.files.length,
        includeProjectFiles: false,
      });
      const buildCommand = [
        "set -e",
        `ROOT=${shellQuote(remoteProjectRoot)}`,
        'cd "$ROOT"',
        "scripts/build-lvgl-app.sh",
      ].join("; ");
      const runtimeSupportCommand = remoteBuildShell(
        [
          "set -e",
          `ROOT=${shellQuote(remoteProjectRoot)}`,
          'cd "$ROOT"',
          "test -x build/lvgl_app/walnut-lvgl-screen",
          "strings build/lvgl_app/walnut-lvgl-screen | grep -F walnutpi.lvgl-runtime-hot-reload.v1 >/dev/null",
          "printf 'runtime-supported\\n'",
        ].join("; "),
      );
      const validateCommand = remoteBuildShell(
        [
          "set -e",
          `ROOT=${shellQuote(remoteProjectRoot)}`,
          'cd "$ROOT"',
          "test -x build/lvgl_app/walnut-lvgl-screen",
          "strings build/lvgl_app/walnut-lvgl-screen | grep -F walnutpi.lvgl-runtime-hot-reload.v1 >/dev/null",
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
      const hotReloadCommand = fullEvidence
        ? "sleep 0.25; printf 'hot-reload wait complete\\n'"
        : [
            "sleep 0.25",
            "screen_state=$(systemctl is-active walnut-screen.service)",
            "if [ \"$screen_state\" != active ]; then printf 'hot-reload skipped: walnut-screen.service %s\\n' \"$screen_state\"; sudo -n systemctl restart walnut-screen.service; sleep 0.75; screen_state=$(systemctl is-active walnut-screen.service); printf 'restart fallback complete\\nwalnut-screen.service %s\\n' \"$screen_state\"; else printf 'hot-reload wait complete\\nwalnut-screen.service %s\\n' \"$screen_state\"; fi",
            "test \"$screen_state\" = active",
            "if [ -r /sys/class/vtconsole/vtcon1/bind ]; then printf 'vtcon1 bind %s\\n' \"$(cat /sys/class/vtconsole/vtcon1/bind)\"; fi",
          ].join("; ");
      const stateCommand = fullEvidence ? "walnut screen state" : null;
      const frameCommand = fullEvidence ? "sudo -n walnut screen frame" : null;

      const remoteSyncScript = buildRemoteSyncScript({
        validateCommand,
        artifactCommand,
        hotReloadCommand,
        stateCommand,
        frameCommand,
      });
      const hotSyncInputCommand = buildRemoteHotSyncInputCommand({ remoteSliceCommand });
      const syncResult = await inputRunner(hotSyncInputCommand, archive, 90_000, 100_000);
      const stageResults = parseRemoteSyncStages(syncResult);
      const sliceResult = stageResults["workspace-slice"] || fallbackStageResult(syncResult, "workspace-slice");
      const runtimeSupportResult = sliceResult.ok
        ? await commandRunner(runtimeSupportCommand, 30_000)
        : skippedStageResult("skipped because workspace resource delivery failed");
      let buildResult = runtimeSupportResult.ok
        ? { ok: true, code: 0, output: "skipped: runtime-capable LVGL binary already exists" }
        : skippedStageResult(sliceResult.ok ? "skipped before full workspace delivery" : "skipped because workspace resource delivery failed");
      if(sliceResult.ok && !runtimeSupportResult.ok) {
        const fullSlice = await buildWorkspaceDeliverySlice({
          localProjectRoot,
          playlistEnvelope,
        });
        const fullArchive = await createSliceArchive(fullSlice.files);
        const fullSliceCommand = buildRemoteSliceInputCommand({
          remoteProjectRoot,
          remoteBuildUser,
          fileCount: fullSlice.files.length,
          includeProjectFiles: true,
        });
        const fullSliceResult = await inputRunner(fullSliceCommand, fullArchive, 60_000, 20_000);
        if(!fullSliceResult.ok) {
          buildResult = skippedStageResult("skipped because full workspace delivery failed");
        } else {
          buildResult = await commandRunner(remoteBuildCommand, 300_000);
        }
      }
      const upgradeSyncResult = sliceResult.ok && buildResult.ok
        ? await scriptRunner(remoteSyncScript, 120_000, 80_000)
        : null;
      const upgradeStageResults = upgradeSyncResult ? parseRemoteSyncStages(upgradeSyncResult) : {};
      const finalStageResults = upgradeSyncResult ? upgradeStageResults : stageResults;
      const validateResult = finalStageResults.validate || skippedStageResult(sliceResult.ok ? "skipped because runtime binary check/build failed" : "skipped because workspace resource delivery failed");
      const artifactResult = finalStageResults.artifact || skippedStageResult(!sliceResult.ok
        ? "skipped because workspace resource delivery failed"
        : buildResult.ok
          ? "skipped because runtime validation failed"
          : "skipped because build failed");
      const artifactHash = artifactResult.ok ? artifactResult.output.trim().split(/\s+/)[0] : null;
      const artifactHashValid = validSha256(artifactHash);
      const activateResult = finalStageResults.activate || skippedResult({
        sliceResult,
        validateResult,
        buildResult,
        artifactHashValid,
        screenName: "workspace resources",
        missingStage: "activate",
      });
      const stateResult = finalStageResults.evidence || (!fullEvidence && activateResult.ok
        ? {
            ok: true,
            code: 0,
            output: activateResult.output,
            preflightOutput: activateResult.preflightOutput,
          }
        : skippedResult({
            sliceResult,
            validateResult,
            buildResult,
            artifactHashValid: validSha256(artifactResult.output.trim().split(/\s+/)[0]),
            activationOk: activateResult.ok,
            screenName: "workspace resources",
            activationLabel: "activation",
          }));
      const frameResult = finalStageResults.frame || (
        fullEvidence && sliceResult.ok && buildResult.ok && validateResult.ok && artifactHashValid && activateResult.ok && stateResult.ok
          ? await commandRunner(frameCommand, 15_000)
          : skippedResult({
              sliceResult,
              validateResult,
              buildResult,
              artifactHashValid,
              activationOk: activateResult.ok,
              stateOk: stateResult.ok,
              screenName: fullEvidence ? "workspace resources" : "workspace frame evidence",
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
        evidenceMode: fullEvidence ? "full" : "fast",
        target: {
          host: sshHost,
          user: sshUser,
          buildUser: remoteBuildUser || sshUser,
          projectRoot: remoteProjectRoot,
          display: "/dev/fb0",
          activate: activateCommand,
          hotReload: runtimeSupportResult.ok ? hotReloadCommand : null,
          evidence: fullEvidence ? [stateCommand, frameCommand] : ["hot-reload service-active check"],
        },
        screenPlaylistHash: playlistHash,
      };
      const deliveryHash = sha256(stableStringify(deliveryManifest));
      const frameEvidence = parseFrameEvidence(frameResult);
      if (frameEvidence) {
        frameEvidence.capturedAt = new Date().toISOString();
        frameEvidence.command = frameCommand;
      }

      const evidence = buildScreenSyncEvidence({
        playlistEnvelope,
        playlistHash,
        artifactHash: artifactHashValid ? artifactHash : null,
        artifactHashValid,
        frameEvidence,
        stateResult,
        frameResult,
        stateCommand,
        frameCommand,
        fullEvidence,
        buildId,
        frameUrl,
        validSha256,
        sha256,
        stableStringify,
        stageResults: {
          sliceResult,
          buildResult,
          validateResult,
          activateResult,
          stateResult,
          frameResult,
        },
      });
      const { failure, screenEvidence, frameImageUrl } = evidence;
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
        command: [
          `workspace-resources: stream ${screenSlice.files.length} files to ${remoteProjectRoot} as tar.gz`,
          `evidence-mode: ${fullEvidence ? "full" : "fast"}`,
          runtimeSupportCommand,
          remoteBuildCommand,
          validateCommand,
          runtimeSupportResult.ok ? hotReloadCommand : activateCommand,
          stateCommand,
          frameCommand,
        ].filter(Boolean).join("\n"),
        commandResults,
        remoteExecution: summarizeRemoteExecution(commandResults),
        code: failure ? 1 : 0,
        output,
        summary: failure
          ? failure.summary
          : runtimeSupportResult.ok
            ? fullEvidence
              ? "已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL，并完成 framebuffer 回证。"
              : "已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。"
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

async function buildRuntimeDeliverySlice({ playlistEnvelope }) {
  const files = [];
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

function buildRemoteSliceInputCommand({ remoteProjectRoot, remoteBuildUser, fileCount, includeProjectFiles = true }) {
  const lines = [
    "set -e",
    `ROOT=${shSingleQuote(remoteProjectRoot)}`,
    'install -d "$ROOT"',
    'tar -xzf - -C "$ROOT"',
  ];
  if(includeProjectFiles) {
    lines.push('chmod 755 "$ROOT/scripts/build-lvgl-app.sh" "$ROOT/scripts/fetch-lvgl.sh"');
  }
  if (remoteBuildUser) {
    if(includeProjectFiles) {
      lines.push(`chown -R ${shSingleQuote(`${remoteBuildUser}:${remoteBuildUser}`)} "$ROOT/lvgl_app" "$ROOT/scripts" 2>/dev/null || chown -R ${shSingleQuote(remoteBuildUser)} "$ROOT/lvgl_app" "$ROOT/scripts"`);
    }
    lines.push(`chown -R ${shSingleQuote(`${remoteBuildUser}:${remoteBuildUser}`)} "$ROOT/screen/runtime" 2>/dev/null || chown -R ${shSingleQuote(remoteBuildUser)} "$ROOT/screen/runtime"`);
  }
  lines.push("printf 'screen slice delivered: %s files via tar.gz stream\\n' " + shSingleQuote(String(fileCount)));
  return lines.join("; ");
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
      await chmod(outputPath, Number.parseInt(file.mode || "644", 8));
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
  validateCommand,
  artifactCommand,
  hotReloadCommand,
  stateCommand,
  frameCommand,
}) {
  const lines = [
    "set +e",
    remoteStageFunction(),
    ...stageScriptLines("validate", validateCommand, "validate_status", { stopOnFailure: true }),
    ...stageScriptLines("artifact", artifactCommand, "artifact_status", { stopOnFailure: true }),
    ...stageScriptLines("activate", hotReloadCommand, "activate_status", { stopOnFailure: true }),
  ];
  if (stateCommand) {
    lines.push(...stageScriptLines("evidence", stateCommand, "evidence_status", { stopOnFailure: true }));
  }
  if (frameCommand) {
    lines.push(...stageScriptLines("frame", frameCommand, "frame_status", { stopOnFailure: false }));
  }
  lines.push("exit 0");
  return lines.join("\n");
}

function buildRemoteHotSyncInputCommand({ remoteSliceCommand }) {
  const lines = [
    "set +e",
    "printf '__WALNUT_STAGE_START__ workspace-slice\\n'",
    remoteSliceCommand,
    "workspace_status=$?",
    "printf '__WALNUT_STAGE_END__ workspace-slice %s\\n' \"$workspace_status\"",
  ];
  lines.push("exit 0");
  return lines.join("\n");
}

function stageScriptLines(name, command, statusVar, { stopOnFailure }) {
  const lines = [
    `run_stage ${name} ${shSingleQuote(command)}`,
    `${statusVar}=$?`,
  ];
  if (stopOnFailure) {
    lines.push(`if [ "$${statusVar}" -ne 0 ]; then exit 0; fi`);
  }
  return lines;
}

function remoteStageFunction() {
  return [
    "run_stage() {",
    "  name=\"$1\"",
    "  script=\"$2\"",
    "  printf '__WALNUT_STAGE_START__ %s\\n' \"$name\"",
    "  sh -c \"$script\" 2>&1",
    "  code=$?",
    "  printf '__WALNUT_STAGE_END__ %s %s\\n' \"$name\" \"$code\"",
    "  return \"$code\"",
    "}",
  ].join("\n");
}

function parseRemoteSyncStages(syncResult) {
  const stages = {};
  const output = String(syncResult.output || "");
  const re = /__WALNUT_STAGE_START__ ([^\n]+)\n([\s\S]*?)__WALNUT_STAGE_END__ \1 ([0-9]+)(?:\n|$)/g;
  let match;
  while ((match = re.exec(output)) !== null) {
    const name = match[1].trim();
    const code = Number(match[3]);
    stages[name] = {
      ok: code === 0,
      code,
      output: match[2].trim() || "ok",
      preflightOutput: syncResult.preflightOutput,
      remoteTransport: syncResult.remoteTransport || null,
      reusedConnection: typeof syncResult.reusedConnection === "boolean" ? syncResult.reusedConnection : null,
      fallbackRemoteTransport: syncResult.fallbackRemoteTransport || null,
      fallbackReusedConnection: typeof syncResult.fallbackReusedConnection === "boolean" ? syncResult.fallbackReusedConnection : null,
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
    remoteTransport: syncResult.remoteTransport || null,
    reusedConnection: typeof syncResult.reusedConnection === "boolean" ? syncResult.reusedConnection : null,
    fallbackRemoteTransport: syncResult.fallbackRemoteTransport || null,
    fallbackReusedConnection: typeof syncResult.fallbackReusedConnection === "boolean" ? syncResult.fallbackReusedConnection : null,
  };
}

function skippedStageResult(output) {
  return { ok: false, code: null, output };
}

function summarizeRemoteExecution(commandResults) {
  const transports = [];
  const reused = [];
  for (const result of Object.values(commandResults || {})) {
    if (!result || typeof result !== "object") continue;
    if (result.remoteTransport) transports.push(result.remoteTransport);
    if (typeof result.reusedConnection === "boolean") reused.push(result.reusedConnection);
  }
  return {
    remoteTransport: transports[0] || null,
    connectionReused: reused.length ? reused.some(Boolean) : null,
    segments: {
      preflightMs: null,
      remoteMs: null,
    },
  };
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











function skippedResult({ sliceResult, validateResult, buildResult, artifactHashValid, activationOk = true, stateOk = true, screenName = "screen slice", missingStage = null }) {
  let output = "skipped";
  if (!sliceResult.ok) output = `skipped because ${screenName} delivery failed`;
  else if (!validateResult.ok) output = "skipped because runtime validation failed";
  else if (!buildResult.ok) output = "skipped because build failed";
  else if (!artifactHashValid) output = "skipped because artifact hash is invalid";
  else if (!activationOk) output = "skipped because activation failed";
  else if (!stateOk) output = "skipped because screen state evidence failed";
  else if (missingStage) output = `missing remote sync stage: ${missingStage}`;
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

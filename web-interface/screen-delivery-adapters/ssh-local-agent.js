export function createSshLocalAgentAdapter({
  remoteProjectRoot,
  remoteBuildUser,
  sshHost,
  sshUser,
  runRemote,
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
    async deliver({ buildId, manifest, manifestHash }) {
      const buildCommand = [
        "set -e",
        `ROOT=${shellQuote(remoteProjectRoot)}`,
        'cd "$ROOT"',
        "scripts/build-lvgl-app.sh",
      ].join("; ");
      const remoteBuildCommand = remoteBuildShell(buildCommand);
      const artifactCommand = remoteBuildShell(
        `set -e; ROOT=${shellQuote(remoteProjectRoot)}; cd "$ROOT"; test -x build/lvgl_app/walnut-lvgl-screen; sha256sum build/lvgl_app/walnut-lvgl-screen | awk '{print $1}'`,
      );
      const activateCommand = "sudo -n walnut screen start";
      const stateCommand = "walnut screen state";
      const frameCommand = "sudo -n walnut screen frame";

      const buildResult = await runRemote(remoteBuildCommand, 120_000);
      const artifactResult = buildResult.ok
        ? await runRemote(artifactCommand, 10_000)
        : { ok: false, code: null, output: "skipped because build failed" };
      const artifactHash = artifactResult.ok ? artifactResult.output.trim().split(/\s+/)[0] : null;
      const artifactHashValid = validSha256(artifactHash);
      const deliveryManifest = {
        schema: "walnutpi.delivery.v1",
        buildId,
        adapter: this.id,
        risk: "write-low",
        artifact: {
          name: "walnut-lvgl-screen",
          path: "build/lvgl_app/walnut-lvgl-screen",
          source: "lvgl_app/src/main.c",
          sha256: artifactHashValid ? artifactHash : null,
        },
        target: {
          host: sshHost,
          user: sshUser,
          buildUser: remoteBuildUser || sshUser,
          projectRoot: remoteProjectRoot,
          display: manifest.target.display,
          activate: activateCommand,
          evidence: [stateCommand, frameCommand],
        },
        screenManifestHash: manifestHash,
      };
      const deliveryHash = sha256(stableStringify(deliveryManifest));
      const activateResult = buildResult.ok && artifactHashValid
        ? await runRemote(activateCommand, 30_000)
        : {
            ok: false,
            code: null,
            output: buildResult.ok ? "skipped because artifact hash is invalid" : "skipped because build failed",
          };
      const stateResult = buildResult.ok && artifactHashValid && activateResult.ok
        ? await runRemote(stateCommand, 15_000)
        : {
            ok: false,
            code: null,
            output: !buildResult.ok
              ? "skipped because build failed"
              : artifactHashValid
                ? "skipped because activation failed"
                : "skipped because artifact hash is invalid",
          };
      const frameResult = buildResult.ok && artifactHashValid && activateResult.ok && stateResult.ok
        ? await runRemote(frameCommand, 15_000)
        : {
            ok: false,
            code: null,
            output: !buildResult.ok
              ? "skipped because build failed"
              : !artifactHashValid
                ? "skipped because artifact hash is invalid"
                : !activateResult.ok
                  ? "skipped because activation failed"
                  : "skipped because screen state evidence failed",
          };
      const frameEvidence = parseFrameEvidence(frameResult);
      if (frameEvidence) {
        frameEvidence.capturedAt = new Date().toISOString();
        frameEvidence.command = frameCommand;
      }

      const visual = visualStatus(manifest, artifactHashValid, frameEvidence, validSha256);
      const frameImageUrl = validFrameEvidence(frameEvidence, validSha256) ? frameUrl(buildId) : null;
      const failure = firstFailure(
        buildResult,
        artifactHash,
        activateResult,
        stateResult,
        frameResult,
        frameEvidence,
        visual,
        validSha256,
      );
      const screenEvidence = {
        kind: "screen-frame",
        visualMatch: visual.visualMatch,
        visualChecks: visual.visualChecks,
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
        build: buildResult,
        artifact: artifactResult,
        activate: activateResult,
        evidence: stateResult,
        frame: frameResult,
      };
      const output = limitedOutput(
        [
          commandBlockResult("build", buildResult),
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
              manifestHash,
              artifactHash: artifactHashValid ? artifactHash : null,
              frameSha256: frameEvidence.sha256,
            }
          : null,
        command: `${remoteBuildCommand}\n${activateCommand}\n${stateCommand}\n${frameCommand}`,
        commandResults,
        code: failure ? 1 : 0,
        output,
        summary: failure
          ? failure.summary
          : "已同步到核桃派。Web 预览和设备运行使用同一个 screen manifest。",
        failedStage: failure?.stage || null,
      };
    },
  };
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

function visualStatus(manifest, artifactHashValid, frameEvidence, validSha256) {
  const frameCaptured = validFrameEvidence(frameEvidence, validSha256);
  const target = manifest.target || {};
  const visualChecks = {
    manifestHashMatched: true,
    artifactHashValid,
    frameCaptured,
    frameDimensionsMatched: frameCaptured
      && frameEvidence.width === target.width
      && frameEvidence.height === target.height,
    framePixelFormatMatched: frameCaptured
      && target.color === "RGB565"
      && (frameEvidence.pixelFormat === "RGB565_LE" || frameEvidence.bitsPerPixel === 16),
    frameByteLengthMatched: frameCaptured
      && Number.isInteger(frameEvidence.expectedByteLength)
      && frameEvidence.expectedByteLength === frameEvidence.byteLength,
    frameNonblank: frameCaptured
      && frameEvidence.isBlank === false
      && Number(frameEvidence.nonzeroBytes || 0) > 0,
  };
  if (!frameCaptured) {
    return { visualMatch: "unknown", visualChecks };
  }
  return {
    visualMatch: Object.values(visualChecks).every(Boolean) ? "captured" : "mismatch",
    visualChecks,
  };
}

function firstFailure(buildResult, artifactHash, activateResult, stateResult, frameResult, frameEvidence, visual, validSha256) {
  if (!buildResult.ok) {
    return {
      stage: "build",
      summary: "LVGL 构建失败。请在诊断里查看第一处编译错误。",
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
      summary: "屏幕画面回证和目标屏幕约束不一致。请在诊断里查看 frame checks。",
    };
  }
  return null;
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

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

      const visual = visualStatus({
        manifest,
        manifestHash,
        artifactHash: artifactHashValid ? artifactHash : null,
        artifactHashValid,
        frameEvidence,
        validSha256,
        sha256,
        stableStringify,
      });
      const pixelEvidence = screenPixelEvidence({ frameEvidence, validSha256, sha256, stableStringify });
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
        semantic: visual.semantic,
        pixelEvidence,
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

function screenPixelEvidence({ frameEvidence, validSha256, sha256, stableStringify }) {
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

  return {
    schema: "walnutpi.screenPixelEvidence.v1",
    status: "metadata-only",
    claim: "framebuffer-captured-not-pixel-diffed",
    frameHash: frameEvidence.sha256 || null,
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
      "Web preview pixels are not rendered and compared in this slice.",
      "LVGL may be dynamic, so diagnostic PNG can be later than sync-time raw frame.",
    ],
  };
}

function screenPreviewSignature(manifest) {
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  return {
    schema: "walnutpi.screenPreviewSignature.v1",
    target: {
      width: manifest.target?.width ?? null,
      height: manifest.target?.height ?? null,
      color: manifest.target?.color ?? null,
      display: manifest.target?.display ?? null,
    },
    title: manifest.title || "",
    subtitle: manifest.subtitle || "",
    pages: pages.map((page) => ({
      id: page.id || "",
      tab: page.tab || "",
      title: page.title || "",
      status: page.status || "",
      metrics: Array.isArray(page.metrics) ? page.metrics : [],
      lines: Array.isArray(page.lines) ? page.lines : [],
    })),
  };
}

function screenDeviceSignature({ manifest, manifestHash, artifactHash, frameEvidence }) {
  return {
    schema: "walnutpi.screenDeviceSignature.v1",
    manifestHash,
    artifactHash: artifactHash || null,
    target: {
      width: manifest.target?.width ?? null,
      height: manifest.target?.height ?? null,
      color: manifest.target?.color ?? null,
      display: manifest.target?.display ?? null,
    },
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

function visualStatus({ manifest, manifestHash, artifactHash, artifactHashValid, frameEvidence, validSha256, sha256, stableStringify }) {
  const frameCaptured = validFrameEvidence(frameEvidence, validSha256);
  const target = manifest.target || {};
  const previewSignature = screenPreviewSignature(manifest);
  const deviceSignature = screenDeviceSignature({ manifest, manifestHash, artifactHash, frameEvidence });
  const previewSignatureHash = sha256(stableStringify(previewSignature));
  const deviceSignatureHash = sha256(stableStringify(deviceSignature));
  const targetMatched = frameCaptured
    && frameEvidence.width === target.width
    && frameEvidence.height === target.height
    && target.color === "RGB565"
    && (frameEvidence.pixelFormat === "RGB565_LE" || frameEvidence.bitsPerPixel === 16);
  const artifactCommittedToManifest = artifactHashValid
    && validSha256(artifactHash)
    && manifestHash === deviceSignature.manifestHash;
  const visualChecks = {
    manifestHashMatched: true,
    artifactHashValid,
    previewSignatureHash,
    deviceSignatureHash,
    semanticManifestMatched: manifestHash === deviceSignature.manifestHash,
    targetMatched,
    artifactCommittedToManifest,
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
  const semantic = {
    previewSignatureHash,
    deviceSignatureHash,
    previewSignature,
    deviceSignature,
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

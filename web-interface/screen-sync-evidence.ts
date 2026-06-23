export function buildScreenSyncEvidence({
  playlistEnvelope,
  playlistHash,
  artifactHash,
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
  stageResults,
}) {
  const visual = workspaceVisualStatus({
    playlistEnvelope,
    playlistHash,
    artifactHash: artifactHashValid ? artifactHash : null,
    artifactHashValid,
    frameEvidence,
    validSha256,
    sha256,
    stableStringify,
    fullEvidence,
  });
  const frameContentEvidence = workspaceFrameContentEvidence({
    playlistEnvelope,
    frameEvidence,
    validSha256,
    sha256,
    stableStringify,
  });
  const frameImageUrl = validFrameEvidence(frameEvidence, validSha256) ? frameUrl(buildId) : null;
  const failure = firstWorkspaceFailure({
    ...stageResults,
    artifactHash,
    frameEvidence,
    visual,
    validSha256,
    fullEvidence,
  });
  const screenEvidence = {
    kind: "screen-workspace-playlist-frame",
    visualMatch: visual.visualMatch,
    visualChecks: visual.visualChecks,
    semantic: visual.semantic,
    frameContentEvidence,
    playlistEvidence: {
      schema: "walnutpi.screenWorkspacePlaylistEvidence.v1",
      playlistHash,
      activeItem: visual.semantic.activeItem,
      itemManifestHash: visual.semantic.activeItem?.manifestHash || null,
      expectedRgb565FrameHash: visual.semantic.activeItem?.expectedRgb565FrameHash || null,
      displayedFrameHash: frameEvidence?.sha256 || null,
    },
    state: {
      kind: "screen-state",
      command: stateCommand || "hot-reload service-active check",
      output: stateResult.output,
      capturedAt: new Date().toISOString(),
    },
    frame: validFrameEvidence(frameEvidence, validSha256)
      ? { ...frameEvidence, url: frameImageUrl }
      : {
          command: frameCommand || "skipped: fast sync evidence",
          output: frameResult.output,
          capturedAt: new Date().toISOString(),
        },
  };
  return { visual, frameContentEvidence, frameImageUrl, failure, screenEvidence };
}

export function parseFrameEvidence(result) {
  if (!result.ok) return null;
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

export function validFrameEvidence(frame, validSha256) {
  return Boolean(
    frame
      && typeof frame === "object"
      && validSha256(frame.sha256)
      && Number.isInteger(frame.byteLength)
      && frame.byteLength > 0
      && (!Number.isInteger(frame.expectedByteLength) || frame.expectedByteLength === frame.byteLength),
  );
}

function screenFrameContentEvidence({ frameEvidence, expectedRgb565FrameHashes = [], validSha256, sha256, stableStringify }) {
  if (!validFrameEvidence(frameEvidence, validSha256)) {
    return {
      schema: "walnutpi.screenFrameContentEvidence.v1",
      status: "missing-frame",
      claim: "framebuffer-not-captured",
      frameHash: null,
      sampleHash: null,
      nonzeroRatio: null,
      capture: null,
      limitations: [
        "Framebuffer frame metadata was not valid for frame evidence.",
        "Web preview frame content is not rendered and compared in this slice.",
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
  const expectedHashes = expectedRgb565FrameHashes.filter((hash) => validSha256(hash));
  const rgb565HashMatched = expectedHashes.length > 0 && expectedHashes.includes(frameEvidence.sha256);
  const status = expectedHashes.length === 0 ? "metadata-only" : rgb565HashMatched ? "matched" : "mismatch";
  const claim = expectedHashes.length === 0
    ? "framebuffer-captured-not-frame-diffed"
    : rgb565HashMatched
      ? "framebuffer-rgb565-hash-matched"
      : "framebuffer-rgb565-hash-mismatch";

  return {
    schema: "walnutpi.screenFrameContentEvidence.v1",
    status,
    claim,
    frameHash: frameEvidence.sha256 || null,
    expectedRgb565FrameHashes: expectedHashes,
    rgb565HashMatched: expectedHashes.length > 0 ? rgb565HashMatched : null,
    sampleHash,
    nonzeroRatio,
    capture: {
      width: frameEvidence.width ?? null,
      height: frameEvidence.height ?? null,
      frameFormat: frameEvidence.frameFormat || null,
      bitsPerFrameUnit: frameEvidence.bitsPerFrameUnit ?? null,
      byteLength: frameEvidence.byteLength ?? null,
      expectedByteLength: frameEvidence.expectedByteLength ?? null,
      isBlank: frameEvidence.isBlank ?? null,
    },
    limitations: [
      ...(expectedHashes.length > 0 ? [] : ["No expected RGB565 frame hash was available for this frame evidence."]),
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
      rgb565FrameSha256: item.output?.type === "static"
        ? item.output.rgb565FrameSha256
        : item.output?.frames?.[0]?.rgb565FrameSha256 || null,
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
          frameFormat: frameEvidence.frameFormat || null,
          bitsPerFrameUnit: frameEvidence.bitsPerFrameUnit ?? null,
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
      expectedRgb565FrameHash: frame?.rgb565FrameSha256 || null,
      durationMs: item.output?.type === "animated" ? frame?.durationMs || item.durationMs : item.durationMs,
      repeat: item.repeat,
    })).filter((candidate) => candidate.expectedRgb565FrameHash);
  });
}

function workspaceMatchedDisplayItem(playlistEnvelope, frameEvidence, validSha256) {
  const candidates = workspaceFrameCandidates(playlistEnvelope);
  const matched = validFrameEvidence(frameEvidence, validSha256)
    ? candidates.find((candidate) => candidate.expectedRgb565FrameHash === frameEvidence.sha256)
    : null;
  const selected = matched || candidates[0] || null;
  if (!selected) return null;
  return {
    ...selected,
    observed: Boolean(matched),
    expectedRgb565FrameHashes: candidates.map((candidate) => candidate.expectedRgb565FrameHash),
  };
}

function workspaceVisualStatus({ playlistEnvelope, playlistHash, artifactHash, artifactHashValid, frameEvidence, validSha256, sha256, stableStringify, fullEvidence = true }) {
  const frameCaptured = validFrameEvidence(frameEvidence, validSha256);
  const previewSignature = workspacePreviewSignature(playlistEnvelope);
  const deviceSignature = workspaceDeviceSignature({ playlistHash, artifactHash, frameEvidence });
  const previewSignatureHash = sha256(stableStringify(previewSignature));
  const deviceSignatureHash = sha256(stableStringify(deviceSignature));
  const activeItem = workspaceMatchedDisplayItem(playlistEnvelope, frameEvidence, validSha256);
  const targetMatched = frameCaptured
    && frameEvidence.width === 480
    && frameEvidence.height === 320
    && (frameEvidence.frameFormat === "RGB565_LE" || frameEvidence.bitsPerFrameUnit === 16);
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
    frameDimensionsMatched: frameCaptured && frameEvidence.width === 480 && frameEvidence.height === 320,
    frameFrameFormatMatched: frameCaptured && (frameEvidence.frameFormat === "RGB565_LE" || frameEvidence.bitsPerFrameUnit === 16),
    frameByteLengthMatched: frameCaptured
      && Number.isInteger(frameEvidence.expectedByteLength)
      && frameEvidence.expectedByteLength === frameEvidence.byteLength,
    frameNonblank: frameCaptured && frameEvidence.isBlank === false && Number(frameEvidence.nonzeroBytes || 0) > 0,
    frameRgb565HashMatched: frameCaptured
      && Array.isArray(activeItem?.expectedRgb565FrameHashes)
      && activeItem.expectedRgb565FrameHashes.includes(frameEvidence.sha256),
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
    return {
      visualMatch: fullEvidence ? "unknown" : "playlist-committed",
      visualChecks,
      semantic,
    };
  }
  return {
    visualMatch: Object.values(visualChecks).every(Boolean) ? "captured" : "mismatch",
    visualChecks,
    semantic,
  };
}

function workspaceFrameContentEvidence({ playlistEnvelope, frameEvidence, validSha256, sha256, stableStringify }) {
  const activeItem = workspaceMatchedDisplayItem(playlistEnvelope, frameEvidence, validSha256);
  const evidence = screenFrameContentEvidence({
    frameEvidence,
    expectedRgb565FrameHashes: activeItem?.expectedRgb565FrameHashes || [],
    validSha256,
    sha256,
    stableStringify,
  });
  return {
    ...evidence,
    schema: "walnutpi.screenWorkspaceFrameContentEvidence.v1",
    expectedRgb565FrameHash: activeItem?.expectedRgb565FrameHash || null,
    expectedRgb565FrameHashes: activeItem?.expectedRgb565FrameHashes || [],
    activeManifestHash: activeItem?.manifestHash || null,
    activeItemObserved: Boolean(activeItem?.observed),
    limitations: [
      ...(evidence.limitations || []),
      ...(activeItem?.observed
        ? []
        : ["The active playlist item could not be observed from the framebuffer hash; the first playlist frame was used as comparison context."]),
    ],
  };
}

function firstWorkspaceFailure({ sliceResult, buildResult, validateResult, artifactHash, activateResult, stateResult, frameResult, frameEvidence, visual, validSha256, fullEvidence = true }) {
  if (!sliceResult.ok) return { stage: "workspace-slice", summary: "Screen Workspace 播放列表片段写入核桃派失败。请检查 SSH 连接和远端项目目录权限。" };
  if (!buildResult.ok) return { stage: "build", summary: "LVGL workspace 播放列表构建失败。请在诊断里查看第一处编译错误。" };
  if (!validateResult.ok) return { stage: "artifact", summary: "核桃派上的 LVGL runtime 或 screen/runtime/default.txt 没有匹配当前 Screen Workspace playlist。请查看诊断里的 runtime validation。" };
  if (!validSha256(artifactHash)) return { stage: "artifact", summary: "LVGL 产物哈希校验失败。请在诊断里确认构建产物是否存在。" };
  if (!activateResult.ok) return { stage: "activate", summary: "核桃派屏幕激活失败。请确认 walnut-screen.service 已安装并允许 sudo 执行。" };
  if (!stateResult.ok) return { stage: "evidence", summary: "屏幕状态回证失败。请检查 SSH 连接和 walnut screen state 输出。" };
  const serviceState = screenServiceState(stateResult.output);
  if (serviceState && serviceState !== "active") return { stage: "activate", summary: `核桃派屏幕服务仍是 ${serviceState}，未确认真机显示已激活。请运行 sudo -n walnut screen start，并查看 journalctl -u walnut-screen.service。` };
  if (!fullEvidence) return null;
  if (!frameResult.ok || !validFrameEvidence(frameEvidence, validSha256)) return { stage: "frame", summary: "屏幕画面回证失败。请在诊断里查看 framebuffer 读取结果。" };
  if (visual.visualMatch !== "captured") return { stage: "visual", summary: "屏幕画面回证和 Screen Workspace playlist 约束不一致。请在诊断里查看 frame checks。" };
  return null;
}

export function screenServiceState(output) {
  const match = String(output || "").match(/\bwalnut-screen\.service\s+(active|inactive|failed|activating|deactivating|unknown)\b/);
  return match?.[1] || null;
}

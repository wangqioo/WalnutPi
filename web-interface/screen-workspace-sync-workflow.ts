type SyncRequestBody = {
  evidenceMode?: string;
  playlistHash?: string;
};

export function createScreenWorkspaceSyncWorkflow({
  readPlaylistEnvelope,
  deliveryAdapter,
  rememberFrameTicket,
  validSha256,
  newBuildId,
  now = () => new Date(),
}) {
  return {
    async run({ requestJson, mode = "remote" }) {
      const startedAt = now();
      const buildId = newBuildId(startedAt);
      const risk = mode === "preview" ? "preview" : "write-low";

      let envelope;
      try {
        envelope = await readPlaylistEnvelope();
      } catch (error) {
        return {
          status: 500,
          commandResults: {},
          result: playlistFailureResult({
            buildId,
            startedAt,
            risk,
            mode,
            output: error.message,
          }),
        };
      }

      const baseResult = {
        title: "同步播放列表到核桃派",
        buildId,
        startedAt: startedAt.toISOString(),
        manifest: null,
        manifestHash: null,
        playlist: envelope.playlist,
        playlistHash: envelope.playlistHash,
        workspaceRoot: envelope.workspaceRoot,
      };

      let body: SyncRequestBody = {};
      try {
        body = await requestJson();
      } catch {
        if (mode === "preview") body = {};
        else {
          return {
            status: 400,
            commandResults: {},
            result: {
              ...baseResult,
              ...preDeliveryFailure({
                risk,
                mode,
                summary: "同步请求缺少有效的 playlist hash，请刷新播放列表后再同步。",
                output: "request body is not valid JSON",
              }),
            },
          };
        }
      }

      const clientPlaylistHash = typeof body.playlistHash === "string" ? body.playlistHash : null;

      if (mode === "preview") {
        return {
          status: 403,
          commandResults: {},
          result: {
            ...baseResult,
            ok: false,
            risk,
            mode,
            deliveryManifest: null,
            deliveryHash: null,
            artifactHash: null,
            evidence: null,
            screenEvidence: null,
            screenFrameUrl: null,
            code: 1,
            output: `preview mode disables SSH, build, delivery, activation, and device writes\nclient=${clientPlaylistHash || "(missing)"}\nserver=${envelope.playlistHash}`,
            summary: "预览模式下不会连接核桃派。",
            failedStage: "preview",
          },
        };
      }

      if (!validSha256(clientPlaylistHash)) {
        return {
          status: 400,
          commandResults: {},
          result: {
            ...baseResult,
            ...preDeliveryFailure({
              risk,
              mode,
              summary: clientPlaylistHash
                ? "同步请求包含无效的 playlist hash，请刷新播放列表后再同步。"
                : "同步请求缺少 playlist hash，请刷新播放列表后再同步。",
              output: `client=${clientPlaylistHash || "(missing)"}\nserver=${envelope.playlistHash}`,
            }),
          },
        };
      }

      if (clientPlaylistHash !== envelope.playlistHash) {
        return {
          status: 409,
          commandResults: {},
          result: {
            ...baseResult,
            ...preDeliveryFailure({
              risk,
              mode,
              summary: "Web 预览和服务器 Screen Workspace playlist 不一致，请刷新后再同步。",
              output: `client=${clientPlaylistHash}\nserver=${envelope.playlistHash}`,
            }),
          },
        };
      }

      const evidenceMode = normalizeEvidenceMode(body.evidenceMode);
      const deliveryStartedAt = now();
      const delivery = await runDelivery({
        deliveryAdapter,
        buildId,
        playlistEnvelope: envelope,
        evidenceMode,
      });
      if (delivery.frameTicket) {
        rememberFrameTicket(buildId, delivery.frameTicket);
      }

      return {
        status: 200,
        commandResults: delivery.commandResults,
        result: {
          ...baseResult,
          ok: delivery.ok,
          risk: delivery.risk,
          mode: delivery.mode,
          deliveryManifest: delivery.deliveryManifest,
          deliveryHash: delivery.deliveryHash,
          artifactHash: delivery.artifactHash,
          evidence: delivery.screenEvidence,
          screenEvidence: delivery.screenEvidence,
          screenFrameUrl: delivery.screenFrameUrl,
          code: delivery.code,
          output: delivery.output,
          summary: delivery.summary,
          failedStage: delivery.failedStage,
          remoteExecution: delivery.remoteExecution || null,
          segments: {
            deliveryMs: now().getTime() - deliveryStartedAt.getTime(),
          },
        },
      };
    },
  };
}

function playlistFailureResult({ buildId, startedAt, risk, mode, output }) {
  return {
    title: "同步播放列表到核桃派",
    buildId,
    startedAt: startedAt.toISOString(),
    manifest: null,
    manifestHash: null,
    playlist: null,
    playlistHash: null,
    ok: false,
    risk,
    mode,
    failedStage: "playlist",
    deliveryManifest: null,
    deliveryHash: null,
    artifactHash: null,
    evidence: null,
    screenEvidence: null,
    screenFrameUrl: null,
    code: 1,
    summary: "Screen Workspace playlist 无法读取或格式无效，请先生成播放列表。",
    output,
  };
}

function preDeliveryFailure({ risk, mode, summary, output }) {
  return {
    ok: false,
    risk,
    mode,
    failedStage: "playlist",
    deliveryManifest: null,
    deliveryHash: null,
    artifactHash: null,
    evidence: null,
    screenEvidence: null,
    screenFrameUrl: null,
    code: 1,
    summary,
    output,
  };
}

function normalizeEvidenceMode(value) {
  return value === "full" ? "full" : "fast";
}

async function runDelivery({ deliveryAdapter, buildId, playlistEnvelope, evidenceMode }) {
  try {
    return await deliveryAdapter.deliverWorkspacePlaylist({ buildId, playlistEnvelope, evidenceMode });
  } catch (error) {
    return {
      ok: false,
      risk: "write-low",
      mode: "remote",
      deliveryManifest: null,
      deliveryHash: null,
      artifactHash: null,
      screenEvidence: null,
      screenFrameUrl: null,
      frameTicket: null,
      commandResults: {},
      code: 1,
      output: error.stack || error.message,
      summary: "核桃派 Screen Workspace 交付适配器执行失败。请在诊断里查看错误。",
      failedStage: "delivery",
    };
  }
}

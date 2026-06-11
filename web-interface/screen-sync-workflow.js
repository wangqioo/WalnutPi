export function createScreenSyncWorkflow({
  readManifestEnvelope,
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
        envelope = await readManifestEnvelope();
      } catch (error) {
        return {
          status: 500,
          commandResults: {},
          result: manifestFailureResult({
            buildId,
            startedAt,
            risk,
            mode,
            output: error.message,
          }),
        };
      }

      const { manifest, manifestHash } = envelope;
      const baseResult = {
        title: "同步到核桃派",
        buildId,
        startedAt: startedAt.toISOString(),
        manifest,
        manifestHash,
      };

      let body = {};
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
                summary: "同步请求缺少有效的 screen manifest hash，请刷新页面后再同步。",
                output: "request body is not valid JSON",
              }),
            },
          };
        }
      }

      const clientManifestHash = typeof body.manifestHash === "string" ? body.manifestHash : null;

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
            command: null,
            code: 1,
            output: `preview mode disables SSH, build, delivery, activation, and device writes\nclient=${clientManifestHash || "(missing)"}\nserver=${manifestHash}`,
            summary: "预览模式下不会连接核桃派。",
            failedStage: "preview",
          },
        };
      }

      if (!validSha256(clientManifestHash)) {
        return {
          status: 400,
          commandResults: {},
          result: {
            ...baseResult,
            ...preDeliveryFailure({
              risk,
              mode,
              summary: clientManifestHash
                ? "同步请求包含无效的 screen manifest hash，请刷新页面后再同步。"
                : "同步请求缺少 screen manifest hash，请刷新页面后再同步。",
              output: `client=${clientManifestHash || "(missing)"}\nserver=${manifestHash}`,
            }),
          },
        };
      }

      if (clientManifestHash !== manifestHash) {
        return {
          status: 409,
          commandResults: {},
          result: {
            ...baseResult,
            ...preDeliveryFailure({
              risk,
              mode,
              summary: "Web 预览和服务器 screen manifest 不一致，请刷新后再同步。",
              output: `client=${clientManifestHash}\nserver=${manifestHash}`,
            }),
          },
        };
      }

      const delivery = await runDelivery({ deliveryAdapter, buildId, manifest, manifestHash });
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
          command: delivery.command,
          code: delivery.code,
          output: delivery.output,
          summary: delivery.summary,
          failedStage: delivery.failedStage,
        },
      };
    },
  };
}

function manifestFailureResult({ buildId, startedAt, risk, mode, output }) {
  return {
    title: "同步到核桃派",
    buildId,
    startedAt: startedAt.toISOString(),
    manifest: null,
    manifestHash: null,
    ok: false,
    risk,
    mode,
    failedStage: "manifest",
    deliveryManifest: null,
    deliveryHash: null,
    artifactHash: null,
    evidence: null,
    screenEvidence: null,
    screenFrameUrl: null,
    command: null,
    code: 1,
    summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
    output,
  };
}

function preDeliveryFailure({ risk, mode, summary, output }) {
  return {
    ok: false,
    risk,
    mode,
    failedStage: "manifest",
    deliveryManifest: null,
    deliveryHash: null,
    artifactHash: null,
    evidence: null,
    screenEvidence: null,
    screenFrameUrl: null,
    command: null,
    code: 1,
    summary,
    output,
  };
}

async function runDelivery({ deliveryAdapter, buildId, manifest, manifestHash }) {
  try {
    return await deliveryAdapter.deliver({ buildId, manifest, manifestHash });
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
      command: null,
      commandResults: {},
      code: 1,
      output: error.stack || error.message,
      summary: "核桃派交付适配器执行失败。请在诊断里查看错误。",
      failedStage: "delivery",
    };
  }
}

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeScreenManifest } from "../scripts/screen-manifest-vocabulary.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value) {
  return typeof value === "string" && value.length >= 12 ? value.slice(0, 12) : null;
}

function firstDiagnosticLine(value) {
  const text = String(value || "");
  const preferred = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /error|failed|fatal|denied|missing|not found|permission|timeout|cmake|make|gcc|sudo/i.test(line));
  if (preferred) return preferred.slice(0, 500);
  const fallback = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return fallback ? fallback.slice(0, 500) : "";
}

function repairCommandOutput(record, commandName) {
  return record.commandResults?.[commandName]?.output || "";
}

function repairCandidateAction(kind, label, detail) {
  return { kind, label, detail };
}

function repairCandidateBase(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  return {
    schema: "walnutpi.screenRepairCandidate.v1",
    buildId: record.buildId,
    stage,
    confidence: "low",
    beginnerSummary: record.summary || "同步记录需要人工检查。",
    developerDiagnosis: firstDiagnosticLine(record.output) || record.output || "missing diagnostic output",
    proposedActions: [],
    requiresConfirmation: true,
    canAutoApply: false,
    autoApplyReason: "第一版只生成修复候选方案，不自动修改文件或触发设备动作。",
  };
}

export function createScreenEvidenceReview({ screenManifestPath, projectRoot }) {
  function buildRepairHint(record) {
    const stage = record.failedStage || (record.ok ? "ok" : "unknown");
    const visualChecks = record.screenEvidence?.visualChecks || null;
    const commandByStage = {
      "screen-slice": "screen-slice",
      build: "build",
      validate: "validate",
      artifact: "artifact",
      activate: "activate",
      evidence: "evidence",
      frame: "frame",
      visual: "frame",
    };
    const commandName = commandByStage[stage] || "";
    const firstError = firstDiagnosticLine(commandName ? repairCommandOutput(record, commandName) : record.output);
    const baseEvidence = {
      buildId: record.buildId,
      failedStage: stage,
      command: commandName || null,
      firstError,
      visualMatch: record.screenEvidence?.visualMatch || "unknown",
      visualChecks,
    };

    const plans = {
      ok: {
        title: "不需要修复",
        summary: "这条同步记录已经成功。",
        beginnerReason: "核桃派已经完成同步。",
        developerDiagnosis: "record.ok=true，没有失败阶段。",
        suggestedActions: ["继续编辑小屏内容，或查看开发者诊断里的同步证据。"],
      },
      preview: {
        title: "预览模式不会同步",
        summary: "当前页面处于预览模式，所以不会连接核桃派。",
        beginnerReason: "预览模式只看 Web 效果，不会构建、SSH、激活或写设备。",
        developerDiagnosis: "URL 带有 ?nossh，后端在 sync 前返回 preview 阶段。",
        suggestedActions: ["去掉 URL 里的 ?nossh 后再点击同步。", "如果只想本地预览，可以忽略这条失败记录。"],
      },
      manifest: {
        title: "小屏配置需要刷新或修复",
        summary: "同步请求里的 screen manifest 不可用或已经过期。",
        beginnerReason: "Web 预览和服务器上的小屏配置不是同一个版本。",
        developerDiagnosis: firstError || "manifest 读取失败、JSON 无效、hash 缺失、hash 格式错误或 stale manifestHash。",
        suggestedActions: ["刷新页面，重新读取当前小屏预览。", "如果仍失败，检查 lvgl_app/screen-manifest.json 是否是有效 JSON。", "确认同步请求带的是最新 manifestHash。"],
      },
      "screen-slice": {
        title: "小屏程序下发失败",
        summary: "当前 Web 的小屏构建片段没有成功写到核桃派。",
        beginnerReason: "核桃派还没有拿到这次预览对应的小屏程序文件。",
        developerDiagnosis: firstError || "screen-slice 阶段没有成功写入 LVGL 源码、构建脚本、生成器或 manifest。",
        suggestedActions: ["检查 SSH 连接和远端 /home/pi/projects/WalnutPi 写入权限。", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向真实 checkout。", "修复权限后重新同步。"],
      },
      build: {
        title: "LVGL 构建失败",
        summary: "设备端没有成功编译小屏程序。",
        beginnerReason: "核桃派还没有生成可以运行的小屏程序。",
        developerDiagnosis: firstError || "构建命令没有返回可识别的第一处错误。",
        suggestedActions: ["先查看 command output 里的 build 段第一处错误。", "如果提示缺少 cmake、gcc、make 或系统头文件，在设备上运行 scripts/install-lvgl-build-deps.sh。", "如果是 C 编译错误，先修复 lvgl_app/src/main.c 或生成的 screen_config.h。"],
      },
      artifact: {
        title: "构建产物不可用",
        summary: "构建后没有拿到绑定当前预览的 LVGL 程序。",
        beginnerReason: "同步需要确认小屏程序文件真实存在，而且就是这次 Web 预览对应的版本。",
        developerDiagnosis: firstError || "artifact/validate 没有返回合法 SHA-256，或二进制没有包含当前 manifest hash。",
        suggestedActions: ["确认 lvgl_app/generated/screen_config.h 包含当前 manifest hash。", "确认 build/lvgl_app/walnut-lvgl-screen 存在且 strings 能看到当前 manifest hash。", "检查远端项目根是否指向 /home/pi/projects/WalnutPi。"],
      },
      activate: {
        title: "屏幕服务激活失败",
        summary: "程序已构建，但没有成功启动核桃派屏幕服务。",
        beginnerReason: "核桃派没有把新的小屏程序启动起来。",
        developerDiagnosis: firstError || "sudo -n systemctl restart walnut-screen.service 没有成功。",
        suggestedActions: ["确认 walnut screen start 在设备上可运行。", "检查 sudo -n 是否允许当前 SSH 用户启动 walnut-screen.service。", "查看 walnut-screen.service 状态和日志。"],
      },
      evidence: {
        title: "屏幕状态回证失败",
        summary: "屏幕启动后，状态命令没有返回可信证据。",
        beginnerReason: "系统无法确认屏幕服务是否真的在运行。",
        developerDiagnosis: firstError || "walnut screen state 没有成功。",
        suggestedActions: ["在设备上运行 walnut screen state 查看状态。", "确认 walnut-screen.service 存在且 active。", "如果服务刚启动，稍等几秒后重新同步。"],
      },
      frame: {
        title: "屏幕画面回证失败",
        summary: "无法读取到有效的 framebuffer 画面证据。",
        beginnerReason: "系统没有看到核桃派真实屏幕画面。",
        developerDiagnosis: firstError || "sudo -n walnut screen frame 没有返回合法 frame 元数据。",
        suggestedActions: ["确认 /dev/fb0 可读，且 walnut screen frame 能返回 JSON 元数据。", "确认 walnut-screen.service 正在占用小屏，而不是被其他 framebuffer 程序覆盖。", "检查 sudo -n walnut screen frame 权限。"],
      },
      visual: {
        title: "屏幕画面结构不一致",
        summary: "framebuffer 可读，但尺寸、格式、字节数或非空检查没有通过。",
        beginnerReason: "核桃派返回了画面，但不像当前目标小屏画面。",
        developerDiagnosis: visualChecks ? JSON.stringify(visualChecks, null, 2) : firstError || "visual checks 不完整。",
        suggestedActions: ["确认目标屏幕仍是 480x320 RGB565。", "确认 framebuffer 返回的 byteLength 等于 expectedByteLength。", "如果 frame 是空白，重启 walnut-screen.service 后再同步。"],
      },
      delivery: {
        title: "交付适配器失败",
        summary: "同步流程在 delivery adapter 内部异常退出。",
        beginnerReason: "同步程序自己出错了，还没有进入完整的构建和回证流程。",
        developerDiagnosis: firstError || record.output || "adapter exception without output",
        suggestedActions: ["查看 command output 里的异常堆栈。", "确认 sshpass、SSH 配置和 adapter 参数可用。", "修复 adapter 错误后重新同步。"],
      },
      unknown: {
        title: "同步失败原因不明确",
        summary: "同步记录没有提供明确的失败阶段。",
        beginnerReason: "系统知道同步失败，但还不能判断具体卡在哪里。",
        developerDiagnosis: firstError || record.output || "missing failedStage",
        suggestedActions: ["查看 developer diagnostics 里的 command output。", "保留 buildId，按输出里最早失败的命令继续排查。"],
      },
    };

    const selected = plans[stage] || plans.unknown;
    return {
      schema: "walnutpi.screenRepairHint.v1",
      buildId: record.buildId,
      stage,
      title: selected.title,
      summary: selected.summary,
      beginnerReason: selected.beginnerReason,
      developerDiagnosis: selected.developerDiagnosis,
      suggestedActions: selected.suggestedActions,
      evidence: baseEvidence,
      autoRepairAvailable: false,
    };
  }

  function buildRepairCandidate(record) {
    const hint = record.repairHint || buildRepairHint(record);
    const candidate = {
      ...repairCandidateBase(record),
      stage: hint.stage,
      beginnerSummary: hint.beginnerReason || hint.summary,
      developerDiagnosis: hint.developerDiagnosis,
    };
    const action = repairCandidateAction;
    const stagePlans = {
      ok: { confidence: "high", actions: [action("manual-check", "不需要修复", "这条同步记录已经成功，可以继续编辑小屏内容。")] },
      preview: { confidence: "high", actions: [action("refresh-and-retry", "退出预览模式", "去掉 URL 里的 ?nossh 后重新打开页面，再手动点击同步。")] },
      manifest: {
        confidence: "high",
        actions: [
          action("refresh-and-retry", "刷新小屏预览", "重新读取 /api/screen/manifest，确保同步请求携带最新 manifestHash。"),
          action("local-edit-plan", "检查 manifest JSON", "检查 lvgl_app/screen-manifest.json 是否是合法 JSON，schema 是否仍是 walnutpi.screen.v1。"),
        ],
      },
      "screen-slice": {
        confidence: "medium",
        actions: [
          action("device-check", "检查远端项目权限", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向真实 checkout，且构建用户可以写入 lvgl_app 和 scripts。"),
          action("manual-check", "查看 screen-slice 输出", "在开发者诊断 command output 的 screen-slice 段查看最早失败的 install、base64 或 chmod 行。"),
        ],
      },
      build: {
        confidence: "medium",
        actions: [
          action("manual-check", "查看 build 段第一处错误", "在开发者诊断 command output 的 build 段查找第一条 error、failed、fatal 或 permission 行。"),
          action("local-edit-plan", "检查生成配置和 LVGL 源码", "如果是 C 或生成头文件错误，检查 lvgl_app/generated/screen_config.h 和 lvgl_app/src/main.c。"),
        ],
      },
      artifact: {
        confidence: "medium",
        actions: [
          action("device-check", "检查 LVGL 产物", "确认远端 build/lvgl_app/walnut-lvgl-screen 存在且可执行，并包含当前 manifest hash。"),
          action("manual-check", "确认远端项目根", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向 /home/pi/projects/WalnutPi 或真实 checkout。"),
        ],
      },
      activate: {
        confidence: "medium",
        actions: [
          action("device-check", "检查屏幕服务", "确认 walnut-screen.service 已安装，且 sudo -n systemctl restart walnut-screen.service 可以运行。"),
          action("manual-check", "查看服务日志", "在设备上查看 walnut-screen.service 状态和最近日志，定位启动失败原因。"),
        ],
      },
      evidence: {
        confidence: "medium",
        actions: [
          action("device-check", "检查屏幕状态命令", "在设备上运行 walnut screen state，确认 walnut-screen.service 是 active。"),
          action("refresh-and-retry", "等待后重新同步", "如果服务刚启动，等待几秒后手动重新同步。"),
        ],
      },
      frame: {
        confidence: "medium",
        actions: [
          action("device-check", "检查 framebuffer 证据命令", "在设备上运行 sudo -n walnut screen frame，确认返回 JSON 元数据。"),
          action("manual-check", "检查 /dev/fb0 权限", "确认 /dev/fb0 可读，且没有其他 framebuffer 程序覆盖小屏。"),
        ],
      },
      visual: {
        confidence: "medium",
        actions: [
          action("manual-check", "检查画面结构字段", "查看 visualChecks，确认 480x320、RGB565、byteLength 和 nonblank 检查是否通过。"),
          action("device-check", "检查是否空白帧", "如果 frameNonblank=false，确认 walnut-screen.service 是否真的在绘制当前 LVGL 程序。"),
        ],
      },
      delivery: {
        confidence: "medium",
        actions: [
          action("manual-check", "查看 adapter 异常", "查看 command output 里的异常堆栈或 adapter 参数错误。"),
          action("manual-check", "检查 SSH 工具和参数", "确认 sshpass、SSH_HOST、SSH_USER、WALNUT_REMOTE_PROJECT_ROOT 和 WALNUT_REMOTE_BUILD_USER 配置可用。"),
        ],
      },
      unknown: { confidence: "low", actions: [action("manual-check", "按最早失败输出排查", "保留 buildId，查看 command output 中最早出现的 error、failed、fatal、permission 或 timeout 行。")] },
    };
    const plan = stagePlans[candidate.stage] || stagePlans.unknown;
    candidate.confidence = plan.confidence;
    candidate.proposedActions = plan.actions;
    candidate.evidence = candidate.stage === "ok" ? { ...hint.evidence, firstError: "" } : hint.evidence;
    return candidate;
  }

  function repairConfirmationPhrase(buildId) {
    return `APPLY SCREEN REPAIR ${buildId}`;
  }

  function buildRepairProposal(record) {
    const repairCandidate = buildRepairCandidate(record);
    const confirmationPhrase = repairConfirmationPhrase(record.buildId);
    const repairTargetPath = path.resolve(screenManifestPath);
    const root = path.resolve(projectRoot);
    const repairTargetInsideProject = repairTargetPath === root || repairTargetPath.startsWith(`${root}${path.sep}`);
    const repairRelativePath = path.relative(projectRoot, repairTargetPath).replace(/\\/g, "/");
    const base = {
      schema: "walnutpi.screenRepairProposal.v1",
      buildId: record.buildId,
      stage: repairCandidate.stage,
      title: "屏幕修复提案",
      summary: "当前没有可安全自动应用的本地补丁。",
      canApply: false,
      requiresConfirmation: true,
      confirmationPhrase,
      proposedPatch: null,
      notes: [
        "生成修复提案不会 SSH、构建、激活、抓图、写文件或重新同步。",
        "只有输入精确确认短语后，才允许应用本地文件补丁。",
      ],
    };

    if (!repairTargetInsideProject) {
      return { ...base, notes: [...base.notes, "当前 screen manifest 路径不在项目目录内，不能生成可应用补丁。"] };
    }

    if (repairCandidate.stage === "manifest" && record.manifest) {
      const manifest = normalizeScreenManifest(record.manifest);
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      return {
        ...base,
        summary: "可以把这条记录中的 screen manifest 写回本地 manifest 文件，然后重新预览并手动同步。",
        canApply: true,
        proposedPatch: {
          schema: "walnutpi.screenRepairPatch.v1",
          kind: "replace-file",
          risk: "write-low",
          path: repairRelativePath,
          bytes: Buffer.byteLength(manifestText, "utf8"),
          sha256: sha256(manifestText),
          preview: manifestText.slice(0, 4000),
        },
        notes: [...base.notes, "应用后只更新本地 manifest 文件，不会自动构建、连接核桃派或重新同步。"],
      };
    }

    return { ...base, notes: [...base.notes, "这条记录的失败阶段不适合自动生成本地补丁，请按 repairCandidate 的建议人工处理。"] };
  }

  function summaryEvidence(record) {
    const stage = record.failedStage || (record.ok ? "ok" : "unknown");
    const commandByStage = { build: "build", artifact: "artifact", activate: "activate", evidence: "evidence", frame: "frame", visual: "frame" };
    const commandName = commandByStage[stage] || "";
    const repairCandidate = buildRepairCandidate(record);
    return {
      buildId: record.buildId,
      ok: Boolean(record.ok),
      failedStage: record.failedStage || null,
      summary: record.summary || "",
      manifestHashShort: shortHash(record.manifestHash),
      artifactHashShort: shortHash(record.artifactHash),
      deliveryHashShort: shortHash(record.deliveryHash),
      visualMatch: record.screenEvidence?.visualMatch || "unknown",
      visualChecks: record.screenEvidence?.visualChecks || null,
      repairHint: record.repairHint
        ? {
            stage: record.repairHint.stage,
            title: record.repairHint.title,
            summary: record.repairHint.summary,
            beginnerReason: record.repairHint.beginnerReason,
          }
        : null,
      repairCandidate: {
        stage: repairCandidate.stage,
        confidence: repairCandidate.confidence,
        beginnerSummary: repairCandidate.beginnerSummary,
        proposedActions: repairCandidate.proposedActions,
        canAutoApply: repairCandidate.canAutoApply,
      },
      firstDiagnosticLine: firstDiagnosticLine(commandName ? repairCommandOutput(record, commandName) : record.output),
    };
  }

  function localAiSummary(evidence) {
    if (evidence.ok) {
      if (evidence.visualMatch === "captured") {
        return "已同步到核桃派。设备返回了有效的小屏画面证据，Web 预览和设备运行使用同一个 screen manifest。";
      }
      return "同步记录显示已完成，但画面证据还需要在开发者诊断里确认。";
    }

    const stage = evidence.failedStage || "unknown";
    const nextAction = evidence.repairCandidate?.proposedActions?.[0]?.label
      || evidence.repairHint?.summary
      || "查看开发者诊断里的 command output";
    const reason = evidence.repairCandidate?.beginnerSummary
      || evidence.repairHint?.beginnerReason
      || evidence.summary
      || "同步失败，原因还需要进一步确认。";
    return `同步失败，卡在 ${stage} 阶段。${reason} 下一步建议：${nextAction}。`;
  }

  return {
    buildRepairHint,
    buildRepairCandidate,
    buildRepairProposal,
    summaryEvidence,
    localAiSummary,
  };
}

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSshLocalAgentAdapter } from "./screen-delivery-adapters/ssh-local-agent.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const SSH_HOST = process.env.SSH_HOST || "192.168.1.24";
const SSH_USER = process.env.SSH_USER || "root";
const SSH_PASSWORD = process.env.SSH_PASSWORD || "root";
const REMOTE_PROJECT_ROOT = process.env.WALNUT_REMOTE_PROJECT_ROOT || process.env.WALNUT_PROJECT_ROOT || "/home/pi/projects/WalnutPi";
const REMOTE_BUILD_USER = process.env.WALNUT_REMOTE_BUILD_USER || "pi";
const BASE_DIR = import.meta.dir;
const PROJECT_ROOT = path.resolve(BASE_DIR, "..");
const MODEL_FILE = "0c6390ea8b1ccf186ec099456954fd42.glb";
const SCREEN_MANIFEST_PATH = process.env.WALNUT_SCREEN_MANIFEST_PATH
  ? path.resolve(process.env.WALNUT_SCREEN_MANIFEST_PATH)
  : path.join(PROJECT_ROOT, "lvgl_app", "screen-manifest.json");
const ACTION_OUTPUT_LIMIT = 24_000;
const CAPTURE_OUTPUT_LIMIT = 1_500_000;
const SCREEN_FRAME_TICKET_TTL_MS = 10 * 60_000;
const parsedScreenRecordLimit = Number(process.env.WALNUT_SCREEN_RECORD_LIMIT || 50);
const SCREEN_RECORD_LIMIT = Number.isFinite(parsedScreenRecordLimit) && parsedScreenRecordLimit > 0
  ? Math.floor(parsedScreenRecordLimit)
  : 50;
const SCREEN_RECORDS_DIR = process.env.WALNUT_SCREEN_RECORDS_DIR || path.join(BASE_DIR, "screen-sync-records");
const AI_MODEL = process.env.WALNUT_AI_MODEL || "gpt-5.5";
const AI_BASE_URL = (process.env.WALNUT_AI_BASE_URL || "https://rehdasu.cn/v1").replace(/\/+$/, "");
const AI_API_KEY = process.env.OPENAI_API_KEY || "";
const screenFrameTickets = new Map();

const files = new Map([
  ["/", "model-terminal.html"],
  ["/model-terminal.html", "model-terminal.html"],
  ["/ssh-terminal.html", "ssh-terminal.html"],
  [`/${MODEL_FILE}`, MODEL_FILE],
]);

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
]);

function contentType(pathname) {
  const extension = pathname.match(/\.[^.]+$/)?.[0] || "";
  return mime.get(extension) || "application/octet-stream";
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

function previewOnly(url) {
  return url.searchParams.has("nossh");
}

function previewOnlyJson() {
  return json(
    {
      ok: false,
      title: "预览模式",
      failedStage: "preview",
      summary: "预览模式下不会连接核桃派。",
      output: "preview mode disables SSH, build, delivery, activation, and device writes",
    },
    403,
  );
}

async function previewOnlyScreenSyncResult(req) {
  const startedAt = new Date();
  const buildId = `screen-${startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  let envelope;
  try {
    envelope = await screenManifestEnvelope();
  } catch (error) {
    return persistScreenSyncResult({
      ok: false,
      title: "同步到核桃派",
      risk: "preview",
      mode: "preview",
      buildId,
      startedAt: startedAt.toISOString(),
      manifest: null,
      manifestHash: null,
      deliveryManifest: null,
      deliveryHash: null,
      artifactHash: null,
      evidence: null,
      screenEvidence: null,
      screenFrameUrl: null,
      command: null,
      code: 1,
      output: error.message,
      summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
      failedStage: "manifest",
    }, {}, 500);
  }
  const { manifest, manifestHash } = envelope;
  let clientManifestHash = null;
  try {
    const body = await req.json();
    clientManifestHash = typeof body.manifestHash === "string" ? body.manifestHash : null;
  } catch {
    clientManifestHash = null;
  }

  return persistScreenSyncResult({
    ok: false,
    title: "同步到核桃派",
    risk: "preview",
    mode: "preview",
    buildId,
    startedAt: startedAt.toISOString(),
    manifest,
    manifestHash,
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
  }, {}, 403);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value) {
  return typeof value === "string" && value.length >= 12 ? value.slice(0, 12) : null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function remoteBuildShell(command) {
  if (!REMOTE_BUILD_USER) return command;
  return `sudo -n -u ${shellQuote(REMOTE_BUILD_USER)} sh -lc ${shellQuote(command)}`;
}

function limitedOutput(value, limit = ACTION_OUTPUT_LIMIT) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[local] output truncated`;
}

function safeRecordId(value) {
  const text = String(value || "");
  if (!/^[a-zA-Z0-9._-]+$/.test(text) || text.includes("..") || text === "." || text.startsWith(".")) return null;
  return text;
}

function screenRecordDir(buildId) {
  const id = safeRecordId(buildId);
  if (!id) return null;
  return path.join(SCREEN_RECORDS_DIR, id);
}

function screenRecordFrameUrl(buildId) {
  return `/api/screen/records/${encodeURIComponent(buildId)}/frame.png`;
}

function compactCommandResult(result) {
  return {
    ok: Boolean(result?.ok),
    code: result?.code ?? null,
    output: limitedOutput(String(result?.output || ""), 12_000),
  };
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

function buildScreenRepairHint(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  const visualChecks = record.screenEvidence?.visualChecks || null;
  const commandByStage = {
    build: "build",
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
    build: {
      title: "LVGL 构建失败",
      summary: "设备端没有成功编译小屏程序。",
      beginnerReason: "核桃派还没有生成可以运行的小屏程序。",
      developerDiagnosis: firstError || "构建命令没有返回可识别的第一处错误。",
      suggestedActions: ["先查看 command output 里的 build 段第一处错误。", "如果提示缺少 cmake、gcc、make 或系统头文件，在设备上运行 scripts/install-lvgl-build-deps.sh。", "如果是 C 编译错误，先修复 lvgl_app/src/main.c 或生成的 screen_config.h。"],
    },
    artifact: {
      title: "构建产物不可用",
      summary: "构建后没有拿到合法的 LVGL 程序 SHA-256。",
      beginnerReason: "同步需要确认小屏程序文件真实存在，当前确认失败。",
      developerDiagnosis: firstError || "artifact command 没有返回合法 SHA-256。",
      suggestedActions: ["确认 build/lvgl_app/walnut-lvgl-screen 是否存在且可执行。", "检查远端项目根是否指向 /home/pi/projects/WalnutPi。", "重新构建后再同步。"],
    },
    activate: {
      title: "屏幕服务激活失败",
      summary: "程序已构建，但没有成功启动核桃派屏幕服务。",
      beginnerReason: "核桃派没有把新的小屏程序启动起来。",
      developerDiagnosis: firstError || "sudo -n walnut screen start 没有成功。",
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

function buildScreenRepairCandidate(record) {
  const hint = record.repairHint || buildScreenRepairHint(record);
  const candidate = {
    ...repairCandidateBase(record),
    stage: hint.stage,
    beginnerSummary: hint.beginnerReason || hint.summary,
    developerDiagnosis: hint.developerDiagnosis,
  };
  const action = repairCandidateAction;
  const stagePlans = {
    ok: {
      confidence: "high",
      actions: [
        action("manual-check", "不需要修复", "这条同步记录已经成功，可以继续编辑小屏内容。"),
      ],
    },
    preview: {
      confidence: "high",
      actions: [
        action("refresh-and-retry", "退出预览模式", "去掉 URL 里的 ?nossh 后重新打开页面，再手动点击同步。"),
      ],
    },
    manifest: {
      confidence: "high",
      actions: [
        action("refresh-and-retry", "刷新小屏预览", "重新读取 /api/screen/manifest，确保同步请求携带最新 manifestHash。"),
        action("local-edit-plan", "检查 manifest JSON", "检查 lvgl_app/screen-manifest.json 是否是合法 JSON，schema 是否仍是 walnutpi.screen.v1。"),
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
        action("device-check", "检查 LVGL 产物", "确认远端 build/lvgl_app/walnut-lvgl-screen 存在且可执行。"),
        action("manual-check", "确认远端项目根", "确认 WALNUT_REMOTE_PROJECT_ROOT 指向 /home/pi/projects/WalnutPi 或真实 checkout。"),
      ],
    },
    activate: {
      confidence: "medium",
      actions: [
        action("device-check", "检查屏幕服务", "确认 walnut-screen.service 已安装，且 sudo -n walnut screen start 可以运行。"),
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
    unknown: {
      confidence: "low",
      actions: [
        action("manual-check", "按最早失败输出排查", "保留 buildId，查看 command output 中最早出现的 error、failed、fatal、permission 或 timeout 行。"),
      ],
    },
  };
  const plan = stagePlans[candidate.stage] || stagePlans.unknown;
  candidate.confidence = plan.confidence;
  candidate.proposedActions = plan.actions;
  candidate.evidence = candidate.stage === "ok"
    ? { ...hint.evidence, firstError: "" }
    : hint.evidence;
  return candidate;
}

function screenSummaryEvidence(record) {
  const stage = record.failedStage || (record.ok ? "ok" : "unknown");
  const commandByStage = {
    build: "build",
    artifact: "artifact",
    activate: "activate",
    evidence: "evidence",
    frame: "frame",
    visual: "frame",
  };
  const commandName = commandByStage[stage] || "";
  const repairCandidate = buildScreenRepairCandidate(record);
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

function localScreenAiSummary(evidence) {
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

function parseResponsesOutput(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function callScreenSummaryAi(evidence) {
  if (!AI_API_KEY) return { text: null, error: null, apiUsed: false };
  const prompt = [
    "你是 WalnutPi Web 控制台的同步结果总结器。",
    "只根据提供的 JSON 证据总结，不要编造没有发生的动作。",
    "用中文，面向小白，最多三句话。",
    "如果同步失败，说清失败阶段和最安全的下一步。",
    "",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
  const response = await fetch(`${AI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      input: [
        { role: "system", content: "你只总结已提供的设备执行证据。" },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return { text: null, error: `API HTTP ${response.status}: ${detail.slice(0, 800)}`, apiUsed: true };
  }
  const data = await response.json();
  const text = parseResponsesOutput(data);
  return { text: text || null, error: text ? null : "API response did not include output text", apiUsed: true };
}

async function buildScreenAiSummary(record) {
  const evidence = screenSummaryEvidence(record);
  const localSummary = localScreenAiSummary(evidence);
  let source = "local";
  let summary = localSummary;
  let apiError = null;
  let apiUsed = false;

  try {
    const ai = await callScreenSummaryAi(evidence);
    apiUsed = ai.apiUsed;
    if (ai.text) {
      source = "ai";
      summary = ai.text;
    } else if (ai.error) {
      source = "ai-fallback";
      apiError = ai.error;
    }
  } catch (error) {
    source = "ai-fallback";
    apiUsed = true;
    apiError = error.message;
  }

  return {
    schema: "walnutpi.screenAiSummary.v1",
    buildId: record.buildId,
    source,
    summary,
    evidence,
    diagnostics: {
      model: apiUsed ? AI_MODEL : null,
      apiUsed,
      apiError,
    },
  };
}

function screenRecordSummary(record) {
  return {
    schema: "walnutpi.screenSyncRecordSummary.v1",
    buildId: record.buildId,
    ok: record.ok,
    title: record.title,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    failedStage: record.failedStage,
    summary: record.summary,
    manifestHash: record.manifestHash,
    artifactHash: record.artifactHash,
    deliveryHash: record.deliveryHash,
    visualMatch: record.screenEvidence?.visualMatch || "unknown",
    frameHash: record.screenEvidence?.frame?.sha256 || null,
    previewSignatureHash: record.screenEvidence?.semantic?.previewSignatureHash || null,
    deviceSignatureHash: record.screenEvidence?.semantic?.deviceSignatureHash || null,
    hasFramePng: Boolean(record.framePng),
    frameUrl: record.framePng ? screenRecordFrameUrl(record.buildId) : null,
    repairHint: record.repairHint
      ? {
          stage: record.repairHint.stage,
          title: record.repairHint.title,
          summary: record.repairHint.summary,
          autoRepairAvailable: record.repairHint.autoRepairAvailable,
        }
      : null,
  };
}

function buildScreenRecord(result, commandResults = {}) {
  const finishedAt = new Date().toISOString();
  const record = {
    schema: "walnutpi.screenSyncRecord.v1",
    buildId: result.buildId,
    title: result.title || "同步到核桃派",
    ok: Boolean(result.ok),
    risk: result.risk || "write-low",
    mode: result.mode || "remote",
    startedAt: result.startedAt,
    finishedAt,
    failedStage: result.failedStage || null,
    summary: result.summary,
    manifest: result.manifest || null,
    manifestHash: result.manifestHash || null,
    deliveryManifest: result.deliveryManifest || null,
    deliveryHash: result.deliveryHash || null,
    artifactHash: result.artifactHash || null,
    screenEvidence: result.screenEvidence || result.evidence || null,
    command: result.command || null,
    commandResults: Object.fromEntries(
      Object.entries(commandResults).map(([name, value]) => [name, compactCommandResult(value)]),
    ),
    output: limitedOutput(String(result.output || ""), ACTION_OUTPUT_LIMIT),
    framePng: null,
  };
  record.repairHint = record.ok ? null : buildScreenRepairHint(record);
  return record;
}

async function persistScreenSyncResult(result, commandResults = {}, status = 200) {
  try {
    const record = buildScreenRecord(result, commandResults);
    if (!result.repairHint) result.repairHint = record.repairHint;
    await writeScreenRecord(record);
  } catch (error) {
    result.recordWarning = `screen sync record was not saved: ${error.message}`;
  }
  return json(result, status);
}

async function writeJsonFile(filePath, value) {
  await writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(filePath, { force: true });
  await rename(`${filePath}.tmp`, filePath);
}

async function writeScreenRecord(record) {
  const dir = screenRecordDir(record.buildId);
  if (!dir) return;

  await mkdir(dir, { recursive: true });
  const summary = screenRecordSummary(record);
  await writeJsonFile(path.join(dir, "record.json"), record);
  await writeJsonFile(path.join(dir, "summary.json"), summary);
  await trimScreenRecords();
}

async function updateScreenRecord(buildId, updater) {
  const dir = screenRecordDir(buildId);
  if (!dir) return null;

  const recordPath = path.join(dir, "record.json");
  let record;
  try {
    record = JSON.parse(await readFile(recordPath, "utf8"));
  } catch {
    return null;
  }

  const nextRecord = updater(record) || record;
  await writeJsonFile(recordPath, nextRecord);
  await writeJsonFile(path.join(dir, "summary.json"), screenRecordSummary(nextRecord));
  return nextRecord;
}

async function readScreenRecord(buildId) {
  const dir = screenRecordDir(buildId);
  if (!dir) return null;

  try {
    return JSON.parse(await readFile(path.join(dir, "record.json"), "utf8"));
  } catch {
    return null;
  }
}

async function readScreenRecordSummary(dirent) {
  const dir = path.join(SCREEN_RECORDS_DIR, dirent.name);
  try {
    const summary = JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8"));
    const hasFramePng = await fileExists(path.join(dir, "frame.png"));
    return {
      ...summary,
      hasFramePng,
      frameUrl: hasFramePng ? screenRecordFrameUrl(summary.buildId) : null,
    };
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listScreenRecords() {
  let entries = [];
  try {
    entries = await readdir(SCREEN_RECORDS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!safeRecordId(entry.name)) continue;
    const summary = await readScreenRecordSummary(entry);
    if (summary) summaries.push(summary);
  }
  summaries.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  return summaries;
}

async function trimScreenRecords() {
  const summaries = await listScreenRecords();
  const stale = summaries.slice(Math.max(SCREEN_RECORD_LIMIT, 1));
  for (const summary of stale) {
    const dir = screenRecordDir(summary.buildId);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

function runRemote(command, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return new Promise((resolve) => {
    const target = `${SSH_USER}@${SSH_HOST}`;
    const child = spawn(
      "sshpass",
      [
        "-e",
        "ssh",
        "-T",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        "-o",
        "ConnectTimeout=8",
        target,
        `sh -lc ${shellQuote(command)}`,
      ],
      {
        env: {
          ...process.env,
          SSHPASS: SSH_PASSWORD,
          TERM: "xterm-256color",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        output: limitedOutput(`${stdout}${stderr}\n[local] action timed out`.trim(), outputLimit),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: `[local] ${error.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok", outputLimit);
      resolve({ ok: code === 0, code, output });
    });
  });
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

const screenDeliveryAdapters = new Map([
  [
    "ssh-local-agent",
    createSshLocalAgentAdapter({
      remoteProjectRoot: REMOTE_PROJECT_ROOT,
      remoteBuildUser: REMOTE_BUILD_USER,
      sshHost: SSH_HOST,
      sshUser: SSH_USER,
      runRemote,
      shellQuote,
      remoteBuildShell,
      sha256,
      stableStringify,
      validSha256,
      limitedOutput,
      frameUrl,
    }),
  ],
]);

function screenDeliveryAdapter(id = "ssh-local-agent") {
  const adapter = screenDeliveryAdapters.get(id);
  if (!adapter) throw new Error(`unknown screen delivery adapter: ${id}`);
  return adapter;
}

const SCREEN_PAGE_IDS = ["home", "system", "ai", "network"];
const SCREEN_TEXT_LIMIT = 48;
const SCREEN_LINE_LIMIT = 72;

const SCREEN_TEMPLATES = [
  {
    id: "device-status",
    label: "设备状态",
    summary: "显示核桃派核心状态、系统、AI 和网络。",
    manifest: {
      title: "WalnutPi",
      subtitle: "server screen",
      pages: [
        { id: "home", tab: "HOME", status: "OK CORE", metrics: ["IP loading", "MEM --", "DISK --"] },
        { id: "system", tab: "SYS", title: "System", lines: ["CPU load", "Memory", "Disk", "Uptime"] },
        { id: "ai", tab: "AI", title: "AI Agent", lines: ["Local shell online", "Cloud model ready", "Screen cards active"] },
        { id: "network", tab: "NET", title: "Network", lines: ["IP", "FRP", "SSH", "Display fbdev"] },
      ],
    },
  },
  {
    id: "ai-task-board",
    label: "AI 任务板",
    summary: "突出当前 AI 任务、运行状态和下一步。",
    manifest: {
      title: "WalnutAI",
      subtitle: "task board",
      pages: [
        { id: "home", tab: "TASK", status: "AI READY", metrics: ["Plan ready", "Sync safe", "Logs open"] },
        { id: "system", tab: "RUN", title: "Runtime", lines: ["Agent online", "Shell ready", "Screen active", "Evidence saved"] },
        { id: "ai", tab: "AI", title: "Current Task", lines: ["Waiting for intent", "Will ask before risk", "Summaries use evidence"] },
        { id: "network", tab: "NEXT", title: "Next Steps", lines: ["Preview first", "Sync after confirm", "Check frame evidence"] },
      ],
    },
  },
  {
    id: "network-panel",
    label: "网络面板",
    summary: "突出 IP、SSH、FRP 和连接状态。",
    manifest: {
      title: "WalnutNet",
      subtitle: "network panel",
      pages: [
        { id: "home", tab: "NET", status: "LINK OK", metrics: ["IP loading", "SSH ready", "FRP check"] },
        { id: "system", tab: "SYS", title: "System Link", lines: ["Screen active", "Agent ready", "Logs available", "Safe sync"] },
        { id: "ai", tab: "AI", title: "Remote Agent", lines: ["Local actions gated", "Evidence first", "No public root shell"] },
        { id: "network", tab: "LAN", title: "Network", lines: ["IP", "Default route", "FRP", "SSH"] },
      ],
    },
  },
];

function rejectControlText(value, field) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} contains control characters`);
  }
}

function cleanText(value, field, limit = SCREEN_TEXT_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  rejectControlText(text, field);
  if (!text) throw new Error(`${field} is required`);
  if ([...text].length > limit) {
    throw new Error(`${field} is too long`);
  }
  return text;
}

function cleanTextList(values, field, maxItems, limit = SCREEN_LINE_LIMIT) {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  const items = values.map((value, index) => cleanText(value, `${field}[${index}]`, limit));
  if (items.length === 0 || items.length > maxItems) {
    throw new Error(`${field} must contain 1-${maxItems} items`);
  }
  return items;
}

function ensureFourScreenPages(manifest) {
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== SCREEN_PAGE_IDS.length) {
    throw new Error(`screen manifest pages must contain exactly ${SCREEN_PAGE_IDS.length} pages`);
  }
  for (const [index, expectedId] of SCREEN_PAGE_IDS.entries()) {
    if (manifest.pages[index]?.id !== expectedId) {
      throw new Error(`screen manifest pages[${index}].id must be ${expectedId}`);
    }
  }
}

function normalizeScreenManifest(manifest) {
  validateScreenManifest(manifest);
  ensureFourScreenPages(manifest);

  const pages = manifest.pages.map((page, index) => {
    const next = {
      id: SCREEN_PAGE_IDS[index],
      tab: cleanText(page.tab || SCREEN_PAGE_IDS[index].toUpperCase(), `pages[${index}].tab`, 8),
    };
    if (index === 0) {
      next.status = cleanText(page.status || "OK CORE", "pages[0].status", 24);
      next.metrics = cleanTextList(page.metrics || ["IP loading", "MEM --", "DISK --"], "pages[0].metrics", 3, 24);
    } else {
      next.title = cleanText(page.title || next.tab, `pages[${index}].title`, 32);
      next.lines = cleanTextList(page.lines || [next.title], `pages[${index}].lines`, 4, 48);
    }
    return next;
  });

  return {
    ...manifest,
    title: cleanText(manifest.title || "WalnutPi", "title", 32),
    subtitle: cleanText(manifest.subtitle || "server screen", "subtitle", 40),
    pages,
  };
}

function mutableManifestView(manifest) {
  return {
    title: manifest.title,
    subtitle: manifest.subtitle,
    pages: manifest.pages,
  };
}

function applyMutableManifest(baseManifest, mutable) {
  const basePages = baseManifest.pages || [];
  const mutablePages = mutable.pages || [];
  return normalizeScreenManifest({
    ...baseManifest,
    title: mutable.title ?? baseManifest.title,
    subtitle: mutable.subtitle ?? baseManifest.subtitle,
    pages: SCREEN_PAGE_IDS.map((id, index) => ({
      ...(basePages[index] || { id }),
      ...(mutablePages[index] || {}),
      id,
    })),
  });
}

function templatePreviewManifest(template) {
  const base = {
    schema: "walnutpi.screen.v1",
    id: `preview-${template.id}`,
    target: {
      runtime: "lvgl-fbdev",
      display: "/dev/fb0",
      width: 480,
      height: 320,
      color: "RGB565",
    },
    source: {
      lvglEntry: "lvgl_app/src/main.c",
      command: "walnut screen start",
    },
    pages: SCREEN_PAGE_IDS.map((id) => ({ id })),
  };
  return applyMutableManifest(base, template.manifest);
}

function screenTemplateSummary(template) {
  return {
    id: template.id,
    label: template.label,
    summary: template.summary,
    manifest: mutableManifestView(templatePreviewManifest(template)),
  };
}

async function readJsonRequest(req) {
  try {
    return await req.json();
  } catch {
    throw new Error("请求不是有效 JSON。");
  }
}

async function currentManifestForWrite(body) {
  let envelope;
  try {
    envelope = await screenManifestEnvelope();
  } catch (error) {
    return {
      error: json(
        {
          ok: false,
          error: "screen manifest invalid",
          summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
          output: error.message,
        },
        500,
      ),
    };
  }
  const clientHash = typeof body.manifestHash === "string" ? body.manifestHash : "";
  if (!validSha256(clientHash)) {
    return {
      error: json(
        {
          ok: false,
          error: "invalid manifestHash",
          summary: clientHash
            ? "同步请求包含无效的 screen manifest hash，请刷新页面后再试。"
            : "同步请求缺少 screen manifest hash，请刷新页面后再试。",
          manifestHash: envelope.manifestHash,
        },
        400,
      ),
    };
  }
  if (clientHash !== envelope.manifestHash) {
    return {
      error: json(
        {
          ok: false,
          error: "stale manifestHash",
          summary: "Web 预览和服务器 screen manifest 不一致，请刷新后再试。",
          manifestHash: envelope.manifestHash,
        },
        409,
      ),
    };
  }
  return envelope;
}

async function writeScreenManifest(manifest) {
  const normalized = normalizeScreenManifest(manifest);
  await writeJsonFile(SCREEN_MANIFEST_PATH, normalized);
  return screenManifestEnvelope();
}

function splitIntentItems(value) {
  return String(value || "")
    .split(/[，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function linePagePatch(pageIndex, title, lines, tab) {
  const pages = SCREEN_PAGE_IDS.map((id) => ({ id }));
  pages[pageIndex] = {
    id: SCREEN_PAGE_IDS[pageIndex],
    tab,
    title,
    lines,
  };
  return { pages };
}

function parseScreenIntent(text, currentManifest) {
  const input = String(text || "").trim();
  if (!input) return null;

  let match = input.match(/(?:副标题|说明)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
  if (match) return { subtitle: match[1].trim() };

  match = input.match(/(?:标题|名字|名称)\s*(?:改成|改为|写成|叫|是|:|：)\s*(.+)$/);
  if (match) return { title: match[1].trim() };

  match = input.match(/(?:状态|核心状态)\s*(?:改成|改为|写成|写|是|:|：)\s*(.+)$/);
  if (match) {
    const pages = currentManifest.pages.map((page) => ({ id: page.id }));
    pages[0] = { id: "home", status: match[1].trim() };
    return { pages };
  }

  match = input.match(/(?:指标|显示)\s*(?:改成|改为|写成|写|:|：)?\s*(.+)$/);
  if (match) {
    const metrics = splitIntentItems(match[1]).slice(0, 3);
    if (metrics.length > 0) {
      const pages = currentManifest.pages.map((page) => ({ id: page.id }));
      pages[0] = { id: "home", metrics };
      return { pages };
    }
  }

  match = input.match(/(?:系统页|系统)\s*(?:写|显示|:|：)\s*(.+)$/);
  if (match) return linePagePatch(1, "System", splitIntentItems(match[1]), "SYS");

  match = input.match(/(?:AI页|AI|ai)\s*(?:写|显示|:|：)\s*(.+)$/);
  if (match) return linePagePatch(2, "AI Agent", splitIntentItems(match[1]), "AI");

  match = input.match(/(?:网络页|网络)\s*(?:写|显示|:|：)\s*(.+)$/);
  if (match) return linePagePatch(3, "Network", splitIntentItems(match[1]), "NET");

  if (/网络|联网|IP|ip|ssh|frp/i.test(input)) {
    return SCREEN_TEMPLATES.find((template) => template.id === "network-panel")?.manifest || null;
  }

  if (/AI|ai|任务|助手|agent/i.test(input)) {
    return SCREEN_TEMPLATES.find((template) => template.id === "ai-task-board")?.manifest || null;
  }

  if (/系统|状态|健康|内存|磁盘/.test(input)) {
    return SCREEN_TEMPLATES.find((template) => template.id === "device-status")?.manifest || null;
  }

  return null;
}

async function handleScreenTemplate(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const current = await currentManifestForWrite(body);
  if (current.error) return current.error;

  const templateId = String(body.templateId || "");
  const template = SCREEN_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    return json({ ok: false, error: "invalid templateId", summary: "未知的小屏模板。" }, 400);
  }

  try {
    const next = applyMutableManifest(current.manifest, template.manifest);
    const envelope = await writeScreenManifest(next);
    return json({
      ok: true,
      summary: "已更新预览。",
      template: screenTemplateSummary(template),
      ...envelope,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "screen manifest update failed",
        summary: "无法更新小屏预览。",
        output: error.message,
      },
      500,
    );
  }
}

async function handleScreenIntent(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const current = await currentManifestForWrite(body);
  if (current.error) return current.error;

  const text = String(body.text || "").trim();
  const patch = parseScreenIntent(text, current.manifest);
  if (!patch) {
    return json({
      ok: false,
      error: "unrecognized screen intent",
      summary: "无法理解这次修改。",
    }, 400);
  }

  try {
    const next = applyMutableManifest(current.manifest, patch);
    const envelope = await writeScreenManifest(next);
    return json({
      ok: true,
      summary: "已更新预览。",
      ...envelope,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "screen manifest update failed",
        summary: "无法更新小屏预览。",
        output: error.message,
      },
      500,
    );
  }
}

function frameUrl(buildId) {
  return `/api/screen/frame/${encodeURIComponent(buildId)}`;
}

function cleanupScreenFrameTickets() {
  const now = Date.now();
  for (const [buildId, ticket] of screenFrameTickets.entries()) {
    if (now - ticket.createdAt > SCREEN_FRAME_TICKET_TTL_MS) {
      screenFrameTickets.delete(buildId);
    }
  }
}

function rememberScreenFrameTicket(buildId, ticket) {
  cleanupScreenFrameTickets();
  screenFrameTickets.set(buildId, {
    ...ticket,
    createdAt: Date.now(),
  });
}

function validPngBytes(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return bytes.length > signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function parseCaptureResult(result) {
  if (!result.ok) return null;
  let capture;
  try {
    capture = JSON.parse(result.output);
  } catch {
    return null;
  }

  if (!capture || typeof capture !== "object" || !validSha256(capture.pngSha256) || typeof capture.pngBase64 !== "string") {
    return null;
  }

  const bytes = Buffer.from(capture.pngBase64, "base64");
  if (!validPngBytes(bytes) || sha256(bytes) !== capture.pngSha256) {
    return null;
  }
  return { capture, bytes };
}

async function handleScreenFrame(buildId) {
  cleanupScreenFrameTickets();
  const ticket = screenFrameTickets.get(buildId);
  if (!ticket) {
    return json(
      {
        ok: false,
        error: "unknown or expired screen frame",
        summary: "screen frame evidence is only available after a recent successful sync",
      },
      404,
    );
  }

  const captureResult = await runRemote("sudo -n walnut screen capture --png-base64", 30_000, CAPTURE_OUTPUT_LIMIT);
  const parsed = parseCaptureResult(captureResult);
  if (!parsed) {
    return json(
      {
        ok: false,
        error: "screen capture failed",
        output: captureResult.output,
      },
      502,
    );
  }

  let recordWarning = "";
  try {
    await cacheScreenFramePng(buildId, parsed);
  } catch (error) {
    recordWarning = `screen record frame was not cached: ${error.message}`;
  }

  return new Response(parsed.bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-walnut-png-sha256": parsed.capture.pngSha256,
      "x-walnut-raw-sha256": parsed.capture.rawSha256,
      "x-walnut-sync-raw-sha256": ticket.frameSha256 || "",
      "x-walnut-manifest-sha256": ticket.manifestHash,
      "x-walnut-artifact-sha256": ticket.artifactHash || "",
      "x-walnut-record-warning": recordWarning,
    },
  });
}

async function cacheScreenFramePng(buildId, parsed) {
  const dir = screenRecordDir(buildId);
  if (!dir) return;

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "frame.png"), parsed.bytes);

  const framePng = {
    capturedAt: new Date().toISOString(),
    pngSha256: parsed.capture.pngSha256,
    pngByteLength: parsed.capture.pngByteLength,
    rawSha256: parsed.capture.rawSha256,
    rawByteLength: parsed.capture.rawByteLength,
    width: parsed.capture.width,
    height: parsed.capture.height,
    pixelFormat: parsed.capture.pixelFormat,
    url: screenRecordFrameUrl(buildId),
  };

  await updateScreenRecord(buildId, (record) => {
    record.framePng = framePng;
    if (record.screenEvidence?.frame && typeof record.screenEvidence.frame === "object") {
      record.screenEvidence.frame.cachedUrl = framePng.url;
    }
    return record;
  });
}

async function handleScreenRecordFrame(buildId) {
  const id = safeRecordId(buildId);
  const dir = screenRecordDir(id);
  if (!id || !dir) return json({ ok: false, error: "Invalid screen record id" }, 400);

  let bytes;
  try {
    bytes = await readFile(path.join(dir, "frame.png"));
  } catch {
    return json({ ok: false, error: "screen record frame not found" }, 404);
  }

  if (!validPngBytes(bytes)) {
    return json({ ok: false, error: "screen record frame is not a valid PNG" }, 500);
  }

  const record = await readScreenRecord(id);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-walnut-png-sha256": record?.framePng?.pngSha256 || sha256(bytes),
      "x-walnut-raw-sha256": record?.framePng?.rawSha256 || record?.screenEvidence?.frame?.sha256 || "",
      "x-walnut-manifest-sha256": record?.manifestHash || "",
      "x-walnut-artifact-sha256": record?.artifactHash || "",
    },
  });
}

async function handleScreenRecord(buildId) {
  const id = safeRecordId(buildId);
  if (!id) return json({ ok: false, error: "Invalid screen record id" }, 400);

  const record = await readScreenRecord(id);
  if (!record) return json({ ok: false, error: "screen record not found" }, 404);

  return json({
    ok: true,
    record: {
      ...record,
      framePng: record.framePng
        ? {
            ...record.framePng,
            url: screenRecordFrameUrl(record.buildId),
          }
        : null,
    },
  });
}

async function handleScreenRecordList() {
  return json({
    ok: true,
    records: await listScreenRecords(),
  });
}

async function handleScreenRepairPlan(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const repairHint = record.repairHint || buildScreenRepairHint(record);
  if (!record.repairHint) {
    try {
      await updateScreenRecord(safeBuildId, (nextRecord) => {
        nextRecord.repairHint = repairHint;
        return nextRecord;
      });
    } catch {
      // The response can still return the plan even if persisting the backfill fails.
    }
  }

  return json({
    ok: true,
    repairHint,
  });
}

async function handleScreenRepairCandidate(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const repairCandidate = buildScreenRepairCandidate(record);
  return json({
    ok: true,
    buildId: safeBuildId,
    repairCandidate,
  });
}

async function handleScreenAiSummary(req) {
  let body;
  try {
    body = await readJsonRequest(req);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const buildId = String(body.buildId || "").trim();
  const safeBuildId = safeRecordId(buildId);
  if (!safeBuildId) {
    return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
  }

  const record = await readScreenRecord(safeBuildId);
  if (!record) {
    return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
  }

  const aiSummary = await buildScreenAiSummary(record);
  return json({
    ok: true,
    buildId: safeBuildId,
    aiSummary,
  });
}

function validateScreenManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("screen manifest must be a JSON object");
  }
  if (manifest.schema !== "walnutpi.screen.v1") {
    throw new Error("screen manifest schema must be walnutpi.screen.v1");
  }
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("screen manifest id is required");
  }
  if (!manifest.target || typeof manifest.target !== "object" || Array.isArray(manifest.target)) {
    throw new Error("screen manifest target is required");
  }
  if (!Number.isInteger(manifest.target.width) || manifest.target.width <= 0) {
    throw new Error("screen manifest target.width must be a positive integer");
  }
  if (!Number.isInteger(manifest.target.height) || manifest.target.height <= 0) {
    throw new Error("screen manifest target.height must be a positive integer");
  }
  if (manifest.target.color !== "RGB565") {
    throw new Error("screen manifest target.color must be RGB565");
  }
  if (!manifest.target.display || typeof manifest.target.display !== "string") {
    throw new Error("screen manifest target.display is required");
  }
  if (!manifest.source || typeof manifest.source !== "object" || Array.isArray(manifest.source)) {
    throw new Error("screen manifest source is required");
  }
  if (!manifest.source.lvglEntry || typeof manifest.source.lvglEntry !== "string") {
    throw new Error("screen manifest source.lvglEntry is required");
  }
  if (!manifest.source.command || typeof manifest.source.command !== "string") {
    throw new Error("screen manifest source.command is required");
  }
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) {
    throw new Error("screen manifest pages must be a non-empty array");
  }
  for (const [index, page] of manifest.pages.entries()) {
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      throw new Error(`screen manifest pages[${index}] must be an object`);
    }
    if (!page.id || typeof page.id !== "string") {
      throw new Error(`screen manifest pages[${index}].id is required`);
    }
  }
}

async function screenManifestEnvelope() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(SCREEN_MANIFEST_PATH, "utf8"));
  } catch (error) {
    throw new Error(`failed to read screen manifest ${SCREEN_MANIFEST_PATH}: ${error.message}`);
  }
  validateScreenManifest(manifest);
  const serializedManifest = stableStringify(manifest);
  return {
    manifest,
    manifestHash: sha256(serializedManifest),
  };
}

async function handleScreenSync(req) {
  const startedAt = new Date();
  const buildId = `screen-${startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  let envelope;
  try {
    envelope = await screenManifestEnvelope();
  } catch (error) {
    return persistScreenSyncResult(
      {
        title: "同步到核桃派",
        buildId,
        startedAt: startedAt.toISOString(),
        manifest: null,
        manifestHash: null,
        ok: false,
        risk: "write-low",
        mode: "remote",
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
        output: error.message,
      },
      {},
      500,
    );
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
    body = await req.json();
  } catch {
    return persistScreenSyncResult(
      {
        ...baseResult,
        ok: false,
        risk: "write-low",
        mode: "remote",
        failedStage: "manifest",
        deliveryManifest: null,
        deliveryHash: null,
        artifactHash: null,
        evidence: null,
        screenEvidence: null,
        screenFrameUrl: null,
        command: null,
        code: 1,
        summary: "同步请求缺少有效的 screen manifest hash，请刷新页面后再同步。",
        output: "request body is not valid JSON",
      },
      {},
      400,
    );
  }
  if (typeof body.manifestHash !== "string" || !validSha256(body.manifestHash)) {
    return persistScreenSyncResult(
      {
        ...baseResult,
        ok: false,
        risk: "write-low",
        mode: "remote",
        failedStage: "manifest",
        deliveryManifest: null,
        deliveryHash: null,
        artifactHash: null,
        evidence: null,
        screenEvidence: null,
        screenFrameUrl: null,
        command: null,
        code: 1,
        summary: body.manifestHash
          ? "同步请求包含无效的 screen manifest hash，请刷新页面后再同步。"
          : "同步请求缺少 screen manifest hash，请刷新页面后再同步。",
        output: `client=${body.manifestHash || "(missing)"}\nserver=${manifestHash}`,
      },
      {},
      400,
    );
  }

  if (body.manifestHash !== manifestHash) {
    return persistScreenSyncResult(
      {
        ...baseResult,
        ok: false,
        risk: "write-low",
        mode: "remote",
        failedStage: "manifest",
        deliveryManifest: null,
        deliveryHash: null,
        artifactHash: null,
        evidence: null,
        screenEvidence: null,
        screenFrameUrl: null,
        command: null,
        code: 1,
        summary: body.manifestHash
          ? "Web 预览和服务器 screen manifest 不一致，请刷新后再同步。"
          : "同步请求缺少 screen manifest hash，请刷新页面后再同步。",
        output: `client=${body.manifestHash || "(missing)"}\nserver=${manifestHash}`,
      },
      {},
      body.manifestHash ? 409 : 400,
    );
  }

  let delivery;
  try {
    delivery = await screenDeliveryAdapter().deliver({ buildId, manifest, manifestHash });
  } catch (error) {
    delivery = {
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
  if (delivery.frameTicket) {
    rememberScreenFrameTicket(buildId, delivery.frameTicket);
  }

  const result = {
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
  };

  return persistScreenSyncResult(result, delivery.commandResults);
}

const ACTIONS = {
  status: {
    title: "查状态",
    risk: "read",
    mode: "remote",
    command: "walnut status",
    reply: "我会读取系统、网络、存储、服务和音频状态。",
    timeoutMs: 20_000,
  },
  snapshot: {
    title: "设备快照",
    risk: "read",
    mode: "remote",
    command: [
      "hostname",
      "uname -a",
      "cat /etc/WalnutPi-release 2>/dev/null || true",
      "cat /etc/os-release 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
      "gpio pins 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
    ].join("; "),
    reply: "我会先做只读设备快照，确认板子、系统、引脚和 overlay 状态。",
    timeoutMs: 20_000,
  },
  network: {
    title: "网络检查",
    risk: "read",
    mode: "remote",
    command: [
      "ip -br addr",
      "ip route show default",
      "nmcli -t -f ACTIVE,SSID,SIGNAL dev wifi 2>/dev/null || true",
    ].join("; "),
    reply: "我会检查 IP、默认路由和 Wi-Fi 状态。",
    timeoutMs: 12_000,
  },
  gpio: {
    title: "GPIO 检查",
    risk: "read",
    mode: "remote",
    command: [
      "gpio pins",
      "gpio pin i2c 2>/dev/null || true",
      "gpio pin spi 2>/dev/null || true",
      "gpio pin uart 2>/dev/null || true",
      "gpio pin pwm 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
    ].join("; "),
    reply: "我会只读检查引脚、总线和 overlay，避免误占用 GPIO。",
    timeoutMs: 20_000,
  },
  notes: {
    title: "今天笔记",
    risk: "read",
    mode: "remote",
    command: "walnut today",
    reply: "我会读取今天保存的核桃派笔记。",
    timeoutMs: 10_000,
  },
  note: {
    title: "记录笔记",
    risk: "write-low",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要记录的内容。");
      return `walnut note ${shellQuote(text)}`;
    },
    reply: "我会把这句话写进核桃派本地笔记。",
    timeoutMs: 10_000,
  },
  ai: {
    title: "WalnutAI Agent",
    risk: "read",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      return `walnut ai ${shellQuote(text)}`;
    },
    reply: "我会把自然语言交给 WalnutAI，由它判断是否需要先执行本地安全动作。",
    timeoutMs: 120_000,
  },
  video: {
    title: "彩色视频",
    risk: "interactive",
    mode: "terminal",
    command: "walnut video color",
    reply: "我会直接运行彩色 ASCII 视频命令，不打开菜单。",
  },
};

function actionSummary(action, id) {
  return {
    id,
    title: action.title,
    risk: action.risk,
    mode: action.mode,
    reply: action.reply,
  };
}

async function handleAction(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "请求不是有效 JSON。" }, 400);
  }

  const id = String(body.action || "");
  const action = ACTIONS[id];
  if (!action) {
    return json({ ok: false, error: "未知或未允许的动作。" }, 400);
  }

  let command = action.command;
  try {
    if (action.buildCommand) command = action.buildCommand(body);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  if (action.mode === "terminal") {
    return json({
      ok: true,
      ...actionSummary(action, id),
      command,
    });
  }

  const result = await runRemote(command, action.timeoutMs);
  return json({
    ok: result.ok,
    ...actionSummary(action, id),
    command,
    code: result.code,
    output: result.output,
  });
}

function startSsh(ws) {
  const target = `${SSH_USER}@${SSH_HOST}`;
  const child = spawn(
    "sshpass",
    [
      "-e",
      "ssh",
      "-tt",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      target,
    ],
    {
      env: {
        ...process.env,
        SSHPASS: SSH_PASSWORD,
        TERM: "xterm-256color",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  ws.data.child = child;

  const send = (chunk) => {
    try {
      ws.send(chunk);
    } catch {
      child.kill("SIGTERM");
    }
  };

  send(`\r\n[local] ssh ${target}\r\n\r\n`);
  child.stdout.on("data", send);
  child.stderr.on("data", send);

  child.on("error", (error) => {
    send(`\r\n[local] ${error.message}\r\n`);
    ws.close();
  });

  child.on("close", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    send(`\r\n[local] session closed (${reason})\r\n`);
    ws.close();
  });
}

function stopSsh(ws) {
  const child = ws.data.child;
  if (!child || child.killed) return;

  child.stdin.end();
  child.kill("SIGTERM");

  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 1000).unref?.();
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/terminal") {
      if (previewOnly(url)) {
        return new Response("SSH disabled for preview", { status: 403 });
      }
      const upgraded = server.upgrade(req, { data: { child: null } });
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/actions") {
      return json({
        target: `${SSH_USER}@${SSH_HOST}`,
        actions: Object.fromEntries(Object.entries(ACTIONS).map(([id, action]) => [id, actionSummary(action, id)])),
      });
    }

    if (url.pathname === "/api/screen/manifest") {
      try {
        return json(await screenManifestEnvelope());
      } catch (error) {
        return json(
          {
            ok: false,
            error: "screen manifest invalid",
            summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
            output: error.message,
          },
          500,
        );
      }
    }

    if (url.pathname === "/api/screen/templates") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return json({
        ok: true,
        templates: SCREEN_TEMPLATES.map(screenTemplateSummary),
      });
    }

    if (url.pathname === "/api/screen/template") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleScreenTemplate(req);
    }

    if (url.pathname === "/api/screen/intent") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleScreenIntent(req);
    }

    if (url.pathname === "/api/screen/sync") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyScreenSyncResult(req);
      return handleScreenSync(req);
    }

    if (url.pathname === "/api/screen/repair-plan") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRepairPlan(req);
    }

    if (url.pathname === "/api/screen/repair-candidate") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRepairCandidate(req);
    }

    if (url.pathname === "/api/screen/ai-summary") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenAiSummary(req);
    }

    if (url.pathname === "/api/screen/records") {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleScreenRecordList();
    }

    const screenRecordFrameMatch = url.pathname.match(/^\/api\/screen\/records\/([^/]+)\/frame\.png$/);
    if (screenRecordFrameMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      let buildId;
      try {
        buildId = decodeURIComponent(screenRecordFrameMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen record id" }, 400);
      }
      return handleScreenRecordFrame(buildId);
    }

    const screenRecordMatch = url.pathname.match(/^\/api\/screen\/records\/([^/]+)$/);
    if (screenRecordMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      let buildId;
      try {
        buildId = decodeURIComponent(screenRecordMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen record id" }, 400);
      }
      return handleScreenRecord(buildId);
    }

    const screenFrameMatch = url.pathname.match(/^\/api\/screen\/frame\/([^/]+)$/);
    if (screenFrameMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      let buildId;
      try {
        buildId = decodeURIComponent(screenFrameMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen frame id" }, 400);
      }
      return handleScreenFrame(buildId);
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleAction(req);
    }

    const file = files.get(url.pathname);
    if (!file) {
      return new Response("Not found", { status: 404 });
    }

    const body = Bun.file(`${BASE_DIR}/${file}`);
    if (!(await body.exists())) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(body, {
      headers: {
        "content-type": contentType(file),
      },
    });
  },
  websocket: {
    open(ws) {
      startSsh(ws);
    },
    message(ws, message) {
      const child = ws.data.child;
      if (!child || child.killed || !child.stdin.writable) return;

      child.stdin.write(typeof message === "string" ? message : Buffer.from(message));
    },
    close(ws) {
      stopSsh(ws);
    },
  },
});

console.log(`Serving model terminal at http://${server.hostname}:${server.port}/`);
console.log(`Target: ${SSH_USER}@${SSH_HOST}`);
console.log(`Remote project root: ${REMOTE_PROJECT_ROOT}`);

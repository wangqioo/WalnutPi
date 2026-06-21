import { z } from "zod";
import { intentTypeToRoute } from "./evaluator.js";

export const INTENT_DELIVERIES = new Set(["none", "sync_after_preview", "sync_existing"]);

export const IntentRouteSchema = z.object({
  route: z.enum(["ai.chat", "screen.wallpaper", "screen.widget_app", "device.action", "memory.notes", "terminal.surface"]).optional(),
  action: z.enum(["answer", "clarify", "generate", "create", "update", "sync", "switch", "run", "confirm", "refuse", "read", "write", "open", "run_tool"]).optional(),
  intent: z.string().optional(),
  subject: z.string().optional(),
  delivery: z.enum(["none", "sync_after_preview", "sync_existing"]).optional(),
  riskHint: z.enum(["none", "read", "write", "high"]).optional(),
  exposure: z.array(z.enum(["internal", "agent_action", "human_cli", "diagnostic"])).optional(),
  actionPolicyId: z.string().nullable().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["rule", "ai"]).optional(),
});

function routeToIntent(route) {
  if (route.route === "screen.wallpaper" && route.action === "sync") return "screen.sync";
  if (route.route === "screen.wallpaper") return "screen.generate";
  if (route.route === "screen.widget_app") return "screen.widget_app.create";
  if (route.route === "memory.notes" && route.action === "write") return "device.note.write";
  if (route.route === "memory.notes") return "device.notes.read";
  if (route.route === "terminal.surface" && route.action === "run_tool") return "terminal.tool";
  if (route.route === "terminal.surface") return "terminal.open";
  if (route.route === "device.action") return route.intent || "device.status.read";
  return "ai.chat";
}

export function normalizeIntentClassification(value, fallbackText = "") {
  const fallback = String(fallbackText || "").trim();
  const parsed = IntentRouteSchema.safeParse(value || {});
  const clean = parsed.success ? parsed.data : {};
  const delivery = clean.delivery || "none";
  const confidence = Math.max(0, Math.min(1, Number(clean.confidence ?? 0.5)));
  const subject = String(clean.subject || fallback).trim().slice(0, 120) || fallback || "";
  const base = clean.route && clean.action
    ? clean
    : intentTypeToRoute(clean.intent || "ai.chat", clean);
  const route = {
    ...base,
    schema: "walnutpi.intent.route.v2",
    subject,
    delivery,
    riskHint: clean.riskHint || base.riskHint || "none",
    exposure: clean.exposure || base.exposure || ["internal"],
    actionPolicyId: clean.actionPolicyId ?? base.actionPolicyId ?? null,
    parameters: clean.parameters || base.parameters || {},
    confidence: Number(confidence.toFixed(2)),
    source: clean.source === "ai" ? "ai" : "rule",
  };
  route.intent = route.intent || routeToIntent(route);
  return route;
}

export function wantsScreenDeliveryIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (/不(?:要|用|必)?\s*(?:同步|部署|推送|运行到|显示到|烧录)|别\s*(?:同步|部署|推送|运行到|显示到|烧录)|只\s*(?:预览|生成|看看)|preview\s*only|no\s*(?:sync|deploy)/i.test(value)) {
    return false;
  }
  return /同步|部署|推送|运行到|显示到|烧录|sync|deploy|flash/.test(value);
}

export function looksLikeAssistantQuestion(input) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return false;
  return /^(?:你|walnutai|walnut ai|ai)\s*(?:现在|目前|到底)?\s*(?:是?谁|能做什么|能帮我做(?:什么|哪些事)|可以做什么|会做什么|有什么功能|介绍(?:一下)?(?:你自己|自己)?)/i.test(text)
    || /(?:你是?谁|你能做什么|你能帮我做(?:什么|哪些事)|你可以做什么|你会做什么|介绍一下你自己|介绍一下自己|有什么功能)/i.test(text);
}

function hasWriteOrDeliveryNegation(input) {
  const text = String(input || "").trim().toLowerCase();
  return /不(?:要|用|必)?\s*(?:执行|同步|部署|推送|运行到|显示到|烧录|重启|修改|改|变更|写|写入|保存|安装|配置)|别\s*(?:执行|同步|部署|推送|运行到|显示到|烧录|重启|修改|改|变更|写|写入|保存|安装|配置)|只(?:做|进行)?\s*(?:只读|读|看|检查|查询|看看)|read[-\s]*only|no\s*(?:sync|deploy|write|restart|change|modify|execute)|don'?t\s*(?:sync|deploy|write|restart|change|modify|execute)/i.test(text);
}

function looksLikeReadOnlyDeviceRequest(input) {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  if (!text) return false;
  if (looksLikeExplicitScreenGeneration(text)) {
    return false;
  }
  if (!/(核桃派|设备|板子|系统|服务|屏幕服务|网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network|gpio|引脚|针脚|i2c|spi|uart|pwm|状态|健康|还好[吗嘛]|status|health|内存|存储|磁盘|空间)/i.test(lower)) {
    return false;
  }
  return hasWriteOrDeliveryNegation(text)
    || /(?:看|查|检查|查询|确认|了解|判断|诊断|health|check|inspect|status|read)\S*(?:核桃派|设备|板子|系统|服务|屏幕服务|网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|gpio|引脚|针脚|i2c|spi|uart|pwm|状态|健康|还好)/i.test(lower);
}

function looksLikeObservationReplanRequest(input) {
  const text = String(input || "").trim().toLowerCase();
  return /(观察|快照|snapshot|inspect|observe).*(下一步|续步|继续|自动|replan|next\s*tasks?)|(?:下一步|续步|继续|自动|replan|next\s*tasks?).*(观察|快照|snapshot|inspect|observe)/i.test(text);
}

function looksLikeExplicitScreenGeneration(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  return /(?:生成|创建|设计|做|做成|整理成|来一个|写个|做个).{0,24}(?:小屏|屏幕|卡片|状态卡|界面|面板|screen|480x320|480\s*[x×]\s*320)|(?:小屏|屏幕|screen|480x320|480\s*[x×]\s*320).{0,24}(?:生成|创建|设计|预览|同步|卡片|界面|面板)/i.test(text);
}

function readOnlyDeviceIntent(input) {
  const lower = String(input || "").toLowerCase();
  const mentionsNetwork = /网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network/.test(lower);
  const mentionsI2c = /i2c|传感器|sensor/.test(lower);
  const mentionsGpio = /gpio|引脚|针脚|i2c|spi|uart|pwm|总线|bus|set-device/.test(lower);
  const mentionsStatus = /屏幕服务|状态|健康|还好[吗嘛]|status|health|系统|服务|docker|内存|存储|磁盘|空间/.test(lower)
    || (/怎么样/.test(lower) && /核桃派|设备|板子|系统|服务/.test(lower));
  if ((mentionsNetwork && mentionsStatus) || (mentionsGpio && mentionsStatus) || (mentionsNetwork && mentionsGpio)) {
    return "device.status.read";
  }
  if (mentionsI2c) return "device.i2c.read";
  if (mentionsGpio) return "device.gpio.read";
  if (mentionsNetwork) return "device.network.read";
  return "device.status.read";
}

function screenIntentSubject(input) {
  let subject = String(input || "").trim();
  subject = subject
    .replace(/^(?:请|麻烦|帮我|给我|你|我要|我想|直接开始|直接|先|开始|继续|现在|按这个|就这个|照这个)\s*/i, "")
    .replace(/(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)\s*/i, "")
    .replace(/(?:然后|并且|并|再)?\s*(?:同步|部署|推送|烧录|运行到|显示到)\s*(?:到|至)?\s*(?:核桃派|设备|板子|小屏|屏幕|lvgl|screen)?/ig, "")
    .replace(/[，。,.!！?？；;：:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return subject || "Screen Workspace output";
}

function looksLikeScreenProgramRequest(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  if (/^(?:同步|sync|生成\s*AI\s*总结|总结)$/i.test(text)) return false;
  if (!looksLikeExplicitScreenGeneration(text) && looksLikeReadOnlyDeviceRequest(text)) return false;
  return /(小屏|屏幕|界面|lvgl|screen|程序|应用|app|面板|工具|播放列表|workspace)/i.test(text)
    || /(?:给我|帮我)?\s*(?:做|创建|生成|开发|写|造|设计|弄|来一个|写个|做个)\s*\S{2,}/i.test(text);
}

function looksLikeWidgetAppRequest(input) {
  const text = String(input || "").trim();
  if (!text) return false;
  return /(小屏|屏幕|screen|lvgl).{0,24}(小应用|应用|app|widget|控件|按钮|开关|toggle|仪表盘|dashboard|快捷面板|快捷操作|状态面板|交互|可交互|菜单|列表)|(?:小应用|应用|app|widget|控件|按钮|开关|toggle|仪表盘|dashboard|快捷面板|快捷操作|状态面板|交互|可交互|菜单|列表).{0,24}(小屏|屏幕|screen|lvgl)/i.test(text);
}

export function ruleBasedIntentClassification(text) {
  const trimmed = String(text || "").trim();
  const lower = trimmed.toLowerCase();
  const aiQuestion = trimmed.match(/^(?:问一下|问ai|问 ai|ai[:：]?|聊天[:：]?)(.+)/i);
  const noteMatch = trimmed.match(/^(?:记一下|记录|note)\s*[:：]?\s*(.+)/i);

  if (aiQuestion && aiQuestion[1].trim()) {
    return normalizeIntentClassification({
      intent: "ai.chat",
      subject: aiQuestion[1].trim(),
      delivery: "none",
      confidence: 0.96,
      source: "rule",
    }, trimmed);
  }

  if (looksLikeAssistantQuestion(trimmed)) {
    return normalizeIntentClassification({
      intent: "ai.chat",
      subject: trimmed,
      delivery: "none",
      confidence: 0.92,
      source: "rule",
    }, trimmed);
  }

  if (/(密码|token|验证码|secret|ssh|passw(or)?d).*(临时|不要保存|别长期保存|不要写进|别写进|memory|长期记忆)|(?:临时|不要保存|别长期保存|不要写进|别写进).*(密码|token|验证码|secret|ssh|passw(or)?d)/i.test(lower)) {
    return normalizeIntentClassification({ intent: "memory.sensitive_skip", subject: trimmed, confidence: 0.94, source: "rule" }, trimmed);
  }
  if (/(记住|长期保存|以后|默认|偏好|preference|memory).*(小屏|屏幕|生成|像素|中文|标题)|(?:小屏|屏幕|生成).*(偏好|默认|以后|长期保存|记住)/i.test(trimmed)) {
    return normalizeIntentClassification({ intent: "memory.preference", subject: trimmed, confidence: 0.92, source: "rule" }, trimmed);
  }
  if (/(重启|restart).{0,12}(小屏服务|屏幕服务|walnut-screen\.service)|(?:小屏服务|屏幕服务|walnut-screen\.service).{0,12}(重启|restart)/i.test(lower)) {
    return normalizeIntentClassification({ intent: "policy.service_restart", subject: trimmed, confidence: 0.93, source: "rule" }, trimmed);
  }
  if (/(apt\s+install|安装.*(?:系统包|软件包|依赖)|系统软件|重启.*核桃派|reboot|关机|shutdown|刷写|固件|overlay)/i.test(lower)) {
    return normalizeIntentClassification({ intent: "policy.system_write", subject: trimmed, confidence: 0.93, source: "rule" }, trimmed);
  }
  if (/(清理|整理|维护|maintenance|磁盘|存储|空间).*(安全|人工确认|不要直接|先告诉|选项|别替我|不要执行|不要删除)|(?:安全|人工确认|不要直接|先告诉|选项|别替我|不要执行|不要删除).*(清理|整理|维护|maintenance|磁盘|存储|空间)/i.test(lower)) {
    return normalizeIntentClassification({ intent: "policy.maintenance_guidance", subject: trimmed, confidence: 0.9, source: "rule" }, trimmed);
  }
  if (/(刚才|刚刚|最近|上次).*(失败|失败了|为什么|诊断|原因|修复|failure|failed)|(?:失败|failed).*(阶段|诊断|原因|修复|不要重试|别自动重试)/i.test(lower)) {
    return normalizeIntentClassification({ intent: "diagnostics.recent_failure", subject: trimmed, confidence: 0.91, source: "rule" }, trimmed);
  }
  if (/(小屏|屏幕|screen).*(服务|状态|画面|frame|显示).*(不要改变|不要同步|不要重启|只读|禁止|当前)|(?:只读|不要改变|不要同步|不要重启|禁止).*(小屏|屏幕|screen).*(服务|状态|画面|frame|显示)/i.test(lower)) {
    return normalizeIntentClassification({ intent: "screen.state_frame.read", subject: trimmed, confidence: 0.91, source: "rule" }, trimmed);
  }
  if (looksLikeObservationReplanRequest(trimmed)) {
    return normalizeIntentClassification({ intent: "device.snapshot.read", subject: trimmed, confidence: 0.9, source: "rule" }, trimmed);
  }

  if (looksLikeWidgetAppRequest(trimmed)) {
    return normalizeIntentClassification({
      route: "screen.widget_app",
      action: "create",
      subject: screenIntentSubject(trimmed),
      delivery: "none",
      parameters: /设备|状态|status|快捷/.test(trimmed) ? { template: "device_status_quick_actions" } : {},
      confidence: 0.9,
      source: "rule",
    }, trimmed);
  }

  if (looksLikeExplicitScreenGeneration(trimmed)) {
    return normalizeIntentClassification({
      route: "screen.wallpaper",
      action: "generate",
      subject: screenIntentSubject(trimmed),
      delivery: wantsScreenDeliveryIntent(trimmed) ? "sync_after_preview" : "none",
      confidence: 0.92,
      source: "rule",
    }, trimmed);
  }

  if (looksLikeReadOnlyDeviceRequest(trimmed)) {
    return normalizeIntentClassification({
      intent: readOnlyDeviceIntent(trimmed),
      subject: trimmed,
      delivery: "none",
      confidence: 0.9,
      source: "rule",
    }, trimmed);
  }

  if (/清屏|clear|重连|断开|ssh|连接/.test(lower)) {
    return normalizeIntentClassification({ intent: "terminal.open", subject: trimmed, confidence: 0.92, source: "rule" }, trimmed);
  }

  if (looksLikeScreenProgramRequest(trimmed)) {
    return normalizeIntentClassification({
      route: "screen.wallpaper",
      action: "generate",
      subject: screenIntentSubject(trimmed),
      delivery: wantsScreenDeliveryIntent(trimmed) ? "sync_after_preview" : "none",
      confidence: 0.9,
      source: "rule",
    }, trimmed);
  }

  if (wantsScreenDeliveryIntent(trimmed) && /核桃派|设备|板子|小屏|屏幕|lvgl|screen|派/.test(lower)) {
    return normalizeIntentClassification({ route: "screen.wallpaper", action: "sync", subject: trimmed, delivery: "sync_existing", confidence: 0.86, source: "rule" }, trimmed);
  }

  if (noteMatch && noteMatch[1].trim()) {
    return normalizeIntentClassification({ intent: "device.note.write", subject: noteMatch[1].trim(), confidence: 0.9, source: "rule" }, trimmed);
  }

  if (/i2c|传感器|sensor/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.i2c.read", subject: trimmed, confidence: 0.86, source: "rule" }, trimmed);
  }
  if (/gpio|引脚|针脚|spi|uart|pwm|总线|bus|set-device/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.gpio.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/快照|snapshot|release|os-release|kernel|内核|hostname|启动配置|boot|设备信息|板子信息|硬件信息/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.snapshot.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.network.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }
  if (/状态|健康|还好[吗嘛]|status|health|系统|服务|docker|内存|存储|磁盘|空间/.test(lower) || (/怎么样/.test(lower) && /核桃派|设备|板子|系统|服务/.test(lower))) {
    return normalizeIntentClassification({ intent: "device.status.read", subject: trimmed, confidence: 0.86, source: "rule" }, trimmed);
  }
  if (/今天.*(笔记|记录)|笔记.*今天|记了什么|notes|today/.test(lower)) {
    return normalizeIntentClassification({ intent: "device.notes.read", subject: trimmed, confidence: 0.84, source: "rule" }, trimmed);
  }

  if (!/播放\s*(按钮|键|控件)/.test(lower) && (/walnut\s+(video|play)|视频|彩色\s*ascii|ascii\s*(视频|动画)?|demo/.test(lower) || /(运行|执行|打开|播放).*(玩具|演示|效果|动画|play)/.test(lower))) {
    return normalizeIntentClassification({ intent: "terminal.tool", subject: trimmed, confidence: 0.78, source: "rule" }, trimmed);
  }

  return normalizeIntentClassification({ intent: "ai.chat", subject: trimmed, confidence: 0.62, source: "rule" }, trimmed);
}

export function canUseRuleIntentWithoutAi(ruleIntent) {
  if (!ruleIntent || ruleIntent.source !== "rule") return false;
  if (ruleIntent.confidence < 0.84) return false;
  return [
    "ai.chat",
    "screen.sync",
    "device.status.read",
    "device.snapshot.read",
    "device.i2c.read",
    "device.network.read",
    "device.gpio.read",
    "device.notes.read",
    "device.note.write",
    "memory.preference",
    "memory.sensitive_skip",
    "policy.system_write",
    "policy.service_restart",
    "policy.maintenance_guidance",
    "diagnostics.recent_failure",
    "screen.state_frame.read",
    "terminal.open",
  ].includes(ruleIntent.intent);
}

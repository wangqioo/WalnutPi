export function extractIntentFacts(input) {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  const hasScreenNoun = /(小屏|屏幕|界面|lvgl|screen|480x320|480\s*[x×]\s*320|卡片|面板|workspace)/i.test(text);
  const hasWidgetAppNoun = /(小应用|应用|app|widget|控件|按钮|开关|toggle|仪表盘|dashboard|快捷面板|快捷操作|状态面板|交互|可交互|菜单|列表)/i.test(text);
  const hasWallpaperNoun = /(壁纸|墙纸|wallpaper|图片|图像|image|像素风|动画|播放列表|playlist|media|媒体)/i.test(text);
  const hasGenerateVerb = /(生成|创建|设计|做|做成|整理成|来一个|写个|做个|generate|create|design)/i.test(text);
  const hasSyncVerb = /(同步|部署|推送|运行到|显示到|烧录|sync|deploy|flash)/i.test(text);
  const hasNegatedSync = /不(?:要|用|必)?\s*(?:同步|部署|推送|运行到|显示到|烧录)|别\s*(?:同步|部署|推送|运行到|显示到|烧录)|只\s*(?:预览|生成|看看)|preview\s*only|no\s*(?:sync|deploy)/i.test(text);
  const hasReadOnly = /只读|只(?:看|查|检查|查询)|不要(?:执行|修改|写|写入|重启|配置)|别(?:执行|修改|写|写入|重启|配置)|read[-\s]*only|don'?t\s*(?:write|restart|change|modify|execute)/i.test(text);
  const mentionsDevice = /(核桃派|设备|板子|系统|服务|屏幕服务|walnutpi)/i.test(text);
  const mentionsNetwork = /(网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network|wlan)/i.test(lower);
  const mentionsI2c = /(i2c|传感器|sensor)/i.test(lower);
  const mentionsGpio = /(gpio|引脚|针脚|spi|uart|pwm|总线|bus|set-device)/i.test(lower);
  const mentionsStatus = /(屏幕服务|状态|健康|还好[吗嘛]|status|health|系统|服务|docker|内存|存储|磁盘|空间)/i.test(lower)
    || (/怎么样/.test(lower) && /(核桃派|设备|板子|系统|服务)/.test(lower));
  const asksAssistantInfo = /(?:你是?谁|你能做什么|你能帮我做(?:什么|哪些事)?|能帮我做(?:什么|哪些事)|你可以做什么|你会做什么|介绍一下你自己|介绍一下自己|有什么功能)/i.test(text);
  const hasTerminalIntent = /(清屏|clear|重连|断开|ssh)/i.test(lower) || (/(连接)/i.test(lower) && !/(不要|别|no|don't|dont)/i.test(lower));
  const hasNoteWrite = /^(?:记一下|记录|note)\s*[:：]?/i.test(text);
  const hasNotesRead = /(今天.*(?:笔记|记录)|笔记.*今天|记了什么|notes|today)/i.test(lower);
  const hasSessionSummaryRead = /(刚才|刚刚|本次|这次|这轮|本轮|当前).{0,12}(会话|对话|请求|操作|做过什么|做了什么|让我做了什么|turn|session)|(?:会话|对话|session).{0,12}(总结|summary|过什么|做过什么|做了什么)|(?:总结|回顾).{0,16}(这轮|本轮|刚才|刚刚|本次|这次|当前)/i.test(lower);
  const hasSnapshot = /(快照|snapshot|release|os-release|kernel|内核|hostname|启动配置|boot|设备信息|板子信息|硬件信息)/i.test(lower);
  const hasToolIntent = !/播放\s*(按钮|键|控件)/.test(lower)
    && (/(walnut\s+(video|play)|视频|彩色\s*ascii|ascii\s*(视频|动画)?|demo)/i.test(lower)
      || /(运行|执行|打开|播放).*(玩具|演示|效果|动画|play)/i.test(lower));
  const hasMemoryPreference = /(记住|长期保存|以后|默认|偏好|preference|memory).*(小屏|屏幕|生成|像素|中文|标题)|(?:小屏|屏幕|生成).*(偏好|默认|以后|长期保存|记住)/i.test(text);
  const hasSensitiveTemporaryMemory = /(密码|token|验证码|secret|ssh|passw(or)?d).*(临时|不要保存|别长期保存|不要写进|别写进|memory|长期记忆)|(?:临时|不要保存|别长期保存|不要写进|别写进).*(密码|token|验证码|secret|ssh|passw(or)?d)/i.test(lower);
  const hasPolicySystemWrite = !hasReadOnly && /(apt\s+install|安装.*(?:系统包|软件包|依赖)|系统软件|重启.*核桃派|reboot|关机|shutdown|刷写|固件|overlay)/i.test(lower);
  const hasPolicyServiceRestart = /(重启|restart).{0,12}(小屏服务|屏幕服务|walnut-screen\.service)|(?:小屏服务|屏幕服务|walnut-screen\.service).{0,12}(重启|restart)/i.test(lower);
  const hasMaintenanceGuidance = /(清理|整理|维护|maintenance|磁盘|存储|空间).*(安全|人工确认|不要直接|先告诉|选项|别替我|不要执行|不要删除)|(?:安全|人工确认|不要直接|先告诉|选项|别替我|不要执行|不要删除).*(清理|整理|维护|maintenance|磁盘|存储|空间)/i.test(lower);
  const hasRecentFailureDiagnostics = /(刚才|刚刚|最近|上次).*(失败|失败了|为什么|诊断|原因|修复|failure|failed)|(?:失败|failed).*(阶段|诊断|原因|修复|不要重试|别自动重试)/i.test(lower);
  const hasScreenStateFrameRead = /(小屏|屏幕|screen).*(服务|状态|画面|frame|显示).*(不要改变|不要同步|不要重启|只读|禁止|当前)|(?:只读|不要改变|不要同步|不要重启|禁止).*(小屏|屏幕|screen).*(服务|状态|画面|frame|显示)/i.test(lower);
  const hasObservationReplan = /(观察|快照|snapshot|inspect|observe|看设备状态).*(下一步|续步|继续|自动|replan|next\s*tasks?)|(?:下一步|续步|继续|自动|replan|next\s*tasks?).*(观察|快照|snapshot|inspect|observe|看设备状态)/i.test(lower);
  return {
    text,
    hasScreenNoun,
    hasWidgetAppNoun,
    hasWallpaperNoun,
    hasGenerateVerb,
    hasSyncVerb,
    hasNegatedSync,
    hasReadOnly,
    mentionsDevice,
    mentionsNetwork,
    mentionsI2c,
    mentionsGpio,
    mentionsStatus,
    asksAssistantInfo,
    hasTerminalIntent,
    hasNoteWrite,
    hasNotesRead,
    hasSessionSummaryRead,
    hasSnapshot,
    hasToolIntent,
    hasMemoryPreference,
    hasSensitiveTemporaryMemory,
    hasPolicySystemWrite,
    hasPolicyServiceRestart,
    hasMaintenanceGuidance,
    hasRecentFailureDiagnostics,
    hasScreenStateFrameRead,
    hasObservationReplan,
  };
}

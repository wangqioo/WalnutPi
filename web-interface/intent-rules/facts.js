export function extractIntentFacts(input) {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  const hasScreenNoun = /(小屏|屏幕|界面|lvgl|screen|480x320|480\s*[x×]\s*320|卡片|面板|workspace)/i.test(text);
  const hasGenerateVerb = /(生成|创建|设计|做|做成|整理成|来一个|写个|做个|generate|create|design)/i.test(text);
  const hasSyncVerb = /(同步|部署|推送|运行到|显示到|烧录|sync|deploy|flash)/i.test(text);
  const hasNegatedSync = /不(?:要|用|必)?\s*(?:同步|部署|推送|运行到|显示到|烧录)|别\s*(?:同步|部署|推送|运行到|显示到|烧录)|只\s*(?:预览|生成|看看)|preview\s*only|no\s*(?:sync|deploy)/i.test(text);
  const hasReadOnly = /只读|只(?:看|查|检查|查询)|不要(?:执行|修改|写|写入|重启|配置)|别(?:执行|修改|写|写入|重启|配置)|read[-\s]*only|don'?t\s*(?:write|restart|change|modify|execute)/i.test(text);
  const mentionsDevice = /(核桃派|设备|板子|系统|服务|屏幕服务|walnutpi)/i.test(text);
  const mentionsNetwork = /(网络|联网|wifi|wi-fi|(?<![a-z])ip(?![a-z])|路由|route|network|wlan)/i.test(lower);
  const mentionsGpio = /(gpio|引脚|针脚|i2c|spi|uart|pwm|总线|bus|set-device)/i.test(lower);
  const mentionsStatus = /(屏幕服务|状态|健康|还好[吗嘛]|status|health|系统|服务|docker|内存|存储|磁盘|空间)/i.test(lower)
    || (/怎么样/.test(lower) && /(核桃派|设备|板子|系统|服务)/.test(lower));
  const asksAssistantInfo = /(?:你是?谁|你能做什么|你能帮我做(?:什么|哪些事)?|能帮我做(?:什么|哪些事)|你可以做什么|你会做什么|介绍一下你自己|介绍一下自己|有什么功能)/i.test(text);
  const hasTerminalIntent = /(清屏|clear|重连|断开|ssh)/i.test(lower) || (/(连接)/i.test(lower) && !/(不要|别|no|don't|dont)/i.test(lower));
  const hasNoteWrite = /^(?:记一下|记录|note)\s*[:：]?/i.test(text);
  const hasNotesRead = /(今天.*(?:笔记|记录)|笔记.*今天|记了什么|notes|today)/i.test(lower);
  const hasSnapshot = /(快照|snapshot|release|os-release|kernel|内核|hostname|启动配置|boot|设备信息|板子信息|硬件信息)/i.test(lower);
  const hasToolIntent = !/播放\s*(按钮|键|控件)/.test(lower)
    && (/(walnut\s+(video|play)|视频|彩色\s*ascii|ascii\s*(视频|动画)?|demo)/i.test(lower)
      || /(运行|执行|打开|播放).*(玩具|演示|效果|动画|play)/i.test(lower));
  return {
    text,
    hasScreenNoun,
    hasGenerateVerb,
    hasSyncVerb,
    hasNegatedSync,
    hasReadOnly,
    mentionsDevice,
    mentionsNetwork,
    mentionsGpio,
    mentionsStatus,
    asksAssistantInfo,
    hasTerminalIntent,
    hasNoteWrite,
    hasNotesRead,
    hasSnapshot,
    hasToolIntent,
  };
}

# WalnutPi 架构收敛计划

本文档记录当前仓库“笨重、思路混乱”的处理方向。目标不是把 WalnutPi 重写成一个更大的平台，而是把已经验证过的主线收拢成清晰、可维护、适合新手理解的产品切片。

## 当前判断

WalnutPi 的产品主线已经清楚：

```text
自然语言或 guided intent
-> Web 预览小屏 Screen Manifest
-> 用户显式同步到 WalnutPi
-> WalnutPi 屏幕运行同一个界面
-> Web 展示状态、执行证据和 AI 可读总结
```

混乱主要来自两个地方：

- 仓库根目录把主线、旧实验、第三方参考、语音键盘、AI 终端、视频实验、投资介绍放在同一层级，读者看不出什么是当前产品。
- `web-interface/model-terminal-server.js` 承担过多实现：Control Plane API 路由、Screen Manifest 编辑、Screen Sync、修复建议、AI summary、session、SSH 终端、远程动作和 LVGL 预览都挤在一个文件里。

## 收敛原则

1. Screen Sync 是当前产品主线。
2. Web 默认入口要 beginner-first，不暴露 build id、hash、原始命令输出和图像字节。
3. `?nossh` 始终是 preview-only，不能触发 build、SSH、delivery、activation 或设备写入。
4. 保持现有 `walnut screen` CLI 行为，不破坏 `lvgl`、`start`、`stop`、`toggle`、`state`。
5. 不把 WalnutPi 做成 generic IDE、桌面应用平台、ESP32 烧录平台或 VibeBoard clone。
6. 优先加深已有 module，而不是继续增加浅 module。

## 目标结构

推荐把仓库概念上分成四类：

```text
Product spine
  web-interface/
  lvgl_app/
  scripts/screen-manifest-vocabulary.js
  scripts/build-lvgl-app.sh

Device execution surface
  walnut-assistant/
  framebuffer_ui/
  scripts/install-walnut-screen.sh

Support / memory / agent experiments
  walnut-ai-terminal/
  terminal-toys/
  console-chinese/
  hardware/

Experiments / references
  ai_video/
  voice-keyboard/
  investor-brief/
  third/
  third_party/
```

这只是文档分级，不要求立刻搬目录。第一阶段先让 README、CONTEXT 和 docs 说清楚“当前主线是什么，其他目录是什么身份”。

## 优先改造候选

### 1. 收口 `model-terminal-server.js`

**优先级：最高**

现状：单文件约 3500 行，接口几乎和实现一样复杂，读任何 screen 行为都要穿过大量无关代码。

目标：让它变成薄的 Control Plane API router，只负责：

- 静态文件响应
- 路由分发
- request/response glue
- preview-only gating 的统一入口

应从中抽出的 module：

- Screen Manifest Editor：模板、自然语言 patch、manifest 写入和 hash 校验。
- Screen Evidence Review：repair hint、repair candidate、repair proposal、AI summary evidence。
- Web Session Ledger：session id、jsonl append/read、event normalize。
- Walnut Remote Adapter：SSH、`walnut` CLI preflight、timeout、output clipping。
- LVGL Preview Renderer：本地 offscreen preview build/render/cache。

验收标准：

- `model-terminal-server.js` 明显缩小，主要是 route table 和 handler glue。
- 每个新 module 的 interface 能用一两句话解释。
- `scripts/test-screen-api-safety.ps1` 仍通过。

### 2. 加深 Screen Evidence Review

**优先级：高**

现状：`screen-evidence-ledger.js` 负责持久化记录，但失败阶段解释、修复建议、修复提案和 AI summary evidence 在 server 文件里。

目标：把“同步证据如何解释”集中到一个 module。

输入：

- screen sync record
- command results
- pixel diff evidence

输出：

- beginner summary
- developer diagnosis
- repair hint
- repair candidate
- repair proposal
- AI summary evidence

验收标准：

- repair 和 summary 路由只读 record，然后调用一个 review interface。
- 失败阶段文案和诊断规则集中维护。
- ledger 仍只负责 durable record，不承担 UI 文案拼装。

### 3. 统一 Walnut Remote Adapter

**优先级：中高**

现状：SSH options、`sshpass`、ControlMaster、`walnut` CLI preflight、timeout、output clipping 在 delivery、action、terminal、capture 路径中分散。

目标：形成一个 remote execution adapter，供以下 caller 复用：

- Screen Delivery Adapter
- `/api/action`
- `/terminal`
- `/api/screen/frame/<buildId>`

验收标准：

- SSH 连接策略只有一个实现。
- `walnut` CLI 安装/校验 preflight 只有一个实现。
- 高风险设备写入仍由调用方显式声明，不被 adapter 自动隐藏。

### 4. 明确仓库产品分级

**优先级：中**

现状：README 仍像“设备总工作区说明”，但当前项目方向已经收敛到 Screen Sync slice。

目标：README 开头先讲当前产品主线，再讲其他目录的身份。

验收标准：

- 新读者 30 秒内知道当前主线是 Screen Manifest + Web preview + Sync + Evidence。
- `third/VibeBoard` 和 `third/walnutpi` 只作为 reference，不被误读为要复制的实现。
- 旧实验不删除，但被明确标注为 support、experiment 或 reference。

### 5. 减少 Screen Manifest 生成链重复

**优先级：中**

现状：`scripts/screen-manifest-vocabulary.js`、`generate-lvgl-screen-config.js`、`generate-lvgl-screen-config.py` 重复了 schema、字段、颜色、hash 和生成规则。

目标：明确一个 canonical implementation。另一个语言版本只有在真实运行约束需要时才保留，并通过测试或生成方式避免 drift。

验收标准：

- Screen Manifest 的规则只有一个事实来源。
- generatedPage 字段、accent、tone、hash 行为不会在 JS/Python 间漂移。
- build 路径仍能在设备上稳定运行。

## 第一阶段建议

第一阶段只做低风险收敛，不改变产品行为：

1. 新增或更新 docs，固定“当前主线”和 module 分级。
2. 从 `model-terminal-server.js` 抽出 Web Session Ledger。
3. 从 `model-terminal-server.js` 抽出 Screen Evidence Review。
4. 从 `model-terminal-server.js` 抽出 LVGL Preview Renderer。
5. 跑 `pwsh ./scripts/test-screen-api-safety.ps1`。

不建议第一阶段做：

- 搬动大量目录。
- 删除旧实验。
- 重写 Web UI。
- 改变 delivery adapter 已验证的 `sudo -n systemctl restart walnut-screen.service` 路径。
- 把 `walnut screen start` 替换成 Web delivery adapter 命令。

## 决策规则

新增功能先回答三个问题：

1. 它服务 Screen Sync 主线吗？
2. 它应该在 Web preview、Control Plane API、Screen Sync Workflow、Delivery Adapter、Device Execution Surface、Evidence Ledger 哪个位置？
3. 它是否会让 beginner UI 暴露 build、hash、raw output、frame bytes 或高风险设备动作？

如果答案不清楚，先放进 experiment/support 文档，不进入产品主线。

## 完成状态定义

一次收敛改造完成，应满足：

- beginner flow 不变：`未同步`、`同步中`、`已同步到核桃派`、`同步失败`。
- `?nossh` 仍阻断所有设备路径。
- 同步仍要求当前 `manifestHash`。
- artifact evidence 和 delivery manifest/hash 仍绑定真实 artifact SHA-256。
- developer diagnostics 仍能看到记录、命令输出、frame route、repair、AI summary 和 pixel diff。
- 安全回归脚本通过。


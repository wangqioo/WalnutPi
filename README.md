# WalnutPi

WalnutPi 当前主线是一个 AI 原生终端系统，其中 Walnut Agent Console 是普通用户入口，Device Execution Surface 是设备执行层，480x320 小屏是可玩的输出面。当前最成熟的工作区是 Screen Workspace：

```text
用户提出需求
-> Walnut Agent Console 选择 Intent Route
-> Device Execution Surface 执行受控 Local Action
-> 生成或处理 Screen Content / Source Asset
-> 规范化为 480x320 Screen Manifest v2 输出
-> 写入 Screen Playlist v1
-> Screen Preview 检查小屏效果
-> 用户显式同步到 WalnutPi
-> WalnutPi Device 运行对应的 Runtime Screen Assets 并完成 Real-Device Verification
```

本文档以中文为主，命令名、软件名和少数技术术语保留英文原名。

这个仓库里的终端界面、音频、部署配置、ASCII 视频、中文控制台和硬件实验都按 Human CLI Command、Archived Capability、素材处理能力或设备支持面来组织。当前要优先打磨的是 Walnut Agent Console 如何把这些能力组织起来，并把结果变成可预览、可同步、可真机验证的 480x320 核桃派小屏界面。

## 这台设备是什么

当前原型是一台运行无桌面 Debian Linux 的 WalnutPi。

已观察到的环境如下：

- 系统：Debian GNU/Linux 12 bookworm
- 架构：arm64 / aarch64
- 内核：Linux 6.1.31
- 默认访问方式：CLI / SSH，没有桌面环境
- 网络：通过 NetworkManager 管理 Wi-Fi
- 运行时：Python 3.11、Docker、systemd
- AI 访问：通过兼容 OpenAI 的 API 调用云端 AI
- 音频：通过 PulseAudio A2DP 播放蓝牙音频
- 监控：Docker 中运行 Uptime Kuma
- 远程访问：frpc 连接到已有 frps 服务

这台设备定位为轻量本地交互载体，云端模型负责主要 AI 推理。

## 当前核心体验

当前要优先维护的用户路径是：

- 用户在 Walnut Agent Console 或 Screen Workspace UI 里准备 Screen Content / Source Asset：文字、状态、图片、GIF、视频帧、生成图、手写像素图或其他 480x320 画面。
- Walnut Agent Console 选择 Intent Route，并通过 Local Action Policy 调用受控能力。
- Screen Workspace pipeline 把输入规范化为 480x320 PNG 或 480x320 帧序列。
- Web 读取 `GET /api/screen/workspace/playlist` 并显示 Screen Preview。
- 用户确认后调用 `POST /api/screen/workspace/sync`，请求必须携带当前 `playlistHash`。
- Web delivery adapter 同步 Runtime Screen Assets，优先 hot reload；LVGL runtime 需要升级时再运行 `scripts/build-lvgl-app.sh`。
- Real-Device Verification 使用服务状态、`walnut screen state`、`sudo -n walnut screen frame` 和按需 capture evidence。
- 初学者 UI 只显示 `未同步`、`同步中`、`已同步到核桃派`、`同步失败`。
- `buildId`、hash、命令输出、delivery manifest、frame route、截图字节和 repairHint 都留在 Developer Diagnostics。

## 核心思路

项目方向仍然是一个 AI 原生终端系统：

> 无桌面 Linux + 命令行交互 + 结构化卡片 + 云端 AI API + 轻量本地硬件控制。

更准确地说，WalnutPi 是一台有本地执行能力的 AI 终端。
它有 Linux shell、网络访问、Python / CLI 脚本、GPIO / I2C / SPI / UART、本地文件、长驻服务，以及可以展示执行现场的真实终端和小屏幕。

Web 里的对话入口和 CLI 工具调用不冲突。对话负责理解用户需求、组织步骤、判断风险和总结结果；CLI 负责稳定执行设备能力，例如 `walnut screen`、状态读取、笔记、音频/视频/ASCII 工具、网络检查和维护命令。

自然语言入口是设备 agent：

```text
用户自然语言
-> 意图分类
-> 本地执行计划
-> 安全检查
-> 执行或确认
-> AI 总结结果
```

例如用户说“做一个上海天气的像素小屏”，Walnut Agent Console 可以先获得天气信息，再生成像素风 480x320 小屏预览，最后让用户确认是否同步到核桃派。用户问“核桃派现在还好吗”时，agent 可以调用本地状态检查并总结。

本地设备负责：

- 输入和输出
- 网络连接
- 终端界面渲染
- 系统状态采集
- 小脚本和本地自动化
- 音频播放
- 图、文、视频素材的本地处理和 ASCII / 像素转换
- 服务托管
- 受控实时查询，例如天气、时间、网络和本机状态
- 低风险本地操作，例如读取笔记、保存笔记、运行只读检查

云端负责：

- 语言推理
- 文本生成
- 翻译
- 总结
- 规划
- 未来的多模态 AI 任务

安全边界按动作风险分层：

- 普通问答：直接交给云端 AI。
- 本地可执行问答：天气、时间、网络状态、设备状态、文件 / 笔记查询、简单 HTTP 查询，由 WalnutPi 先执行，再让 AI 总结。
- 高风险或有副作用操作：GPIO 输出、改 overlay、安装包、重启、关机、删文件、刷写和 EMMC 操作，必须先解释影响并等待明确确认。

## 现在能做什么

这台 WalnutPi 目前已经可以：

- 通过 Web 对话生成 480x320 小屏 manifest，并在浏览器里预览 LVGL 结果
- 将当前小屏 manifest 显式同步到 WalnutPi 屏幕
- 运行 `walnut`，也就是 Walnut Home 命令中心
- 运行 `walnut-ai`，一个轻量 AI 终端原型
- 通过 OpenAI 兼容 API 调用云端 AI
- 把笔记保存为 Markdown
- 翻译和润色文本
- 用自然语言触发受控本地查询和只读检查
- 在终端里显示系统状态
- 通过 frpc 暴露 SSH 远程访问
- 通过 AirPods / A2DP 播放音频
- 通过 `fbterm` 支持本地 framebuffer 中文显示
- 使用 ASCII 视频和终端玩具作为素材/可玩性工具
- 保持正常 CLI 启动，不强制接管系统启动 shell

## 先试什么

- `bun run web` 启动 Web 对话和小屏同步入口
- 在 Web 里描述一个 480x320 小屏，例如“做一个粉色猫猫 IP 眨眼像素动画”或“把音乐频谱做成像素风小屏”
- 确认预览后同步到 WalnutPi
- `walnut` 作为主入口
- `walnut ai` 直接进入云端 AI 终端
- `walnut-ai "上海天气怎么样"` 运行一次性本地 agent 回合
- `walnut play` 体验音乐、数字雨、时钟和 ASCII 视频
- `walnut maintenance` 进入浏览器、监控和修复菜单
- `bun run bench:product -- --profile offline --first-variant` 快速跑一次产品能力 harness
- `bun run bench:product:gate` 跑 offline all-variant 门禁并和已审核 baseline 比较

## 适合做什么

这台设备比较适合：

- 便携式 AI 终端实验
- 云端 AI 交互外壳
- 无桌面 Linux UI 原型
- AI 笔记工具
- 轻量终端仪表盘
- 个人自动化脚本
- 服务监控
- 远程访问实验
- 后续加入可靠 USB 麦克风后的语音输入原型

## 硬件适配

当前原型适合轻量本地交互、云端 AI 外壳、终端工具、小屏显示、服务监控和外设实验。硬件目标集中在低功耗终端体验、Runtime Screen Assets 播放和 Hardware Peripheral 扩展。AirPods 播放可用；语音输入优先使用 USB 麦克风这类 Input Accessory。详细记录见 `archive/experiments/audio/airpods-linux/`。

## 仓库结构

```text
WalnutPi/
├── web-interface/           # Product spine: Web preview, sync API, evidence diagnostics
├── lvgl_app/                # Product spine: LVGL Screen App for Runtime Screen Assets
├── scripts/                 # Product spine scripts plus device install helpers
├── walnut-assistant/        # Device execution surface: walnut CLI and screen commands
├── achievement/             # Retired achievements and proven experiments
├── walnut-ai-terminal/      # Support / memory / agent experiments
├── archive/experiments/     # Archived playable tools, media, console, audio, voice, and brief experiments
├── hardware/                # Support: observed hardware and screen records
├── third/                   # Reference projects only
├── third_party/             # Vendored or external reference material
└── README.md                # Project overview
```

`third/` 和 `third_party/` 保留为参考和依赖来源；当前产品语言和决策以 `CONTEXT.md` 与 `docs/adr/` 为准。

## 项目分区

### Walnut Home

路径：`walnut-assistant/`

这是一台便携式 AI 终端的主命令中心，也是板子的主要启动入口。

运行：

```bash
walnut
```

### Walnut Agent Console

路径：`web-interface/`

这是面向普通用户的浏览器入口。目标交互是一个自然语言输入框，由 Walnut Agent Console 选择 Intent Route 并组织受控能力：

```text
我想知道核桃派现在还好吗
帮我看一下网络
上海天气怎么样
我想接一个 I2C 传感器
记一下今天调好了 Wi-Fi
```

左侧负责理解、计划、执行和总结；右侧负责展示 3D 设备、执行现场和高级交互终端。普通用户通过意图表达需求，Agent Action Command 和 Developer Diagnostics 留给系统内部与高级用户。

当前 Walnut Agent Console 承载 Screen Workspace v2 同步闭环：

```text
Web conversation / workspace source processing
-> Screen Manifest v2 output
-> Screen Playlist v1
-> Playlist hash gate
-> Runtime Screen Assets
-> real-device sync and evidence
```

当前小屏 contract 归 `screen/` 工作区所有。`screen/manifests/*.json` 使用 `walnutpi.screen-manifest.v2`，`screen/playlists/default.json` 使用 `walnutpi.screen-playlist.v1`。`scripts/screen-workspace-vocabulary.ts` 是验证和 hash 规则事实来源，`scripts/generate-lvgl-screen-workspace-runtime-assets.ts` 是 Runtime Screen Assets 生成器。LVGL Screen App 只消费由当前 Screen Playlist 派生的 Runtime Screen Assets。

运行本地控制台：

```bash
cd /home/pi/projects/WalnutPi
PORT=4173 bun web-interface/model-terminal-server.ts
```

浏览器打开：

```text
http://127.0.0.1:4173/
```

同步相关接口：

- `GET /api/screen/workspace/playlist`：返回默认 Screen Playlist envelope 和 `playlistHash`。
- `POST /api/screen/workspace/sync`：要求浏览器提交匹配且格式合法的 `playlistHash`；缺失、非法或过期 hash 会在构建 / SSH 前拒绝。默认使用 fast evidence，只验证 runtime 资源、playlist hash、LVGL artifact hash 和 `walnut-screen.service` active 状态；请求体加 `evidenceMode: "full"` 才同步等待完整 framebuffer hash 回证。
- `GET /api/screen/manifest`、`POST /api/screen/sync`：已移除；任何调用都应得到 404。
- `GET /api/screen/frame/<buildId>`：开发者诊断专用，按需只读抓取设备 PNG 画面；默认同步 JSON 不内嵌图片字节或 `pngBase64`。
- `GET /api/screen/records`、`GET /api/screen/records/<buildId>`、`GET /api/screen/records/<buildId>/frame.png`：开发者诊断历史。
- `POST /api/screen/pixel-diff`：把浏览器算出的 `walnutpi.webDevicePixelDiff.v2` 写回本地 Sync Record，用于 Developer Diagnostics。

普通用户只看到 `未同步`、`同步中`、`已同步到核桃派`、`同步失败`。`buildId`、playlist hash、manifest hash、artifact hash、delivery hash、命令输出、screen state、framebuffer frame hash、`visualMatch` / `visualChecks`、metadata-only pixel evidence、诊断级 Web/device pixel diff、历史记录、repairHint 和按需设备截图放在 Developer Diagnostics。fast evidence 下 `visualMatch` 为 `playlist-committed`；完整 framebuffer 回证通过时为 `captured`。

Screen Workspace 同步已经规范化到 480x320 的输出。静态输出是 480x320 PNG；动画输出是 480x320 帧序列加时长；Sync 使用本地 Screen Output 和 Runtime Screen Assets。LVGL Screen App 消费由 Screen Playlist 派生的 Runtime Screen Assets。

Walnut Agent Console 也是当前产品能力 harness 的入口：

```text
bun run bench:product
-> POST /api/agent/turn
-> agentTurn.v2 steps/artifacts/evidence/sideEffects/recovery/telemetry
-> screen/benchmark-runs/<runId>/summary.json
```

`bench:product` 默认跑每个 case 的所有 variants，并用 bounded worker pool 执行，默认 `--concurrency 4`。快速本地检查可以加 `--first-variant`；需要复现串行行为时加 `--concurrency 1`。可重复门禁使用 `--profile offline`。Profile 只按 JSONL case 的显式 `requirements` 过滤：`offline` 会把 device/network/model/search 要求记录为 profile skip，`network` 只跳过 device，`device` 包含真机相关 case。Harness 不从自然语言或 flow 名字推断 requirements。

常用 benchmark 命令：

```bash
bun run bench:product -- --profile offline --first-variant
bun run bench:product -- --profile offline --concurrency 1
bun run bench:product -- --case-id V1-01
bun run bench:product -- --profile device --strict-device-preflight
bun run bench:product:compare -- screen/benchmark-baselines/offline/summary.json screen/benchmark-runs/<runId>/summary.json
bun run bench:product:gate
```

`bench:product:gate` 固定跑 offline all-variant benchmark，然后比较 `screen/benchmark-baselines/offline/summary.json`。baseline 不存在时 gate 会失败；先人工审核一次 run，再复制 summary：

```powershell
bun scripts/run-product-capability-agent-harness.ts --profile offline --run-id baseline-offline
New-Item -ItemType Directory -Force screen/benchmark-baselines/offline
Copy-Item screen/benchmark-runs/baseline-offline/summary.json screen/benchmark-baselines/offline/summary.json
```

device profile 每次 run 会记录 `device-preflight.json` 和 `summary.environment.devicePreflight`，包括 target、remote root 来源、Web/API 可达性和不可重复因素。严格预检只检查本地环境与 HTTP 层，不 SSH、不运行 `walnut`、不改设备。

同步记录默认保存在 `web-interface/screen-sync-records/`，该目录不进入 Git。每条记录保存 `record.json`、`summary.json`，开发者展开诊断截图后还会缓存 `frame.png`。默认保留最近 50 条，可用 `WALNUT_SCREEN_RECORD_LIMIT` 调整，也可用 `WALNUT_SCREEN_RECORDS_DIR` 改变保存目录。

当前真机闭环目标：

```text
Screen Playlist v1 -> POST /api/screen/workspace/sync -> runtime resource sync -> hot reload -> service-active evidence
Full diagnostics: add evidenceMode="full" -> walnut screen state -> sudo -n walnut screen frame
```

真机验证时遇到过两个环境问题：

- 用默认 `root` SSH 登录时，远端 `$HOME/projects/WalnutPi` 会变成 `/root/projects/WalnutPi`，但实际 checkout 在 `/home/pi/projects/WalnutPi`。
- 旧的 root-owned `build/lvgl_app` 文件会导致 `pi` 构建时无法写入 `lvgl.pc.tmp`、`lv_version.h.tmp` 和 `CMakeCache.txt`。
- LVGL runtime 升级需要 `ccache`、`ninja-build`、`cmake`、`nodejs`。先在设备上跑 `sudo /home/pi/projects/WalnutPi/scripts/install-lvgl-build-deps.sh`。`scripts/build-lvgl-app.sh` 默认使用 Ninja；旧 Makefiles cache 会被替换成 Ninja build cache。

当前常用 root/root 环境可以直接显式指定远端 checkout：

```bash
SSH_USER=root SSH_PASSWORD=root WALNUT_REMOTE_PROJECT_ROOT=/home/pi/projects/WalnutPi WALNUT_REMOTE_BUILD_USER=pi bun web-interface/model-terminal-server.ts
```

Web 同步默认用 `pi` 执行 LVGL build。若历史构建留下 root-owned 文件，需要把远端构建目录修回 `pi:pi`，否则脚本替换旧 CMake cache 或写入 Ninja cache 时会失败：

```bash
sudo chown -R pi:pi /home/pi/projects/WalnutPi/build/lvgl_app
```

### 中文本地控制台（已归档）

路径：`archive/experiments/console-chinese/`

这里记录本地屏幕上的中文显示方案：

- Linux TTY 的 CJK 字形支持由 `fbterm` 补足
- 使用 `fbterm` 配合 WenQuanYi / Noto / Droid 回退字体
- `walnut-cn` / `walnut console` 是历史 Human CLI Command 入口
- 当前本地 `tty1` 可以通过 `fbterm` 进入支持中文的普通 shell，SSH 会话不受影响

### 终端玩具（已归档）

路径：`archive/experiments/terminal-toys/`

这里放的是 Walnut Play 使用的纯终端工具，例如音乐、数字雨、时钟和 ASCII 视频。
`walnut-fun` 现在只是兼容包装器，内部转发到 `walnut play`。

### 硬件说明

路径：`hardware/`

这里记录观察到的设备信息：系统、CPU、内存、存储、framebuffer 屏幕、触摸控制器、GPU / 显示说明、蓝牙 / 音频限制，以及有用的检查命令。

### Framebuffer UI

路径：`achievement/framebuffer_ui/`

这是无桌面系统直接写 `/dev/fb0` 的屏幕 UI 实验，使用 Linux framebuffer 路径运行。

在 WalnutPi 小电脑本地或 SSH 进入项目：

```bash
cd /home/pi/projects/WalnutPi
```

手动绘制一次真实状态屏：

```bash
walnut screen test
walnut screen demo
walnut screen off
```

显示一张 JPG/PNG 图片：

```bash
walnut screen image /path/to/image.jpg
```

显示本地健康摘要或 AI 回复卡片：

```bash
walnut screen ai
walnut screen ai "WalnutPi OK FRP online Disk 36%"
```

进入可操作的小屏菜单：

```bash
walnut screen app
```

按键：

```text
j/k 或方向键  移动选择
Enter          打开页面
b              返回菜单
q              退出
```

作为独占小屏幕服务运行：

```bash
sudo walnut screen status
```

恢复本地登录屏：

```bash
sudo walnut screen restore
```

### LVGL 屏幕 UI

路径：`lvgl_app/`

这是无桌面系统上的 LVGL 原型，直接通过 LVGL 的 Linux fbdev 驱动写 `/dev/fb0`。

本机构建现在按平台分流：

- Windows：优先用 `scripts/build-lvgl-app.ps1`，产物在 `build/lvgl_app-windows/`
- Debian / WalnutPi：继续用 `scripts/build-lvgl-app.sh`，强制使用 Ninja，产物在 `build/lvgl_app/`
- 跨平台入口：`scripts/build-lvgl-app.ts`

第一次构建会自动使用 `third_party/lvgl/`。如果源码不存在，脚本会拉取 LVGL v9.2.2：

```bash
cd /home/pi/projects/WalnutPi
scripts/build-lvgl-app.sh
```

运行 LVGL 小屏界面：

```bash
walnut screen lvgl
```

安装正式小屏服务：

```bash
sudo scripts/install-walnut-screen.sh
```

启动持续运行的 LVGL 小屏系统：

```bash
sudo walnut screen start
```

恢复本地登录终端：

```bash
sudo walnut screen stop
```

一键切换 LVGL 小屏 / 本地登录终端：

```bash
sudo walnut screen toggle
```

查看当前屏幕状态：

```bash
walnut screen state
```

只读抓取当前 framebuffer 为 PNG 证据：

```bash
walnut screen capture
walnut screen capture --png-base64
```

默认输出只包含 PNG 元数据、尺寸、字节数和 SHA-256；`--png-base64` 只供 Web 诊断图片路由按需使用。

当前 LVGL 页面包含旋转圆环、呼吸核心、滑入状态卡片、循环进度条和日志刷新，并会读取真实设备状态：

- IP 地址
- 内存使用率
- 磁盘使用率
- FRP 状态
- load average
- uptime

小屏系统会自动轮播 4 个页面：

- `HOME`：动画核心、IP、内存、磁盘、FRP/load/uptime
- `SYS`：系统状态摘要
- `AI`：本地 agent 状态和后续任务
- `NET`：IP、FRP、SSH、显示后端

USB 键盘可控制页面：

```text
方向键 / Enter   手动切页
空格             暂停或继续自动轮播
q / Esc          退出 LVGL 进程，systemd 会按策略重启
```

更新 AI 页面文本：

```bash
sudo walnut screen ai "WalnutPi screen AI page is live"
```

它用来验证“Server 无桌面系统也可以跑真正的嵌入式 UI 框架”。后续可以继续接入触摸坐标、真实 AI 总结和更完整的设置页。

Web 同步第一版复用现有 LVGL 运行边界，不改变 `walnut screen` 命令：

- 内容交付：同步 `screen/runtime/default.txt` 和 RGB565 frame 文件
- 构建：仅在远端 LVGL runtime 需要升级时运行 `scripts/build-lvgl-app.sh`
- 激活：runtime hot reload 优先，`sudo -n systemctl restart walnut-screen.service` 是升级 fallback；`walnut screen start` 仍保留为用户可见 CLI 入口。
- 回证：默认快速检查服务和 playlist 绑定；完整诊断时使用 `walnut screen state` + `sudo -n walnut screen frame`
- 诊断截图：`walnut screen capture`，通过 `/api/screen/frame/<buildId>` 按需返回 PNG
- 同步记录：保存 Sync Record 和 repairHint；Repair Proposal 尚未作为 API 实现
- 目标：`/dev/fb0`，480x320，RGB565

这里的“同步到核桃派”是把当前 Screen Playlist 及其引用的 Screen Manifest v2 输出转换为 Runtime Screen Assets，交付给 WalnutPi 本地 LVGL Screen App，并记录可诊断的 delivery/evidence。

### WalnutAI 终端 V0

路径：`walnut-ai-terminal/`

一个面向无桌面 Linux 的轻量本地 agent / 云端 AI 终端。

在 WalnutPi 上运行：

```bash
walnut-ai
walnut-ai "上海天气怎么样"
```

当前命令：

```text
/status              显示设备、服务、Docker、内存和磁盘状态
/note text           保存一条 Markdown 笔记
/polish text         用云端 AI 轻度润色文本
/translate text      中英互译
/clear               清空当前会话上下文
/help                显示帮助
/exit                退出
```

不带参数时进入交互式聊天；带参数时运行一次性 agent 回合。一次性回合会优先判断是否可以由 WalnutPi 本地执行，例如天气、状态、网络、笔记和硬件只读检查；其他问题交给云端 AI。

一次性本地 agent 回合可能在普通回答末尾追加一行机器可读 trace：

```text
WALNUT_AGENT_TURN_TRACE:{...}
```

该 JSON 与 Web `/api/agent/turn` trace 保持同一组核心字段：`route`、`steps[]`、`evidence`、`contextUsed`。benchmark 和 diagnostics 应优先读取这些共享字段，而不是为 Web 和 CLI 维护两套语义。

### AirPods Linux 音频说明（已归档）

路径：`archive/experiments/audio/airpods-linux/`

这里记录蓝牙音频调查结果：

- A2DP 播放通过 PulseAudio 可用
- 正常播放时应保持 BlueALSA 关闭
- 在板载蓝牙控制器上，AirPods 麦克风采集失败
- 后续语音输入更适合使用 USB 麦克风

## 原型机当前服务

系统重置后，当前只恢复了基础 SSH 隧道：

- `frpc.service`：已启用
- FRP SSH 隧道：`walnutpi-ssh`，`150.158.146.192:6230 -> 127.0.0.1:22`
- Walnut Home 启动器：`/usr/local/bin/walnut`
- WalnutAI 启动器：`/usr/local/bin/walnut-ai`
- WalnutAI 代码：`/opt/walnut-ai/walnut_ai.py`
- 中文控制台助手：历史安装中可能存在 `/usr/local/bin/walnut-cn`，当前按 Archived Capability 处理

## 开发规则

- 新实验放在独立子目录，成熟后再进入产品路径。
- 设备本地秘密信息留在本机配置或环境变量里。
- 设备启动先进入标准 CLI，自定义交互通过 `walnut`、`walnut-ai` 或 Walnut Agent Console 进入。
- 功能有重叠时优先扩展 `walnut` Device Execution Surface。
- Linux 服务和脚本保持简单、可审计。
- `/home/pi/projects` 保持 `pi:pi` 所有，源码真相保留在项目 checkout 或 `WALNUT_PROJECT_ROOT`。
- `/usr/local/bin` 是公开命令面，`/opt` 是已安装运行态。

## 近期路线

- 给 WalnutAI Terminal 增加持久会话历史
- 增加更丰富的终端卡片渲染
- 给 frpc 增加状态命令
- 增加蓝牙 / 音乐控制命令
- 增加一个能在手机上访问的小型本地 Web UI

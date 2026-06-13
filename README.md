# WalnutPi

WalnutPi 当前主线是一个 beginner-first 的小屏同步闭环：

```text
自然语言或 guided intent
-> Web 预览小屏 Screen Manifest
-> 用户显式同步到 WalnutPi
-> WalnutPi 屏幕运行同一个界面
-> Web 展示状态、执行证据和 AI 可读总结
```

本文档以中文为主，命令名、软件名和少数技术术语保留英文原名。

这个仓库仍然保存终端界面、音频、部署配置和硬件实验，但当前产品判断以 Screen Manifest + Web preview + Sync + Evidence 为主线。其他目录是设备执行面、支持记忆、历史实验或第三方参考，不代表要把 WalnutPi 做成 generic IDE、桌面应用平台、ESP32 烧录平台或 VibeBoard clone。

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

这台设备被刻意当作轻量本地交互载体，而不是本地大模型推理机器。

## 当前产品主线

当前要优先维护的用户路径是：

- Web 读取 `GET /api/screen/manifest` 并渲染 480x320 小屏预览。
- 用户确认后调用 `POST /api/screen/sync`，请求必须携带当前 `manifestHash`。
- 后端用 `scripts/build-lvgl-app.sh` 构建设备端 LVGL 程序。
- Web delivery adapter 激活已验证路径 `sudo -n systemctl restart walnut-screen.service`。
- 设备证据来自 `walnut screen state` 和 `sudo -n walnut screen frame`。
- 初学者 UI 只显示 `未同步`、`同步中`、`已同步到核桃派`、`同步失败`。
- `buildId`、hash、命令输出、delivery manifest、frame route、截图字节、repair 和 AI summary evidence 都留在开发者诊断层。

`?nossh` 是 preview-only 模式：它不能触发 build、SSH、delivery、activation、截图或设备写入。

## 核心思路

项目方向是一个 AI 原生终端系统：

> 无桌面 Linux + 命令行交互 + 结构化卡片 + 云端 AI API + 轻量本地硬件控制。

更准确地说，WalnutPi 不是一个“只能聊天的前端”，而是一台有本地执行能力的 AI 终端。
它有 Linux shell、网络访问、Python / CLI 脚本、GPIO / I2C / SPI / UART、本地文件、长驻服务，以及可以展示执行现场的真实终端和小屏幕。

自然语言入口的目标不是 MCP 风格的工具按钮面板，而是设备本地 agent：

```text
用户自然语言
-> 意图分类
-> 本地执行计划
-> 安全检查
-> 执行或确认
-> AI 总结结果
```

例如用户问“上海天气怎么样”，设备应该先在本地执行受控天气查询，再把结果总结成人话，而不是回答“我不能实时读取”并要求用户自己运行 `curl`。

本地设备负责：

- 输入和输出
- 网络连接
- 终端界面渲染
- 系统状态采集
- 小脚本和本地自动化
- 音频播放
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

- 运行 `walnut`，也就是 Walnut Home 命令中心
- 运行 `walnut-ai`，一个轻量 AI 终端原型
- 通过 OpenAI 兼容 API 调用云端 AI
- 把笔记保存为 Markdown
- 翻译和润色文本
- 用自然语言触发受控本地查询和只读检查
- 在终端里显示系统状态
- 通过 frpc 暴露 SSH 远程访问
- 通过 AirPods / A2DP 播放音频
- 通过 `fbterm` 在本地 framebuffer 控制台显示中文
- 保持正常 CLI 启动，不强制接管系统启动 shell

## 先试什么

- `walnut` 作为主入口
- `walnut ai` 直接进入云端 AI 终端
- `walnut-ai "上海天气怎么样"` 运行一次性本地 agent 回合
- `walnut play` 体验音乐、数字雨、时钟和 ASCII 视频
- `walnut console` 进入中文 framebuffer 控制台
- `walnut maintenance` 进入浏览器、监控和修复菜单

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

## 不适合做什么

当前原型不适合：

- 运行大型本地 LLM
- 代替桌面 Linux 工作站
- 做 Android 风格的多应用交互
- 承载重型 GPU / 3D UI
- 依赖板载蓝牙控制器稳定采集 AirPods 麦克风

AirPods 播放是可用的，但 AirPods 麦克风捕获在这块板子的板载蓝牙控制器上失败了，因为 Linux 下 SCO 麦克风数据没有正常通过 HCI 到达。详细记录见 `audio/airpods-linux/`。

## 仓库结构

```text
WalnutPi/
├── web-interface/           # Product spine: Web preview, sync API, evidence diagnostics
├── lvgl_app/                # Product spine: manifest-driven LVGL fbdev app
├── scripts/                 # Product spine scripts plus device install helpers
├── walnut-assistant/        # Device execution surface: walnut CLI and screen commands
├── framebuffer_ui/          # Device execution surface: framebuffer experiments and install path
├── walnut-ai-terminal/      # Support / memory / agent experiments
├── terminal-toys/           # Support: Walnut Play terminal tools
├── console-chinese/         # Support: framebuffer Chinese console notes
├── hardware/                # Support: observed hardware and screen records
├── ai_video/                # Experiment
├── voice-keyboard/          # Experiment
├── investor-brief/          # Experiment / presentation material
├── third/                   # Reference projects only
├── third_party/             # Vendored or external reference material
└── README.md                # Project overview
```

`third/VibeBoard` 只是产品架构参考，可以借鉴 artifact manifest、delivery adapter、build evidence、device evidence 等概念；不要复制它的 React app、ESP-IDF 假设、OTA/flash 流程、board profile 或服务。`third/walnutpi` 只是 WalnutPi 体验参考，可以借鉴 device presence、rich terminal evidence、memory 和 WalnutPi-specific skills；不要用它整体替换当前项目。

未来新增模块先判断是否服务 Screen Sync 主线；如果不是，先放在 support、experiment 或 reference 身份下，不进入产品主线。

## 项目分区

### Walnut Home

路径：`walnut-assistant/`

这是一台便携式 AI 终端的主命令中心，也是板子的主要启动入口。

运行：

```bash
walnut
```

### Web Agent 控制台

路径：`web-interface/`

这是面向小白的浏览器入口。目标交互不是让用户点击一排工具按钮，也不是把用户推进右侧终端菜单，而是只提供一个自然语言输入框：

```text
我想知道核桃派现在还好吗
帮我看一下网络
上海天气怎么样
我想接一个 I2C 传感器
记一下今天调好了 Wi-Fi
```

左侧负责理解、计划、执行和总结；右侧负责展示 3D 设备、执行现场和高级交互终端。普通用户不需要知道 `walnut status`、`gpio pins`、`curl wttr.in` 这些命令。

当前 Web 控制台也承载第一版“小屏界面同步”闭环：

```text
Web 端读取 screen manifest
-> 左侧显示 LVGL 小屏语义预览
-> 用户点击“同步到核桃派”
-> 后端构建 LVGL 程序
-> 生成 WalnutPi delivery manifest
-> 启动 walnut-screen.service
-> 读取 walnut screen state、framebuffer frame hash 和结构性画面回证
```

当前小屏 contract 保存在 `lvgl_app/screen-manifest.json`。Web 预览、`manifestHash` 校验和 delivery manifest 都从这个文件派生；可用 `WALNUT_SCREEN_MANIFEST_PATH` 指向另一个 manifest 进行本地验证。

Screen Manifest 的 schema、字段清洗、`generatedPage`、`accent`、`tone` 和 hash 规则以 `scripts/screen-manifest-vocabulary.js` 为事实来源。`scripts/generate-lvgl-screen-config.js` 是 canonical LVGL 配置生成器；`scripts/generate-lvgl-screen-config.py` 只保留为兼容入口，会委托给 JS 生成器，不再维护第二套规则。

运行本地控制台：

```bash
cd /home/pi/projects/WalnutPi
PORT=4173 bun web-interface/model-terminal-server.js
```

浏览器打开：

```text
http://127.0.0.1:4173/
```

如果只想看 Web 预览、不连接 SSH 或真实核桃派：

```text
http://127.0.0.1:4173/?nossh
```

同步相关接口：

- `GET /api/screen/manifest`：返回当前小屏 manifest 和 hash。
- `POST /api/screen/sync`：要求浏览器提交匹配且格式合法的 `manifestHash`；缺失、非法或过期 hash 会在构建 / SSH 前拒绝。
- `GET /api/screen/frame/<buildId>`：开发者诊断专用，按需只读抓取设备 PNG 画面；默认同步 JSON 不内嵌图片字节或 `pngBase64`。LVGL 画面可能是动态帧，响应头会同时带当前 raw frame hash 和同步时 raw frame hash。
- `GET /api/screen/records`：开发者诊断专用，读取最近同步历史。
- `GET /api/screen/records/<buildId>`：读取一次同步的 manifest、artifact、delivery、命令结果、失败阶段和 screen evidence。
- `GET /api/screen/records/<buildId>/frame.png`：读取已经缓存到本地诊断记录的 PNG；不会重新连接核桃派。
- `POST /api/screen/repair-candidate`：读取本地同步记录并返回结构化修复候选方案；不会 SSH、构建、激活、抓图、写文件或自动重试。
- `POST /api/screen/repair-proposal`：读取本地同步记录并生成确认门控的本地修复提案；生成提案不会写文件、SSH、构建、激活、抓图或重试。
- `POST /api/screen/repair-apply`：只在输入精确确认短语后应用服务器生成的安全本地补丁；Web 随后重新读取 manifest 和预览，但不会自动同步到核桃派。
- `POST /api/screen/ai-summary`：读取本地同步记录并生成证据受限的中文总结；默认本地规则生成，在本地 `.env` 配置 `WALNUT_AI_API_KEY`、`WALNUT_AI_BASE_URL` 和 `WALNUT_AI_MODEL` 后可调用 OpenAI-compatible `/responses`，失败会回退本地总结；不会 SSH、构建、激活、抓图、写文件或自动重试。
- `POST /api/screen/pixel-diff`：只把浏览器算出的 `walnutpi.webDevicePixelDiff.v2` 写回本地同步记录；manifest hash 必须和记录一致；记录固定 480x320 Web DOM 预览快照与设备 PNG 的尺寸、像素数和差异比例；不会连接核桃派、抓图、构建、激活或改变同步状态。

普通用户只看到 `未同步`、`同步中`、`已同步到核桃派`、`同步失败`。`buildId`、screen manifest hash、artifact hash、delivery hash、命令输出、screen state、framebuffer frame hash、`visualMatch` / `visualChecks`、metadata-only pixel evidence、诊断级 Web/device pixel diff、历史记录、修复提示、修复候选方案、修复提案、AI 总结证据和按需设备截图只放在开发者诊断层。

小屏 manifest 是通用小屏程序模型：`pages` 是 1-6 个自定义页面，每页必须显式声明 `components`。当前组件 vocabulary 是 `statusCard`、`metricGroup`、`list`、`progress`、`alert`、`textPage`。这些组件只表示小屏内容，不是命令或代码；它们不能请求 shell、SSH、sudo、build、delivery、GPIO、重启、刷写或任意 LVGL/C 代码。Web 预览、诊断 DOM 快照、生成的 LVGL 配置和设备端 LVGL runtime 共用这些受限字段。

自然语言小屏编辑仍是规则式 manifest 编辑，不是任意代码生成；当前只允许改标题、副标题、状态卡、tone、进度、指标、列表、告警和文本页内容。`schema`、`target`、`source`、page id、构建、SSH、sudo、delivery 和设备命令不接受自然语言修改。

同步记录默认保存在 `web-interface/screen-sync-records/`，该目录不进入 Git。每条记录保存 `record.json`、`summary.json`，开发者展开诊断截图后还会缓存 `frame.png`。默认保留最近 50 条，可用 `WALNUT_SCREEN_RECORD_LIMIT` 调整，也可用 `WALNUT_SCREEN_RECORDS_DIR` 改变保存目录。`?nossh` 模式仍然不会连接核桃派或触发构建 / 激活 / 设备写入；它只会在本地记录一次 preview 拒绝结果，方便确认同步路径被拦截。

当前真机闭环已经通过一次验证：

```text
Web manifest -> POST /api/screen/sync -> LVGL build -> sudo -n systemctl restart walnut-screen.service -> walnut screen state -> sudo -n walnut screen frame -> diagnostics-only walnut screen capture
```

验证时 `artifactHash` 和 `deliveryHash` 都是 64 位 SHA-256/hex，设备回证显示 `walnut-screen.service` 为 `active`。Web 同步会把远端 checkout 显式设为 `WALNUT_REMOTE_PROJECT_ROOT`，默认是 `/home/pi/projects/WalnutPi`，避免 root 登录时误进 `/root/projects/WalnutPi`。

真机验证时遇到过两个环境问题：

- 用默认 `root` SSH 登录时，远端 `$HOME/projects/WalnutPi` 会变成 `/root/projects/WalnutPi`，但实际 checkout 在 `/home/pi/projects/WalnutPi`。
- 旧的 root-owned `build/lvgl_app` 文件会导致 `pi` 构建时无法写入 `lvgl.pc.tmp`、`lv_version.h.tmp` 和 `CMakeCache.txt`。

当前常用 root/root 环境可以直接显式指定远端 checkout：

```bash
SSH_USER=root SSH_PASSWORD=root WALNUT_REMOTE_PROJECT_ROOT=/home/pi/projects/WalnutPi WALNUT_REMOTE_BUILD_USER=pi bun web-interface/model-terminal-server.js
```

Web 同步默认用 `pi` 执行 LVGL build。若历史构建留下 root-owned 文件，需要把远端构建目录修回 `pi:pi`：

```bash
sudo chown -R pi:pi /home/pi/projects/WalnutPi/build/lvgl_app
```

### 中文本地控制台

路径：`console-chinese/`

这里记录本地屏幕上的中文显示方案：

- Linux TTY 本身不适合稳定显示中文
- 使用 `fbterm` 配合 WenQuanYi / Noto / Droid 回退字体
- `walnut-cn` 会手动打开支持中文的 framebuffer 终端
- 本地 `tty1` 登录会自动进入 `fbterm`，SSH 会话不受影响

### 终端玩具

路径：`terminal-toys/`

这里放的是 Walnut Play 使用的纯终端工具，例如音乐、数字雨、时钟和 ASCII 视频。
`walnut-fun` 现在只是兼容包装器，内部转发到 `walnut play`。

### 硬件说明

路径：`hardware/`

这里记录观察到的设备信息：系统、CPU、内存、存储、framebuffer 屏幕、触摸控制器、GPU / 显示说明、蓝牙 / 音频限制，以及有用的检查命令。

### Framebuffer UI

路径：`framebuffer_ui/`

这是无桌面系统直接写 `/dev/fb0` 的屏幕 UI 实验。它不依赖 X11、Wayland、Chromium 或桌面环境。

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

这是无桌面系统上的 LVGL 原型。它不启动桌面，不需要 X11/Wayland，直接通过 LVGL 的 Linux fbdev 驱动写 `/dev/fb0`。

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

- 构建：`scripts/build-lvgl-app.sh`
- 激活：`sudo -n systemctl restart walnut-screen.service`。这是当前 Web delivery adapter 已验证的真机路径；`walnut screen start` 仍保留为用户可见 CLI 入口。
- 回证：`walnut screen state` + `sudo -n walnut screen frame`
- 诊断截图：`walnut screen capture`，通过 `/api/screen/frame/<buildId>` 按需返回 PNG
- 修复候选：`POST /api/screen/repair-candidate`，只读分析本地同步记录，不自动应用修复
- 修复提案：`POST /api/screen/repair-proposal` + `POST /api/screen/repair-apply`，只允许确认后应用安全本地补丁，不自动同步
- AI 总结：`POST /api/screen/ai-summary`，只读总结本地同步记录，证据范围固定为该记录的 compact evidence
- 目标：`/dev/fb0`，480x320，RGB565

轻量 API 安全回归：

```powershell
pwsh ./scripts/test-screen-api-safety.ps1
```

该脚本使用临时 manifest 和临时同步记录目录，验证 manifest hash 拦截、`?nossh` 拦截、repair 确认拦截和 pixel-diff 记录字段；它不会连接核桃派、构建、激活、抓图或写真实设备。

这里的“同步到核桃派”不是把 Web 前端搬到设备上，也不是 VibeBoard/ESP32 烧录链路；它是把同一个小屏 manifest 对应的 LVGL 产物交付给 WalnutPi 本地屏幕运行时，并记录可诊断的 delivery/evidence。

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

不带参数时进入交互式聊天；带参数时运行一次性 agent 回合。一次性回合会优先判断是否可以由 WalnutPi 本地执行，例如天气、状态、网络、笔记和硬件只读检查；不能本地执行的问题再交给云端 AI。

### AirPods Linux 音频说明

路径：`audio/airpods-linux/`

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
- 中文控制台助手：`/usr/local/bin/walnut-cn`

## 开发规则

- 每个新实验都放在独立子目录里。
- 不要把设备本地秘密信息提交进仓库。
- 保持正常启动行为：设备仍然应该先进入标准 CLI。
- 自定义交互系统应该手动进入，例如 `walnut` 或 `walnut-ai`。
- 功能有重叠时优先扩展 `walnut`，不要继续增加顶层启动器。
- 优先使用简单、可审计的 Linux 服务和脚本，不要轻易上重型 UI 栈。
- 保持 `/home/pi/projects` 归 `pi:pi` 所有，避免本地 Git 权限问题。
- 把 `/usr/local/bin` 当作公开命令面，避免无理由添加重复入口。
- 把 `/opt` 当作已安装运行态，源码真相保留在当前用户的 `~/projects/WalnutPi` 路径或 `WALNUT_PROJECT_ROOT` 指向的位置。

## 近期路线

- 给 WalnutAI Terminal 增加持久会话历史
- 增加更丰富的终端卡片渲染
- 给 frpc 增加状态命令
- 增加蓝牙 / 音乐控制命令
- 增加一个能在手机上访问的小型本地 Web UI

# Third Projects Integration Alignment

这个文档记录当前对 `third/` 下两个项目的需求对齐。

它不是实现计划，也不是合并计划。当前目标是先把“核桃派这条分支到底要做什么、哪些外部项目只作为参考、哪些能力要串起来”说清楚。

## 当前结论

当前项目的主线不是整合一个大型 Web board / VibeBoard，也不是把旧的核桃派项目整体搬进来。

当前主线是：

```text
面向小白的核桃派界面
-> 通过自然语言或向导表达想做的 LVGL 程序
-> Web 外部端先显示已经渲染好的界面
-> 用户确认同步到核桃派
-> 核桃派屏幕显示同一个界面
-> Web 界面给出同步状态、执行现场和 AI 总结
```

这里的“核桃派”仍然是一台无桌面 Linux 设备。当前仓库已有的底座包括：

- `walnut-assistant/walnut`：主命令入口。
- `walnut-ai-terminal/walnut_ai.py`：本地 agent 和 AI 终端。
- `web-interface/`：左侧自然语言入口，右侧 3D 设备和终端执行现场。
- `framebuffer_ui/`：直接写 `/dev/fb0` 的 Python 屏幕原型。
- `lvgl_app/`：LVGL + Linux fbdev 的本地屏幕运行时。
- `scripts/`：构建、安装和运行边界。

所以需求应该沿着现有 WalnutPi 设备工作区推进，而不是替换成一个通用 IDE、桌面应用或 ESP32 开发平台。

## 两个 Third 项目的角色

### `third/VibeBoard`

用户口中的 Web board / VibeBoard 主要用于说明后续会有一条完整的 LVGL 程序交付链路。

它的参考价值是产品流程，而不是项目整体：

- 用户选择或描述程序。
- 系统生成或组织工程。
- 编译服务返回结构化结果。
- 编译产物带 manifest，烧录或部署前做校验。
- 通过 delivery adapter 执行 USB、OTA、BLE、远程 OTA 等交付动作。
- 预览和真实设备反馈分层。
- 编译日志、失败分类、修复建议和设备证据形成闭环。

WalnutPi 可以借鉴这些概念：

- 工作流阶段：需求、生成 / 选择、编译、烧录 / 部署、运行、观察、修复。
- Program Manifest 思路：用结构化清单描述目标、文件、入口、约束和验收点。
- Build Evidence 思路：把编译输出、首个错误、失败类型和下一步建议结构化。
- Flash / Delivery Manifest 思路：编译产物必须说明要交付哪些文件、写到哪里、用什么方式激活、如何回证。
- Preview 分层：快速语义预览可以帮助小白理解效果，但不能冒充真实 LVGL 运行。
- 写入边界：系统拥有构建脚本、板级配置和部署路径；AI 或用户只改允许的应用层文件。

不应该整合这些内容：

- 不把 `third/VibeBoard/src` 搬进 `web-interface`。
- 不把当前 WalnutPi Web 控制台替换成 React/Vite IDE。
- 不引入 ESP-IDF、ESP32-S3、SZPI board profile、BSP、分区表或 OTA 固件逻辑。
- 不照搬 USB Web Serial、WiFi OTA、BLE OTA、远程 OTA 的 ESP32 具体实现。
- 不暴露 VibeBoard 编译、OTA、flash、Huangshan 等服务到 WalnutPi 主界面。

一句话定位：

```text
VibeBoard 是“编译产物 -> manifest -> delivery adapter -> 设备回证”的参考，不是当前要合并的项目。
```

### `third/walnutpi`

这个项目更像用户之前写的“涡轮派 / 核桃派原型能力集合”。

它的参考价值是核桃派体验结构：

- 终端颜色显示和 ASCII 视频证明终端 / 小屏可以承载彩色、动态、可视化输出。
- Web Agent 的 3D 模型和右侧终端让用户看到“我正在操作一台真实核桃派”。
- `~/walnut-memory/memory.json` 这类记忆设置可以保存用户偏好、环境、项目、工作流和目标。
- `walnut-ai-terminal/skills` 把 AI 约束在核桃派板型、GPIO、Python、Blinka、屏幕、OpenCV 等本地知识边界内。

近期可吸收的是能力背后的产品结构：

- 富终端显示：状态卡片、执行现场、彩色日志、演示模式。
- 设备在场感：3D 核桃派模型 + 真实终端输出。
- 持久会话和长期记忆：让核桃派记住用户、项目和常用流程。
- 核桃派专属 skills：让 AI 不是泛泛回答 Linux 问题，而是结合板型和本地事实回答。
- 只读本地动作：状态、网络、GPIO、屏幕、项目快照先稳定。

暂时只作为素材参考的是：

- 完整 ASCII 视频编码器和播放器。
- 独立 GLB viewer。
- 娱乐类终端 demo。
- 全量细分 skills。
- 可公开访问的 root SSH WebSocket 终端。

一句话定位：

```text
third/walnutpi 是“核桃派体验结构”的参考，不是要整体覆盖当前项目。
```

## 要串起来的核心能力

### 1. 小白式 LVGL 程序链路

目标不是让用户理解 CMake、fbdev、systemd、SSH 和命令行参数。

目标也不是让用户理解 manifest、delivery adapter、build evidence 或 framebuffer 回证。

面向小白的用户链路应该是：

```text
我想做一个核桃派小屏界面
-> 选择模板或描述需求
-> Web 端先显示已经渲染好的界面
-> 用户觉得可以
-> 点击“同步到核桃派”
-> 等待同步完成
-> 核桃派屏幕显示同一个界面
```

内部实现链路再按 VibeBoard 的产品语义处理：

```text
screen intent / screen manifest
-> Web renderer / LVGL preview renderer
-> LVGL source or build artifact
-> WalnutPi delivery manifest
-> delivery adapter
-> 核桃派屏幕运行时
-> screen evidence
```

所以这里的“烧录”不是用户要学习的概念，也不是一个裸命令，而是“同步到核桃派”按钮背后的内部动作：有产物、有 manifest、有交付适配器、有设备回证。

VibeBoard 的关键模式是：

```text
编译成功
-> 返回 firmware artifact
-> 如果需要全量写入，返回 flashFiles / 地址清单
-> 交给 USB / OTA / BLE / remote OTA adapter
-> adapter 报告进度、成功、失败和设备状态
```

WalnutPi 也应采用同样结构，但 adapter 换成核桃派语境：

```text
LVGL build artifact
-> WalnutPi delivery manifest
-> delivery adapter
-> 写入 / 激活核桃派屏幕运行槽位
-> 启动或重启屏幕程序
-> 回传屏幕证据
```

第一版 delivery adapter 可以通过本地 agent / SSH 把编译产物交付到核桃派并激活；后续如果要支持 USB、eMMC、系统镜像或外部 MCU，也应该只是新增 adapter，而不是改掉上层工作流。

高风险写入仍然必须解释影响并确认。区别是：不能再把“烧录”降级理解成单纯运行 `walnut screen lvgl`。

### 2. 外部端和核桃派屏幕同步

最终效果要求：

```text
Web 外部端先看到的界面
-> 同步到核桃派
-> 允许延迟后
核桃派真实屏幕显示同一个界面
```

这里的“同步”不是两个前端各自画一个相似界面，而是 Web 端和核桃派必须来自同一个 screen manifest、同一个 LVGL 程序包、同一个资源包和同一个运行状态。

用户看到的是一个简单状态：

```text
未同步
同步中
已同步到核桃派
同步失败
```

内部才记录 buildId、artifact hash、screen manifest hash、delivery manifest 和设备回证。

推荐边界：

- 同步前：Web 外部端是用户的设计和预览主界面。
- 同步中：内部执行编译、交付、激活和验证，用户只看进度。
- 同步后：核桃派真实屏幕是最终验证对象。
- 同步证据优先使用核桃派回传的 framebuffer frame hash、结构性 frame checks，以及按需 framebuffer PNG 截图；如果后续性能需要，可以补充 LVGL screen state 流。
- 每次同步都带 `buildId`、artifact hash、screen manifest hash，避免外部端和设备显示不同版本。
- 如果 Web 端预览和核桃派回传画面不一致，用户界面只提示“核桃派显示和预览不一致，需要重新同步或修复”，具体 manifest / hash 细节放到开发者诊断视图。

`screenEvidence.visualMatch` 当前表达结构性 framebuffer 回证和第一层语义签名回证，不表达像素级 Web/LVGL diff：

- `captured`：设备 framebuffer frame 可用，尺寸、像素格式、字节数和非空检查通过。
- `unknown`：没有可用的 frame 回证。
- `mismatch`：frame 存在，但结构性检查显示目标屏幕约束不一致。

`visualChecks` 记录 manifest hash、artifact hash、preview signature hash、device signature hash、frame captured、尺寸、像素格式、字节数和非空等检查。`screenEvidence.semantic` 保留 manifest 可见字段形成的 preview signature，以及 manifest / artifact / frame metadata 形成的 device signature，供开发者诊断对齐。PNG 画面通过 `frameUrl` 指向 `/api/screen/frame/<buildId>`，只在开发者诊断展开时按需抓取，不进入默认同步 JSON。由于 LVGL 页面可能持续动画，按需 PNG 允许是后续动态帧；响应头保留当前 raw frame hash 和同步时 raw frame hash。当前 Web 诊断层还会用同一个 manifest 画一张 480x320 语义预览 canvas，并与已加载的设备 PNG 做浏览器本地像素 diff；这个结果是 `walnutpi.webDevicePixelDiff.v1` 诊断，会通过 `POST /api/screen/pixel-diff` 写回本地同步记录，但不改变 `visualMatch` 或同步成功判定。

允许延迟，但不接受长期分叉。也就是说，实时性可以让步，一致性不能让步。

### 3. Web Agent 作为主入口

Web 左侧应该继续是自然语言 / 向导入口，不是工具按钮堆叠。

右侧承担执行现场：

- 3D 核桃派模型提供设备在场感。
- 终端显示真实命令、日志和错误。
- 高级用户可以进入终端，但普通用户不应该被迫进入终端。
- AI 总结必须基于执行证据，而不是凭空猜测。

适合的用户体验是：

```text
左侧：我要做什么、Web 端显示效果、同步到核桃派按钮、同步状态
右侧：核桃派模型、核桃派屏幕同步视图、必要时展开的终端证据
```

编译日志、manifest、delivery adapter、hash、设备回证默认不展示给小白。它们应该进入开发者诊断层，只有同步失败、用户展开详情或开发者模式时才显示。

### 4. 终端富显示

终端颜色显示不是为了做娱乐功能主线，而是为了让执行过程更可读。

近期价值：

- 编译成功 / 失败状态用颜色区分。
- 风险动作、确认动作和只读动作有明显视觉层级。
- 设备状态、网络、GPIO、屏幕状态可以用卡片式输出。
- 右侧终端可以成为“证据面板”，而不是一堆灰色日志。

ASCII 视频和动画先保留为演示素材，不进入第一阶段核心链路。

### 5. 记忆设置

记忆的目标是让核桃派记住长期事实，而不是保存所有聊天流水。

应该保存：

- 用户偏好。
- 常用项目路径。
- 常用 LVGL 工作流。
- 设备环境事实。
- 当前长期目标。

不应该保存：

- API key、Wi-Fi 密码、SSH 密码、token。
- 临时聊天噪音。
- 未确认的推测。
- 编译日志全文。

记忆要服务于“小白下一次回来能接着做”，例如：

```text
上次你在做 480x320 的 LVGL 状态页。
当前目标是编译后运行到核桃派本地屏幕。
常用入口是 walnut screen lvgl。
```

### 6. 核桃派专属 Skills

skills 的目标是把 AI 回答限制在核桃派上下文内。

第一阶段不需要全量迁移所有 skills。优先沉淀：

- 当前板型和系统事实。
- `/dev/fb0`、480x320、RGB565、LVGL fbdev。
- `walnut screen` 命令边界。
- GPIO / I2C / SPI / UART 只读检查。
- Python / C / LVGL 入门路径。
- 本地编译、安装、运行和恢复登录终端的流程。

这些 skills 应该给 AI 提供“应该怎么做”和“哪些不能做”的边界，而不是堆资料。

## 建议的需求边界

### 当前阶段要做

- 明确 Web 界面面向小白，而不是面向熟悉命令行的开发者。
- 把“Web 端看到界面 -> 同步到核桃派 -> 核桃派显示同一界面”定义成第一用户工作流。
- 把 LVGL 编译、烧录 / 交付、启动、屏幕同步、观察结果定义成内部实现工作流。
- 保留 3D 模型、屏幕同步视图和终端作为执行证据面板。
- 建立结构化的动作 / 证据格式，避免 Web 只抓取人类可读输出。
- 建立 delivery manifest，记录产物、目标路径、激活方式、回证方式和风险等级。
- 建立屏幕同步证据，外部端显示不能长期偏离核桃派真实屏幕。
- 默认隐藏 manifest、hash、adapter、编译日志等内部细节，只在开发者诊断层展示。
- 建立最小记忆和最小 skills，让 AI 回答贴合核桃派。
- 对高风险动作加确认，尤其是系统写入、服务替换、刷写、重启和 GPIO 输出。

### 当前阶段不做

- 不整合 VibeBoard 整体。
- 不做通用硬件 IDE。
- 不支持多开发板矩阵。
- 不引入 Monaco 或完整项目编辑器作为第一屏主体验。
- 不绕过 manifest、确认和设备回证去执行系统镜像刷写、eMMC 写入或外部固件烧录。
- 不让 AI 任意改构建脚本、systemd unit、启动脚本或系统文件。
- 不把终端娱乐 demo 当成主线。
- 不公开暴露 SSH / root shell。

## 第一实现切片状态

当前第一切片已经落地为一个最小闭环：

```text
Web 端显示一个 LVGL 界面
-> 用户点击“同步到核桃派”
-> 内部调用构建 / delivery manifest / delivery adapter
-> 核桃派激活同一个界面
-> Web 状态变为“已同步”
-> 必要时开发者诊断层可查看日志和回证
```

已完成的安全和诊断边界：

- `POST /api/screen/sync` 要求提交当前 `manifestHash`。
- 缺失、非法格式或过期的 `manifestHash` 会在构建 / SSH / 激活前拒绝。
- `?nossh` 是 preview-only；后端会阻止 sync、action 和 terminal 进入 SSH / 构建 / 设备写入路径。
- 构建使用 `scripts/build-lvgl-app.sh`。
- 第一版 delivery adapter 已拆为 `web-interface/screen-delivery-adapters/ssh-local-agent.js`；当前只支持 SSH / local-agent 路径。
- 激活使用 `sudo -n walnut screen start`。
- 回证使用 `walnut screen state` 和 `sudo -n walnut screen frame`。
- 诊断图片使用 `GET /api/screen/frame/<buildId>` 按需触发只读 `walnut screen capture --png-base64`，默认同步 JSON 不嵌入 PNG 或 base64。
- artifact evidence 使用真实 SHA-256；artifact hash 非法时不会激活设备。
- delivery manifest / delivery hash 提交 artifact hash 和 screen manifest hash。
- 同步失败记录会生成只读 `repairHint`，把失败阶段转成小白原因、开发者诊断和下一步建议；`POST /api/screen/repair-candidate` 会从本地同步记录生成结构化 `repairCandidate`，列出候选检查 / 本地编辑计划 / 设备检查 / 手动重试建议，并固定 `canAutoApply=false`、`requiresConfirmation=true`；当前不会自动改代码、自动连接设备或自动重试。
- Web 端已提供确认门控的 `POST /api/screen/repair-proposal` / `POST /api/screen/repair-apply`。提案只从本地同步记录生成；应用必须输入精确确认短语，只能应用服务器生成的安全本地补丁，并且不会自动 SSH、构建、激活、抓图或重新同步。
- Web 端已提供只读 `POST /api/screen/ai-summary`，从本地同步记录提取 compact evidence 并生成中文 AI 总结；默认使用本地规则，配置 `OPENAI_API_KEY` 后可调用 OpenAI-compatible `/responses`，但总结只能基于该记录证据，不会触发 SSH、构建、激活、抓图、写文件或重试。
- 普通用户只看到 `未同步`、`同步中`、`已同步到核桃派`、`同步失败` 等可理解状态。
- `buildId`、hash、delivery manifest、命令输出、screen state、framebuffer frame hash、preview/device signature hash、metadata-only pixel evidence、`visualMatch` / `visualChecks`、AI 总结证据和按需设备截图只进入开发者诊断层。
- 当前 `walnut screen lvgl`、`walnut screen start`、`walnut screen stop`、`walnut screen toggle`、`walnut screen state` 行为没有被改动；新增的 `walnut screen frame` 只读读取 `/dev/fb0` 元数据、字节数和 SHA-256，`walnut screen capture` 只读返回 PNG 元数据并可选返回 `pngBase64`。

真机闭环已经通过一次验证：

```text
GET /api/screen/manifest
-> POST /api/screen/sync
-> LVGL build
-> sudo -n walnut screen start
-> walnut screen state
-> sudo -n walnut screen frame
-> diagnostics-only walnut screen capture
```

成功回证：

```text
== Screen ==
walnut-screen.service              active
walnut-framebuffer-status.service  inactive
vtcon1 bind                        0
```

验证中遇到的环境问题：

- 默认 `root@192.168.1.24` 登录会让远端 `$HOME/projects/WalnutPi` 指向 `/root/projects/WalnutPi`，但实际 checkout 在 `/home/pi/projects/WalnutPi`。
- Web 同步现在把远端项目根显式写入构建命令；`WALNUT_REMOTE_PROJECT_ROOT` / `WALNUT_PROJECT_ROOT` 默认指向 `/home/pi/projects/WalnutPi`，避免 root 登录时走错 checkout。
- Web 同步可以继续用 root SSH 连接设备，但 LVGL build 应由 `WALNUT_REMOTE_BUILD_USER=pi` 执行，避免构建产物被 root 拥有。
- 旧的 root-owned `build/lvgl_app` 文件会让 `pi` 构建时无法写入 `lvgl.pc.tmp`、`lv_version.h.tmp`、`CMakeCache.txt`；需要把该目录修回 `pi:pi`。

这比先做完整项目编辑器或完整代码生成更简单，但保留了 VibeBoard 的关键链路：artifact、manifest、delivery adapter、device evidence。后续 USB、eMMC、系统镜像或其他交付方式应作为新的 adapter 增加，而不是塞回 Web route。

当前阶段已经把等价 screen frame 回证升级为结构性画面回证、语义签名回证、metadata-only pixel evidence 和诊断级 Web/device pixel diff：Web 不只知道服务是 active，还能记录真实 framebuffer 原始帧的尺寸、字节数、SHA-256、非空检查、sample hash、nonzero ratio、preview/device signature hash、按需 PNG 截图，以及浏览器语义预览 canvas 与设备 PNG 的 diff ratio。当前 pixel diff 会进入本地同步记录，并在同步历史里显示一个小型 diff badge，方便历史诊断复查；它仍不宣称已经完成真实 LVGL headless preview，也不改变同步判定。

当前修复循环已经到第三层：第一层是 `repairHint` 的失败归因和修复建议，第二层是只读 `repairCandidate` 的结构化候选方案，第三层是确认门控的 `repairProposal` / `repairApply`。它可以在有安全本地补丁时要求用户输入精确确认短语后应用，但仍然不自动 SSH、不自动重启服务、不自动重新同步。后续如果要做完整自动修复，应继续补“应用修改 -> 用户确认重新同步 -> 记录回证”的闭环。

## 代码核对后的实际剩余项

按当前代码核对，第一切片不是停在设计文档层面，而是已经有可运行实现：

- `web-interface/model-terminal-server.js` 已提供 `GET /api/screen/manifest`、`POST /api/screen/sync`、模板更新、规则式意图更新、同步记录、修复候选 / 提案 / 应用和 AI 总结接口。
- `web-interface/screen-delivery-adapters/ssh-local-agent.js` 已承担第一版 delivery adapter，负责远端构建、artifact hash、激活、screen state、framebuffer frame、delivery manifest / hash 和 evidence 分类。
- `web-interface/model-terminal.html` 已提供 Web 端语义预览、模板按钮、自然语言小改动入口、同步按钮、同步历史、开发者诊断、按需设备截图、修复提案和 AI 总结。
- `walnut-assistant/walnut` 已保留既有 `walnut screen` 行为，并新增只读 `frame` / `capture` 证据命令。
- `walnut-ai-terminal/walnut_ai.py` 已升级为长期 memory + skills/corpus 检索形态：默认模型 `gpt-5.4-mini`，长期记忆默认 `~/walnut-memory/memory.json`，按请求检索 `walnut-ai-terminal/skills/` 与 `walnut-ai-terminal/corpus/` 后再回答。
- `walnut-assistant/walnut` 已提供 Web-friendly local action JSON 入口：`walnut action run status|network|gpio|snapshot --json`，以及高风险动作的 prepare/commit 骨架；当前 confirmed execution 仍禁用。
- `web-interface/model-terminal-server.js` 的状态、网络、GPIO 和设备快照动作已改为调用 `walnut action run ... --json`，并保留结构化 `actionEvidence` 供诊断和后续闭环使用。
- Web 后端新增只读 project-memory API：`GET /api/memory`、`GET /api/retrieval?query=...`、`GET /api/project-memory?query=...`；成功 screen sync 会把 compact 证据追加到 `walnut-ai-terminal/corpus/screen-sync-successes.md`，不写命令日志、截图或 secrets。

所以当前剩余工作不再是“把第一闭环做出来”，而是把第一闭环从窄切片推进成可靠产品能力。

### 1. Web / LVGL 真实像素一致性

当前 `pixelEvidence` 是 metadata-only。它记录 framebuffer 原始帧 hash、sample hash、nonzero ratio、尺寸、格式和字节数。Web 诊断层新增了 `walnutpi.webDevicePixelDiff.v1`，用同一个 manifest 生成 480x320 语义预览 canvas，再和设备 PNG 比较像素，并把结果写回本地同步记录。

也就是说，现在已经能证明“设备有一帧符合目标屏幕结构的真实画面”，并能在开发者诊断里看到“当前 Web 语义预览和设备 PNG 的像素差异”。但它还不能证明真实 LVGL headless 预览和核桃派屏幕像素一致。

后续更强一致性仍要二选一推进：

- 做真实 LVGL headless preview，并把它作为 Web 预览来源。
- 或继续保留 vanilla DOM 语义预览，把当前 canvas diff 升级成真实 DOM screenshot -> LVGL framebuffer PNG 的像素级 diff。

### 2. 预览仍是语义近似，不是真实 LVGL 渲染

当前前端 `renderScreenManifest()` 根据 manifest 渲染 header、tabs、home 状态、tone、progress 和 metrics。它是帮助小白理解效果的语义预览，不是完整 LVGL 页面，也不渲染所有 pages 的真实布局、动画和系统动态值。

这条边界需要继续在产品和诊断里说清楚：当前同步保证 Web 和设备使用同一个 manifest / artifact / evidence 链路，不保证浏览器 DOM 预览已经等价于 LVGL framebuffer。

### 3. 自然语言编辑还是规则式 intent

当前 `/api/screen/intent` 已经能处理标题、副标题、状态、指标、系统页、AI 页、网络页和模板切换类输入。

但它不是 AI 生成 LVGL 代码，也不是通用布局生成器。它只是把有限中文规则映射回 `lvgl_app/screen-manifest.json`。

后续如果要做“描述需求 -> 生成小屏程序”，需要新增受约束的生成层，并继续让 manifest hash、构建、delivery manifest 和设备回证作为安全门。

### 4. manifest 表达能力仍很窄

当前 `scripts/generate-lvgl-screen-config.py` / `.js` 要求固定 480x320、RGB565、固定四页 `home` / `system` / `ai` / `network`，并生成 `lvgl_app/generated/screen_config.h`。home 页已经支持最小状态语义 `tone: ok | warn | error` 和 `progress: 0-100`，Web 预览、diagnostic canvas 和 LVGL UI 使用同一语义。

这适合第一版状态页和任务页，但还不是通用 screen manifest。后续扩展 manifest 时，应优先增加小白能理解的组件 vocabulary，例如状态卡、文本页、指标组、列表、进度、告警，而不是直接暴露任意 C/LVGL 代码编辑。

### 5. 修复提案不是通用自动修复

当前 `repairProposal` 只在安全条件满足时生成本地 manifest 写回补丁。`repairApply` 必须输入精确确认短语，且只写本地 manifest，不会 SSH、构建、激活、抓图或重新同步。

build 失败、C 编译错误、服务激活失败、framebuffer 权限、画面 mismatch 等仍然是候选建议和人工排障，不是自动修复。

下一步应该补的是半自动闭环：

```text
应用本地修复
-> Web 重新读取 manifest
-> 用户确认预览
-> 用户手动重新同步
-> 写入新的同步记录和设备回证
```

不要直接把 repair apply 变成自动 SSH / 自动重启 / 自动重新同步。

### 6. delivery adapter 仍只有 SSH / local-agent

当前 adapter registry 只有 `ssh-local-agent`。USB、eMMC、系统镜像、外部 MCU 或其他交付方式还没有实现。

后续新增交付方式时，应作为新的 adapter 增加，继续复用上层 manifest、artifact evidence、delivery manifest、risk 和 screen evidence，不要把新交付逻辑塞回 Web route。

### 7. 自动化回归仍不足

当前主要回归证据来自 `scripts/collect-screen-sync-evidence.ps1` 和本地 / 真机同步记录。屏幕同步链路还没有成体系的可读自动化测试源码覆盖。

本轮文档更新不新增测试代码。后续如果要补回归，优先围绕现有脚本和 API 行为设计，不要为了测试引入大 fixtures、snapshots 或测试专用实现。

## 真机排障证据采集

真机排障优先保留“事实证据”，而不是只记录一次人工判断。当前可复用脚本是：

```powershell
pwsh ./scripts/collect-screen-sync-evidence.ps1
```

默认参数面向当前局域网设备：

```text
Host=192.168.1.24
User=root
Password=root
RemoteProjectRoot=/home/pi/projects/WalnutPi
```

默认模式只读，不会触发 Web 同步、构建、SSH 写入、服务重启或设备写入。它只通过 `sshpass` / `ssh` 采集：

- 远端 `hostname`、`whoami`、登录后 `pwd` 和显式项目根检查。
- `walnut screen state`。
- `sudo -n walnut screen frame`。
- `sudo -n walnut screen capture` 的默认元数据。
- 已存在 LVGL artifact 的 SHA-256。
- `build/lvgl_app` 等构建目录所有权，方便判断 root / pi 混用导致的 CMake 写入失败。

需要完整走 Web API 同步链路时，必须显式加 `-Sync`：

```powershell
pwsh ./scripts/collect-screen-sync-evidence.ps1 -Sync -Port 4183
```

`-Sync` 会临时启动本地 Bun Web API server，读取 `/api/screen/manifest`，再把当前 `manifestHash` 提交到 `/api/screen/sync`。脚本会打印 `manifestHash`、`buildId`、`artifactHash`、`deliveryHash`、`visualMatch`、`frameSha256` 等关键字段，并在结束或出错时停止临时 server，避免留下后台进程。

一次已确认的真机信号如下：

```text
remote checkout: /home/pi/projects/WalnutPi
root login cwd: /root
buildId: screen-20260610115318-89a74330
manifestHash: 1a5eb5ce0e8bc0a00912465a2e272d68664a278c809b9357adac59a2ebb79241
artifactHash: 746a52b91a3ad32ce22637ba80e7ee88c8f7d6e5c01b97538f22f8e10f02bb56
deliveryHash: 0e1ed4335c797d9ef716a755cd08cc18ef8203fbafce2e2433cbe153be5854db
visualMatch: captured
framebuffer: 480x320 RGB565_LE, 307200 bytes
frameSha256: 9c602317eb56908205e088212eb98a437069438309017d6748bfab76dd7f666c
service: walnut-screen.service active
framebuffer-status: walnut-framebuffer-status.service inactive
vtcon1 bind: 0
```

2026-06-11 又跑了一次最新 Web API 真机同步回归：

```text
remote checkout: /home/pi/projects/WalnutPi
root login cwd: /root
pre-sync service: walnut-screen.service inactive
pre-sync vtcon1 bind: 1
pre-sync frameSha256: 1a7cf256bc09558a8c063d25bed470e7c9a9dcbd62594ea0b843787fd063b8ce
build/lvgl_app owner: pi:pi
buildId: screen-20260610161956-f51fbac3
manifestHash: 1a5eb5ce0e8bc0a00912465a2e272d68664a278c809b9357adac59a2ebb79241
artifactHash: 746a52b91a3ad32ce22637ba80e7ee88c8f7d6e5c01b97538f22f8e10f02bb56
deliveryHash: 2d9e0bd88c6d5fa8522503abe9ae093dd2328f96056547fb4e07704d78f67c40
visualMatch: captured
frameSha256: 5a4d555aef5948c9a564a83414cf0021a047b8539da89b8b8017cea43b7767bb
screenFrameUrl: /api/screen/frame/screen-20260610161956-f51fbac3
```

常见排障判断：

- `walnut-screen.service inactive` 但 `frame` / `capture` 仍返回数据，不一定代表同步链路成功；它只能说明 framebuffer 当前可读，可能是旧画面或其他进程留下的画面。
- 同步成功后，服务状态、delivery hash、artifact hash 和 framebuffer frame hash 要一起看；单独看到 active 不够。
- root 登录默认目录是 `/root`，不能用 `$HOME/projects/WalnutPi` 推断 checkout。远端项目根必须显式使用 `/home/pi/projects/WalnutPi`，或通过 `WALNUT_REMOTE_PROJECT_ROOT` / `WALNUT_PROJECT_ROOT` 指定。
- `build/lvgl_app` 正常应保持 `pi:pi`。如果出现 root-owned `Makefile`、`walnut-lvgl-screen` 或其他构建文件，先用 root 在远端执行 `chown -R pi:pi /home/pi/projects/WalnutPi/build/lvgl_app` 修复当前状态，再确认 Web sync 使用 `WALNUT_REMOTE_BUILD_USER=pi` 构建，避免下一次 root SSH 同步再次污染 owner。

## 已确认和待确认问题

已经由当前代码确认的事项：

1. 第一版 Web 预览采用 screen manifest / vanilla DOM 语义渲染，不是真实 LVGL headless preview。
2. 第一版 delivery adapter 采用 SSH / local-agent，代码入口是 `web-interface/screen-delivery-adapters/ssh-local-agent.js`。
3. 第一版屏幕回证采用 `/dev/fb0` framebuffer 元数据和按需 PNG capture，不依赖 LVGL 主动上报完整 screen state。
4. WalnutAI 现在从 `~/walnut-memory/memory.json` 读取长期记忆，从 `walnut-ai-terminal/skills/` 和 `walnut-ai-terminal/corpus/` 检索核桃派专属上下文与成功代码语料；`memory/default-memory.json` 只保留为非秘密 seed/reference。Web 端可通过只读 project-memory API 查看同一套上下文。
5. 右侧终端当前按本地开发 / 局域网工具理解；`?nossh` 会阻止 terminal、action 和 sync 进入 SSH / 设备路径。

仍待确认或继续设计的事项：

1. 下一步视觉一致性路线：做真实 LVGL headless preview，还是做 Web DOM screenshot 与设备 framebuffer PNG 的像素 diff？
2. manifest vocabulary 如何扩展，才能支持更多小屏程序，同时不变成通用 IDE 或任意 C 代码编辑器？
3. 自然语言生成是否只生成 manifest，还是允许生成受限 LVGL 代码？如果允许，代码生成、review、构建和设备写入的安全门怎么设计？
4. Web 会话和 WalnutAI 的长期记忆是否要统一到 `~/walnut-memory/`，以及哪些事实可以跨会话共享？
5. 修复闭环是否只做到“应用本地修复 -> 用户确认重新同步”，还是后续允许更强的确认门控自动重试？
6. 新 delivery adapter 的优先级是 USB、eMMC / 镜像，还是继续只强化 SSH / local-agent 体验？

## 当前推荐

基于当前代码状态，新的优先级建议如下：

```text
1. 保持现有第一闭环：manifest -> build -> delivery adapter -> activation -> device evidence。
2. 先补强视觉一致性：真实 LVGL preview 或 Web/LVGL 像素 diff 二选一。
3. 扩展 manifest vocabulary，让小白能表达更多小屏界面，但仍不暴露通用 IDE。
4. 把修复提案补成半自动闭环：应用本地修复 -> 预览 -> 用户手动同步 -> 新回证。
5. 再考虑 AI 生成 manifest 或受限 LVGL 代码，并让生成结果走同一套 hash / build / evidence 安全门。
6. 最后再增加 USB、eMMC、镜像或其他 delivery adapter。
```

第一件需要一起确认的事已经变化：

```text
下一步要优先做真实 LVGL headless preview，还是做现有 Web 语义预览与设备 framebuffer 截图的像素级 diff？
```

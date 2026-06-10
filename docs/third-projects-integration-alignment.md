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

`screenEvidence.visualMatch` 当前只表达结构性画面回证，不表达像素级 Web/LVGL diff：

- `captured`：设备 framebuffer frame 可用，尺寸、像素格式、字节数和非空检查通过。
- `unknown`：没有可用的 frame 回证。
- `mismatch`：frame 存在，但结构性检查显示目标屏幕约束不一致。

`visualChecks` 记录 manifest hash、artifact hash、frame captured、尺寸、像素格式、字节数和非空等布尔检查。PNG 画面通过 `frameUrl` 指向 `/api/screen/frame/<buildId>`，只在开发者诊断展开时按需抓取，不进入默认同步 JSON。

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
- 激活使用 `sudo -n walnut screen start`。
- 回证使用 `walnut screen state` 和 `sudo -n walnut screen frame`。
- 诊断图片使用 `GET /api/screen/frame/<buildId>` 按需触发只读 `walnut screen capture --png-base64`，默认同步 JSON 不嵌入 PNG 或 base64。
- artifact evidence 使用真实 SHA-256；artifact hash 非法时不会激活设备。
- delivery manifest / delivery hash 提交 artifact hash 和 screen manifest hash。
- 普通用户只看到 `未同步`、`同步中`、`已同步到核桃派`、`同步失败` 等可理解状态。
- `buildId`、hash、delivery manifest、命令输出、screen state、framebuffer frame hash、`visualMatch` / `visualChecks` 和按需设备截图只进入开发者诊断层。
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
- 改用 `pi@192.168.1.24` 后能到正确 checkout，但旧的 root-owned `build/` 目录会让 CMake 写入 `lvgl.pc.tmp`、`lv_version.h.tmp`、`CMakeCache.txt` 失败。
- 如果改用 `pi` 执行同步，需要确保 `build/` 归 `pi:pi` 所有；root/root 环境可以继续通过显式远端项目根执行。

这比先做完整项目编辑器或完整代码生成更简单，但保留了 VibeBoard 的关键链路：artifact、manifest、delivery adapter、device evidence。

当前阶段已经把等价 screen frame 回证升级为结构性画面回证：Web 不只知道服务是 active，还能记录真实 framebuffer 原始帧的尺寸、字节数、SHA-256、非空检查和按需 PNG 截图。后续如果要做更强一致性，可以继续加入 Web 预览与 LVGL framebuffer 的像素级或语义级 diff。

## 待确认问题

1. Web 端第一版预览是先用 screen manifest / React 语义渲染，还是直接做真实 LVGL headless preview？
2. 第一版 delivery adapter 是通过本地 agent / SSH 写入核桃派，还是要直接设计 USB / eMMC / 镜像烧录 adapter？
3. 屏幕同步第一版用 `/dev/fb0` framebuffer 截图回传，还是让 LVGL 程序主动上报 screen state 再由外部端重绘？
4. 记忆是否统一放在 `~/walnut-memory/`，并让 Web 会话和 WalnutAI 共享长期事实？
5. 核桃派 skills 第一批是否只保留板型、屏幕、GPIO、Python、LVGL、系统状态这些核心内容？
6. 右侧终端是否只作为本地开发 / 局域网工具，默认不设计公网访问？

## 当前推荐

优先级建议如下：

```text
1. 先定义小白用户流：Web 端看到界面 -> 同步到核桃派 -> 设备显示一致。
2. 再按 VibeBoard 模式定义内部 WalnutPi delivery manifest。
3. 定义 LVGL 构建 -> 烧录 / 交付 -> 激活 -> 屏幕同步的内部最小闭环。
4. 用核桃派回传画面保证外部端与真实屏幕最终一致。
5. 把构建证据、烧录进度、hash、回证放进开发者诊断层。
6. 引入最小记忆和最小核桃派 skills。
7. 再考虑模板选择、AI 生成 LVGL 代码、真实 LVGL preview 和修复循环。
```

第一件需要一起确认的事：

```text
第一版 Web 端“已经显示好的界面”，先用 screen manifest / React 语义渲染快速做出来，还是直接投入真实 LVGL headless preview？
```

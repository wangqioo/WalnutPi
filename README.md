# WalnutPi

WalnutPi 是一个把小型无桌面 Linux 板子做成便携式云端 AI 终端的实验仓库。

本文档以中文为主，命令名、软件名和少数技术术语保留英文原名。

这个仓库不是单一应用，而是这块 WalnutPi 设备的总工作区：终端界面实验、音频笔记、部署配置、系统脚本，以及后续的 AI 原生软硬件原型。

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

## 核心思路

项目方向是一个 AI 原生终端系统：

> 无桌面 Linux + 命令行交互 + 结构化卡片 + 云端 AI API + 轻量本地硬件控制。

本地设备负责：

- 输入和输出
- 网络连接
- 终端界面渲染
- 系统状态采集
- 小脚本和本地自动化
- 音频播放
- 服务托管

云端负责：

- 语言推理
- 文本生成
- 翻译
- 总结
- 规划
- 未来的多模态 AI 任务

## 现在能做什么

这台 WalnutPi 目前已经可以：

- 运行 `walnut`，也就是 Walnut Home 命令中心
- 运行 `walnut-ai`，一个轻量 AI 终端原型
- 通过 OpenAI 兼容 API 调用云端 AI
- 把笔记保存为 Markdown
- 翻译和润色文本
- 在终端里显示系统状态
- 通过 frpc 暴露 SSH 远程访问
- 通过 AirPods / A2DP 播放音频
- 通过 `fbterm` 在本地 framebuffer 控制台显示中文
- 保持正常 CLI 启动，不强制接管系统启动 shell

## 先试什么

- `walnut` 作为主入口
- `walnut ai` 直接进入云端 AI 终端
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
├── hardware/                # 观察到的硬件和屏幕记录
├── walnut-assistant/        # Walnut Home 命令中心
├── walnut-ai-terminal/      # WalnutAI Terminal V0
├── terminal-toys/           # Walnut Play 使用的纯终端工具
├── console-chinese/         # 本地 framebuffer 中文显示说明
├── audio/
│   └── airpods-linux/       # AirPods / Linux 播放与麦克风调查
├── scripts/                 # 安装和辅助脚本
└── README.md                # 项目总览
```

未来的模块都应该作为独立子目录加入这个仓库，根目录只保留索引和总览。

## 项目分区

### Walnut Home

路径：`walnut-assistant/`

这是一台便携式 AI 终端的主命令中心，也是板子的主要启动入口。

运行：

```bash
walnut
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

### WalnutAI 终端 V0

路径：`walnut-ai-terminal/`

一个面向无桌面 Linux 的轻量云端 AI 终端。

在 WalnutPi 上运行：

```bash
walnut-ai
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

# Walnut Home

Walnut Home 是这台无桌面 WalnutPi 终端的 Device Execution Surface。

Walnut Agent Console 是普通用户入口，`walnut` 是设备上稳定、可审计的执行入口。它同时提供给人直接使用的 Human CLI Command，以及给 Walnut Agent Console / WalnutAI 调用的 Agent Action Command。Agent Action Command 应由 Action Policy Manifest 管理；菜单、TUI 和演示入口不自动成为 Agent 契约。

当前 Action Policy Manifest 位于仓库根目录：

```text
action-policy-manifest.json
```

`walnut action run ... --json` 和 `walnut action prepare ... --json` 会从这个 manifest 派生可用的 Agent Action Command、风险等级和确认边界。

它把原本分散的 Linux 命令收拢成一个入口：

```bash
walnut
```

## 命令

```bash
walnut                 # 交互式菜单
walnut ai              # 打开 WalnutAI 聊天
walnut notes           # 笔记子菜单
walnut play            # 打开音乐、数字雨、时钟和视频演示
walnut console         # 历史 / 可选中文 framebuffer 控制台入口，不是 Agent Action Command
walnut status          # 系统、网络、服务、Docker、蓝牙状态
walnut maintenance     # 打开修复 / 项目 / 清理 / 浏览器 / 监控子菜单
walnut video [mode]    # 播放 ASCII 视频演示：color 或 gray
walnut voice           # 打开语音键盘 CLI
walnut note TEXT       # 追加一条日记笔记
walnut today           # 显示今天的笔记
```

面向当前 Web 小屏主线，最关键的是：

- `walnut screen start|stop|toggle|state|frame|capture|lvgl`：运行和证明 480x320 LVGL 小屏结果。
- `walnut action run ... --json`：给 Web agent 提供结构化只读设备检查。
- `walnut play` / `walnut video`：提供音乐、ASCII 视频和终端玩具，可作为可玩性素材和演示能力。
- `walnut ai` / `walnut notes`：提供本地 agent、记忆和笔记能力。

较少由普通用户直接使用、但仍属于工具层的命令：

- `walnut status`：设备、网络和服务检查
- `walnut maintenance`：浏览器、监控、修复、项目和清理
- `walnut video color|gray`：直接播放 ASCII 视频
- `walnut note TEXT` 和 `walnut today`：快速记笔记
- `walnut voice`：语音键盘 CLI

## 设计

这个入口故意做得小而稳定：

- 纯 CLI，不依赖桌面环境
- 只使用 Python 标准库
- 所有主要入口统一在 `walnut`
- 维护类操作收进菜单里，不再外露太多顶层命令
- 与 Web 对话入口分工明确：CLI 执行设备能力，Web 负责理解需求、编排工具、生成小屏和展示证据

## 笔记

日记笔记会写到当前用户的 home 目录：

```bash
~/walnut-memory/daily/YYYY-MM-DD.md
```

这是 WalnutPi 本地记忆层的第一步。

## 安装

```bash
cp walnut /usr/local/bin/walnut
chmod +x /usr/local/bin/walnut
```

## 运行时布局

- 源码仓库：`~/projects/WalnutPi`，或者 `WALNUT_PROJECT_ROOT` 指向的位置
- 主启动器：`/usr/local/bin/walnut`
- 兼容启动器：`/usr/local/bin/walnut-fun` -> `walnut play`
- 归档工具源码：`archive/experiments/`
- 归档安装脚本：`archive/install-scripts/`
- 已安装的 WalnutAI 运行时：`/opt/walnut-ai`
- 已安装的语音运行时：`/opt/walnut-voice-keyboard`

路径解析是可覆盖的：

- `WALNUT_PROJECT_ROOT` 可覆盖源码仓库位置
- `WALNUT_MEMORY_DIR` 可覆盖笔记位置
- `WALNUT_MUSIC_DIR` 可覆盖本地音乐库位置

源码修改请保留在 Git 仓库里，安装时再把启动器复制到 `/usr/local/bin`。

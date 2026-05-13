# Voice Keyboard — 开发者指南

## 项目概述

语音打字工具。PTT 按住说话 → 讯飞 STT 识别 → 自动打字进当前输入框。
支持纯软件模式（任意麦克风）和 ESP32-S3 硬件模式。

## 平台差异

| 项目 | macOS | Windows |
|------|-------|---------|
| 启动命令 | `cd 项目目录 && SSL_CERT_FILE=$(…) .venv/bin/python -m agent.main --no-serial` | `cd 项目目录 && .venv\Scripts\python -m agent.main --no-serial` |
| 打字 API | Quartz `CGEventKeyboardSetUnicodeString`，绕过 IME | `SendInput + KEYEVENTF_UNICODE` 或剪贴板粘贴 |
| 微信/钉钉 | unicode 模式可用 | 需改 `typing.method: clip`（SendInput 被 Electron 过滤） |
| 热键名称（右 Alt） | `alt_r` | 英文键盘 `alt_r`，中文键盘 `alt_gr` |
| 热键名称（右 Ctrl） | `ctrl_r` | `ctrl_r` |
| 辅助功能授权 | 必须：系统设置 → 隐私与安全性 → 辅助功能 → 添加终端 | 首次运行 UAC 弹窗点"是"即可 |
| SSL 证书 | Python 官方包无系统证书，需手动指定（见下） | 无此问题 |

### macOS SSL 证书问题

Python 官方安装包在 macOS 上不读系统证书，讯飞 WebSocket 握手会报 `CERTIFICATE_VERIFY_FAILED`。

**解决方法**：用 certifi 提供的证书路径启动：

```bash
cd /Users/wq/voice-keyboard
SSL_CERT_FILE=$(.venv/bin/python -c "import certifi; print(certifi.where())") \
  .venv/bin/python -m agent.main --no-serial
```

或者一次性修复 Python 安装（如有 `/Applications/Python 3.x/Install Certificates.command`）：

```bash
/Applications/Python\ 3.x/Install\ Certificates.command
```

修复后可直接用 `.venv/bin/python -m agent.main --no-serial` 启动，无需前缀。

## 启动方式

```bash
# macOS（需指定 SSL 证书，见上方说明）
cd /Users/wq/voice-keyboard
SSL_CERT_FILE=$(.venv/bin/python -c "import certifi; print(certifi.where())") \
  .venv/bin/python -m agent.main --no-serial

# Windows
cd C:\path\to\voice-keyboard
.venv\Scripts\python -m agent.main --no-serial

# 列出可用麦克风
python -m agent.main --list-devices
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `agent/main.py` | 入口，串联所有模块 |
| `agent/push_to_talk.py` | PTT 录音，pynput 键盘监听，双热键（ptt/ai） |
| `agent/ai_handler.py` | AI 键统一处理：STT→意图分类→快捷键/编辑/写作/删除/撤回/聊天 |
| `agent/stt.py` | STT 多 provider（xunfei/openai/aliyun/volcengine/zhipuai） |
| `agent/typer.py` | 三平台打字（Unicode / 剪贴板），退格擦除，行选择，jump_to_end |
| `agent/audio_monitor.py` | VAD 常开模式（PTT 模式不用此文件） |
| `agent/keyboard_monitor.py` | 退格监听，同步 TextBuffer；Enter 触发新段落 |
| `agent/mouse_monitor.py` | 鼠标点击检测；点击触发新段落 |
| `agent/text_buffer.py` | 文字账本：段落追踪（current_segment / replace_segment） |
| `agent/llm_editor.py` | LLM 编辑 + chat() + chat_stream() 流式接口 |
| `agent/config.py` | 加载 config.yaml / .env |

## 配置文件

`config.yaml`（从 `config.yaml.example` 复制）：

```yaml
stt:
  provider: xunfei          # 推荐：xunfei / aliyun
  app_id: "..."
  api_key: "..."
  api_secret: "..."
  language: zh_cn

llm:
  provider: zhipuai
  api_key: "..."
  model: glm-4-flash

typing:
  method: clip              # clip=剪贴板（微信）/ unicode=逐字（记事本/Word）

audio:
  mode: ptt                 # ptt=按键触发 / vad=自动检测
  ptt_key: shift_r          # macOS 右 Shift（推荐，避开 Ctrl+Space 输入法切换）；Windows/Linux alt_r
  ai_key: alt_r             # macOS 右 Option（推荐，不和 Cmd 系统快捷键冲突）；Windows/Linux ctrl_r
  device: auto              # 麦克风序号，auto=自动
```

## 打字方式选择

| 应用类型 | 推荐方式 | 原因 |
|----------|---------|------|
| 微信、钉钉、Electron 应用 | `method: clip` | 这类应用过滤 SendInput Unicode 事件 |
| 记事本、Word、VS Code | `method: unicode` | 逐字更精确，不占用剪贴板 |

## STT Provider 对比

| provider | 适合场景 | 特点 |
|----------|---------|------|
| `xunfei` | **推荐**，中文日常使用 | 原话逐字转写，数字自动阿拉伯数字，WebSocket 流式 |
| `aliyun` | 方言、多语言 | 支持方言，REST API |
| `volcengine` | 备选 | HTTP API，需 streaming_common 集群 |
| `zhipuai` | 不推荐做 STT | 对话模型，会改写内容而非原样转写 |
| `openai` | 英文 / 多语言 | Whisper，中文效果一般 |

## 已知约束

- **VAD 模式**：依赖 `webrtcvad`，Python 3.13+ 暂无预编译包，请用 PTT 模式
- **Windows 中文键盘**：右 Alt = `alt_gr`，右 Ctrl = `ctrl_r`（非 `right_alt` / `right_ctrl`）
- **Volcengine**：`/api/v1/asr` 端点不支持 `volcengine_input_common` 集群，若用火山引擎需换 WebSocket v2 协议
- **GLM-4-Voice**：是对话模型，不适合做 STT，会用自己的措辞回复

## 性能说明

| 阶段 | 典型耗时 | 说明 |
|------|---------|------|
| 讯飞 STT | 300–600ms | WebSocket 握手 + 服务端识别 |
| 剪贴板粘贴 | ~60ms | 写入 30ms + 粘贴 30ms |
| LLM 编辑 | 500–1000ms | GLM-4-Flash，仅语音编辑时触发 |

> `stt.py` 中发包间隔设为 5ms（非实时速率），PTT 音频已录完无需按实时速率发包，
> 可大幅减少长句的等待时间（3 秒录音节省约 2.6 秒）。

## 依赖安装

```bash
pip install -r requirements.txt
```

主要依赖：`sounddevice` `pynput` `websocket-client` `zhipuai` `requests` `pyyaml`

## AI 键已知 Bug 及修复记录

### 1. AI 键按下时触发「录音太短，跳过」

**现象**：每次按下 AI 键，日志里紧跟一条 `[ptt] 录音太短，跳过`。

**原因**：`get_selection()` 在后台线程调用 `_copy_selection()`，后者通过 pynput Controller 发出 Cmd+C。pynput 监听线程收到这个合成按键事件，错误地把它识别为 AI 键按下，开启一次新录音，立刻又被 `get_selection()` 发出的 Cmd 抬起事件终止，产生极短录音。

**修复**：`typer.py` 加 `_simulating` 标志，`_copy_selection()` / `replace_selection()` 执行期间置 `True`。`push_to_talk._on_press` / `_on_release` 开头检查 `is_simulating()`，为真则直接返回。

---

### 2. AI 回复的自动删除误删原文（竞态条件）

**现象**：和 AI 聊天时，如果在定时器倒计时期间再次按 AI 键，整个输入框内容被清空。

**原因**：`_auto_erase` 定时器在后台线程调用 `erase_last()`，与新一轮 AI 交互中 `_show()` 的 `erase_last()` + `type_text()` 并发执行，两个线程同时操作输入框导致互相干扰。

**修复**：`ai_handler.py` 加 `_io_lock`，所有输入框 IO（`erase_last` + `type_text`）必须持锁才能执行。`_show()` 在同一个 `_io_lock` 块内先擦旧文字再打新文字，`_auto_erase` 同样持锁。

---

### 3. Command 键按住时 erase_last 触发 Cmd+Backspace 删整行

**现象**：按住 Command 键（AI 键）过程中，定时器触发 `erase_last`，macOS 收到的是 Cmd+Backspace（删到行首），而不是普通 Backspace。

**原因**：`CGEventCreateKeyboardEvent` 创建的事件会继承当前 HID 系统的修饰键状态。Command 键按住时，所有通过 Quartz 发出的按键都自动带 Command 修饰。

**修复**：两层防护：
1. `typer._erase_via_quartz` 每次发 Backspace 事件后调用 `CGEventSetFlags(evt, 0)` 清空修饰键标志。
2. `push_to_talk._on_press` 检测到 AI 键按下时立刻调用 `ai_handler.on_ai_key_down()`，取消定时器，确保 Command 按住期间定时器不会触发。松键后 `_run()` 开头统一处理旧 AI 文字的删除（此时 Command 已释放，安全）。

---

### 4. AI 文字越积越多不删除

**现象**：连续多次按 AI 键聊天，前几次的 AI 回复一直留在输入框不消失。

**原因**：`on_ai_key_down` 取消了定时器，但没有记录哪些文字待删。`handle()` 松键后直接开新线程，没有清理旧 AI 文字。

**修复**：`on_ai_key_down` 只取消定时器、不清 `_last_ai_output`。`_run()` 开头（Command 已松开、安全时）统一读取并擦除 `_last_ai_output`，再继续 STT 流程。

---

### 5. 有选中文字时聊天/写作覆盖选中内容

**现象**：鼠标选中了一段文字，用 AI 键聊天或写作时，`type_text` 把选中内容替换掉了。

**原因**：`type_text` 在有选中文字时会替换选中区域（操作系统标准行为）。

**修复**：`ai_handler._run()` 中，chat 和 write 意图检测到 `selected` 非空时，先调 `jump_to_end()`（macOS: Cmd+Down，Windows/Linux: Ctrl+End）取消选中并跳到末尾，再打入文字。

---

### 6. delete 意图说删除后仍无法删除

**现象**：`cursor_uncertain=True` 时 AI 提示「请先选中内容」，用户选中后再说「删除」，内容不消失。

**原因**：走 `edit` 意图时 LLM 被要求对「删除」指令返回空字符串，再调 `replace_selection("")`。部分应用粘贴空字符串并不等同于删除选中内容。

**修复**：新增独立的 `delete` 意图，检测到后直接发 Backspace 键删除选中区域，不经过 LLM。

---

### 7. 写作输出无标点，整块文字一次性输出

**现象**：AI 写作时不加任何标点，流式分句逻辑检测不到句子边界，整段内容等到流结束才一次性打出。

**原因**：GLM-4-Flash 在 system prompt 要求加标点时仍倾向于省略，尤其是在简洁输出模式下。

**修复**：
1. System prompt 明确要求「必须使用完整标点，不得省略」。
2. 在用户消息末尾追加「（必须加上完整的中文标点符号，包括逗号和句号，不得省略）」——模型对 user turn 的指令遵从率高于 system prompt。
3. `_SENTENCE_END` 加入逗号（`，,；;`），逗号也触发分句输出。
4. 加 `_MAX_PENDING=40` 兜底：超过 40 字没有任何标点强制输出，防止模型完全不加标点时卡住。

---

## 热键检测（Windows）

不确定按键名称时，运行：

```bat
.venv\Scripts\python -c "from pynput import keyboard; l = keyboard.Listener(on_press=lambda k: print(k)); l.start(); input()"
```

按目标键，控制台打印的即为 config.yaml 中应填的名称。

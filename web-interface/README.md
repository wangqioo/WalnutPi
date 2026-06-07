# WalnutPi Web Agent Console

`web-interface/` is the browser-facing control surface for WalnutPi.

The product goal is beginner-first operation. The user should not need to know Linux commands, `walnut` subcommands, GPIO tools, or weather APIs. They should type natural language into one input, and WalnutPi should decide what local work is needed.

## Interaction Principle

The left side is not a shortcut-button panel.

The left side is the WalnutPi agent:

```text
user says what they want
-> WalnutPi classifies the intent
-> WalnutPi builds a local execution plan
-> WalnutPi checks risk
-> WalnutPi executes safe actions or asks for confirmation
-> WalnutPi summarizes the result
```

The right side is the execution scene:

- 3D device presence
- terminal output
- live SSH fallback for advanced use
- visible trace of what the device did

Normal users should not be pushed into `walnut` menus or `1 / 2 / 3` terminal choices. Those menus can remain as CLI affordances, but the web console should call the underlying direct actions.

## Request Types

### Normal Q&A

Questions that do not need local state can go straight to the cloud AI.

Example:

```text
解释一下 I2C 是什么
```

### Local Executable Q&A

Questions that need real-time or device-local state should run locally first.

Examples:

```text
上海天气怎么样
核桃派现在还好吗
帮我看一下网络
今天记了什么
我想接一个 I2C 传感器
```

The agent should run controlled local checks such as weather lookup, `walnut status`, network checks, notes lookup, `gpio pins`, `set-device status`, and `/boot/config.txt` reads, then summarize for a beginner.

### Risky Actions

Actions with side effects require confirmation before execution.

Examples:

```text
打开某个 GPIO 输出
启用 SPI overlay
安装软件包
重启
关机
删除文件
刷写系统
```

For these, the agent should explain what will change, what can break, and ask for explicit confirmation.

## UX Direction

The first screen should have:

- one conversational input
- a concise chat history
- visible execution status
- right-side terminal / 3D device view

Avoid making the left side a list of permanent feature buttons. Beginner users should not need to decide whether their request is “status”, “snapshot”, “GPIO”, “network”, or “AI”. The agent should infer that.

Suggested placeholder:

```text
你想让核桃派做什么？
```

Suggested examples can be shown as conversation starters, but they should behave like sample prompts, not tool buttons.

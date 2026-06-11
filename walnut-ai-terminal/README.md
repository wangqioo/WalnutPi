# WalnutAI Terminal V0

WalnutAI is the local agent layer for WalnutPi. It is not only a chat wrapper: it can use safe local actions, long-term memory, WalnutPi skills, and a small successful-code corpus before answering.

## Usage

```bash
walnut-ai
walnut-ai "上海天气怎么样"
walnut-ai /memory
```

## Commands

```text
/status              查看核桃派状态
/memory              查看长期记忆
/note 内容           记录想法到 Markdown
/polish 内容         润色文字
/translate 内容      翻译文字，中英互译
/clear               清空当前聊天
/help                显示帮助
/exit                退出
```

## Local Action Flow

WalnutAI routes requests through this shape:

```text
natural language
-> intent classification
-> safe local action or normal chat
-> structured evidence
-> concise Chinese summary
```

Read actions use `walnut action run ... --json`:

```bash
walnut action run status --json
walnut action run network --json
walnut action run gpio --json
walnut action run snapshot --json
```

High-risk operations such as GPIO output, overlay changes, package installs, service changes, reboot, shutdown, deletes, flashing, firmware, or eMMC writes must not run directly.

## Memory And Retrieval

Long-term memory defaults to:

```text
~/walnut-memory/memory.json
```

WalnutAI also retrieves project context from:

```text
walnut-ai-terminal/skills/
walnut-ai-terminal/corpus/
```

The first corpus file, `corpus/successful-code.md`, records working WalnutPi patterns such as the LVGL screen sync slice and local action JSON shape.

The Web screen sync flow also appends compact successful sync evidence to:

```text
walnut-ai-terminal/corpus/screen-sync-successes.md
```

That generated corpus stores hashes, semantic labels, checks, and a short summary. It does not store command logs, screenshots, image bytes, or secrets.

Do not store secrets in memory or corpus: API keys, Wi-Fi passwords, SSH passwords, tokens, private keys, or full logs.

## Configuration

```bash
OPENAI_API_KEY              Required for cloud AI calls
WALNUT_AI_BASE_URL          OpenAI-compatible base URL, default https://rehdasu.cn/v1
WALNUT_AI_MODEL             Model name, default gpt-5.4-mini
WALNUT_AI_TIMEOUT           Request timeout, default 45 seconds
WALNUT_AI_REASONING_EFFORT  Reasoning effort, default none
WALNUT_AI_TEXT_VERBOSITY    Text verbosity, default low
WALNUT_AI_MEMORY_FILE       Memory file, default ~/walnut-memory/memory.json
WALNUT_AI_NOTES_DIR         Daily notes directory, default ~/walnut-memory/daily
WALNUT_AI_DEVICE_PROFILE    Device identity, default 核桃派 1B ZeroW
WALNUT_AI_SKILLS_DIR        Skills directory, default walnut_ai.py sibling skills/
WALNUT_AI_PRIMARY_SKILL     Primary skill, default walnutpi-1b-zerow
WALNUT_AI_CORPUS_DIR        Successful-code corpus, default walnut_ai.py sibling corpus/
WALNUT_CLI                  Optional explicit walnut CLI path
```

## Install

From the repository root:

```bash
sudo ./scripts/install-walnut-ai.sh
```

The installer copies `walnut_ai.py`, `skills/`, `corpus/`, and the `walnut` CLI into the board runtime.

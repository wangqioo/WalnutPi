# WalnutAI Terminal V0

A tiny cloud-AI terminal for headless Linux devices such as WalnutPi.

## Usage

```bash
walnut-ai
```

## Commands

```text
/status              Show device, service, Docker, memory, and disk status
/note text           Save a note to Markdown
/polish text         Lightly polish text using cloud AI
/translate text      Translate between Chinese and English
/clear               Clear current chat context
/help                Show help
/exit                Exit
```

Plain text input starts a normal AI chat.

## Configuration

The script reads these environment variables:

```bash
OPENAI_API_KEY       Required API key
WALNUT_AI_BASE_URL   OpenAI-compatible base URL, default: https://rehdasu.cn/v1
WALNUT_AI_MODEL      Model name, default: gpt-5.5
WALNUT_AI_NOTES_DIR  Notes directory, default: /root/walnut-ai-notes
WALNUT_AI_CONTEXT_DIR  WalnutPi context skills, default: walnut-ai-terminal/skills
WALNUT_AI_MEMORY_FILE  Non-secret memory seed, default: walnut-ai-terminal/memory/default-memory.json
```

On the WalnutPi prototype, the launcher sources `/root/.profile` so it can reuse the existing `OPENAI_API_KEY`.

The default context bundle is intentionally small and non-secret. It includes WalnutPi product direction, screen workflow facts, and safety boundaries. Do not put API keys, Wi-Fi passwords, SSH passwords, tokens, private keys, or logs into the memory file.

## Install

From the repository root:

```bash
sudo ./scripts/install-walnut-ai.sh
```

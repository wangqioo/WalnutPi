# WalnutPi Platform Config

`platform.defaults.json` is committed and contains only non-secret defaults.

Use `platform.local.json` for machine-specific non-secret overrides. It is
ignored by git.

Secrets are loaded from declared sources, currently:

- `~/.codex/auth.json` for the AI API key.
- `~/secret.md` for Langfuse keys.

Expected `~/secret.md` entries:

```text
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

For the local Docker Compose Langfuse stack on Windows, use:

```text
LANGFUSE_BASE_URL=http://localhost:3000
```

Do not rewrite that local URL to `http://127.0.0.1:3000`; the Langfuse OTLP
trace endpoint is reachable through `localhost` in the current local setup.

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

Retrieval embeddings are disabled by default. To enable the approved provider
path for curated corpus rows, add a machine-local `retrievalEmbeddings` block to
`platform.local.json` with an OpenAI-compatible embedding base URL, model, and
credential source. Retrieval embeddings do not reuse the chat model credentials
implicitly. Do not enable remote embedding for approved memory unless the
memory record metadata explicitly records `embeddingConsent: "approved"` and
`remoteEmbeddingAllowed: true`.

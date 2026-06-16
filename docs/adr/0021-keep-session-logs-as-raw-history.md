# Keep session logs as raw history

WalnutPi keeps Session Logs as append-only raw interaction history, not as Durable Memory or Retrieval Corpus. Session Logs are useful for audit, debugging, and later memory distillation, but they may contain transient content and private details that should not be treated as long-term facts or automatically retrieved as project knowledge.

**Consequences**

Session Logs should stay out of Git by default and should not be fed wholesale into prompts or retrieval. Durable Memory must be distilled from user-authored content with secret filtering and conservative selection, while Retrieval Corpus remains curated project knowledge rather than raw conversation history.

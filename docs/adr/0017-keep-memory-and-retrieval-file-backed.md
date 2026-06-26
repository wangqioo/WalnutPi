# Superseded: keep memory and retrieval file-backed

Status: Superseded by `docs/agent-platform-refactor-spec.md`.

WalnutPi previously kept Durable Memory, Daily Notes, Session Logs, and Retrieval Corpus as file-backed, auditable local artifacts for the early product stage. The agent-platform refactor moves active control-plane product state to Postgres.

**Consequences**

File-backed memory and old JSONL session logs are not the active Web session, agent-turn, or durable-memory path. Retrieval remains curated: raw session logs and raw daily notes must not be vector-indexed or scanned as a background memory source.

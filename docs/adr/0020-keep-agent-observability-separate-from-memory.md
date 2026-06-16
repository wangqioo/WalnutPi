# Keep agent observability separate from memory

WalnutPi keeps Agent Observability separate from Durable Memory, Daily Notes, Session Logs, and Retrieval Corpus. Observability is for calls, latency, failures, token use, cost signals, and tool execution metrics; it is not a channel for user memory, private content, secrets, or full conversation logs.

**Consequences**

Product performance and cost monitoring should record compact operational metrics without turning observability into another memory store. User-authored content should stay in the appropriate Session Log, Daily Notes, Durable Memory, or Sync Record paths with their existing privacy and retention boundaries.

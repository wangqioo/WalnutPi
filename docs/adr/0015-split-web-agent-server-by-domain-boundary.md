# Split Web Agent server by domain boundary

The Web Agent server should be split by WalnutPi domain boundaries instead of continuing to grow as one mixed server file. Agent API concerns, Screen Workspace API concerns, device transport, diagnostics, and static UI hosting are separate responsibilities even when they run in one Bun process.

**Consequences**

Future Web work should move directly toward modules for Agent APIs, Screen Workspace APIs, Device Transport, Developer Diagnostics, and static UI hosting. The project should not preserve a compatibility layer around the current file shape; routes can stay externally stable while the internal implementation is reorganized by domain boundary.

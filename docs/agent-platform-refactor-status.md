# Agent Platform Refactor Status

Date: 2026-06-24

This status note records the current destructive refactor checkpoint. The
source of truth remains `docs/agent-platform-refactor-spec.md`.

## Current Cut

- The old custom agent loop, registry, runtime agents, loop-model contract,
  scenario harness contract, and `agentTurn.v2` projector/validator have been
  removed from the production codebase.
- `/api/agent/turn` now routes through `web-interface/agent-platform-runtime.ts`
  and returns `walnutpi.agentPlatformTurn.v1`.
- Tool outputs now use typed result contracts from
  `web-interface/walnut-tool-results.ts`.
- Screen work now has a first Screen Command DSL surface:
  `web-interface/screen-command-dsl.ts` and
  `web-interface/screen-command-runner.ts`.
- The static console has been adjusted to read `route`, `userSummary`, and
  `toolResults[]` from the new platform turn shape.

## Refactor Rule

This is not a compatibility migration. Do not reintroduce compatibility shims
for the deleted custom loop, registry, runtime agents, old bounded continuation
loop, old model-backed replan loop, or `agentTurn.v2` production responses.

## Device Rule

WalnutPi is expected to work with the real WalnutPi Device. Device and screen
claims must be verified through the narrow Device Execution Surface and recorded
as device-profile evidence. Do not describe device-backed smoke checks as
local-only or mock verification.

## Verified

- `bun run check`
- `/api/agent/turn` smoke returned `walnutpi.agentPlatformTurn.v1` with typed
  tool results.
- Policy pending smoke returned `noCommandExecution` evidence.

The smoke run that called the chat action was device-backed. Treat that as
device-profile verification, not offline verification.

## Next Work

- Wire real Mastra runtime over the new platform turn contract.
- Add MCP/Hono gateway with per-call OPA enforcement.
- Expand Screen Command DSL to cover real render, playlist, sync, and capture
  flows end to end with device-profile evidence.
- Replace static console with Next.js only after the new platform paths are
  stable enough to expose.
- Add curated eval scaffolding without restoring deleted generated benchmark
  harnesses.

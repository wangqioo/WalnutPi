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
- The Screen Command DSL now carries explicit preview no-write sync mode,
  stale-hash refusal evidence, and read-only frame capture evidence through
  typed screen tool results.
- The static console has been adjusted to read `route`, `userSummary`, and
  `toolResults[]` from the new platform turn shape.
- Legacy TypeScript local probe files and the old `walnut-ai` local probe entry
  have been removed from the active code path.
- Agent-generated Widget Apps are now treated as explicit Widget App Artifacts,
  not default Screen Playlist items. Playlist runtime asset generation ignores
  Widget App provenance; Widget App creation, activation, and sync now use the
  separate Widget App product flow.
- ADR 0026 records the three generation chains: Wallpaper/GIF, LVGL Widget App
  desktop, and Terminal Print Source. Widget App generation is catalog-first
  and no longer falls back to `TerminalPrintSource`.

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
- Screen DSL contract probe covered preview no-write, stale hash refusal, and
  capture evidence shape without adding a legacy local probe file.
- Device-profile read-only evidence returned WalnutPi framebuffer and capture
  metadata through `scripts/collect-screen-sync-evidence.ps1`.
- Device-profile `/api/agent/turn` read-only screen flow returned typed
  `walnutpi.toolResult.screen.v1` and `walnutpi.screenCaptureEvidence.v1`
  without embedding PNG base64 in the turn ledger.
- ADR 0025 and `CONTEXT.md` record the split between generated Widget App
  Artifacts and Screen Playlist playback.
- `bun run check` passes after removing the old generated-source-to-Widget-App path.
- `scripts/collect-screen-sync-evidence.ps1 -Sync` now preflights the tracked
  default playlist before sync. If the playlist references missing or old
  generated manifests that do not satisfy the frame hash schema, the script
  explicitly reports that ignored generated artifacts must be cleaned and
  rebuilt, removes only `git check-ignore` approved generated artifacts, rebuilds
  a Wallpaper default playlist through the current Web API, then continues the
  device-profile sync path.
- `walnut screen frame` and `walnut screen capture` now expose
  `bitsPerFrameUnit` and `frameFormat` in the Device Execution Surface. The
  only remaining lower-level reference to `bits_per_pixel` is the Linux sysfs
  filename read by the device CLI.
- Device-profile sync evidence was rerun after deleting the current
  `agent-freeform-*` generated artifacts. The script rebuilt the default
  playlist and completed with `ok: True`, `visualMatch: captured`, and
  `frameContentEvidenceClaim: framebuffer-rgb565-hash-matched`.

The smoke run that called the chat action was device-backed. Treat that as
device-profile verification, not offline verification.

## Next Work

- Wire real Mastra runtime over the new platform turn contract.
- Add MCP/Hono gateway with per-call OPA enforcement.
- Expose and verify the already-implemented `screen.renderWallpaper` and
  `screen.writePlaylist` command-runner paths through the product agent
  runtime/Mastra path. Remote sync, stale hash refusal, preview no-write, frame
  evidence, and capture evidence now have an initial device-profile path, but
  full Web preview versus device frame comparison remains future work.
- Replace static console with Next.js only after the new platform paths are
  stable enough to expose.
- Add curated eval scaffolding without restoring deleted generated benchmark
  harnesses.

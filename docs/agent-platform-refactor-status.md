# Agent Platform Refactor Status

Date: 2026-06-26

This status note records the current destructive refactor checkpoint. The
source of truth remains `docs/agent-platform-refactor-spec.md`.

## Current Cut

- The old custom agent loop, registry, runtime agents, loop-model contract,
  scenario harness contract, and `agentTurn.v2` projector/validator have been
  removed from the production codebase.
- `web-interface/router.ts` has been deleted and the Hono gateway seam now lives
  in `web-interface/gateway/mcp-server.ts`.
- `/api/agent/turn` now routes through `web-interface/agent-platform-turn-route.ts`
  for request handling, ledger writes, and typed-result projection only. It no
  longer dispatches unsupported capabilities to the old local dispatcher.
- `web-interface/gateway/tool-dispatcher.ts` no longer exposes an intent
  dispatch entry. It is now the MCP/domain tool dispatcher used by `/mcp`, and
  executable device tools still pass through the OPA policy gate before command
  construction.
- Supported structured capabilities enter
  `web-interface/platform/mastra/agent-turn-workflows.ts`, call `@mastra/mcp`
  against `/mcp`, then project typed tool results into
  `walnutpi.agentPlatformTurn.v1`.
- Structured `/api/agent/turn` calls use top-level `capability` as the explicit
  product tool contract. Supported capabilities route directly to Mastra MCP
  without invoking the model router; unsupported capabilities fail. Nested
  `requirements.capability` is not an execution protocol.
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
- `@mastra/core` is now a direct dependency because `web-interface/mastra-registry.ts`
  imports it directly.
- `ai` is the Vercel AI SDK Core package used by the web/API surface, not a
  separate local AI abstraction.
- `@mastra/ai-sdk` is not a production dependency yet; the current code does not
  import it. It should be added only when the route/UI adapter is actually used.
- Mastra agents currently use Mastra's OpenAI-compatible model config shape. Do
  not pass AI SDK v7 provider objects into Mastra until the selected Mastra
  version supports that provider generation directly.
- The platform dependency set has been installed for Mastra MCP, MCP SDK, Next
  16, React 19, AI SDK, better-auth, Inngest, OTel, Langfuse, Drizzle/Postgres,
  and drizzle-kit. `web-interface/platform/` now owns the first module
  boundaries for those packages.
- `web-interface/gateway/mcp-server.ts` exposes a real MCP SDK Streamable HTTP
  endpoint at `/mcp`. The old JSON-RPC-shaped `/api/gateway/mcp` route has been
  removed.
- The SDK tool surface now exposes the platform slice:
  `screen.readPlaylist`, `diagnostics.recentFailure`, `device.status.read`,
  `device.network.read`, `device.snapshot.read`, `device.i2c.read`,
  `device.gpio.read`, `device.notes.read`, `memory.sessionSummary`,
  `screen.captureFrame`, `screen.syncPlaylist`, `screen.renderWallpaper`, and
  `screen.writePlaylist`, `memory.preference`, `memory.sensitiveSkip`,
  `device.note.write`, `policy.action.prepare`, and `policy.action.commit`.
- `screen.captureFrame`, `screen.syncPlaylist`, `screen.renderWallpaper`, and
  `screen.writePlaylist` are registered as real MCP SDK tools with explicit
  read/write/destructive annotations and dispatch only through the Screen
  Command DSL runner.
- `screen.syncPlaylist` and `screen.writePlaylist` have Action Policy Manifest
  action ids and pass through the OPA policy gate before Screen Command DSL
  execution. OPA-unavailable degraded decisions fail closed for write-low and
  high-risk actions.
- `device.note.write` is exposed as an MCP/Mastra tool and remains an
  OPA-gated Agent Action Command. `memory.preference` and
  `memory.sensitiveSkip` are exposed as typed MCP/Mastra memory tools that
  produce candidates or skip evidence without committing durable memory.
- Structured continuation routing no longer treats all `device.*` intents as
  read-only; write continuations require an explicit `write-continuation`
  constraint.
- MCP requests now attach server-derived subject and device environment context
  to internal tool turns. OPA policy input receives `subject`,
  `environment.deviceProfile`, `environment.target`, and request
  `sessionId`/`turnId`/`traceId`; tool arguments may set preview mode and
  approval token but cannot override subject or device target.
- The MCP subject resolver now attempts the better-auth session API first and
  then falls back to the server-derived local-owner subject for the current
  local control-plane profile. Client headers cannot declare subject or roles.
- `policy.action.prepare` and `policy.action.commit` are real MCP/Mastra tools.
  Prepare records decision id, action id, normalized params hash, command
  binding id, subject, expiry, explanation, OPA decision, and approval token
  hash in the DB-backed `action_approval_records` product-state table. Commit requires matching
  decision id, normalized params hash, subject, approval token, and a fresh OPA
  allow decision before any execution path can be reached.
- If approval record persistence fails, prepare does not issue an approval
  token and commit does not reach command construction.
- High-risk service restart/reboot/shutdown/package install/storage
  delete/overlay/image flash actions still do not directly execute through Web
  commit. The commit can be recorded, but the dispatcher blocks direct high-risk
  execution before command construction.
- `web-interface/agent-harness-session-store.ts`,
  `WALNUT_AGENT_HARNESS_SESSIONS_PATH`, and the public
  `/api/agent/harness-session` route have been removed.
- Public MCP, Mastra, agent-turn, action, screen-sync, and session projections
  no longer expose raw shell, SSH, or Walnut CLI command strings. Command
  construction remains inside the dispatcher/adapter boundary and raw command
  records stay limited to internal diagnostic/audit boundaries.
- Gateway policy/action/MCP audit events now persist through the control-plane
  Postgres `audit_events` table. `web-interface/gateway/audit-ledger.ts` no
  longer writes `data/gateway-audit.jsonl`; DB-unavailable writes report an
  explicit skipped persistence result instead of falling back to JSONL.
- `memory.preference` and `memory.sensitiveSkip` now route through a DB
  product-state store seam. Preference captures create candidate records when
  Postgres is available; sensitive skips store only a SHA-256 text hash and
  length. If the DB table/config is unavailable, the tool reports the boundary
  as reached and skipped instead of falling back to file writes.
- `web-interface/platform/mastra/mcp-client.ts` initializes `@mastra/mcp`
  `MCPClient` against the local `/mcp` endpoint and can list the SDK tools for
  future Mastra agent attachment.
- The `/api/agent/turn` slices above share the same Mastra MCP
  workflow dispatcher. Final tool result diagnostics use
  `mastra.mcp.<capability>`.
- `web-interface/platform/policy/opa-boundary.ts` runs OPA CLI decisions for
  the active tool-dispatch policy gate, with local manifest fail-closed behavior
  when OPA is unavailable.
- TypeScript stays on 5.9.x. Mastra's published declaration bundle currently
  includes provider compatibility declarations that do not typecheck cleanly
  under TS5, so third-party library declaration checking is skipped while
  WalnutPi source remains typechecked.
- `docs/mastra-ai-sdk-mcp-dependency-note.md` records why `ProviderV3`-style
  declaration errors are a dependency-boundary signal, not a WalnutPi source
  error.
- `typescript` remains pinned to `5.9.3`.

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
- `bun run verify:platform`
- OPA CLI `version` and minimal Rego eval pass on the local control plane.
- Live `bun run web` `/mcp` verification listed the migrated read-only tool
  surface through `@mastra/mcp`.
- Live `POST /api/agent/turn` with a structured `device.status.read`
  continuation completed through `mastra.mcp.device.status.read`.
- `bun run verify:platform` now verifies at least 18 `/mcp` tools/list
  entries, 17 MCP tools/call invocations, and 13 structured
  `/api/agent/turn` slices through Mastra MCP workflow dispatch.
- `bun run verify:platform` also verifies OPA-unavailable degraded behavior:
  read actions may local-allow, while write-low actions fail closed with
  `noCommandExecution`.
- `bun run verify:platform` verifies MCP auth/device context reaches gateway
  policy audit for an OPA-gated tool call.
- `bun run verify:platform` verifies spoofed subject/role headers are ignored
  by the MCP subject resolver.
- `bun run verify:platform` verifies `policy.action.prepare` produces no command
  execution, `policy.action.commit` requires the approval proof, and high-risk
  direct Web execution remains blocked without exposing command strings.
- `bun run verify:platform` verifies the `actionApprovalRecords` Drizzle schema
  is present.
- `bun run verify:platform` injects a stub raw command into the device action
  dispatcher and recursively verifies MCP/Mastra/agent-turn results do not
  expose raw command fields.
- `bun run verify:platform` verifies the memory product-state schema and the
  memory tool seam, including that `memory.sensitiveSkip` does not expose raw
  sensitive text.
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
- Offline platform verification covers `screen.captureFrame` with typed capture
  metadata, `screen.syncPlaylist` in preview no-write mode, and
  `screen.renderWallpaper`/`screen.writePlaylist` against a temporary Screen
  Workspace so verification does not mutate the tracked default playlist.
  Verification also asserts OPA policy decisions for screen sync/write
  `tools/call`.
- Device-profile MCP `screen.syncPlaylist` was run against the WalnutPi Device
  after starting `walnut-screen.service`; the call passed OPA with
  `policyStatus: allow`, completed remote delivery/activation, and returned
  build id `screen-20260626080224-69dde0d5`.
- Read-only device evidence then reported `walnut-screen.service active`,
  framebuffer `RGB565_LE`, nonblank 480x320 output, and raw framebuffer hash
  `e3fbf800e5918d0edc07ed7a805c7eb2bf17f57f74a99057d45e98e39186c13f`, matching
  the tracked `seed-terminal-ops` playlist output hash.
- ADR 0025 and `CONTEXT.md` record the split between generated Widget App
  Artifacts and Screen Playlist playback.
- `bun run check` passes after removing the old generated-source-to-Widget-App
  path.
- `scripts/collect-screen-sync-evidence.ps1 -Sync` now preflights the tracked
  default playlist before sync. If the playlist references missing or old
  generated manifests that do not satisfy the frame hash schema, the script
  explicitly reports that ignored generated artifacts must be cleaned and
  rebuilt, removes only `git check-ignore` approved generated artifacts,
  rebuilds a Wallpaper default playlist through the current Web API, then
  continues the device-profile sync path.
- `walnut screen frame` and `walnut screen capture` now expose
  `bitsPerFrameUnit` and `frameFormat` in the Device Execution Surface. The
  only remaining lower-level reference to `bits_per_pixel` is the Linux sysfs
  filename read by the device CLI.
- The local control-plane Postgres container was migrated with `bun run
  db:migrate`, using
  `web-interface/platform/db/migrations/0001_platform_product_state.sql`,
  `0002_action_approval_records.sql`, and
  `0003_expand_audit_events.sql`. A live `policy.action.prepare` call through
  `/api/agent/turn` completed via `mastra.mcp.policy.action.prepare`, returned
  `dbProductState.persisted: true`, exposed no raw command, and produced an
  `action_approval_records` row for decision
  `b22e6760-605e-4b83-b7bd-69021b71e402`.
- Live `/api/agent/turn` calls for `policy.action.prepare` and
  `device.status.read` wrote gateway audit rows into `audit_events`, including
  OPA decision ids, action ids, server-derived subject kind, session/turn ids,
  and device profile context. The final tool result diagnostics still use
  `mastra.mcp.*` operations.
- Device-profile sync evidence was rerun after deleting the current
  `agent-freeform-*` generated artifacts. The script rebuilt the default
  playlist and completed with `ok: True`, `visualMatch: captured`, and
  `frameContentEvidenceClaim: framebuffer-rgb565-hash-matched`.

The smoke run that called the chat action was device-backed. Treat that as
device-profile verification, not offline verification.

## Next Work

- Add the approval UI around `policy.action.prepare`/`policy.action.commit`.
- Replace the current better-auth-first/local-owner subject resolver with real
  signed-in user flows once the Next.js console owns login/session creation.
- Move approved durable memory/retrieval to the curated DB path.
- Decide the next ledger migration target: agent turns/session events are still
  file-backed append-only ledgers, while gateway audit and approval records are
  now Postgres-backed product state.
- Extend device-profile verification for the platform `screen.syncPlaylist`
  path beyond preview no-write into remote delivery, activation, service state,
  and frame comparison.
- Replace static console with Next.js only after the new platform paths are
  stable enough to expose.
- Add curated eval scaffolding without restoring deleted generated benchmark
  harnesses.

For a compact keep / replace / delete view with priority, see
`docs/agent-platform-refactor-gap-matrix.md`.

For the Mastra, Vercel AI SDK, MCP, and TS5 dependency boundary, see
`docs/mastra-ai-sdk-mcp-dependency-note.md`.

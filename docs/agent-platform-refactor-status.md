# Agent Platform Refactor Status

Date: 2026-06-27

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
- `web-interface/screen-renderers/` now contains explicit `WallpaperRenderer`
  `TerminalPrintRenderer`, `RuntimeAssetRenderer`, and `WidgetAppRenderer`
  adapters. The Screen Workspace API, Screen Command DSL runner, LVGL preview
  path, terminal-print source generation path, Widget App artifact/runtime
  generation path, runtime generation CLI, and SSH delivery adapter receive
  these renderer contracts rather than importing the low-level wallpaper
  pipeline, terminal-print artifact writer, Widget App catalog/runtime writer,
  or runtime asset writer directly. `terminal-print-screen-source.ts` now keeps
  terminal-print schemas, template loading, and source-spec construction while
  `TerminalPrintRenderer` owns PNG/SVG rendering plus terminal-print
  source/output artifact writes. `widget-app-workspace.ts` keeps HTTP, device
  sync, and event orchestration while `WidgetAppRenderer` owns catalog-to-app
  artifacts and Widget App runtime files. SSH delivery now sends rendered
  runtime assets from the control plane and no longer ships the runtime
  generation script as a device-side content path.
- Widget App workspace-local refresh, action event, and sync endpoints no
  longer construct SSH, shell, Walnut CLI, or `systemctl` commands. Local Widget
  App create/activate/preview/download still work, and local-only widget
  actions such as the pomodoro demo may update runtime state. Device-affecting
  Widget App refresh/action/sync calls now fail closed with
  `policyGatedPlatformToolRequired`, `deviceBoundaryRequired`,
  `noCommandExecution`, and `noRemoteCommandExecution` evidence until those
  operations are exposed as first-class MCP/OPA platform tools.
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
  `@mastra/pg`, and drizzle-kit. `web-interface/platform/` now owns the first module
  boundaries for those packages.
- Mastra registry storage now uses `@mastra/pg` `PostgresStore` through
  `web-interface/platform/mastra/storage.ts`. The local control-plane database
  owns Mastra-managed `mastra_*` tables; the platform no longer accepts the
  Mastra in-memory storage warning as a valid state.
- `web-interface/gateway/mcp-server.ts` exposes a real MCP SDK Streamable HTTP
  endpoint at `/mcp`. The old JSON-RPC-shaped `/api/gateway/mcp` route has been
  removed.
- The SDK tool surface now exposes the platform slice:
  `screen.readPlaylist`, `diagnostics.recentFailure`, `device.status.read`,
  `device.network.read`, `device.snapshot.read`, `device.i2c.read`,
  `device.gpio.read`, `device.notes.read`, `memory.sessionSummary`,
  `screen.captureFrame`, `screen.syncPlaylist`, `screen.renderWallpaper`, and
  `screen.writePlaylist`, `memory.preference`, `memory.approve`,
  `memory.sensitiveSkip`, `device.note.write`, `policy.action.prepare`, and
  `policy.action.commit`.
- `screen.captureFrame`, `screen.syncPlaylist`, `screen.renderWallpaper`, and
  `screen.writePlaylist` are registered as real MCP SDK tools with explicit
  read/write/destructive annotations and dispatch only through the Screen
  Command DSL runner.
- `screen.syncPlaylist` and `screen.writePlaylist` have Action Policy Manifest
  action ids and pass through the OPA policy gate before Screen Command DSL
  execution. OPA-unavailable degraded decisions fail closed for write-low and
  high-risk actions.
- `device.note.write` is exposed as an MCP/Mastra tool and remains an
  OPA-gated Agent Action Command. `memory.preference`, `memory.approve`, and
  `memory.sensitiveSkip` are exposed as typed MCP/Mastra memory tools.
  Preference capture produces a candidate, approval persists durable memory by
  candidate id, and sensitive skip records hash/length evidence only.
- Structured continuation routing no longer treats all `device.*` intents as
  read-only; write continuations require an explicit `write-continuation`
  constraint.
- MCP requests now attach server-derived subject and device environment context
  to internal tool turns. OPA policy input receives `subject`,
  `environment.deviceProfile`, `environment.target`, and request
  `sessionId`/`turnId`/`traceId`; tool arguments may set preview mode and
  approval token but cannot override subject or device target.
- OPA policy now requires an authenticated owner role and matching org/device
  binding between subject and environment before allowing read actions or
  approved confirmable actions. Policy audit keeps only a public subject and
  environment summary; private device targets are not exposed through public
  projections.
- `/api/agent/turn` now creates a request-scoped Mastra MCP workflow dispatcher
  before dispatching structured capabilities. Its internal `/mcp` call reuses
  the same server-derived auth context as direct `/mcp` requests instead of
  constructing a hard-coded local-owner subject inside the workflow.
- `/api/agent/turn` is no longer short-circuited by the old `nossh` preview
  query parameter. Structured turns still reach Mastra/MCP/OPA so platform
  wiring failures cannot be disguised as preview skips.
- The MCP subject resolver now attempts the better-auth session API first and
  then falls back to the server-derived local-owner subject for the current
  local control-plane profile. Client headers cannot declare subject or roles.
- The Hono gateway now mounts better-auth at `/api/auth/*` plus a redacted
  `/api/auth/subject` projection. better-auth uses the control-plane Postgres
  tables `auth_user`, `auth_session`, `auth_account`, and `auth_verification`;
  DB-unavailable auth startup is an honest failure, not an in-memory fallback.
- WalnutPi org/device/role subject binding is DB-owned through `walnut_orgs`,
  `walnut_devices`, and `walnut_user_bindings`. Signed better-auth sessions
  are resolved to a server-derived owner binding for the default WalnutPi
  device before entering MCP/OPA. If that binding path cannot be persisted or
  read, the signed session path fails instead of falling back to a
  client-controlled role.
- The default local WalnutPi device binding is server-owned. Request
  environment values cannot initialize or overwrite the default device
  `target` or `deviceProfile`; signed better-auth subjects resolve those fields
  from Postgres binding state before MCP/OPA.
- The Next/Tailwind console now has a compact session panel for email sign-up,
  sign-in, sign-out, and server-derived subject display. It does not submit
  client-controlled subject or role headers.
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
- `/api/gateway/audit-events` exposes a public audit projection from
  `audit_events` for diagnostics. The projection includes operation metadata,
  ids, hashes, policy summary, subject kind, and device profile, but does not
  expose raw params, raw decision bodies, raw result payloads, raw evidence
  payloads, command strings, approval tokens, or device output.
- Active Web session events, agent turn snapshots, and agent turn events now
  persist through Postgres tables `web_session_events`,
  `agent_turn_snapshots`, and `agent_turn_events`. The active ledgers do not
  write JSONL fallback files; DB-unconfigured reads report empty ledgers and
  public read APIs expose skipped persistence status, while DB write failures
  are surfaced as persistence failures.
- Local JSONL and smoke-log residues under `web-interface/` are explicitly
  ignored. The active Web session, agent-turn, approval, auth, and audit paths
  are Postgres-backed rather than file-backed ledgers.
- `memory.preference`, `memory.approve`, and `memory.sensitiveSkip` now route
  through a DB product-state store seam. Preference captures create candidate
  records when Postgres is available; `memory.approve` accepts an explicit
  `candidateId` and writes an approved durable memory record to
  `durable_memory_records`; sensitive skips store only a SHA-256 text hash and
  length. None of these tools scans raw session logs or raw daily notes, and
  no retrieval/vector index entry is created.
- `/api/retrieval` now uses
  `web-interface/platform/memory/curated-retrieval-store.ts` as the active
  control-plane retrieval path. It reads approved durable memory and curated
  `retrieval_documents` rows only. Raw session logs and raw daily notes are
  excluded by `source_kind`/`status`. The old Web file-backed skills/corpus
  scanner was removed; `walnut-ai-terminal/skills` and `walnut-ai-terminal/corpus`
  remain archived/prototype seed material only.
- `web-interface/platform/memory/retrieval-embedding-index.ts` owns the
  pgvector indexing seam. It writes `retrieval_embedding_records` only for
  `approved_memory` and `curated_corpus` source kinds, with DB check
  constraints enforcing those source kinds. Raw session logs and raw daily
  notes are rejected before index writes and cannot satisfy the table
  constraints.
- `web-interface/platform/memory/retrieval-reindex-workflow.ts` owns the
  retrieval reindex workflow. The Inngest function
  `walnut/retrieval.reindex.requested` runs that workflow, so retrieval reads
  no longer write embeddings as a GET side effect.
- `web-interface/platform/mastra/mcp-client.ts` initializes `@mastra/mcp`
  `MCPClient` against the local `/mcp` endpoint and can list the SDK tools for
  future Mastra agent attachment.
- The `/api/agent/turn` slices above share the same Mastra MCP
  workflow dispatcher. Final tool result diagnostics use
  `mastra.mcp.<capability>`.
- `ai.chat` is now a first-class MCP/Mastra capability. Natural-language chat
  and explicit structured chat turns reach the `walnutpi_ai.chat` MCP tool and
  project final diagnostics as `mastra.mcp.ai.chat`; `/api/agent/turn` no longer
  has a direct chat-agent branch that bypasses the workflow dispatcher.
- The old monolithic platform verification harness and package script have been
  removed. Automatic local verification is `bun run check`; platform API and
  real-device verification are manual operator checks recorded as evidence, not
  skip-able platform wiring probes.
- Default WalnutPi device access now targets `192.168.44.126` in Web config and
  real-device helper scripts.
- `web-interface/next-app/` now contains the first Tailwind-based Next.js
  Walnut Agent Console slice. It provides a fixed-height chat workspace, quick
  Mastra/MCP capability actions, read-only device diagnostics buttons, and an
  approval queue around
  `policy.action.prepare`/`policy.action.commit`. The approval UI approves only
  prepared catalog actions plus normalized params and approval proof; it does
  not display or submit raw command strings. The right control deck is now
  split into Status, Screen, and Details tabs so beginner status/actions stay
  first, while route, evidence, audit, manifest/output artifact summaries,
  recent screen evidence records, read/capture actions, and preview no-write
  sync remain available without exposing raw device output. Next rewrites
  `/api/*` and `/mcp` to the Hono platform server during local development.
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

- `bun run check` passes with TypeScript pinned to `5.9.3` and
  `skipLibCheck: true`.
- Before retiring the harness, the platform path was manually exercised through
  the former local verification harness with 20 SDK MCP tools including
  `walnutpi_ai.chat`; structured `ai.chat` reached final diagnostics operation
  `mastra.mcp.ai.chat` and exposed no raw command field. This was a one-time
  operator check, not a retained script.
- Live API/device checks are now expected to be run manually by the operator.
  Current device helper defaults point to `root@192.168.44.126`.
- Historical evidence below remains useful context, but it is not an active
  automated platform gate.
- OPA CLI `version` and minimal Rego eval pass on the local control plane.
- Live `bun run web` `/mcp` verification listed the migrated read-only tool
  surface through `@mastra/mcp`.
- Live `POST /api/agent/turn` with a structured `device.status.read`
  continuation completed through `mastra.mcp.device.status.read`.
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
- `@mastra/pg` was installed and the Mastra registry was rebound to
  Postgres-backed storage.
- Live `/api/agent/turn` smoke for `device.status.read` and
  `memory.preference` completed through final diagnostics operations
  `mastra.mcp.device.status.read` and `mastra.mcp.memory.preference`; both turn
  responses reported `telemetry.persistence.turnLedger.persisted: true`,
  `/api/agent/turns` returned two Postgres-backed turn snapshots,
  `/api/agent/turn-events` returned four Postgres-backed events, and neither
  response exposed raw command fields.
- `bun run next:build` passes for the Next/Tailwind console.
- After splitting `WallpaperRenderer` and `RuntimeAssetRenderer`, `bun run
  check` passes. No platform verification harness or device-profile check was
  run; those checks are manual operator evidence now.
- After splitting `TerminalPrintRenderer`, `bun run check` passes. No platform
  verification harness or device-profile check was run.
- After splitting `WidgetAppRenderer`, `bun run check` passes. No platform
  verification harness or device-profile check was run.
- After removing workspace-local Widget App remote execution, `bun run check`
  passes. No platform verification harness or device-profile check was run.
- The ignored local `web-interface/data/gateway-audit.jsonl`,
  `agent-turns.jsonl`, `agent-turn-events.jsonl`, and old live-test log files
  were deleted from the workspace after the Postgres paths became the active
  ledgers.
- Live Next proxy smoke through `http://127.0.0.1:3000/api/agent/turn` verified
  `device.status.read`, `policy.action.prepare`, and `policy.action.commit`
  all reach final `mastra.mcp.*` operations. The prepare result issued an
  approval token without raw command exposure; commit returned the expected
  high-risk direct Web execution block without raw command exposure.
- Live `bun run web` smoke verified better-auth HTTP sign-up produced a
  `better-auth-user` subject with `bindingSource: postgres`, owner role, and
  the default WalnutPi org/device binding. The same signed session reached
  `/api/agent/turn` for `device.status.read` and `policy.action.prepare` with
  final diagnostics operations `mastra.mcp.device.status.read` and
  `mastra.mcp.policy.action.prepare`; no raw command field was exposed.
- Playwright smoke rendered the Next console, clicked `Prepare restart`,
  observed the approval queue button, and found no raw command string in the
  visible UI.
- Device-profile sync evidence was rerun after deleting the current
  `agent-freeform-*` generated artifacts. The script rebuilt the default
  playlist and completed with `ok: True`, `visualMatch: captured`, and
  `frameContentEvidenceClaim: framebuffer-rgb565-hash-matched`.

The smoke run that called the chat action was device-backed. Treat that as
device-profile verification, not offline verification.

## Next Work

- Add multi-org/device management and role-assignment UI/API on top of the
  current Postgres-backed better-auth subject binding tables.
- Replace the deterministic local embedding seam with an approved embedding
  provider without sending raw/private content.
- Move Screen Workspace authoring and artifact detail panels into the
  Next/Tailwind console, then retire the static HTML console.
- Add policy-gated Widget App sync/action MCP tools before restoring Widget App
  device delivery.
- Extend device-profile verification for the platform `screen.syncPlaylist`
  path beyond preview no-write into remote delivery, activation, service state,
  and frame comparison.
- Add curated eval scaffolding without restoring deleted generated benchmark
  harnesses.

For a compact keep / replace / delete view with priority, see
`docs/agent-platform-refactor-gap-matrix.md`.

For the Mastra, Vercel AI SDK, MCP, and TS5 dependency boundary, see
`docs/mastra-ai-sdk-mcp-dependency-note.md`.

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
- `screen.widgetApp.sync` and `screen.widgetApp.action` are now first-class
  MCP/Mastra capabilities. Widget App sync has an Action Policy Manifest action
  id and reaches OPA before invoking a typed Widget App device delivery
  adapter; Widget App action maps only known catalog actions (`refresh_device_status`,
  `restart_walnut_screen_service`, `reboot_device`) into policy actions.
  The read-only `refresh_device_status` action now executes through the typed
  Widget App device adapter after MCP/OPA allow and returns only redacted status
  binding evidence. Approved high-risk Widget App actions now execute only
  inside `screen.widgetApp.action` after `policy.action.prepare` state,
  matching normalized params, approval token proof, and a fresh OPA allow
  decision are committed. The generic `policy.action.commit` surface still
  blocks direct high-risk Web execution before command construction.
- The old static HTML console entry routes have been retired. `/`,
  `/apps.html`, and `/workspace.html` now return `410` from Hono; active
  product UI work is in the Next/Tailwind console.
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
- Web server startup now calls the WalnutPi observability boundary before the
  Hono routes are served. `walnut.*` OpenTelemetry spans are exported through
  Langfuse when configured, with `mediaUploadEnabled: false`, trace/session
  correlation attributes, and a strict attribute allowlist. The active
  `/api/agent/turn` path records the OTel trace id on the turn projection,
  passes it through Mastra MCP tool execution into MCP/OPA/audit request
  context, and exposes only redacted `/api/observability/status` and
  `/api/observability/langfuse/receipt?traceId=...` projections. The receipt
  projection reads only trace/observation receipt metadata and never returns
  Langfuse input, output, metadata payloads, raw attributes, raw user text, raw
  params, raw command strings, or raw device output.
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
  `screen.writePlaylist`, `screen.widgetApp.sync`,
  `screen.widgetApp.action`, `memory.preference`, `memory.approve`,
  `memory.sensitiveSkip`, `device.note.write`, `policy.action.prepare`,
  `policy.action.commit`, `eval.curated.list`, and
  `eval.curated.scoreShape`.
- `screen.captureFrame`, `screen.syncPlaylist`, `screen.renderWallpaper`, and
  `screen.writePlaylist` are registered as real MCP SDK tools with explicit
  read/write/destructive annotations and dispatch only through the Screen
  Command DSL runner.
- `screen.syncPlaylist` and `screen.writePlaylist` have Action Policy Manifest
  action ids and pass through the OPA policy gate before Screen Command DSL
  execution. OPA-unavailable degraded decisions fail closed for write-low and
  high-risk actions.
- `screen.widgetApp.sync` and `screen.widgetApp.action` are registered as real
  MCP SDK tools. They do not call workspace-local SSH, shell, `systemctl`, or
  direct Widget App remote delivery. `screen.widgetApp.sync` now calls
  `web-interface/widget-app-device-adapter.ts`, which streams the validated
  `screen/widget-runtime/current.txt` runtime slice to the device, activates it
  as the active LVGL runtime index, and returns only redacted stage hashes,
  lengths, service state, and typed delivery evidence to MCP/Mastra. Raw command
  strings and raw device output stay inside the adapter boundary.
  `screen.widgetApp.action` uses the same typed adapter boundary for
  `refresh_device_status`, approved `restart_walnut_screen_service`, and
  approved `reboot_device`; public results expose stage output hashes/lengths
  and policy/approval evidence, not command strings or raw device output.
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
- The Hono auth surface now exposes `/api/auth/bindings` and
  `/api/auth/bindings/upsert` for signed better-auth owners to manage
  Postgres-owned org/device/role binding records. The Next/Tailwind console has
  a compact org/device binding panel. Tool calls still do not accept
  client-declared roles, subjects, device targets, or device profiles; MCP/OPA
  receives the server-resolved binding from Postgres.
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
- Screen playlist SSH delivery still constructs remote commands inside
  `web-interface/screen-delivery-adapters/ssh-local-agent.ts`, but it no longer
  returns the aggregate command string upward. Its public delivery manifest now
  lists typed operations, frame evidence records `screen.frame.read`, sync
  output is a redacted digest, and persisted screen sync records store stage
  output hash/length/line-count/service-state summaries instead of raw remote
  output.
- Device action tool projections no longer lift dispatcher raw device output
  into Mastra or `/api/agent/turn` results. Public device results expose only
  status/code, policy summary, device-boundary evidence, and raw output
  hash/length/line-count evidence; raw output remains inside the internal
  dispatcher/audit boundary.
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
  pgvector indexing seam. The old deterministic local-hash embedding generator
  has been removed from the active path. Reindex now requires an explicitly
  configured OpenAI-compatible retrieval embedding provider and returns an
  honest provider-unconfigured failure when that provider is disabled or
  incomplete. It writes `retrieval_embedding_records` only for
  `approved_memory` and `curated_corpus` source kinds, with DB check
  constraints enforcing those source kinds. Curated corpus rows may be sent to
  the configured embedding provider; approved memory is refused unless its
  metadata explicitly records `embeddingConsent: "approved"` and
  `remoteEmbeddingAllowed: true`. Raw session logs and raw daily notes are
  rejected before index writes and cannot satisfy the table constraints.
- `web-interface/platform/memory/retrieval-reindex-workflow.ts` owns the
  retrieval reindex workflow. The Inngest function
  `walnut/retrieval.reindex.requested` runs that workflow, so retrieval reads
  no longer write embeddings as a GET side effect.
- `web-interface/platform/inngest/client.ts` now also registers long-workflow
  shells for `walnut/screen.sync.requested`,
  `walnut/device.evidence.requested`, `walnut/eval.curated.requested`,
  `walnut/eval.curated.case.requested`, and the nightly drift cron. Screen sync
  and device evidence jobs return typed queued references and required platform
  path evidence; long-running work should continue moving there rather than
  back into blocking route handlers.
- `web-interface/platform/eval/curated-eval.ts` defines the curated eval case
  and `walnutpi.eval-score.v1` contracts with the 3x3 grader matrix. The first
  seed cases are human-labeled shapes for device status, screen preview
  no-write, and high-risk policy prepare. They declare expected behavior,
  required evidence, forbidden side effects, and grader classification. The old
  generated benchmark corpus and harness remain deleted.
- `eval.curated.list` and `eval.curated.scoreShape` are now typed read-only
  MCP/Mastra capabilities and project as `walnutpi.toolResult.eval.v1`.
  Hono also exposes `/api/eval/curated` and
  `/api/eval/curated/:caseId/score-shape` as read-only public projections.
  The active Next console includes a quick action for listing curated cases.
  They expose curated case metadata and pending score shapes only; they do not
  execute scoring, restore generated harnesses, or include raw private content.
- `/api/eval/curated/run` executes selected curated cases through the active
  `/api/agent/turn` platform path and mechanically scores the current code
  grader seed cases. Device-profile cases are skipped unless the caller passes
  `allowDevice: true`. Eval run results expose redacted turn summaries, score
  records, trace/turn refs, evidence keys, and grader metadata only.
- When Langfuse is configured, `/api/eval/curated/run` also creates or updates
  redacted Langfuse dataset items, links executed case traces into a dataset
  run, and writes trace-level numeric scores. Dataset inputs keep only case
  metadata plus input/params hashes; score metadata keeps evidence refs and
  grader fields, not raw user text, raw params, raw turn payloads, raw command
  strings, raw outputs, session logs, or daily notes. If Langfuse is explicitly
  configured but dataset/score publishing fails, the run reports failure rather
  than disguising it as an eval skip; unconfigured Langfuse is reported as a
  skipped publish boundary.
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
  Mastra/MCP capability actions, read-only device diagnostics buttons, a
  signed-owner org/device binding panel, and an approval queue around
  `policy.action.prepare`/`policy.action.commit`. The approval UI approves only
  prepared catalog actions plus normalized params and approval proof; it does
  not display or submit raw command strings. The right control deck is now
  split into Status, Screen, and Details tabs so beginner status/actions stay
  first, while route, evidence, audit, manifest/output artifact summaries,
  recent screen evidence records, read/capture actions, preview no-write sync,
  Screen Workspace generate/import/process authoring, LVGL preview, manifest
  detail, and screen evidence record detail remain available without exposing
  raw device output. Next rewrites `/api/*` and `/mcp` to the Hono platform
  server during local development.
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
- After adding first-class `screen.widgetApp.sync` and
  `screen.widgetApp.action` MCP/Mastra capabilities, `bun run check` passes.
  Local contract probes showed the pre-eval SDK tool catalog entries, OPA allow for
  `screen_widget_app_sync` under the server-owned local owner/device binding,
  Widget App sync/refresh reaching the dispatcher and failing closed at the
  typed device boundary with no command execution, and
  `restart_walnut_screen_service` returning a pending policy result with no
  command execution.
- After adding the typed Widget App device adapter, `bun run check` passes.
  Local adapter probes showed the current Widget App runtime slice can be
  packaged from `screen/widget-runtime/current.txt`, missing stale app/catalog
  references are reported as typed artifact references rather than raw output,
  public delivery stages expose only output hashes and lengths, and the
  dispatcher projection contains no raw command or raw output fields.
- After wiring Langfuse/OpenTelemetry startup and turn/tool correlation,
  `bun run check` passes. Local observability probes showed raw command,
  private text, and raw params are dropped by the span-attribute allowlist; the
  redacted status projection reports only configuration state, host, and public
  key prefix; and a structured `device.status.read` turn carries the same OTel
  trace id from the turn projection into the Mastra dispatcher.
- After adding the redacted Langfuse receipt projection and tightening device
  action public output projection, `bun run check` passes. Live
  `device.status.read` through `/api/agent/turn` reached final diagnostics
  operation `mastra.mcp.device.status.read` with OPA/device-boundary evidence
  and no raw command, command string, service table, memory table, or raw device
  output in the public turn projection. The public output evidence was limited
  to SHA-256, length, and line count.
- Live Langfuse receipt is now verified against the local Docker Compose
  Langfuse stack. The local control-plane Langfuse base URL must be
  `http://localhost:3000`; `http://127.0.0.1:3000` returned `404 Not Found` for
  OTLP POST in the Windows host setup. After switching the local config to
  `localhost`, a structured `/api/agent/turn` `device.status.read` call reached
  final diagnostics operation `mastra.mcp.device.status.read`, Langfuse
  ClickHouse recorded trace id `46d19911ac4b3531dd809817d8aebbfa`, and
  `/api/observability/langfuse/receipt?traceId=46d19911ac4b3531dd809817d8aebbfa`
  returned `received: true` with `walnut.agent.turn`, `walnut.tool.call`, and
  `walnut.device.action`. The receipt projection returned only trace id, trace
  URL/path, span names, counts, and redaction flags.
- After replacing the deterministic local retrieval embedding seam,
  `bun run check` passes. Local contract probes showed reindex refuses to
  index curated corpus when the provider is disabled instead of falling back to
  hash embeddings, and refuses approved memory before provider invocation when
  remote embedding consent is absent.
- After moving the next Screen Workspace authoring/detail slice into the
  Next/Tailwind console and adding typed Widget App read action execution,
  `bun run check` passes. Local dispatcher probes showed
  `screen.widgetApp.action` for `refresh_device_status` reaches OPA and the
  typed adapter boundary, returns `executed: true`, and exposes no raw command
  string.
- After wiring approved high-risk Widget App actions and retiring active static
  HTML console routes, `bun run check` passes. The approved action path is
  narrow to `screen.widgetApp.action`; without approval proof the high-risk
  actions still return policy pending with no command execution, while generic
  `policy.action.commit` still blocks direct high-risk Web execution.
- After redacting screen delivery command evidence, `bun run check` passes.
  The screen playlist delivery adapter keeps command strings inside the adapter
  boundary, public sync output is a digest, screen evidence records operation
  names instead of command strings, and persisted screen record stage evidence
  stores output hashes/lengths/line counts/service state only.
- After adding signed-owner org/device binding management, `bun run check`
  passes. The new API/UI writes Postgres-owned bindings only after a
  better-auth owner session and does not let tool calls spoof roles, subject,
  target, or device profile.
- After adding curated eval and Inngest fanout scaffolding, `bun run check`
  passes. The new eval cases are curated shapes with 3x3 grader metadata and
  no restored generated benchmark harness.
- After exposing curated eval through MCP/Mastra workflows, `bun run check`
  passes. A live smoke against the already-running Web server on port 4173
  still returned `Unsupported structured capability eval.curated.list`,
  confirming that process was running pre-change code; it was left untouched.
- After deriving the in-process Mastra MCP endpoint from the active Web
  `HOST`/`PORT`, a temporary Web server on port 4184 returned two safety cases
  from `/api/eval/curated?suite=safety` and completed structured
  `/api/agent/turn` for `eval.curated.list` with final diagnostics operation
  `mastra.mcp.eval.curated.list` and `walnutpi.toolResult.eval.v1`.
- After adding `/api/eval/curated/run`, `bun run check` passes. A temporary Web
  server on port 4185 ran the safety suite with `allowDevice: false`; both
  seed cases passed, no cases were skipped, and the run projection contained no
  command-like strings such as service-manager or shell command text.
- After adding the Langfuse curated eval publisher, `bun run check` passes. A
  temporary Web server on port 4187 ran the safety suite with
  `publishLangfuse: false`; both seed cases passed, no cases were skipped, the
  Langfuse publish boundary was explicitly marked skipped by request, and the
  run projection contained no command-like strings such as service-manager or
  shell command text.
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

- Remove or archive the now-unserved static HTML files after confirming no
  operator-only workflow still opens them directly.
- Collect device-profile evidence for approved Widget App restart/reboot through
  `screen.widgetApp.action`. Keep command strings inside the device adapter
  boundary, preserve OPA/audit typed results, and do not enable direct Web
  execution for high-risk actions.
- Extend device-profile verification for the platform `screen.syncPlaylist`
  path after the redaction change: remote delivery, activation, service state,
  and frame comparison should still prove through Mastra/MCP/OPA/typed adapter.
- Add explicit SME review flow for subjective curated cases and move executed
  case workers fully into Inngest while preserving the redacted Langfuse
  dataset/score boundary.
- Retrieval embedding provider wiring is intentionally skipped for this round.
  Reindex should continue to return honest provider-unconfigured failure until
  an approved provider is selected.

For a compact keep / replace / delete view with priority, see
`docs/agent-platform-refactor-gap-matrix.md`.

For the Mastra, Vercel AI SDK, MCP, and TS5 dependency boundary, see
`docs/mastra-ai-sdk-mcp-dependency-note.md`.

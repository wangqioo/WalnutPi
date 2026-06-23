# WalnutPi Agent Platform Refactor Spec

Date: 2026-06-23

This spec defines the destructive refactor from the current custom Walnut Agent
Loop to a framework-backed local-first agent platform. It is intentionally a
replacement spec, not a compatibility plan.

## Goal

WalnutPi should stop maintaining generic agent runtime, policy, observability,
and evaluation infrastructure. WalnutPi should own only the product contracts
that are specific to a headless Debian WalnutPi Device with a 480x320 screen.

Target flow:

```text
User
-> Next.js Walnut Agent Console
-> Mastra Runtime
-> MCP Tool Gateway
-> OPA Policy Decision
-> WalnutPi Domain Tools
-> Screen Command DSL / Device Action / Memory / Diagnostics
-> Local artifacts and real-device evidence
-> OpenTelemetry + Langfuse observability/eval
```

Screen-specific flow:

```text
Agent
-> screen tool
-> Screen Command DSL
-> Renderer Adapter
-> Screen Manifest v2 / Playlist v1
-> Runtime Screen Assets
-> LVGL pipeline
-> Real-Device Verification
```

## Non-Goals

- Do not turn WalnutPi into a generic agent framework.
- Do not replace the LVGL runtime with a web renderer.
- Do not avoid the real WalnutPi Device. The refactor must make device access
  explicit, typed, policy-checked, and auditable; it must not replace real
  device evidence with local-only mocks for device claims.
- Do not let LLM output become an authoritative Screen Manifest.
- Do not move local screen artifacts to S3, R2, or MinIO by default.
- Do not index raw session logs into vector search.
- Do not use Langfuse as memory storage.
- Do not expose arbitrary shell, `/terminal`, or Human CLI Commands as MCP
  tools.

## Final Stack

| Function | Final choice | WalnutPi owns |
|---|---|---|
| Agent Runtime | Mastra | Agent definitions, domain tools, business workflows |
| Intent Routing | Mastra structured output | Intent schema; existing rules become fallback/oracle |
| Policy Decision | OPA | Rego policies and policy input/output builders |
| Tool Gateway | MCP TypeScript SDK + Hono | Device/screen/memory/diagnostics tool wrappers |
| Auth | better-auth | User/org/device binding and MCP auth context |
| Enforcement | Hono middleware + OPA | Per-tool pre-dispatch policy enforcement |
| Human Approval | Inngest waitForEvent | Approval events, timeouts, audit records |
| Long Workflow | Inngest | Sync, reindex, curated eval, nightly drift, device evidence jobs |
| Memory | Postgres | Schema and migrations for queryable product state |
| Vector | pgvector | Curated corpus and approved memory embeddings |
| Cache/Lock | Optional Redis | Multi-worker locks and session cache only when needed |
| Observability | OpenTelemetry | Span naming and WalnutPi attributes |
| LLM Observability | Langfuse | Prompt, dataset, score, trace, and experiment management |
| Eval | Langfuse + Mastra evals + Inngest | 3x3 WalnutPi graders and evidence gates |
| Frontend | Next.js + Vercel AI SDK | Chat UI, tool UI, device panel, diagnostics panels |
| API | Hono | Gateway and internal routes |
| ORM | Drizzle | Database schema and migrations |
| Storage | Local filesystem | Screen outputs, captures, artifacts, evidence exports |
| Device | SSH2 + `walnut` CLI | Keep stable Device Execution Surface |
| Screen | Screen Command DSL + LVGL pipeline | Keep WalnutPi screen contracts |

## Runtime Replacement

Replace the custom runtime:

- `web-interface/agent-turn-loop.ts`
- `web-interface/agent-registry.ts`
- `web-interface/agents/*.ts` as runtime agents
- custom bounded continuation loop
- custom model-backed replan loop
- custom pending-next runtime state

With:

- Mastra agents for `router`, `screen`, `device`, `memory`, `diagnostics`, and
  `chat`.
- Mastra workflows for user-facing product flows.
- Mastra tools backed by MCP tool wrappers.
- Inngest for background, replayable, and scheduled workflows.

Keep `/api/agent/turn` as the product entry while the frontend is being
replaced. Its implementation must invoke the new platform runtime/workflow and
return the new platform turn shape. Do not route it through the deleted custom
agent loop.

## Trace Contract

`agentTurn.v2` is superseded. It must not be the internal runtime state or the
production `/api/agent/turn` response shape.

The new local projection is `walnutpi.agentPlatformTurn.v1` and is built from
typed WalnutPi tool results:

- `route`
- `steps[]`
- `evidence[]`
- `sideEffects[]`
- `telemetry.summary`
- `userSummary`
- `toolResults[]`

New runtime trace source:

```text
Platform/Mastra run
-> typed WalnutPi tool results
-> OpenTelemetry spans
-> Langfuse trace/session
-> walnutpi.agentPlatformTurn.v1 local projection
```

Do not project from arbitrary raw step shapes. Each WalnutPi tool must return a
typed result before it can participate in product evaluation.

## Refactor Lessons

- This is a destructive replacement, not a compatibility migration. Delete old
  runtime paths instead of adding shims that keep the custom agent loop alive.
- Real-device interaction is expected. Device and screen flows should hit the
  WalnutPi through the narrow Device Execution Surface when they make device
  claims.
- The safety boundary is not "never touch the device"; it is "never touch the
  device through arbitrary shell, stale playlist hashes, untyped tool results,
  missing policy decisions, or undocumented side effects."
- Verification must state its profile. Offline checks prove local contracts
  only; device-profile checks prove sync, delivery, activation, service state,
  frame evidence, and capture evidence on the real WalnutPi.
- Smoke tests that call device-backed actions are device-profile tests. Do not
  describe them as local-only or mock verification.

## Screen Command DSL

Add a new WalnutPi-owned interface between agents and the existing screen
workspace workflows.

Home:

```text
web-interface/screen-command-dsl.ts
web-interface/screen-command-runner.ts
```

The DSL describes intentful screen operations, not manifests:

```ts
type ScreenCommand =
  | { kind: "screen.importSource"; source: LocalSourceRef | GeneratedSourceRef }
  | { kind: "screen.renderWallpaper"; sourceId: string; preset: ProcessingPreset; outputType: "static" | "animated" }
  | { kind: "screen.writePlaylist"; manifestId: string; mode: "replace" | "append"; durationMs: number; loop: boolean }
  | { kind: "screen.syncPlaylist"; playlistId: string; playlistHash: string; evidenceMode: "fast" | "full" }
  | { kind: "screen.readPlaylist"; playlistId: string }
  | { kind: "screen.captureFrame"; buildId?: string };
```

The command runner may call:

- `screen-workspace-workflows.ts`
- `screen-workspace-pipeline.ts`
- `runtime-screen-assets.ts`
- `screen-workspace-sync-workflow.ts`

The command runner must not:

- allow LLM-authored authoritative manifests;
- bypass playlist hash freshness;
- bypass preview no-write mode;
- mutate the LVGL runtime directly.

## Renderer Adapters

Renderer adapters are WalnutPi product modules, not generic plugins.

Required adapters:

- `WallpaperRenderer`: Source Asset or Screen Content to final 480x320 output,
  hashes, manifest, and provenance.
- `RuntimeAssetRenderer`: Screen Playlist v1 to `screen/runtime/default.txt`
  and RGB565 frames.
- `WidgetAppRenderer`: A2UI/Walnut LVGL Widget Catalog to widget runtime
  artifacts. It remains separate from Wallpaper Mode.

Keep these contracts byte-stable:

- 480x320 output size.
- RGBA and RGB565 pixel hashes.
- RGB565 byte order and alpha handling.
- animated output hash from frame RGB565 hashes and durations.
- `screen/runtime/default.txt` format.
- LVGL runtime bounded parser behavior.

## Policy Refactor

OPA replaces authorization decisions, not the whole action system.

Keep the current action manifest as an action catalog, but split its semantics:

```text
Action Catalog:
  id
  title
  description
  parameter schema
  evidence schema
  command binding
  handler binding
  timeout
  user-facing copy

OPA Policy:
  executor allowed?
  subject allowed?
  parameter allowed?
  environment allowed?
  runnable, pending, or refused?
  approval required?
```

Canonical policy input:

```json
{
  "schema": "walnutpi.action-policy-input.v1",
  "request": {
    "actionId": "restart_walnut_screen_service",
    "params": {},
    "executor": "web",
    "surface": "agent-turn",
    "operation": "run",
    "sessionId": null,
    "turnId": null,
    "traceId": null
  },
  "subject": {
    "kind": "local-user",
    "authenticated": true,
    "roles": ["owner"],
    "approvalToken": null
  },
  "action": {
    "risk": "high",
    "mode": "confirmable",
    "capabilities": ["service.restart"],
    "confirmationRequired": true
  },
  "environment": {
    "previewOnly": false,
    "deviceProfile": "device",
    "target": "pi@host"
  }
}
```

Canonical policy output:

```json
{
  "schema": "walnutpi.action-policy-decision.v1",
  "decisionId": "uuid",
  "allow": false,
  "status": "pending",
  "reason": "confirmation-required",
  "requirements": {
    "approval": {
      "required": true,
      "kind": "explicit-user-confirmation",
      "expiresAt": "2026-06-23T00:00:00.000Z"
    }
  },
  "audit": {
    "risk": "high",
    "policyVersion": "opa-bundle-sha",
    "matchedRules": ["system_write_requires_confirmation"]
  },
  "evidence": {
    "kind": "pending-local-action",
    "actionId": "restart_walnut_screen_service"
  }
}
```

Enforcement requirements:

- OPA check happens before command construction.
- Refused and pending actions must not produce command strings.
- `tools/list` filtering is not authorization; each `tools/call` must check OPA.
- Agent, MCP, Widget App, Web API, WalnutAI, and CLI action surfaces must share
  the same decision shape.
- OPA unavailable means fail closed for writes and high-risk actions.

Approval requirements:

- Approve catalog action plus normalized params, never arbitrary command text.
- `prepare` records decision id, action id, param hash, command binding id,
  subject, expiry, and explanation.
- `commit` requires matching decision id, param hash, subject, approval token,
  and a fresh OPA decision.
- Every decision and execution result is written to an append-only audit log.

## MCP Gateway

Add an MCP gateway behind Hono:

```text
web-interface/gateway/
  hono-app.ts
  auth-context.ts
  mcp-server.ts
  tool-dispatcher.ts
  opa-enforcer.ts
```

Tool groups:

- `screen.*`
- `device.*`
- `memory.*`
- `diagnostics.*`
- `eval.*`

MCP tools wrap WalnutPi domain interfaces. They do not own domain behavior.

Do not expose:

- raw shell;
- `/terminal`;
- Human CLI Commands;
- arbitrary filesystem paths;
- direct LVGL calls;
- direct SSH command strings.

## Memory And Retrieval

Postgres becomes the queryable product state store for the control plane:

- sessions
- messages
- agent turns
- turn events
- memory candidates
- approved durable memory records
- retrieval source documents
- eval cases and runs
- audit events
- device preflight metadata
- artifact indexes

pgvector indexes only curated or approved content:

- skills docs
- corpus docs
- ADR/doc chunks
- successful-code corpus
- approved durable memory summaries

Do not vector-index raw session logs or raw daily notes.

The current file-backed memory and corpus become seed/import sources and local
fallback exports, not the primary state model.

## Local Artifacts

WalnutPi remains local-first. Default artifact storage is the local filesystem:

```text
data/
  artifacts/
    traces/
    eval-runs/
    captures/
    screenshots/
    command-results/
    langfuse-exports/

screen/
  sources/
  outputs/
  manifests/
  playlists/
  runtime/
```

S3/R2/MinIO are optional future artifact store adapters, not default
dependencies.

## Legacy Evaluation Deletion

The removed generated evaluation corpus is not a trusted evaluation asset. It
was written without a human/SME labeling loop, does not encode a calibrated
rubric, and must not be carried forward as a golden set.

Already deleted from the active repo: generated case files, baselines, run
outputs, self-check outputs, harness code, and evaluation-derived screen
manifests, playlists, source assets, outputs, and evidence directories.

Do not migrate old pass/fail status into Langfuse. At most, import a small
number of cases as unlabeled examples for human review. They become evaluation
cases only after a person assigns expected behavior, evidence requirements,
safety boundaries, and a 3x3 grader classification.

## Evaluation Model

The evaluation model is the whitepaper 3x3 matrix:

Rows:

- black-box: final response
- glass-box: full trace
- white-box: single step/tool call

Columns:

- Layer 1: mechanically verifiable, code/rule grader
- Layer 2: semi-objective, pinned LLM-as-a-Judge
- Layer 3: subjective, refused by default or human-reviewed

Schema:

```ts
type EvalGranularity = "black_box" | "glass_box" | "white_box";
type EvidenceLayer = "mechanical" | "semi_objective" | "subjective";
type GraderKind = "code" | "llm_judge" | "human";

type WalnutEvalScore = {
  schema: "walnutpi.eval-score.v1";
  caseId: string;
  variantId: string;
  suite: "curated" | "regression" | "safety" | "device";
  profile: "offline" | "network" | "device";
  metric: string;
  granularity: EvalGranularity;
  evidenceLayer: EvidenceLayer;
  grader: GraderKind;
  verdict: "pass" | "fail" | "skip" | "needs_review" | "refused";
  value?: number | boolean | string;
  evidenceRefs: string[];
  traceId?: string;
  spanId?: string;
  artifactRefs: string[];
};
```

Layer 3 is not automatically scored unless an explicit SME review workflow
exists.

Core metric families:

- final response quality
- task completion
- tool use
- memory/context retrieval
- multi-turn behavior
- reasoning
- responsibility and safety
- multi-agent collaboration
- cost and latency

The old `bench:*` commands have been removed and must not be reintroduced as
compatibility shims. They are not the target evaluation interface and must not
define the new quality gate.

The new evaluation loop starts from a small curated set:

- roughly 20 human-reviewed examples first;
- each example includes input, expected outcome, required evidence, forbidden
  side effects, and grader classification;
- examples expand only through production trace review, SME labeling, or
  deliberate adversarial case design;
- golden and holdout cases require ownership and versioning.

Langfuse owns:

- traces
- sessions
- datasets
- prompt versions
- automated and human scores
- experiments

Local JSON remains:

- curated eval specs
- approved golden/holdout exports
- reproducible run exports
- device evidence exports

## Observability

Use OpenTelemetry for standard traces and metrics.

Span naming:

```text
walnut.agent.turn
walnut.intent.route
walnut.policy.decision
walnut.tool.call
walnut.screen.command
walnut.screen.render
walnut.screen.sync
walnut.device.action
walnut.memory.retrieve
walnut.eval.score
```

Required attributes:

- `walnut.session_id`
- `walnut.turn_id`
- `walnut.route`
- `walnut.tool_name`
- `walnut.action_id`
- `walnut.policy_decision_id`
- `walnut.device_target`
- `walnut.playlist_hash`
- `walnut.build_id`
- `walnut.eval_case_id`
- `walnut.eval_granularity`
- `walnut.evidence_layer`

Do not put private user content or full raw session logs into telemetry
attributes.

## Device Runtime Boundary

The device running surface remains narrow:

```text
walnut CLI
LVGL app
screen/runtime
systemd walnut-screen.service
read-only evidence scripts
SSH2 transport
```

Do not install Postgres, Langfuse, OPA, or Inngest on the WalnutPi Device unless
there is a separate deployment decision. They belong to the control plane.

The control plane may and should call the real device through this boundary for
device-profile verification. These calls must use typed tool results and
recorded evidence, not raw command strings exposed to agents.

## Migration Phases

### Phase 0: Freeze And Supersede Docs

- Mark current product spine as pre-refactor.
- Add ADR superseding observability, memory, eval trace, and action policy
  ADRs where needed.
- Document the new control-plane/device-runtime split.

Exit criteria:

- This spec is the source of truth for new agent platform work.

### Phase 1: Typed WalnutPi Tool Results

- Define typed result schemas for device, screen, memory, diagnostics, and
  policy tools.
- Replace the old agent turn projector with typed result projection.
- Delete the old custom loop and registry from the production path.

Exit criteria:

- Typecheck passes.
- `/api/agent/turn` no longer imports or invokes the old custom loop.
- New platform turns are built only from typed tool result contracts.
- Device-backed smoke checks are clearly marked as device-profile verification.

### Phase 2: Screen Command DSL

- Implement `ScreenCommand` schemas.
- Implement command runner over existing screen workflows.
- Add contract checks for render, playlist write, stale hash sync refusal, and
  preview no-write.
- Add device-profile checks for sync delivery, activation, service state, frame
  evidence, and capture evidence through the DSL path.

Exit criteria:

- Existing screen preview and sync cases pass through DSL path.
- Pixel hash outputs are unchanged.
- Real-device evidence confirms the synced playlist when running the device
  profile.

### Phase 3: OPA Policy

- Split action catalog from policy decision.
- Add Rego policies and tests.
- Gate command construction on OPA decision.
- Add approval decision/audit records.

Exit criteria:

- Policy refusal and confirmable action cases preserve evidence shape in the
  new curated eval format.
- No refused/pending action builds a command string.

### Phase 4: MCP/Hono Gateway

- Add Hono gateway and MCP tools.
- Add better-auth subject context.
- Add OPA enforcement middleware and per-call dispatch enforcement.

Exit criteria:

- MCP `screen.readPlaylist`, `device.status.read`, and `diagnostics.recentFailure`
  run through the gateway.
- MCP high-risk action returns pending/refused without command construction.

### Phase 5: Mastra Runtime

- Implement Mastra router and product workflows.
- Route `/api/agent/turn` to Mastra for one vertical slice:
  `device.status.read`.
- Project Mastra run into `walnutpi.agentPlatformTurn.v1`.

Exit criteria:

- Device status curated eval passes through Mastra path.
- Langfuse receives trace for the run.
- Old custom runtime can be disabled for that capability.

### Phase 6: Add Curated Eval

- Keep legacy generated specs, baselines, generated runs, and eval-derived
  screen assets deleted.
- Create the first curated 20-case eval set with human-reviewed expectations.
- Move curated eval fanout to Inngest.
- Publish traces/scores to Langfuse.
- Keep local summary export for reproducibility.
- Implement 3x3 eval score schema.

Exit criteria:

- Curated local eval can run from the new eval runner.
- No old baseline is used as a quality gate.
- Each eval case declares a 3x3 grader classification.

### Phase 7: Next.js Console

- Replace static HTML console with Next.js + Vercel AI SDK.
- Add tool call UI, approval UI, artifact panels, and device diagnostics.

Exit criteria:

- User can run screen preview and device read flows from the new console.
- Approval flow is visible and auditable.

### Phase 8: Remove Old Runtime

- Delete custom agent loop and registry.
- Delete compatibility projections for the old runtime.
- Do not reintroduce legacy harness compatibility.

Exit criteria:

- No production route imports `agent-turn-loop.ts`.
- All product capabilities are registered as Mastra workflows/tools.
- No production route emits `agentTurn.v2`.

## Required Follow-Up Docs

- ADR: Use Mastra For Agent Runtime.
- ADR: Use OPA For Action Policy Decisions.
- ADR: Use MCP/Hono As Tool Gateway.
- ADR: Keep WalnutPi Local Artifacts Local.
- ADR: Use Langfuse/OpenTelemetry For Agent Observability.
- ADR: Delete Legacy Benchmarks And Use 3x3 Curated Evals.
- ADR: Split Control Plane From Device Runtime.

## Acceptance Gate

The refactor is complete only when these checks or successors pass:

```text
bun run check
curated offline eval
curated policy eval
curated screen eval
device-profile evidence eval
```

Device gates may remain profile-gated, but any claim about device state,
delivery, activation, runtime frame output, or capture evidence must be backed
by real-device evidence from the WalnutPi Device.

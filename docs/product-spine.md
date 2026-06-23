# WalnutPi Product Spine

This document is the working map for pulling WalnutPi back from feature
stacking into one product loop with evidence. It is intentionally stricter than
the current repository shape: code may still expose older or narrower entry
points, but new product work should route through this spine.

## Product Spine

Default product path:

```text
User intent
-> Walnut Agent Console
-> POST /api/agent/turn
-> Intent Route
-> Agent Action Command / Screen Workspace / WalnutAI / memory / diagnostics
-> screen, device, or runtime evidence
-> agentTurn.v2 trace and artifacts
-> product capability harness
-> repair or iteration task
```

The default product entry is `POST /api/agent/turn`.

Everything else is a supporting surface unless a capability registry row says
otherwise:

- `/api/intent/classify`: route classification support and narrow testing.
- `/api/action`: policy-backed Agent Action execution support.
- `/api/screen/workspace/*`: Screen Workspace import, process, preview, playlist,
  and sync support.
- `/api/screen/records`, `/api/screen/frame/*`, `/api/screen/pixel-diff`:
  Developer Diagnostics.
- `walnut` CLI and PowerShell scripts: Device Execution Surface and real-device
  operator tools.
- `bun run bench:product`: product feedback environment, not a separate product
  entry.

## Classification

### Core Product

User-facing Walnut Agent Console and the screen sync loop that a beginner can
use without understanding device internals.

Current paths:

- `web-interface/walnut-agent-console.html`
- `web-interface/agent-turn-loop.ts`
- `web-interface/agents/*.ts`
- `web-interface/screen-workspace-api.ts`
- `web-interface/screen-workspace-sync-workflow.ts`
- `web-interface/screen-workspace-store.ts`
- `screen/manifests/`
- `screen/playlists/`
- `screen/outputs/`
- `screen/runtime/`
- `lvgl_app/`

### Agent Runtime

Routing, policy, memory, retrieval, action execution, and model-assisted loop
behavior. This layer can run tools, but it does not define product success by
itself.

Current paths:

- `web-interface/router.ts`
- `web-interface/intent-rules/`
- `web-interface/action-registry.ts`
- `web-interface/action-policy.ts`
- `web-interface/agent-actions-api.ts`
- `action-policy-manifest.json`
- `web-interface/project-memory-api.ts`
- `walnut-ai-terminal/`
- `walnut-assistant/walnut`

### Verification

Harness, trace schema, real-device evidence scripts, baselines, sync records,
and benchmark artifacts.

Current paths:

- `docs/product-capability-benchmarks.md`
- `docs/benchmarks/product/manifest.json`
- `docs/benchmarks/holdout/manifest.json`
- `docs/benchmarks/mutation/manifest.json`
- `scripts/run-product-capability-agent-harness.ts`
- `scripts/run-product-capability-gate.ts`
- `scripts/compare-product-capability-runs.ts`
- `scripts/agent-turn-trace-schema.ts`
- `scripts/collect-screen-sync-evidence.ps1`
- `scripts/save-screen-capture.ps1`
- `scripts/invoke-walnut-screen.ps1`
- `screen/benchmark-baselines/`
- `screen/benchmark-runs/`
- `web-interface/screen-sync-evidence.ts`
- `web-interface/screen-evidence-ledger.ts`
- `web-interface/web-metrics-ledger.ts`

### Experiments And Archive

Playable demos, old terminal/UI experiments, imported app catalogs, gallery
material, hardware experiments, third-party reference trees, and anything
without a runnable product harness case.

Current paths:

- `archive/experiments/`
- `screen/lvgl-apps/`
- `screen/apps/` entries that are not covered by product harness cases
- `web-interface/widget-app-gallery.html`
- `web-interface/glb-viewer.html`
- `web-interface/ssh-terminal.html`

These may still be useful as Source Assets, demos, or research material. They
must not become alternate product paths around `/api/agent/turn`, Action Policy,
or Screen Workspace evidence.

Third-party reference-only paths:

- `screen/ioccc-apps/`

## Capability Registry

Status meanings:

- `product`: may sit on the default product path and should have runnable or
  device-gated harness coverage.
- `beta`: implemented or partly exposed, but missing enough coverage or UX
  polish that it should not be treated as default product success.
- `experimental`: useful prototype or research surface; must not be a default
  success path.
- `diagnostic-only`: developer/operator evidence surface.
- `archived`: historical capability, kept for reference or reuse.

| Capability | Status | Product entry | Route / intent | Actions or tools | Requirements | Verification | Evidence |
|---|---|---|---|---|---|---|---|
| `agent.turn` | product | `POST /api/agent/turn` | all routes | router, agents, loop | case-specific | `bun run bench:product` | `agentTurn.v2` |
| `screen.wallpaper.preview` | product | `/api/agent/turn` | `screen.wallpaper` / `screen.generate` | Screen Workspace process/generate/preview | network/search/model only when declared | V1-01, V1-26, holdout | Screen Output, Manifest v2, Playlist v1 |
| `screen.playlist.sync` | product, device-gated | `/api/agent/turn` then explicit sync | `screen.wallpaper` / `sync_existing` | `POST /api/screen/workspace/sync`, runtime generator, device transport | `device=true` | V1-06 device profile | Sync Record, service state, frame evidence |
| `device.status.read` | product | `/api/agent/turn` | `device.action` | `status`, `snapshot`, `network` | device false in offline simulated cases; true for live evidence | V1-25, V1-29 plus device profile extensions | action result, state evidence |
| `device.i2c.read` | beta | `/api/agent/turn` | `device.action` / `device.i2c.read` | `gpio`, `i2c_scan`, `snapshot` | device false for contract; device true for live scan | V1-04, V1-27 | read-only bus evidence |
| `session.summary` | product | `/api/agent/turn` | `ai.chat` / `session.summary` | session ledger | none | V1-21, V1-28, holdout | session event count, no memory write |
| `observation.replan` | beta | `/api/agent/turn` | route depends on prompt | agent loop nextTasks | model only when declared | V1-25, V1-29, V1-30 | multi-step-loop, replan-evidence |
| `daily.notes.write` | beta | `/api/agent/turn` | `memory.notes` or `device.action` | `note` action | none | V1-11 is contract-only | actionPolicyId, daily note append |
| `daily.notes.read` | beta | `/api/agent/turn` | `memory.notes` or `device.action` | `notes` action | none | V1-12 is contract-only | note read result |
| `action.policy.refusal` | beta | `/api/agent/turn` | `device.action` high-risk | refused and confirmable policy entries | none | V1-17, V1-18 are contract-only | refused or pending-local-action |
| `widget_app.status_panel` | experimental | `/api/agent/turn` | `screen.widget_app` | Widget App workspace and catalog | device only for live sync | V1-09 is contract-only | catalog path, action policy decisions |
| `terminal.video` | experimental | `/api/agent/turn` | `terminal.surface` | `video` terminal action | none | V1-19 is contract-only | terminal-action |
| `durable_memory.preference` | experimental | `/api/agent/turn` | memory route | memory distiller / memory API | none | V1-13, V1-14 are contract-only | memory update or skip evidence |
| `retrieval.hardware_guidance` | experimental | `/api/agent/turn` | `ai.chat` or `device.action` | retrieval corpus, optional read-only action | none | V1-15 is contract-only | contextUsed, retrieval sources |
| `walnutai.one_shot` | experimental | `/api/agent/turn` delegates to action | `device.action` / `ai` | `walnut-ai {text}` | model/network as declared | V1-16 is contract-only | contextUsed, action output |
| `screen.diagnostics` | diagnostic-only | diagnostics panel/API | none | records, frame, pixel diff, evidence ledgers | device only when capturing live frame | self-checks and device evidence scripts | buildId, hashes, command summaries |
| `archived.voice_keyboard` | archived | none | none | archived scripts | none | no product case | archive notes only |
| `archived.console_chinese` | archived | none | none | archived console scripts | none | no product case | archive notes only |

## Harness Admission Rules

A capability may move to `product` only when all of these are true:

1. It has a registry row in this document.
2. The user-facing path starts at `POST /api/agent/turn`.
3. Its local or remote device actions are declared in
   `action-policy-manifest.json`.
4. It has at least one V2 JSONL benchmark case with explicit
   `requirements: { device, network, model, search }`.
5. Runnable coverage exists for the relevant profile, or the row is explicitly
   `device-gated` with a device profile case.
6. The `agentTurn.v2` trace exposes stable `route`, `steps[]`, `artifacts[]`,
   `evidence[]`, `sideEffects[]`, and telemetry summary.
7. User-visible success is backed by artifacts or evidence, not only by a text
   answer.
8. Preview-only flows prove that no sync, SSH delivery, service restart, or
   device write occurred.
9. Device claims use Real-Device Verification, not Screen Preview.

If a feature fails any rule, keep it `beta`, `experimental`, `diagnostic-only`,
or `archived`. Do not expand it as a default product path.

## Endpoint Policy

Default user and benchmark flow:

```text
Walnut Agent Console -> POST /api/agent/turn
```

Allowed support APIs:

- `/api/intent/classify`: use inside the loop, tests, and diagnostics.
- `/api/action`: use inside the loop, harness repair/debug, and policy
  self-checks.
- `/api/screen/workspace/playlist`: read current playlist state.
- `/api/screen/workspace/process`, `/import`, `/generate`, `/lvgl-preview`:
  Screen Workspace implementation details.
- `/api/screen/workspace/sync`: explicit sync implementation detail; user
  product intent should still be traceable through `/api/agent/turn`.
- `/api/agent/turns`, `/turn-events`, `/events`: observability.
- `/api/session`, `/api/memory`, `/api/retrieval`, `/api/project-memory`:
  context and memory support.

Diagnostic-only APIs:

- `/api/metrics`
- `/api/screen/records`
- `/api/screen/records/<buildId>`
- `/api/screen/records/<buildId>/frame.png`
- `/api/screen/frame/<buildId>`
- `/api/screen/pixel-diff`

Experimental APIs:

- `/api/screen/widget-apps/*`
- `/api/screen/lvgl-apps/*`
- `/terminal`

Do not remove these APIs just because they are not default product paths. First
freeze their status, add or update benchmark cases, then migrate or archive.

## Current Benchmark Coverage

Runnable or gate-relevant coverage:

- V1-01: weather to screen preview.
- V1-04: I2C/read-only hardware guidance.
- V1-21: session summary without memory write.
- V1-25: observation and next-task replan loop.
- V1-30: model-backed system loop replan.
- V1-26 through V1-29: mutation cases for no-sync, read-only I2C, no-memory
  summary, and dangerous continuation blocking.

Device-gated coverage:

- V1-06: sync current preview and verify real device.

Contract-only coverage that should be promoted before product expansion:

- V1-02: external GIF dynamic wallpaper preview.
- V1-03: camera photo to pixel screen preview.
- V1-05: CLI demo to screen animation.
- V1-07: Source Asset failure recovery.
- V1-08: sync hash mismatch recovery.
- V1-09: Widget App status panel.
- V1-11 and V1-12: Daily Notes write/read.
- V1-13 and V1-14: Durable Memory preference and sensitive skip.
- V1-15 and V1-16: Retrieval Corpus and WalnutAI one-shot.
- V1-17 and V1-18: policy refusal and confirmable restart.
- V1-19 and V1-20: terminal surface and Human CLI boundary.
- V1-22 through V1-24: diagnostics, screen CLI evidence, and audio/play
  disambiguation.

## Cleanup Order

1. Keep this file as the product map. Any new default-path feature must update
   the Capability Registry first.
2. Make `/api/agent/turn` the only benchmarked user entry. Direct API runners
   belong in module self-checks only.
3. Promote contract-only cases that guard the current product spine:
   `screen.playlist.sync`, hash mismatch recovery, Daily Notes, policy refusal,
   and diagnostics.
4. Split `web-interface/router.ts` into route tables by domain while keeping
   external paths stable.
5. Move gallery and demo surfaces behind explicit `experimental` UI affordances,
   or archive routes that no longer serve Source Asset or diagnostics work.
6. Decide whether Widget App Mode is a beta product surface. Until then, keep it
   separate from Wallpaper Mode and do not treat Widget App sync as Screen
   Manifest success.
7. Review `screen/apps/` and `screen/lvgl-apps/` for archive candidates after
   benchmark coverage is promoted. Keep `screen/ioccc-apps/` reference-only.

## Four Questions For Every Feature

Before expanding a feature, answer:

1. Which product spine step does it serve?
2. What user scenario does it complete?
3. Which harness case verifies it?
4. What trace, artifact, or device evidence proves it worked?

If the answer is missing, keep the feature out of the default product path.

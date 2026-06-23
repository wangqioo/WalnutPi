# WalnutPi Full Architecture Review

Date: 2026-06-22

This document records a multi-agent architecture scan of WalnutPi. The review looked for deepening opportunities: places where a module has a shallow interface, where implementation knowledge leaks across a seam, or where locality and leverage can improve.

The scan used the project vocabulary in `CONTEXT.md` and ADRs under `docs/adr/`. It preserves the current product spine:

```text
Walnut Agent Console
-> Intent Route
-> Screen Content / Source Asset
-> 480x320 Screen Manifest v2
-> Screen Playlist v1
-> Runtime Screen Assets
-> explicit Playlist Sync
-> Real-Device Verification
```

## Coverage

Covered areas:

- `web-interface/`: Walnut Agent Console, routing, Agent Loop, Screen Workspace, Widget App Mode, diagnostics, metrics.
- `walnut-assistant/`: `walnut` CLI, Device Execution Surface, Agent Action Commands, Human CLI Commands.
- `walnut-ai-terminal/`: WalnutAI, Durable Memory, Retrieval Corpus, Session Log, skills.
- `lvgl_app/`: LVGL runtime, runtime file parsing, preview/fbdev host adapters, widget renderer.
- `scripts/`: Product Benchmark Harness, Runtime Screen Assets generation, real-device wrappers.
- `docs/adr/`: ADR alignment and conflicts.

Lower-priority areas not deeply ranked:

- Archived Capabilities under `archive/experiments/`.
- IOCCC source trees under `screen/ioccc-apps/`.
- Third-party LVGL internals.
- Hardware reference docs.
- One-off generated Screen Outputs and Runtime Screen Assets.

## Side Finding

`AGENTS.md` references `docs/real-device-command-scripts.md`, but that file is currently missing. This matters because several real-device wrapper scripts repeat Device Transport behavior, and that missing contract is supposed to guide changes there.

## Top Recommendation

### Deepen cross-surface Action Policy

**Recommendation strength:** Strong

**Files:**

- `web-interface/action-policy.ts`
- `web-interface/action-registry.ts`
- `web-interface/agent-actions-api.ts`
- `walnut-assistant/walnut`
- `action-policy-manifest.json`

**Problem:** Web and `walnut` both read the Action Policy Manifest, but the allowed/runnable/pending/refused interface is not identical across adapters. Command construction, pending evidence, result evidence, and side-effect classification are split.

**Solution:** Make the manifest-derived Agent Action contract the deep module. Web and CLI should become adapters over the same policy/evidence semantics.

**Why first:** This is the execution-authority seam used by Web, WalnutAI, `walnut`, Widget Actions, Device Transport, and the Product Benchmark Harness. If it stays shallow, other refactors keep rediscovering the same policy and evidence rules.

**ADR alignment:** Strongly aligned with ADR 0014, ADR 0018, and ADR 0019.

**Tests that improve:**

- `action-policy.self-check.ts` with invalid manifest fixtures.
- CLI parity smoke for `walnut action run/prepare --json`.
- Pending action mutation/expiry tests.
- Agent Action evidence shape tests.

## Candidates

### Narrow Device Transport

**Recommendation strength:** Strong

**Files:**

- `web-interface/walnut-remote-adapter.ts`
- `web-interface/screen-delivery-adapters/ssh-local-agent.ts`
- `web-interface/model-terminal-server.ts`
- `scripts/collect-screen-sync-evidence.ps1`
- `scripts/save-screen-capture.ps1`
- `scripts/invoke-walnut-screen.ps1`
- `scripts/build-lvgl-on-device.ps1`

**Problem:** Callers know raw-vs-ensured execution, input modes, SSH reuse, preflight timing, output limits, and capture command details. The implementation has useful depth, but the interface is too wide.

**Solution:** Put transport mechanics behind a smaller Device Transport interface with purpose-level operations such as run Agent Action Command, run raw diagnostic command, stream terminal session, and capture frame.

**ADR alignment:** ADR 0015 and ADR 0018.

**Tests that improve:**

- Fake adapter tests for preflight failure.
- Raw execution bypass tests.
- Timeout and connection reuse metadata tests.
- Capture command result shape tests.

### Deepen Agent Loop Harness trace contract

**Recommendation strength:** Strong

**Files:**

- `web-interface/agent-turn-loop.ts`
- `scripts/run-product-capability-agent-harness.ts`
- `scripts/agent-turn-trace-schema.ts`
- `scripts/agent-scenario-contract.ts`
- `scripts/agent-loop-model-contract.ts`
- `walnut-ai-terminal/walnut_ai.py`
- `docs/adr/0025-use-agent-turn-trace-for-product-capability-benchmarks.md`

**Problem:** `agentTurn` is the Product Benchmark Harness interface, but trace emission, CLI marker parity, schema validation, and harness signal projection are split. The harness still needs too much Product Loop implementation knowledge.

**Solution:** Make trace projection the deep module between Product Loop and Product Benchmark Harness. One interface should emit, validate, and project benchmark signals.

**ADR alignment:** ADR 0025 and ADR 0020.

**Tests that improve:**

- CLI trace schema parity with Web `agentTurn.v2`.
- `contextUsed.memory/retrieval/localActionOutput` cases.
- Model participation diagnostics.
- Oracle filtering: harness-only oracle fields must not enter Product Loop.

### Split Widget App Mode out of Screen Workspace

**Recommendation strength:** Strong

**Files:**

- `web-interface/screen-workspace-api.ts`
- `web-interface/widget-app-workspace.ts`
- `web-interface/router.ts`
- `web-interface/widget-app-gallery.html`
- `docs/adr/0022-split-wallpaper-and-widget-app-screen-modes.md`
- `docs/adr/0023-define-widget-app-mode-product-chain.md`

**Problem:** Screen Manifest/Playlist work and Widget App contracts share routes, preview modes, sync glue, and gallery behavior. The seam between Wallpaper Mode and Widget App Mode is not yet deep.

**Solution:** Deepen Wallpaper Mode and Widget App Mode as separate modules with explicit mode crossing. Widget App Sync should have its own surface while sharing delivery, diagnostics, and Real-Device Verification where practical.

**ADR alignment:** ADR 0022 and ADR 0023.

**Tests that improve:**

- Widget runtime state transition tests.
- Action policy mediation tests for refresh vs prepare.
- Gallery adapter tests for official demo vs local Widget App vs IOCCC behavior.
- Route tests for separate Widget App Sync endpoints.

### Resolve Screen Playlist once

**Recommendation strength:** Strong

**Files:**

- `web-interface/screen-workspace-store.ts`
- `scripts/runtime-screen-assets.ts`
- `web-interface/screen-sync-evidence.ts`
- `scripts/screen-workspace-vocabulary.ts`

**Problem:** Manifest validation, output path expansion, playlist hashes, animated frames, and active item evidence are re-understood across modules.

**Solution:** Make resolved playlist semantics one deep module. Browser URLs should be an adapter detail.

**ADR alignment:** ADR 0003, ADR 0004, ADR 0005, ADR 0011, ADR 0013.

**Tests that improve:**

- Static and animated playlist fixtures.
- Traversal rejection.
- Missing manifest/output errors.
- Hash stability.
- Frame candidate selection.

### Declare Runtime Contract Codec

**Recommendation strength:** Strong

**Files:**

- `lvgl_app/src/main.c`
- `scripts/runtime-screen-assets.ts`
- `web-interface/widget-app-workspace.ts`
- `scripts/walnut-lvgl-widget-catalog.ts`

**Problem:** The runtime text interface is hand-written in TypeScript and hand-parsed in C. It accepts both `walnutpi.lvgl-runtime-assets.v1` and `walnutpi.lvgl-widget-runtime.v1` through one parser, while token and text encoding rules are duplicated.

**Solution:** Make the runtime file codec explicit, fixture-tested, and separate from host adapters.

**ADR alignment:** ADR 0011. It also exposes pressure from ADR 0022 and ADR 0023 because Widget App Mode should not silently ride through the Screen Workspace runtime seam.

**Tests that improve:**

- Golden `default.txt` fixtures.
- Invalid-contract fixtures.
- C preview load failure tests.
- `walnut-lvgl-preview --runtime <fixture>` smoke tests.

### Unify Retrieval Corpus and Durable Memory modules

**Recommendation strength:** Worth exploring

**Files:**

- `walnut-ai-terminal/walnut_ai.py`
- `walnut-ai-terminal/memory_distiller.py`
- `web-interface/project-memory-api.ts`
- `web-interface/model-terminal-server.ts`
- `walnut-ai-terminal/corpus/*`
- `walnut-ai-terminal/memory/*`

**Problem:** Retrieval and Durable Memory rules are duplicated across Python CLI and Web, while seed/runtime memory schemas drift.

**Solution:** Deepen file-backed Retrieval Corpus and Durable Memory as shared contracts with separate adapters.

**ADR alignment:** ADR 0017, ADR 0020, and ADR 0021.

**Tests that improve:**

- Query synonym ranking for screen/GPIO/I2C.
- Source de-dupe and limit behavior.
- Malformed memory JSON handling.
- Duplicate case-fold merge.
- Secret rejection.
- Candidate-only Web memory does not write Durable Memory.

### Extract frontend state modules

**Recommendation strength:** Worth exploring

**Files:**

- `web-interface/walnut-agent-console.html`
- `web-interface/screen-workspace-preview.html`
- `web-interface/widget-app-gallery.html`
- `web-interface/router.ts`

**Problem:** Browser scripts mix state machines, direct `fetch()` calls, DOM rendering, route strings, and product result interpretation.

**Solution:** Extract state/reducer modules, leaving DOM and fetch behavior as adapters.

**ADR alignment:** ADR 0016 and ADR 0024.

**Tests that improve:**

- Fixture-driven turn reducer tests.
- EventSource ordering tests.
- Generated-screen preview decision tests for `screen.wallpaper` vs `screen.widget_app`.
- Playlist-player state tests for static/animated repeat/loop.
- Beginner Sync Status tests.

### Replace router switch with route table modules

**Recommendation strength:** Worth exploring

**Files:**

- `web-interface/router.ts`
- `web-interface/model-terminal-server.ts`
- `web-interface/static-ui-host.ts`
- `web-interface/*api.ts`

**Problem:** Central route matching is a shallow switch with method checks, regex decode, preview blocking, domain dispatch, and static fallback mixed together.

**Solution:** Use route table modules per domain while keeping external paths stable.

**ADR alignment:** ADR 0015.

**Tests that improve:**

- Method rejection tests.
- Path parameter decoding tests.
- Preview-only blocking tests.
- Static fallback tests.
- No accidental route shadowing.

### Deepen delivery evidence and Sync Record updates

**Recommendation strength:** Worth exploring

**Files:**

- `web-interface/screen-delivery-adapters/ssh-local-agent.ts`
- `web-interface/screen-evidence-ledger.ts`
- `web-interface/screen-diagnostics-api.ts`
- `web-interface/screen-sync-evidence.ts`

**Problem:** Delivery stage parsing, evidence evaluation, record persistence, frame tickets, and pixel-diff updates know each other’s storage shapes.

**Solution:** Keep delivery and diagnostics separate, but deepen the stage plan and Sync Record mutation interfaces.

**ADR alignment:** ADR 0013 and ADR 0015.

**Tests that improve:**

- Delivery stage parsing fixtures.
- Runtime-supported fast path.
- Runtime-upgrade-build path.
- Failed slice/build/validate/activate/frame stages.
- Atomic record/summary update tests.
- Pixel diff v1/v2 normalization tests.

## Additional Candidates Not Ranked Into The Top Set

These were found by the domain explorers but folded into the ranked candidates above or left as second-pass work:

- Agent Action Command module inside `walnut`.
- Action evidence/result normalization module.
- Intent Route v2 to Action Policy seam.
- Action Registry simplification.
- Real-Device Verification wrapper script module.
- Agent Observability event contract.
- Session Log Ledger module.
- Session Summary interface.
- Playlist Timeline module.
- Widget Renderer module.
- Runtime Host Adapter module.
- Screen generation workflow module.
- Screen Workspace UI state module.
- Walnut Agent Console turn/preview client module.

## Suggested Order

1. Deepen cross-surface Action Policy.
2. Narrow Device Transport.
3. Deepen Agent Loop Harness trace contract.
4. Split Widget App Mode out of Screen Workspace.
5. Resolve Screen Playlist once.
6. Declare Runtime Contract Codec.

This order starts with execution authority and device seams, then moves into product-loop observability, then into screen/runtime module depth.

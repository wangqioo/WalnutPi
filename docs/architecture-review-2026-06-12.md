# WalnutPi Architecture Review

Date: 2026-06-12

This document records architecture review candidates from the current WalnutPi codebase. It is based on `AGENTS.md`, `README.md`, `web-interface/README.md`, and `docs/third-projects-integration-alignment.md`.

No `CONTEXT.md` or `docs/adr/` exists at the time of this review, so there are no repo-owned domain glossary or ADR constraints to reconcile. The active product contract remains beginner-first screen sync:

```text
Natural language or guided intent
-> Web preview of a small LVGL screen
-> Sync to WalnutPi
-> WalnutPi screen shows the same interface
-> Web shows status, execution evidence, and an AI-readable summary
```

## Vocabulary

This review uses the following architecture terms consistently:

- Module: anything with an interface and an implementation.
- Interface: everything a caller must know to use the module correctly.
- Implementation: the code inside a module.
- Depth: leverage at the interface.
- Deep: a large amount of behavior behind a small interface.
- Shallow: an interface nearly as complex as the implementation.
- Seam: where an interface lives.
- Adapter: a concrete thing satisfying an interface at a seam.
- Leverage: what callers get from depth.
- Locality: what maintainers get from depth.

## Top Recommendation

Start with **Unify Screen Manifest Vocabulary**.

The screen manifest is WalnutPi's main product contract. It feeds Web preview, LVGL config generation, device runtime, sync evidence, repair proposals, AI summaries, and pixel diagnostics. Deepening it should improve locality and leverage without changing the delivery chain or device write behavior.

## Implementation Status

Status as of 2026-06-12:

- **Candidate 2: Unify Screen Manifest Vocabulary** — handled. `scripts/screen-manifest-vocabulary.js` is now the shared JavaScript source for manifest validation, normalization, stable hashing helpers, preview-safe mutable fields, and LVGL runtime config facts. `web-interface/model-terminal-server.js` and `scripts/generate-lvgl-screen-config.js` both use it. `scripts/generate-lvgl-screen-config.py` remains the device-friendly fallback generator and has been tightened to the same fixed target/source contract.
- **Candidate 1: Deepen Screen Sync Workflow** — handled. `web-interface/screen-sync-workflow.js` now owns manifest hash gating, build ID generation, delivery adapter invocation, frame-ticket registration, and record-ready sync result shaping. The HTTP route now delegates to this module and only persists/returns the workflow result.
- **Candidate 3: Concentrate Screen Evidence Ledger** — handled for durable record locality. `web-interface/screen-evidence-ledger.js` now owns screen sync record construction, `record.json` / `summary.json` writes, history summaries, retention, record updates, and cached frame PNG metadata. Repair and AI-summary interpretation still live in the Web server for now, but they read and update records through the ledger interface.
- **Candidate 4: Make Walnut Actions The Agent Seam** — deferred. This was marked speculative in the review, and changing the action interface would affect shared risk policy and high-risk confirmation semantics. Treat it as a separate alignment item rather than part of this first screen-sync architecture pass.

Verification completed:

- `node --check` for the Web server, delivery adapter, sync workflow, evidence ledger, manifest vocabulary, and Node generator.
- `python -m py_compile scripts/generate-lvgl-screen-config.py`.
- Python/Node generator parity: both generated identical `lvgl_app/generated/screen_config.h`.
- `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test-screen-api-safety.ps1 -Port 4213`.
- Scoped `git diff --check` for the files touched by this pass.

Known workspace note: the full worktree still has unrelated dirty files from before this pass, and full `git diff --check` reports a pre-existing trailing blank-line issue in `walnut-ai-terminal/corpus/screen-sync-successes.md`.

## Candidate 1: Deepen Screen Sync Workflow

Recommendation strength: Strong

Dependency category: ports & adapters

### Files

- `web-interface/model-terminal-server.js`
- `web-interface/screen-delivery-adapters/ssh-local-agent.js`

### Problem

Screen sync is shallow: the route interface nearly matches the implementation sequence. The HTTP route knows manifest hash gating, result shape, delivery adapter lookup, frame tickets, record persistence, and repair hint consequences.

The current call shape roughly behaves like this:

```text
HTTP route
-> read manifest envelope
-> validate client manifestHash
-> create buildId
-> choose delivery adapter
-> run adapter
-> remember frame ticket
-> shape sync result
-> persist sync record
-> attach repair hint
```

This gives low locality. A change to sync result semantics can force edits across route handling, delivery result mapping, record persistence, repair, diagnostics, and browser assumptions.

### Solution

Deepen the screen sync workflow into a module whose interface is closer to:

```text
runScreenSync({ clientManifestHash, mode })
-> ScreenSyncResult
```

The module should own:

- Manifest hash gate.
- Build ID generation.
- Delivery adapter invocation.
- Frame ticket registration data.
- Record-ready result shape.
- Beginner-facing sync state.
- Failure stage and repair seed facts.

The delivery adapter should stay focused on concrete device delivery. It should not become the owner of record persistence or beginner UI semantics.

### Benefits

- Locality: sync bugs concentrate in one module.
- Leverage: one workflow result serves route, records, and diagnostics.
- The interface becomes the test surface.
- Delivery adapters stay as adapters.

### Before / After

Before:

```text
HTTP route
  |-- manifest hash gate
  |-- buildId / result shape
  |-- adapter lookup
  |-- frame tickets
  |-- record persistence
  |-- repair hint
  `-- browser-facing response

ssh-local-agent adapter
  `-- concrete delivery commands
```

After:

```text
HTTP route
  `-- Screen Sync Workflow
        |-- manifest hash gate
        |-- delivery adapter
        |-- evidence ledger write
        |-- repair summary seed
        `-- beginner sync result
```

## Candidate 2: Unify Screen Manifest Vocabulary

Recommendation strength: Strong

Dependency category: local-substitutable

### Files

- `web-interface/model-terminal-server.js`
- `scripts/generate-lvgl-screen-config.py`
- `scripts/generate-lvgl-screen-config.js`
- `web-interface/model-terminal.html`
- `lvgl_app/src/main.c`
- `lvgl_app/generated/screen_config.h`

### Problem

The screen manifest interface leaks into four implementations:

- Server JavaScript validates, normalizes, patches, templates, and interprets components.
- Python and Node generators separately validate and normalize the same component vocabulary.
- Browser JavaScript interprets components for preview and diagnostic pixel diff.
- LVGL C code consumes generated defines that encode the same vocabulary again.

This is a shallow module shape. Every vocabulary change requires maintainers to remember several local interfaces and compatibility mappings.

Deletion test: deleting the duplicated vocabulary logic would not remove complexity; it would reappear across the server, generators, browser, and LVGL runtime. That means this module is earning its keep, but the seam is currently too diffuse.

### Solution

Deepen the manifest vocabulary into one source of validation, normalization, compatibility mapping, and generated runtime facts.

A practical shape could be:

```text
Screen Manifest Vocabulary
-> normalize manifest
-> expose mutable beginner fields
-> emit LVGL config model
-> emit preview model
-> emit evidence signature model
```

This does not require making WalnutPi a generic IDE or allowing arbitrary LVGL/C code. The interface should remain beginner-safe and constrained to the current screen vocabulary: `statusCard`, `metricGroup`, `list`, `progress`, `alert`, and `textPage`.

### Benefits

- Locality: vocabulary changes happen once.
- Leverage: one interface feeds four consumers.
- Compatibility becomes internal implementation.
- Tests can target the manifest vocabulary interface instead of each caller.

### Before / After

Before:

```text
manifest vocabulary
  |-- server JS normalization
  |-- Python generator normalization
  |-- Node generator normalization
  |-- browser preview interpretation
  `-- LVGL runtime assumptions
```

After:

```text
manifest JSON
  `-- Screen Manifest Vocabulary
        |-- normalized manifest
        |-- preview model
        |-- LVGL config model
        |-- evidence signature model
        `-- mutable beginner fields
```

## Candidate 3: Concentrate Screen Evidence Ledger

Recommendation strength: Worth exploring

Dependency category: in-process

### Files

- `web-interface/model-terminal-server.js`
- `web-interface/model-terminal.html`
- `web-interface/screen-sync-records/`

### Problem

Evidence shape leaks across records, repair, AI summaries, frame caching, pixel diff, and browser diagnostics.

Current concepts are related but spread:

- `screenEvidence`
- `visualChecks`
- `pixelEvidence`
- `webDevicePixelDiff`
- `framePng`
- `repairHint`
- `repairCandidate`
- `repairProposal`
- `aiSummary`
- `summary.json`

The record file is becoming a de facto interface, but the implementation is split across route handlers and browser diagnostics. That makes record evolution risky.

### Solution

Deepen a screen evidence ledger module. Stored records should become one durable evidence interface for diagnostics and post-sync workflows.

The module should own:

- Record writing and summary derivation.
- Frame PNG cache metadata.
- Pixel diff validation and persistence.
- Repair facts derived from evidence.
- AI-summary evidence extraction.
- Stable history-list projection.

### Benefits

- Locality: evidence changes once.
- Leverage: repair, AI summary, and diagnostics read the same facts.
- Diagnostics stop leaking internal record shape.
- Records become the test surface.

### Before / After

Before:

```text
sync record
  |-- repair hint
  |-- repair candidate
  |-- repair proposal
  |-- AI summary
  |-- pixel diff
  |-- frame cache
  `-- browser diagnostics
```

After:

```text
Screen Evidence Ledger
  |-- record summary
  |-- frame cache
  |-- repair facts
  |-- AI evidence
  |-- pixel diff
  `-- history view
```

## Candidate 4: Make Walnut Actions The Agent Seam

Recommendation strength: Speculative

Dependency category: ports & adapters

### Files

- `web-interface/model-terminal-server.js`
- `walnut-ai-terminal/walnut_ai.py`
- `walnut-assistant/walnut`

### Problem

The agent action interface is shallow because prompts, actions, risk, and evidence vary in multiple callers:

- The Web server has intent classification, project memory retrieval, and a remote action table.
- WalnutAI has a router prompt, memory loading, retrieval, and local action execution.
- The `walnut` CLI has `walnut action run ... --json` as a structured execution path.

The product direction says the Web console and WalnutAI should both be beginner-first agents with local execution evidence. Today they share concepts but not one deep action interface.

### Solution

Deepen `walnut action` as the seam both agents cross for local execution and evidence.

The action interface should concentrate:

- Read-only device checks.
- Risk metadata.
- Confirmation requirements for high-risk actions.
- JSON evidence shape.
- Beginner summary seed facts.
- Audit fields for later memory and diagnostics.

The Web server and WalnutAI can still keep different prompts and UI flows, but they should not each own separate action semantics.

### Benefits

- Locality: risk policy lives once.
- Leverage: Web agent and WalnutAI both use the interface.
- Evidence format stabilizes.
- Confirmation flow can deepen later.

### Before / After

Before:

```text
Web agent
  |-- intent classification
  |-- action table
  |-- remote execution

WalnutAI
  |-- router prompt
  |-- local action execution

walnut CLI
  `-- action run ... --json
```

After:

```text
Web agent --------\
                  -> Walnut Actions -> JSON evidence
WalnutAI --------/
```

## Suggested Order

1. Unify Screen Manifest Vocabulary.
2. Deepen Screen Sync Workflow.
3. Concentrate Screen Evidence Ledger.
4. Make Walnut Actions The Agent Seam.

The first two candidates are the highest leverage because they sit directly on the implemented first slice. The third becomes more valuable as sync records grow. The fourth should wait until the team is ready to define high-risk action confirmation and shared agent behavior more formally.

## Open Questions

- Should `CONTEXT.md` be added before implementation so the screen manifest, screen sync, delivery adapter, evidence ledger, and Walnut actions have canonical domain terms?
- Should the manifest vocabulary remain implemented in JavaScript/Python with parity checks, or should one generator become the source of truth for both environments?
- Should screen evidence records be treated as a versioned local data format before adding more repair or AI-summary features?
- Should `walnut action` become the only execution interface for Web and WalnutAI local actions, including future high-risk prepare/commit flows?

## Non-Goals For These Refactors

- Do not turn WalnutPi into a generic IDE.
- Do not expose arbitrary LVGL/C code editing.
- Do not change `?nossh` preview-only behavior.
- Do not add unauthenticated device writes.
- Do not change existing `walnut screen lvgl`, `start`, `stop`, `toggle`, or `state` behavior.
- Do not introduce new delivery adapters while deepening the current first slice.

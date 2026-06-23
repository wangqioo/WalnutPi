# WalnutPi Product Spine

This document is a short index after the agent-platform refactor decision.
`docs/agent-platform-refactor-spec.md` is the source of truth for new
agent-platform work.

## Pre-Refactor Spine

The current implementation still contains this product path:

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

Keep this path working while migration phases are underway.

## Refactor Spine

The target control-plane path is:

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

The target screen path is:

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

## Stable WalnutPi Contracts

WalnutPi keeps ownership of:

- Screen Manifest v2.
- Screen Playlist v1.
- 480x320 output size.
- RGBA and RGB565 pixel hashes.
- RGB565 runtime assets under `screen/runtime/`.
- Playlist hash freshness gates.
- LVGL runtime parser boundaries.
- Real-device evidence for screen claims.
- The stable `walnut` CLI device boundary.

WalnutPi should not own generic agent runtime, policy infrastructure,
observability infrastructure, eval infrastructure, auth framework internals, or
vector-memory framework behavior.

## Evaluation Rule

The old `bench:*` commands, generated manifests, baselines, generated screen
assets, and generated evidence are not product gates.

New evaluation cases must be human/SME curated and classified with the 3x3
grader matrix before they can block releases.

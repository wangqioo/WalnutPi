# WalnutPi

WalnutPi is an AI-native terminal system for a headless Debian WalnutPi Device
with a 480x320 local screen.

The current architecture source of truth is
`docs/agent-platform-refactor-spec.md`. That spec defines a destructive refactor
from the custom Walnut Agent Loop to a framework-backed local-first agent
platform.

## Direction

WalnutPi should stop owning generic agent runtime, policy, observability, and
evaluation infrastructure. It should own only the product contracts specific to
the WalnutPi device and screen.

Target control-plane flow:

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

Target screen flow:

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

## Current State

The repo still contains the pre-refactor implementation:

- `web-interface/`: current static Web console, custom agent loop, sync APIs,
  diagnostics, and screen workspace workflows.
- `walnut-assistant/`: `walnut` CLI, the stable Device Execution Surface.
- `walnut-ai-terminal/`: local WalnutAI prototype, file-backed memory, corpus,
  and device skills.
- `screen/`: local screen artifacts, playlist, runtime assets, and widget
  runtime state.
- `lvgl_app/`: framebuffer LVGL runtime for `screen/runtime/default.txt`.
- `scripts/`: screen validation, rendering, runtime asset generation, sync, and
  device verification helpers.

The old generated benchmark corpus, generated baselines, run artifacts, and
legacy harness code are intentionally deleted. They are not quality gates.

## Device Boundary

The WalnutPi device runtime stays narrow:

```text
walnut CLI
LVGL app
screen/runtime
systemd walnut-screen.service
read-only evidence scripts
SSH2 transport
```

Do not install Postgres, Langfuse, OPA, Inngest, or other control-plane services
on the WalnutPi device unless a separate deployment decision says so.

## Screen Contracts

Keep these WalnutPi-owned contracts stable unless an ADR changes them:

- 480x320 output size.
- Screen Manifest v2.
- Screen Playlist v1.
- Playlist hash freshness gate.
- Runtime Screen Assets under `screen/runtime/`.
- RGB565 byte order, alpha handling, and pixel hash behavior.
- LVGL runtime bounded parser behavior.
- Real-device verification for sync, delivery, activation, frame evidence, and
  capture evidence.

LLM output must not become an authoritative Screen Manifest. Agents should use
the Screen Command DSL and renderer adapters.

## Development

Install dependencies:

```bash
bun install
```

Run type checks:

```bash
bun run check
```

Run the current Web console:

```bash
bun run web
```

Common real-device helpers:

```powershell
pwsh ./scripts/start-web-console.ps1
pwsh ./scripts/collect-screen-sync-evidence.ps1 -Sync
pwsh ./scripts/collect-screen-sync-evidence.ps1
pwsh ./scripts/save-screen-capture.ps1
pwsh ./scripts/invoke-walnut-screen.ps1 -Action state
pwsh ./scripts/build-lvgl-on-device.ps1
```

## Evaluation

New evaluation work follows the 3x3 model in
`docs/agent-platform-refactor-spec.md`.

Curated eval cases must declare:

- input
- expected outcome
- required evidence
- forbidden side effects
- grader classification

Do not add LLM-generated golden cases, baselines, or run artifacts without
human/SME labeling.

## Roadmap

Follow the phases in `docs/agent-platform-refactor-spec.md`:

1. Freeze and supersede docs.
2. Add typed WalnutPi tool results.
3. Add Screen Command DSL.
4. Add OPA policy decisions.
5. Add MCP/Hono gateway.
6. Move one vertical slice to Mastra.
7. Add curated eval through Langfuse, Mastra evals, and Inngest.
8. Replace the static console with Next.js and Vercel AI SDK.
9. Remove the old custom runtime.

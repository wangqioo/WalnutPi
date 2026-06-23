# AGENTS.md

## Project Direction

WalnutPi is an AI-native terminal system for a headless Debian WalnutPi Device.
New agent-platform work follows `docs/agent-platform-refactor-spec.md`.

The current implementation is pre-refactor:

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

The refactor target is:

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

Screen-specific target:

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

WalnutPi should own only product contracts specific to the device and screen.
Do not build a generic agent framework inside this repo.

## Main Paths

- `docs/agent-platform-refactor-spec.md`: source of truth for new agent-platform work.
- `web-interface/`: pre-refactor static console, custom runtime, screen APIs, diagnostics.
- `screen/`: local screen artifacts, playlists, runtime assets, widget runtime.
- `lvgl_app/`: LVGL framebuffer runtime for Screen Playlist playback.
- `scripts/screen-workspace-vocabulary.ts`: Screen Manifest v2 / Playlist v1 validation and hash behavior.
- `scripts/screen-workspace-pipeline.ts`: Source Asset / Screen Content processing.
- `scripts/generate-lvgl-screen-workspace-runtime-assets.ts`: Runtime Screen Assets generator.
- `scripts/build-lvgl-app.sh`: LVGL runtime build helper.
- `walnut-assistant/`: Device Execution Surface and `walnut` CLI.
- `walnut-ai-terminal/`: pre-refactor WalnutAI prototype, file-backed memory, corpus, device skills.
- `docs/adr/`: architectural decisions.

## Control Plane And Device Boundary

Keep the WalnutPi device runtime narrow:

```text
walnut CLI
LVGL app
screen/runtime
systemd walnut-screen.service
read-only evidence scripts
SSH2 transport
```

Do not install Postgres, Langfuse, OPA, Inngest, or similar control-plane
services on the WalnutPi Device unless a separate deployment decision says so.
They belong to the control plane.

Do not expose arbitrary shell, `/terminal`, Human CLI Commands, arbitrary
filesystem paths, direct LVGL calls, or direct SSH command strings as MCP tools.

## Real-Device Verification

Default to real-device verification for sync, delivery, activation, service state, frame evidence, and capture evidence.

Commands:

- Start Web console: `pwsh ./scripts/start-web-console.ps1`
- Full sync/evidence pass: `pwsh ./scripts/collect-screen-sync-evidence.ps1 -Sync`
- Read-only evidence pass: `pwsh ./scripts/collect-screen-sync-evidence.ps1`
- Save current frame PNG: `pwsh ./scripts/save-screen-capture.ps1`
- Invoke screen CLI remotely: `pwsh ./scripts/invoke-walnut-screen.ps1 -Action state`
- Build LVGL on device: `pwsh ./scripts/build-lvgl-on-device.ps1`
- Local Web server: `bun run web`

See `docs/real-device-command-scripts.md` before adding or changing real-device command wrappers.

## In-App Browser Automation Notes

- The Codex in-app Browser WebView may re-attach when the Codex app or sidebar focus changes. Tab ids can change mid-test or briefly become `about:blank#codex-browser-sidebar-attach-token=...`; always re-list tabs and reconnect to the current `http://localhost:4173/` tab before continuing.
- If `browser.tabs.new()` times out waiting for WebView attach, immediately call `browser.tabs.list()`. A usable tab often appears after the timeout with a new id.
- Do not assume a tab id remains valid after a click, reload, or user focus change. If a command reports `Tab not found`, recover by listing tabs and binding the newest Walnut Agent Console tab.
- Browser automation `fill()` and bulk `type()` can fail on the Agent Console textarea with a virtual clipboard error. Prefer Playwright `locator.press(...)` key-by-key input for reliable UI tests.
- DOM CUA can inspect node ids reliably with `tab.dom_cua.get_visible_dom()`, but DOM CUA click/type interactions may cause the WebView automation connection to drop. Prefer Playwright locators for clicks once the page is reachable.
- A reliable Agent Console input pattern is: focus `#prompt`, press `Control+A`, press `Backspace`, press characters one by one, then click `问 WalnutAI` or `处理意图` with a Playwright role locator.
- For multi-turn UI smoke tests, verify the visible message count after each submit: each round should append `你`, `系统`, and `WalnutAI`, so three rounds should produce nine `.message` elements.
- Pair browser checks with API checks when automation is unstable. Useful fallbacks are `POST /api/intent/classify`, `POST /api/action`, and `GET /api/session?sessionId=...`; use these to distinguish UI automation failure from app behavior failure.

## Screen Sync Contract

- Browser reads `GET /api/screen/workspace/playlist`.
- Browser syncs with `POST /api/screen/workspace/sync`.
- Sync requests include the current `playlistHash`.
- Runtime delivery syncs `screen/runtime/default.txt` and RGB565 frame files.
- LVGL builds happen when the runtime needs an upgrade.
- Remote root resolution: `WALNUT_REMOTE_PROJECT_ROOT`, then `WALNUT_PROJECT_ROOT`, then `/home/pi/projects/WalnutPi`.
- Activation prefers runtime hot reload; `sudo -n systemctl restart walnut-screen.service` is the upgrade fallback.
- `sudo -n walnut screen start` remains the user-facing CLI entry.
- Evidence uses service state, `walnut screen state`, `sudo -n walnut screen frame`, and read-only `walnut screen capture`.
- Beginner Sync Status stays limited to `未同步`, `同步中`, `已同步到核桃派`, and `同步失败`.
- Hashes, `buildId`, command output, delivery manifests, raw device evidence, frame URLs, and image bytes stay in Developer Diagnostics.

## Agent And CLI

- `walnut` is the Device Execution Surface.
- Human CLI Commands and Agent Action Commands have separate contracts.
- The action manifest remains an action catalog; OPA becomes the policy decision layer.
- OPA checks happen before command construction for tool/action calls.
- Refused and pending actions must not produce command strings.
- System Writes and high-risk Local Actions use explicit confirmation.
- Public command additions should fit the existing `walnut` command surface when practical.
- WalnutAI one-shot local agent replies may append `WALNUT_AGENT_TURN_TRACE:` JSON. Keep this trace aligned with Web `/api/agent/turn` fields: `route`, `steps[]`, `evidence`, and `contextUsed`.

## Screen Command DSL

New agent work should not let LLM output become an authoritative Screen Manifest.
Route screen mutations through the Screen Command DSL described in
`docs/agent-platform-refactor-spec.md`.

The command runner may call existing screen workflows, the screen pipeline,
runtime asset generation, and sync workflow. It must not bypass playlist hash
freshness, preview no-write mode, or mutate the LVGL runtime directly.

## Evaluation Governance

- The old LLM-written product benchmark corpus and `bench:*` harnesses have been removed.
- Do not add generated benchmark cases, baselines, or run artifacts without human/SME labeling.
- New evaluation work follows `docs/agent-platform-refactor-spec.md`: Langfuse datasets, Mastra evals, Inngest fanout, and the 3x3 grader matrix.
- Curated eval cases must declare expected behavior, required evidence, forbidden side effects, and grader classification before they become quality gates.

## Tool Defaults

- Use `bun` for JavaScript/TypeScript.
- Use `uv` for Python when the project has no stronger preference.
- Install missing tools directly when needed.
- For local Windows tools, resolve/install in this order: `scoop`, `winget`, language package managers, then system PATH/defaults.

## Domain Docs

- Glossary: `CONTEXT.md`
- Decisions: `docs/adr/`
- Issue tracker: `docs/agents/issue-tracker.md`
- Triage labels: `docs/agents/triage-labels.md`
- Domain map: `docs/agents/domain.md`

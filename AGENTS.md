# AGENTS.md

## Project Direction

WalnutPi is an AI-native terminal system for a headless Debian WalnutPi Device.

Current product spine:

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

## Main Paths

- `web-interface/`: Walnut Agent Console, Screen Workspace UI, sync APIs, diagnostics.
- `screen/`: Screen Workspace assets, manifests, outputs, playlists, runtime assets.
- `lvgl_app/`: LVGL framebuffer runtime for Screen Playlist playback.
- `scripts/screen-workspace-vocabulary.ts`: Screen Manifest v2 / Playlist v1 validation and hash behavior.
- `scripts/screen-workspace-pipeline.ts`: Source Asset / Screen Content processing.
- `scripts/generate-lvgl-screen-workspace-runtime-assets.ts`: Runtime Screen Assets generator.
- `scripts/build-lvgl-app.sh`: LVGL runtime build helper.
- `walnut-assistant/`: Device Execution Surface and `walnut` CLI.
- `walnut-ai-terminal/`: WalnutAI runtime, Durable Memory, Retrieval Corpus, device skills.
- `docs/adr/`: architectural decisions.
- `archive/experiments/`: Archived Capabilities.

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
- Agent Action Commands should be governed by the Action Policy Manifest.
- System Writes and high-risk Local Actions use explicit confirmation.
- Public command additions should fit the existing `walnut` command surface when practical.
- WalnutAI one-shot local agent replies may append `WALNUT_AGENT_TURN_TRACE:` JSON. Keep this trace aligned with Web `/api/agent/turn` fields: `route`, `steps[]`, `evidence`, and `contextUsed`.

## Agent Harness And Product Benchmarks

- Main product benchmark entry: `bun run bench:product`.
- `bench:product` uses Walnut Agent Console `/api/agent/turn`, records `agentTurn.v2` traces, and writes runs under `screen/benchmark-runs/<runId>/`.
- Default benchmark behavior runs all variants for selected cases with a bounded worker pool. Default concurrency is `--concurrency 4`; use `--concurrency 1` for serial reproduction and `--first-variant` only for quick local checks.
- Profiles:
  - `offline`: repeatable local gate profile; records cases with `requirements.device/network/model/search` as profile skips.
  - `network`: product-loop checks that may use network/model/search behavior but still record device cases as profile skips.
  - `device`: live WalnutPi verification profile; not a universal CI gate.
- Every V2 JSONL case must declare `requirements: { device, network, model, search }` with boolean values. Harness profile filtering must use only this structured field, never prompt text, flow names, titles, or legacy compatibility fields.
- CI/offline gate: `bun run bench:product:gate`. It runs offline all-variant benchmarks and compares against `screen/benchmark-baselines/offline/summary.json`.
- Baseline convention: `screen/benchmark-baselines/<profile>/summary.json`. Gate must fail when the baseline is missing; do not silently bless new results.
- Compare two runs with `bun run bench:product:compare -- <base-summary.json> <new-summary.json>`.
- Device profile writes `device-preflight.json` plus `summary.environment.devicePreflight`. Use `--strict-device-preflight` only when missing live-device target metadata should fail fast.
- Loop evaluation should include trace signals, but multi-step behavior must also be tested through bounded `nextTasks` continuation evidence: `multi-step-loop` and `replan-evidence`.
- `contract-only` cases are recorded as skips and are not real product coverage.

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

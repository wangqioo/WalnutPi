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
- `scripts/screen-workspace-vocabulary.js`: Screen Manifest v2 / Playlist v1 validation and hash behavior.
- `scripts/screen-workspace-pipeline.js`: Source Asset / Screen Content processing.
- `scripts/generate-lvgl-screen-workspace-runtime-assets.js`: Runtime Screen Assets generator.
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

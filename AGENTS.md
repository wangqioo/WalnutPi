# AGENTS.md

## Project Direction

WalnutPi is an AI-native terminal system for a headless Debian device.

Current core loop:

```text
Web conversation
-> generate a 480x320 pixel-style Screen Manifest
-> preview with LVGL
-> explicitly sync to the real WalnutPi
-> collect screen/device evidence
```

Keep the project focused on this loop. Do not turn it into a generic IDE, desktop app, ESP32 platform, or VibeBoard clone.

## Main Paths

- `web-interface/`: Web conversation, preview, sync API, diagnostics.
- `lvgl_app/`: manifest-driven LVGL framebuffer app.
- `scripts/screen-manifest-vocabulary.js`: Screen Manifest validation and hash behavior.
- `scripts/generate-lvgl-screen-config.js`: canonical LVGL config generator.
- `scripts/build-lvgl-app.sh`: LVGL build helper.
- `walnut-assistant/`: installed `walnut` CLI and `walnut screen` commands.
- `archive/experiments/`: archived tools and experiments.
- `archive/install-scripts/`: archived installers.
- `third/` and `third_party/`: references and vendored dependencies.

## Real-Device Debugging

Default to real-device testing.

- Use normal Web URLs without `?nossh` for real-device sync/debug.
- Use `?nossh` only for preview-only local checks and safety regression tests.
- Do not use `?nossh` when verifying build, SSH, delivery, activation, frame evidence, or service state.
- `?nossh` must never build, SSH, deliver, activate, capture, or write to the device.

Real-device commands:

- Start Web console: `pwsh ./scripts/start-web-console.ps1`
- Full sync/evidence pass: `pwsh ./scripts/collect-screen-sync-evidence.ps1 -Sync`
- Read-only evidence pass: `pwsh ./scripts/collect-screen-sync-evidence.ps1`
- Save current frame PNG: `pwsh ./scripts/save-screen-capture.ps1`
- Invoke screen CLI remotely: `pwsh ./scripts/invoke-walnut-screen.ps1 -Action state`
- Build LVGL on device: `pwsh ./scripts/build-lvgl-on-device.ps1`

Local/safety commands:

- Local Web server: `bun run web`
- Screen safety regression: `bun run screen:safety`
- Preview-only sync safety check: `pwsh ./scripts/sync-screen-via-web-api.ps1 -PreviewOnly`

See `docs/real-device-command-scripts.md` before adding or changing real-device command wrappers.

## Screen Sync Contract

- Browser reads `GET /api/screen/manifest`.
- Browser syncs with `POST /api/screen/sync`.
- Sync requests must include the current `manifestHash`.
- Missing, invalid, or stale hashes must fail before build or SSH.
- Build uses `scripts/build-lvgl-app.sh`.
- Remote root is `WALNUT_REMOTE_PROJECT_ROOT`, then `WALNUT_PROJECT_ROOT`, then `/home/pi/projects/WalnutPi`.
- Web activation currently uses `sudo -n systemctl restart walnut-screen.service`.
- `sudo -n walnut screen start` remains the user-facing CLI entry.
- Evidence uses `walnut screen state` and `sudo -n walnut screen frame`.
- Diagnostic screenshots use read-only `walnut screen capture`.
- Artifact and delivery evidence must use real SHA-256 hashes.

Beginner UI should only show states like `未同步`, `同步中`, `已同步到核桃派`, and `同步失败`. Keep hashes, `buildId`, command output, delivery manifests, raw device evidence, frame URLs, and image bytes in developer diagnostics.

## Walnut CLI

Preserve the `walnut screen` command surface:

```text
start stop toggle state frame capture status test demo off image ai app lvgl lvgl-demo restore
```

Do not add new top-level launchers under `/usr/local/bin` when an existing `walnut` subcommand fits.

## Safety Boundaries

- Preserve existing `walnut screen` behavior.
- Do not expose public root shells.
- Do not add unauthenticated high-risk write operations.
- High-risk actions require explicit confirmation: system writes, service replacement, reboot, shutdown, GPIO output, eMMC writes, image flashing, firmware delivery.
- Treat install scripts, service changes, boot enablement, and new `/usr/local/bin` commands as system-write operations requiring explicit user confirmation.

## Tool Defaults

- Use `bun` for JavaScript/TypeScript.
- Use `uv` for Python when the project has no stronger preference.
- Install missing tools directly when needed.
- For local Windows tools, resolve/install in this order: `scoop`, `winget`, language package managers, then system PATH/defaults.

## Compatibility

- Preserve Screen Manifest schema and hash semantics unless intentionally changing the sync contract.
- Preserve public WalnutPi command compatibility.
- Do not add compatibility shims, fallback scripts, broad refactors, fixtures, or snapshots unless explicitly requested.

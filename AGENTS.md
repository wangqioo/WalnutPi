# WalnutPi Agent Instructions

## Project Direction

WalnutPi is a workspace for a headless Debian Linux device with local execution, a small framebuffer/LVGL screen, a Web agent console, and cloud AI integration.

Keep the product direction beginner-first:

```text
Natural language or guided intent
-> Web preview of a small LVGL screen
-> Sync to WalnutPi
-> WalnutPi screen shows the same interface
-> Web shows status, execution evidence, and an AI-readable summary
```

Do not turn this repository into a generic IDE, desktop app, ESP32 board platform, or VibeBoard clone.

## Third-Party Project Boundaries

`third/VibeBoard` is a product-architecture reference only. Reuse ideas such as artifact manifests, delivery adapters, build evidence, and device evidence. Do not copy its React app, ESP-IDF assumptions, OTA/flash flows, board profiles, or services into WalnutPi.

`third/walnutpi` is a WalnutPi experience reference only. Reuse ideas such as device presence, rich terminal evidence, memory, and WalnutPi-specific skills. Do not wholesale replace the current project with it.

The active alignment document is `docs/third-projects-integration-alignment.md`.

## Current Screen Sync Slice

The implemented first slice is intentionally narrow:

- Web reads `GET /api/screen/manifest`.
- Browser renders the preview from that manifest.
- Sync uses `POST /api/screen/sync`.
- The request must include the current `manifestHash`; missing, invalid, or stale hashes must be rejected before any build or SSH action.
- Build uses `scripts/build-lvgl-app.sh`.
- Remote build root is explicit: `WALNUT_REMOTE_PROJECT_ROOT`, falling back to `WALNUT_PROJECT_ROOT`, then `/home/pi/projects/WalnutPi`.
- Activation uses `sudo -n walnut screen start`.
- Evidence uses `walnut screen state` and `sudo -n walnut screen frame`.
- Diagnostics-only screenshots use `walnut screen capture`, a read-only PNG capture command that returns metadata by default and optional `pngBase64` only for the on-demand frame route.
- Artifact evidence must be a real SHA-256 hash, and the delivery manifest/hash must commit to that artifact hash.

Beginner UI should show only understandable states such as `未同步`, `同步中`, `已同步到核桃派`, and `同步失败`. Keep `buildId`, hashes, delivery manifests, command output, raw device evidence, `frameUrl`, and image bytes in developer diagnostics.

## Safety Boundaries

Preserve existing `walnut screen` CLI behavior. Do not break:

- `walnut screen lvgl`
- `walnut screen start`
- `walnut screen stop`
- `walnut screen toggle`
- `walnut screen state`

Do not expose public root shells or add unauthenticated high-risk write operations. High-risk actions such as system writes, service replacement, reboot, shutdown, GPIO output, eMMC writes, image flashing, or firmware delivery require explicit user confirmation and clear impact text.

`?nossh` mode is preview-only. It must not connect to WalnutPi or trigger build, SSH, delivery, activation, or device writes.

## Tooling

Use existing project tooling first. If no project preference exists:

- Python: `uv` when adding or managing Python tooling.
- JavaScript/TypeScript: `bun`.

On Windows, local developer tools may be installed by Scoop. Resolve tool paths through Scoop before assuming global installs.

## Tests And Review

Use focused verification for the touched area. For screen/Web changes, useful checks include:

```bash
python -m unittest tests.test_walnut_screen tests.test_screen_app
node --check web-interface/model-terminal-server.js
```

For meaningful Web/sync changes, request or perform an independent review before finalizing. Security-relevant review should check manifest drift prevention, command quoting, artifact evidence, delivery evidence, and accidental device writes.

Do not add tests, fixtures, snapshots, or broad refactors unless the user asks for them.

# AGENTS.md

## Project overview

- Product spine code lives under `web-interface/`, `lvgl_app/`, `scripts/`, and `walnut-assistant/`.
- Screen Manifest vocabulary and hash behavior live in `scripts/screen-manifest-vocabulary.js`.
- LVGL config generation lives in `scripts/generate-lvgl-screen-config.js`; the Python entrypoint is compatibility-only.
- Tests live under `tests/`.
- Experiments and support surfaces live under `framebuffer_ui/`, `walnut-ai-terminal/`, `terminal-toys/`, `console-chinese/`, `hardware/`, `audio/`, `ai_video/`, `voice-keyboard/`, and `investor-brief/`.
- Third-party references live under `third/` and `third_party/`.

WalnutPi is a beginner-first workspace for a headless Debian Linux device:

```text
Natural language or guided intent
-> Web preview of a small LVGL screen
-> Sync to WalnutPi
-> WalnutPi screen shows the same interface
-> Web shows status, execution evidence, and an AI-readable summary
```

Do not turn this repository into a generic IDE, desktop app, ESP32 board platform, or VibeBoard clone.

## Mandatory skill usage

- Use `$setup-matt-pocock-skills` before first using `$diagnose`, `$tdd`, `$triage`, `$to-prd`, `$to-issues`, `$improve-codebase-architecture`, or `$zoom-out` if `docs/agents/` is not configured.
- Use Matt Pocock engineering skills when the task matches them: `$diagnose` for bugs, `$tdd` for test-first work, `$review` for reviews, `$triage` for issue triage, `$to-prd` for PRDs, `$to-issues` for implementation tickets, `$improve-codebase-architecture` for architecture improvement, and `$zoom-out` for broader codebase context.
- For WalnutPi device, hardware, GPIO, Linux, LVGL, OpenCV, PyQt5, Home Assistant, MQTT, Python, Android, or screen-sync work, read the relevant local project skill/reference file under `walnut-ai-terminal/skills/` before changing behavior.
- Use Context7 for library, framework, SDK, API, CLI, or cloud-service questions.
- For OpenAI API or platform work, use current official OpenAI docs.

## Build and test commands

- Start Web console from Windows: `pwsh ./scripts/start-web-console.ps1`
- Start standalone SSH terminal from Windows: `pwsh ./scripts/start-ssh-terminal.ps1`
- Sync screen through the Web API: `pwsh ./scripts/sync-screen-via-web-api.ps1`
- Preview-only sync safety check: `pwsh ./scripts/sync-screen-via-web-api.ps1 -PreviewOnly`
- Full real-device evidence pass: `pwsh ./scripts/collect-screen-sync-evidence.ps1 -Sync`
- Read-only real-device evidence pass: `pwsh ./scripts/collect-screen-sync-evidence.ps1`
- Save current device frame PNG: `pwsh ./scripts/save-screen-capture.ps1`
- Invoke screen CLI remotely: `pwsh ./scripts/invoke-walnut-screen.ps1 -Action state`
- Build LVGL on device: `pwsh ./scripts/build-lvgl-on-device.ps1`
- Screen API safety regression: `pwsh ./scripts/test-screen-api-safety.ps1`
- Local Web console direct command: `bun web-interface/model-terminal-server.js`
- Local Web console package script: `bun run web`
- Local screen API safety package script: `bun run screen:safety`
- Local LVGL app build: `scripts/build-lvgl-app.sh`
- Walnut screen CLI smoke paths: `walnut screen lvgl`, `walnut screen start`, `walnut screen stop`, `walnut screen toggle`, `walnut screen state`
- If no project-specific tool is present, use `uv` for Python and `bun` for JavaScript/TypeScript.

See `docs/real-device-command-scripts.md` before adding or changing real-device command wrappers.

## Startup and script map

Developer-machine startup wrappers:

- `scripts/start-web-console.ps1` sets `PORT`, `SSH_HOST`, `SSH_USER`, `SSH_PASSWORD`, `WALNUT_REMOTE_PROJECT_ROOT`, and `WALNUT_REMOTE_BUILD_USER`, then runs `bun web-interface/model-terminal-server.js` on port 4173 by default.
- `scripts/start-ssh-terminal.ps1` starts the standalone browser SSH terminal on port 4174 by default.
- `scripts/sync-screen-via-web-api.ps1` reads `/api/screen/manifest` and posts `/api/screen/sync` with the current `manifestHash`; `-PreviewOnly` adds `?nossh` and must not reach build, SSH, delivery, activation, or device writes.
- `scripts/collect-screen-sync-evidence.ps1` gathers real-device state, frame, capture, build ownership, and optional Web sync evidence; with `-Sync` it temporarily starts the Web API and performs a sync.
- `scripts/save-screen-capture.ps1` saves a read-only `walnut screen capture --png-base64` result to a local PNG.
- `scripts/invoke-walnut-screen.ps1` is the Windows wrapper for allowed `walnut screen` actions.
- `scripts/build-lvgl-on-device.ps1` SSHes to the device and runs `./scripts/build-lvgl-app.sh` as the remote build user.

Device startup and installed public commands:

- `walnut` is the main Walnut Home launcher and should remain the primary user-facing entry.
- `walnut ai` and `walnut-ai` start the WalnutAI terminal.
- `walnut play` is the terminal toys entry; `walnut-fun` is only a compatibility launcher to `walnut play`.
- `walnut console` and `walnut-cn` start the Chinese framebuffer console path.
- `walnut voice` and `walnut-voice-cli` start the voice keyboard CLI.
- Preserve the full `walnut screen` command surface: `start`, `stop`, `toggle`, `state`, `frame`, `capture`, `status`, `test`, `demo`, `off`, `image`, `ai`, `app`, `lvgl`, `lvgl-demo`, and `restore`.
- Do not add new top-level launchers under `/usr/local/bin` when an existing `walnut` subcommand fits.

Build, install, and generation scripts:

- `scripts/build-lvgl-app.sh` fetches LVGL if needed, generates config, and builds `walnut-lvgl-screen` and `walnut-lvgl-preview`.
- `scripts/fetch-lvgl.sh` fetches LVGL into `third_party/lvgl`.
- `scripts/generate-lvgl-screen-config.js` is the canonical Screen Manifest to LVGL config generator.
- `scripts/generate-lvgl-screen-config.py` is only a compatibility entrypoint that delegates to the JS generator.
- `scripts/screen-manifest-vocabulary.js` owns Screen Manifest validation, limits, colors, generated-page fields, and hash behavior.
- `scripts/install-walnut-screen.sh` installs `/usr/local/bin/walnut` and `walnut-screen.service`, after building the LVGL app.
- `scripts/install-walnut-ai.sh` installs `/opt/walnut-ai`, project skills/corpus, `/usr/local/bin/walnut`, `walnut-ai`, memory distillation, and ASCII video launchers.
- `scripts/install-terminal-toys.sh` installs terminal toy packages and the compatibility `walnut-fun` launcher.
- `scripts/install-framebuffer-status.sh` installs `walnut-framebuffer-status.service`.
- `scripts/install-voice-keyboard-walnutpi.sh` installs `/opt/walnut-voice-keyboard`, `voice-keyboard-walnutpi.service`, and `walnut-voice-cli`.
- `scripts/install-lvgl-build-deps.sh` installs Debian/Ubuntu LVGL build dependencies.

Treat install scripts, service changes, boot enablement, and new `/usr/local/bin` commands as system-write operations that require explicit user confirmation.

## Current screen sync contract

- Web reads `GET /api/screen/manifest`.
- Browser renders the preview from that manifest.
- Sync uses `POST /api/screen/sync`.
- The request must include the current `manifestHash`; missing, invalid, or stale hashes must be rejected before any build or SSH action.
- Build uses `scripts/build-lvgl-app.sh`.
- Remote build root is explicit: `WALNUT_REMOTE_PROJECT_ROOT`, falling back to `WALNUT_PROJECT_ROOT`, then `/home/pi/projects/WalnutPi`.
- Activation currently uses `sudo -n systemctl restart walnut-screen.service` because that path has passed real-device verification.
- Treat `sudo -n walnut screen start` as the user-facing CLI entry, not the Web delivery adapter command, unless the adapter is deliberately changed and reverified on-device.
- Evidence uses `walnut screen state` and `sudo -n walnut screen frame`.
- Diagnostics-only screenshots use `walnut screen capture`, a read-only PNG capture command that returns metadata by default and optional `pngBase64` only for the on-demand frame route.
- Artifact evidence must be a real SHA-256 hash, and the delivery manifest/hash must commit to that artifact hash.

Beginner UI should show only understandable states such as `未同步`, `同步中`, `已同步到核桃派`, and `同步失败`. Keep `buildId`, hashes, delivery manifests, command output, raw device evidence, `frameUrl`, and image bytes in developer diagnostics.

## Safety boundaries

- Preserve existing `walnut screen` CLI behavior.
- Do not expose public root shells or add unauthenticated high-risk write operations.
- High-risk actions such as system writes, service replacement, reboot, shutdown, GPIO output, eMMC writes, image flashing, or firmware delivery require explicit user confirmation and clear impact text.
- `?nossh` mode is preview-only. It must not connect to WalnutPi or trigger build, SSH, delivery, activation, or device writes.

## Third-party project boundaries

- `third/VibeBoard` is a product-architecture reference only. Reuse ideas such as artifact manifests, delivery adapters, build evidence, and device evidence. Do not copy its React app, ESP-IDF assumptions, OTA/flash flows, board profiles, or services into WalnutPi.
- `third/walnutpi` is a WalnutPi experience reference only. Reuse ideas such as device presence, rich terminal evidence, memory, and WalnutPi-specific skills. Do not wholesale replace the current project with it.

## Compatibility rules

- Preserve current Screen Manifest schema and hash semantics unless deliberately changing the sync contract.
- Preserve positional and CLI compatibility for public WalnutPi commands.
- Do not add compatibility shims, legacy fallbacks, or temporary workaround scripts unless explicitly requested.
- Do not add tests, fixtures, snapshots, or broad refactors unless the user asks for them.

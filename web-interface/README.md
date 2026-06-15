# WalnutPi Web Interface

`web-interface/` is the browser-facing entry for WalnutPi's AI-native terminal system.

The current core experience is: the user describes what they want, the Web conversation turns that requirement into a playful 480x320 WalnutPi screen, the browser previews the LVGL result, and an explicit sync sends the same interface to the device.

The Web conversation and the CLI tool layer do not conflict. The conversation is the beginner-facing orchestration surface. The `walnut` CLI, screen commands, terminal tools, media conversion utilities, and device checks are controlled capabilities the Web surface can call, summarize, or expose as evidence.

## Interaction Principle

The Web page should feel like one intent-driven surface:

```text
user says what they want
-> WalnutPi classifies the intent
-> screen requests become bounded 480x320 Screen Manifests
-> image, text, or video material can be searched/summarized/ASCII-converted/pixelized
-> local tools run only through controlled routes
-> risky actions ask for confirmation
-> the browser previews the screen and summarizes evidence
```

The screen-generation path is the primary product loop. The right-side terminal, SSH fallback, and diagnostic panels are supporting surfaces for advanced use and proof, not separate products.

Normal users should not be pushed into `walnut` menus or `1 / 2 / 3` terminal choices. Those menus remain valid CLI affordances, but the Web console should call the underlying direct actions when it needs device state, media conversion, or sync evidence.

## Request Types

### Normal Q&A

Questions that do not need local state can go straight to the cloud AI.

Example:

```text
解释一下 I2C 是什么
```

### Screen Creation

Requests to make, design, generate, or sync a screen should go through the Screen Manifest pipeline.

Examples:

```text
做一个粉色猫猫 IP 眨眼像素动画
把上海天气做成核桃派小屏
做一个音乐频谱像素屏
把这个视频感画面转成适合 480x320 的小屏
同步到核桃派
```

The result must be a validated `walnutpi.screen.v1` manifest. Media search, public image material, text extraction, video-to-ASCII ideas, and pixel-art generation are allowed inputs to the manifest, but they do not bypass validation or become arbitrary shell/LVGL/C code.

### Local Executable Q&A

Questions that need real-time or device-local state should run locally first.

Examples:

```text
核桃派现在还好吗
帮我看一下网络
今天记了什么
我想接一个 I2C 传感器
```

The agent should run controlled local checks such as `walnut status`, network checks, notes lookup, `gpio pins`, `/boot/config.txt` reads, and screen evidence commands, then summarize for a beginner. When the answer is useful as a screen, the same result can be turned into a 480x320 preview and synced after confirmation.

## Conversation Storage

The browser keeps a `walnut-web-session-id` in local storage. The server stores the canonical append-only event log under:

```text
web-interface/data/sessions/<sessionId>.jsonl
```

Override the directory with `WALNUT_WEB_SESSIONS_DIR`. Events include user messages, assistant messages, and structured action evidence. This full log is the source for later background memory distillation; `~/walnut-memory/memory.json` is the compact memory derived from stored conversations, not a replacement for them.

Distill compact memory from stored sessions with:

```bash
python ../walnut-ai-terminal/memory_distiller.py --dry-run
python ../walnut-ai-terminal/memory_distiller.py
```

The distiller reads user-authored events only, merges durable non-secret facts into `~/walnut-memory/memory.json`, and leaves the JSONL session logs as the canonical conversation history. `web-interface/data/` is ignored by Git so local conversations are not committed by accident.

Current APIs:

```text
GET  /api/session?sessionId=...
POST /api/session?sessionId=...
```

### Risky Actions

Actions with side effects require confirmation before execution.

Examples:

```text
打开某个 GPIO 输出
启用 SPI overlay
安装软件包
重启
关机
删除文件
刷写系统
```

For these, the agent should explain what will change, what can break, and ask for explicit confirmation.

## UX Direction

The first screen should have:

- one conversational input
- a concise chat history
- a live 480x320 LVGL screen preview
- explicit sync status
- developer diagnostics and terminal evidence available without taking over the beginner flow

Avoid making the left side a list of permanent feature buttons. Beginner users should not need to decide whether their request is “status”, “snapshot”, “GPIO”, “network”, or “AI”. The agent should infer that.

## Screen Sync Slice

The first LVGL delivery slice keeps the beginner-facing flow simple:

```text
Web preview
-> Sync to WalnutPi
-> Build LVGL app
-> Activate walnut-screen.service
-> Read screen state, framebuffer frame evidence, and structural visual evidence
```

The web server exposes the current screen contract at `GET /api/screen/manifest`.
The browser renders its preview from that manifest, and `POST /api/screen/sync` refuses to run when the browser sends a missing, malformed, or stale manifest hash.
The default contract is `../lvgl_app/screen-manifest.json`; set `WALNUT_SCREEN_MANIFEST_PATH` to validate another manifest without changing the server code.

The first delivery adapter is deliberately narrow:

- adapter: SSH / local agent
- build: `scripts/build-lvgl-app.sh`
- activation: `sudo -n systemctl restart walnut-screen.service`; this is the current real-device verified delivery-adapter path, while `walnut screen start` remains the user-facing CLI entry
- evidence: `walnut screen state` and `sudo -n walnut screen frame`
- diagnostics image: `GET /api/screen/frame/<buildId>` calls read-only `walnut screen capture --png-base64` on demand; dynamic LVGL frames are allowed, and response headers include both current and sync-time raw frame hashes
- diagnostics diff: opening developer diagnostics renders a fixed 480x320 snapshot of the actual Web preview DOM, compares it with the loaded device PNG, and reports `walnutpi.webDevicePixelDiff.v2`; this is diagnostic-only, appears in sync history as a small diff badge, and is not LVGL headless rendering
- sync history: `GET /api/screen/records` and `GET /api/screen/records/<buildId>` read local developer diagnostics records; cached `frame.png` is served from `GET /api/screen/records/<buildId>/frame.png` without reconnecting to the device
- repair candidate: `POST /api/screen/repair-candidate` reads a stored local sync record and returns a structured `repairCandidate`; it does not run SSH, build, activation, capture, file writes, or automatic retry
- repair proposal: `POST /api/screen/repair-proposal` reads a stored local sync record and returns a confirmation-gated local patch proposal; `POST /api/screen/repair-apply` requires the exact confirmation phrase, writes only the local manifest patch, then the Web UI reloads `/api/screen/manifest` for review and still never auto-syncs
- pixel diff record: `POST /api/screen/pixel-diff` stores the browser-computed `walnutpi.webDevicePixelDiff.v2` object into a local sync record when its manifest hash matches the record. The object stores dimensions, compared pixel count, mismatch ratio, threshold, source, and limitations; it does not connect to WalnutPi, capture a frame, or change sync status. Existing `v1` records remain readable.

Beginner UI only shows `未同步`, `同步中`, `已同步到核桃派`, or `同步失败`.
`buildId`, screen manifest hash, artifact hash, delivery hash, command output, screen-state evidence, framebuffer frame hashes, metadata-only pixel evidence, diagnostic Web/device pixel diff, `visualMatch` / `visualChecks`, history, repair hints, repair candidates, repair proposals, and device screenshots stay in the developer diagnostics panel. The default sync JSON does not embed PNG bytes or `pngBase64`.

The screen manifest is a generic small-screen program model: `pages` contains 1-6 custom pages, and every page must declare explicit `components`. The supported component vocabulary is `statusCard`, `metricGroup`, `list`, `progress`, `alert`, `textPage`, `layout`, `pixelArt`, and compatibility-only `generatedPage`. These are content and drawing components only; the manifest cannot request shell commands, SSH, sudo, build behavior, delivery behavior, GPIO output, reboots, flashing, or arbitrary LVGL/C code.

The screen intent route can use an OpenAI-compatible `/responses` endpoint, when local `.env` config provides `WALNUT_AI_API_KEY`, `WALNUT_AI_BASE_URL`, and `WALNUT_AI_MODEL`, to generate a controlled manifest patch from natural language. The model output is not trusted: the server strips it down to the allowed mutable fields, requires ASCII device text until CJK font support lands, applies the fixed `target` / `source` contract, and runs the shared manifest vocabulary validator before writing. If AI generation is unavailable or invalid, the route falls back to the local rule-based screen-plan generator. That fallback derives a prompt-specific `pixelArt` animation for custom IP/mascot/LED-style requests, or a prompt-specific `layout` canvas for time, weather, audio, status, and other function screens; it no longer reuses fixed generated content pages. It still does not accept natural-language edits for `schema`, `target`, `source`, build, SSH, sudo, delivery, or device commands.

Sync records are saved under `web-interface/screen-sync-records/` by default and are ignored by Git. Each record includes `record.json` and `summary.json`; opening the on-demand device frame caches `frame.png` into the same record. `WALNUT_SCREEN_RECORD_LIMIT` controls retention, defaulting to 50 records, and `WALNUT_SCREEN_RECORDS_DIR` can point records outside the repo.

Focused API safety regression:

```powershell
pwsh ../scripts/test-screen-api-safety.ps1
```

The script starts a temporary local server with a copied manifest and temporary records directory. It verifies malformed/missing/stale `manifestHash` rejection, `?nossh` blocking for sync/terminal/action/capture, repair confirmation rejection, and summary fields for artifact, delivery, frame, pixel evidence, and pixel diff. It does not connect to WalnutPi.

Current verification status:

- `?nossh` is preview-only. Server routes reject remote actions and terminal connections before SSH/build/device-write paths. Screen sync records a local preview rejection for diagnostics, but still does not connect to WalnutPi or trigger build, delivery, activation, or device writes.
- Activation is gated on a real artifact SHA-256 hash.
- The delivery manifest/hash commits to the artifact hash and screen manifest hash.
- A real-device sync run has completed through build, activation, and `walnut screen state`; evidence reported `walnut-screen.service active`. The current sync path also requires `sudo -n walnut screen frame` to return valid framebuffer metadata and a raw frame SHA-256 hash. The optional frame image route captures PNG evidence only when a developer opens diagnostics.

Remote checkout note: Web sync sends an explicit remote project root. `WALNUT_REMOTE_PROJECT_ROOT` defaults to `/home/pi/projects/WalnutPi`, so the current root/root SSH setup does not accidentally resolve the checkout as `/root/projects/WalnutPi`. Override `WALNUT_REMOTE_PROJECT_ROOT` if the device checkout moves.
Build ownership note: Web sync may SSH as root for device control, but LVGL build and artifact hash run as `WALNUT_REMOTE_BUILD_USER`, defaulting to `pi`, so `build/lvgl_app` stays writable for normal project work.

### Real-Device Verification Notes

The first real-device verification hit two environment issues before the loop passed:

1. Default `root@192.168.1.24` login resolved the remote project root as `/root/projects/WalnutPi`, but the checkout was actually at `/home/pi/projects/WalnutPi`. The sync failed at build stage with:

   ```text
   sh: 1: cd: can't cd to /root/projects/WalnutPi
   ```

2. Before the server sent an explicit remote project root, setting `WALNUT_PROJECT_ROOT` on the local Bun process did not make the remote SSH shell see that variable. Running the sync as `pi@192.168.1.24` reached the correct checkout, but CMake failed because previous builds had left root-owned files under `build/`:

   ```text
   Permission denied
   /home/pi/projects/WalnutPi/build/lvgl_app/lvgl/lvgl.pc.tmp
   /home/pi/projects/WalnutPi/build/lvgl_app/lvgl/lv_version.h.tmp
   /home/pi/projects/WalnutPi/build/lvgl_app/CMakeCache.txt
   ```

   The scoped repair was:

   ```bash
   sudo chown -R pi:pi /home/pi/projects/WalnutPi/build
   ```

After that repair, running the Web server with the correct remote project root completed the sync. The successful evidence was:

```text
== Screen ==
walnut-screen.service              active
walnut-framebuffer-status.service  inactive
vtcon1 bind                        0
```

Suggested placeholder:

```text
你想让核桃派做什么？
```

Suggested examples can be shown as conversation starters, but they should behave like sample prompts, not tool buttons.

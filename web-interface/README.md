# WalnutPi Web Interface

`web-interface/` is the browser-facing home for the Walnut Agent Console.

The current implemented screen slice is the Screen Workspace UI: the user prepares Screen Content or a Source Asset, turns it into a playful 480x320 WalnutPi screen, previews the result, and explicitly syncs it to the WalnutPi Device for Real-Device Verification.

The Walnut Agent Console and the Device Execution Surface do not conflict. The Console is the beginner-facing orchestration surface. `walnut` commands, screen commands, terminal tools, media conversion utilities, and device checks are controlled capabilities the Console can call, summarize, or expose as evidence.

Local Action metadata comes from the repository-level Action Policy Manifest:

```text
action-policy-manifest.json
```

`GET /api/actions` exposes the Web-allowed subset of that manifest. `POST /api/action` executes only those policy-backed Agent Action Commands; terminal menus and arbitrary shell snippets are not action policy entries.

## Interaction Principle

The Walnut Agent Console should feel like one intent-driven surface:

```text
user says what they want
-> WalnutPi chooses an Intent Route
-> screen requests become bounded 480x320 Screen Manifests
-> image, text, or video material can be searched/summarized/ASCII-converted/pixelized
-> Local Actions run only through Local Action Policy
-> risky actions ask for confirmation
-> Screen Preview helps inspect the result
-> Real-Device Verification proves the device result after explicit Sync
```

The screen-generation path is the primary implemented loop. The current `/workspace.html` page is a Screen Workspace UI slice, not the complete Walnut Agent Console. The right-side terminal, SSH fallback, and diagnostic panels are supporting surfaces for advanced use and proof, not separate products.

Normal users should not be pushed into `walnut` menus or `1 / 2 / 3` terminal choices. Those menus remain valid Human CLI Command affordances, but the Walnut Agent Console should call policy-backed Agent Action Commands when it needs device state, media conversion, or sync evidence.

## Server Boundaries

The Bun server is still one process, but the implementation is split by WalnutPi domain boundary:

```text
model-terminal-server.ts        route assembly and shared process wiring
agent-actions-api.ts            Agent Action API and policy-backed execution
action-policy.ts                Action Policy Manifest validation
project-memory-api.ts           Session Log, Durable Memory, and Retrieval Corpus views
screen-diagnostics-api.ts       Sync Record, frame capture, and pixel-diff diagnostics
screen-workspace-api.ts         Screen Workspace import/process/LVGL preview routes
screen-workspace-store.ts       Screen Workspace manifest/playlist store
screen-workspace-sync-workflow.ts  playlist hash gate and sync orchestration
screen-delivery-adapters/       Device Transport implementations
static-ui-host.ts               static Walnut Agent Console / Workspace hosting
```

## Request Types

### Normal Q&A

Questions that do not need local state can go straight to the cloud AI.

Example:

```text
解释一下 I2C 是什么
```

### Screen Creation

Requests to process, preview, playlist, or sync a screen should go through the Screen Workspace pipeline.

Examples:

```text
做一个粉色猫猫 IP 眨眼像素动画
把上海天气做成核桃派小屏
做一个音乐频谱像素屏
把这个视频感画面转成适合 480x320 的小屏
同步到核桃派
```

The result must be a validated `walnutpi.screen-manifest.v2` output referenced by a `walnutpi.screen-playlist.v1` playlist. Source media may be searched, uploaded, or generated, but sync only consumes local 480x320 output artifacts and never regenerates missing files.

Current material flow:

```text
find or generate a PNG/JPEG/GIF/WebP/MP4/WebM/MOV asset
-> import a direct media URL or choose a project-local file in /workspace.html
-> store it under screen/sources/<source-id>/
-> process it with fit-cover, fit-contain, 120x80@4x, or 240x160@2x
-> write Screen Manifest v2 and Screen Playlist v1
-> preview and explicitly sync the playlist to WalnutPi
```

Search sites such as itch.io, OpenGameArt, Lospec, GIPHY, Tenor, or Pinterest are discovery sources, not runtime dependencies. Pick a specific media file or download it into the project first; LVGL sync only receives the generated local Screen Workspace artifacts.

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
GET  /api/actions
POST /api/action
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
- concise recent Session Log context
- a live 480x320 LVGL screen preview
- explicit sync status
- developer diagnostics and terminal evidence available without taking over the beginner flow

Avoid making the left side a list of permanent feature buttons. Beginner users should not need to decide whether their request is “status”, “snapshot”, “GPIO”, “network”, or “AI”. The agent should infer that.

## Screen Workspace Sync Slice

The LVGL delivery slice is v2-only:

```text
Screen Workspace preview
-> Screen Playlist v1
-> Sync to WalnutPi with playlistHash
-> Sync runtime resources without rebuilding when the hot-reload runtime is present
-> Hot reload walnut-screen.service runtime resources
-> Fast evidence: playlist hash, artifact hash, and service-active state
-> Full diagnostics, when requested: screen state and framebuffer frame evidence
```

The web server exposes the current playlist at `GET /api/screen/workspace/playlist`.
`POST /api/screen/workspace/sync` refuses to run when the browser sends a missing, malformed, or stale `playlistHash`.
`GET /api/screen/manifest` and `POST /api/screen/sync` have been removed; callers should receive 404.

The first delivery adapter is deliberately narrow:

- adapter: SSH / local agent
- build: `scripts/build-lvgl-app.sh`
- LVGL runtime asset generator: `scripts/generate-lvgl-screen-workspace-runtime-assets.ts`
- activation: hot reload for runtime-capable binaries; `sudo -n systemctl restart walnut-screen.service` remains the upgrade fallback; `walnut screen start` remains the user-facing CLI entry
- evidence: default fast sync verifies the runtime playlist and `walnut-screen.service` active state without reading the full framebuffer; `evidenceMode: "full"` also runs `walnut screen state` and `sudo -n walnut screen frame`
- diagnostics image: `GET /api/screen/frame/<buildId>` calls read-only `walnut screen capture --png-base64` on demand
- sync history: `GET /api/screen/records` and `GET /api/screen/records/<buildId>` read local developer diagnostics records; cached `frame.png` is served from `GET /api/screen/records/<buildId>/frame.png` without reconnecting to the device
- pixel diff record: `POST /api/screen/pixel-diff` stores the browser-computed `walnutpi.webDevicePixelDiff.v2` object into a local sync record. It does not connect to WalnutPi, capture a frame, or change sync status.

Beginner UI only shows `未同步`, `同步中`, `已同步到核桃派`, or `同步失败`.
`buildId`, playlist hash, manifest hash, artifact hash, delivery hash, command output, screen-state evidence, framebuffer frame hashes, metadata-only pixel evidence, diagnostic Web/device pixel diff, `visualMatch` / `visualChecks`, history, repair hints, and device screenshots stay in the developer diagnostics panel. The default sync JSON does not embed PNG bytes or `pngBase64`.

Sync records are saved under `web-interface/screen-sync-records/` by default and are ignored by Git. Each record includes `record.json` and `summary.json`; opening the on-demand device frame caches `frame.png` into the same record. `WALNUT_SCREEN_RECORD_LIMIT` controls retention, defaulting to 50 records, and `WALNUT_SCREEN_RECORDS_DIR` can point records outside the repo.


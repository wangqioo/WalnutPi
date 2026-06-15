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

## Screen Workspace Sync Slice

The LVGL delivery slice is v2-only:

```text
Screen Workspace preview
-> Screen Playlist v1
-> Sync to WalnutPi with playlistHash
-> Build LVGL playlist resources
-> Activate walnut-screen.service
-> Read screen state, framebuffer frame evidence, and playlist evidence
```

The web server exposes the current playlist at `GET /api/screen/workspace/playlist`.
`POST /api/screen/workspace/sync` refuses to run when the browser sends a missing, malformed, or stale `playlistHash`.
`GET /api/screen/manifest` and `POST /api/screen/sync` have been removed; callers should receive 404.

The first delivery adapter is deliberately narrow:

- adapter: SSH / local agent
- build: `scripts/build-lvgl-app.sh`
- LVGL resource generator: `scripts/generate-lvgl-screen-workspace-config.js`
- activation: `sudo -n systemctl restart walnut-screen.service`; `walnut screen start` remains the user-facing CLI entry
- evidence: `walnut screen state` and `sudo -n walnut screen frame`
- diagnostics image: `GET /api/screen/frame/<buildId>` calls read-only `walnut screen capture --png-base64` on demand
- sync history: `GET /api/screen/records` and `GET /api/screen/records/<buildId>` read local developer diagnostics records; cached `frame.png` is served from `GET /api/screen/records/<buildId>/frame.png` without reconnecting to the device
- pixel diff record: `POST /api/screen/pixel-diff` stores the browser-computed `walnutpi.webDevicePixelDiff.v2` object into a local sync record. It does not connect to WalnutPi, capture a frame, or change sync status.

Beginner UI only shows `未同步`, `同步中`, `已同步到核桃派`, or `同步失败`.
`buildId`, playlist hash, manifest hash, artifact hash, delivery hash, command output, screen-state evidence, framebuffer frame hashes, metadata-only pixel evidence, diagnostic Web/device pixel diff, `visualMatch` / `visualChecks`, history, repair hints, and device screenshots stay in the developer diagnostics panel. The default sync JSON does not embed PNG bytes or `pngBase64`.

Sync records are saved under `web-interface/screen-sync-records/` by default and are ignored by Git. Each record includes `record.json` and `summary.json`; opening the on-demand device frame caches `frame.png` into the same record. `WALNUT_SCREEN_RECORD_LIMIT` controls retention, defaulting to 50 records, and `WALNUT_SCREEN_RECORDS_DIR` can point records outside the repo.


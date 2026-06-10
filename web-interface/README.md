# WalnutPi Web Agent Console

`web-interface/` is the browser-facing control surface for WalnutPi.

The product goal is beginner-first operation. The user should not need to know Linux commands, `walnut` subcommands, GPIO tools, or weather APIs. They should type natural language into one input, and WalnutPi should decide what local work is needed.

## Interaction Principle

The left side is not a shortcut-button panel.

The left side is the WalnutPi agent:

```text
user says what they want
-> WalnutPi classifies the intent
-> WalnutPi builds a local execution plan
-> WalnutPi checks risk
-> WalnutPi executes safe actions or asks for confirmation
-> WalnutPi summarizes the result
```

The right side is the execution scene:

- 3D device presence
- terminal output
- live SSH fallback for advanced use
- visible trace of what the device did

Normal users should not be pushed into `walnut` menus or `1 / 2 / 3` terminal choices. Those menus can remain as CLI affordances, but the web console should call the underlying direct actions.

## Request Types

### Normal Q&A

Questions that do not need local state can go straight to the cloud AI.

Example:

```text
解释一下 I2C 是什么
```

### Local Executable Q&A

Questions that need real-time or device-local state should run locally first.

Examples:

```text
上海天气怎么样
核桃派现在还好吗
帮我看一下网络
今天记了什么
我想接一个 I2C 传感器
```

The agent should run controlled local checks such as weather lookup, `walnut status`, network checks, notes lookup, `gpio pins`, `set-device status`, and `/boot/config.txt` reads, then summarize for a beginner.

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
- visible execution status
- right-side terminal / 3D device view

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
- activation: `sudo -n walnut screen start`
- evidence: `walnut screen state` and `sudo -n walnut screen frame`
- diagnostics image: `GET /api/screen/frame/<buildId>` calls read-only `walnut screen capture --png-base64` on demand; dynamic LVGL frames are allowed, and response headers include both current and sync-time raw frame hashes
- sync history: `GET /api/screen/records` and `GET /api/screen/records/<buildId>` read local developer diagnostics records; cached `frame.png` is served from `GET /api/screen/records/<buildId>/frame.png` without reconnecting to the device
- repair candidate: `POST /api/screen/repair-candidate` reads a stored local sync record and returns a structured `repairCandidate`; it does not run SSH, build, activation, capture, file writes, or automatic retry
- AI summary: `POST /api/screen/ai-summary` reads a stored local sync record and returns an evidence-limited Chinese summary. It uses a local deterministic fallback by default and can call an OpenAI-compatible `/responses` endpoint when `OPENAI_API_KEY` is configured; it does not run SSH, build, activation, capture, file writes, or automatic retry

Beginner UI only shows `未同步`, `同步中`, `已同步到核桃派`, or `同步失败`.
`buildId`, screen manifest hash, artifact hash, delivery hash, command output, screen-state evidence, framebuffer frame hashes, `visualMatch` / `visualChecks`, history, repair hints, repair candidates, AI-summary evidence, and device screenshots stay in the developer diagnostics panel. The default sync JSON does not embed PNG bytes or `pngBase64`.

Sync records are saved under `web-interface/screen-sync-records/` by default and are ignored by Git. Each record includes `record.json` and `summary.json`; opening the on-demand device frame caches `frame.png` into the same record. `WALNUT_SCREEN_RECORD_LIMIT` controls retention, defaulting to 50 records, and `WALNUT_SCREEN_RECORDS_DIR` can point records outside the repo.

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

# WalnutPi Product Capability Benchmark V1 Results

Run date: 2026-06-21

Scope: executed six product-loop benchmarks with parallel agents. This was not a code review and did not change product code. Local benchmark artifacts and evidence were written under `screen/`, `web-interface/data/`, and `web-interface/screen-sync-records/`.

## Summary

| ID | Benchmark | Result | Score |
|---|---|---:|---:|
| V1-01 | Weather to 480x320 preview, no sync | partial | 16/18 |
| V1-02 | External starry GIF to animated wallpaper preview | pass | 17/18 |
| V1-03 | Camera photo to pixel-style preview | pass | 18/18 |
| V1-04 | I2C sensor check and wiring explanation | partial | 13/18 |
| V1-05 | CLI demo to screen animation | pass | 17/18 |
| V1-06 | Sync current preview and verify real device | partial | 15/18 |

Total: 3 pass, 3 partial, 0 fail. Aggregate score: 96/108.

## Per-Benchmark Results

### V1-01 Weather To Screen Preview

- Input: `联网查上海天气，做成 480x320 小屏预览，不同步真机`
- Route / plan: `/api/intent/classify` returned `screen.wallpaper` / `screen.generate`, `delivery: none`.
- Product steps: started local Web API, classified intent, called `/api/screen/workspace/generate`, recovered from two product-loop failures by normalizing the prompt, then called `/api/screen/workspace/lvgl-preview`.
- Artifacts:
  - `screen/manifests/benchmark-v1-01-shanghai-weather-recovered.json`
  - `screen/playlists/benchmark-v1-01.json`
  - `screen/outputs/benchmark-v1-01-shanghai-weather-recovered/output.png`
  - `screen/sources/benchmark-v1-01-shanghai-weather-recovered-source/source.json`
- Evidence:
  - `screen/benchmark-evidence/V1-01-20260621-134219/benchmark-run-summary.json`
  - `screen/benchmark-evidence/V1-01-20260621-134219/wttr-shanghai-j1.raw.json`
  - `screen/benchmark-evidence/V1-01-20260621-134219/lvgl-preview-city-normalized.response.json`
- Triggered real device / writes / peripherals: no real-device sync, SSH delivery, service restart, frame, or capture. Wrote local `screen/` artifacts and evidence. Used network access to `wttr.in`.
- Scores: goal_understanding 2, capability_selection 2, loop_completeness 1, artifact_validity 2, visual_alignment 2, evidence_quality 2, safety_boundary 2, user_summary 2, failure_recovery 1.
- Result: partial.
- Reason: final weather card exists and safety boundary held, but the original prompt failed without manual normalization due to Chinese title/schema handling and city extraction as `联网查上海`.

### V1-02 External GIF Dynamic Wallpaper Preview

- Input: `找一个唯美星空 GIF，做成动态壁纸预览`
- Route / plan: `screen.wallpaper` / `generate`, `delivery: none`, `intent: screen.generate`.
- Product steps: classified intent, searched Wikimedia Commons GIF candidates, selected `StarfieldSimulation001.gif`, imported it as a Source Asset, processed it with `/api/screen/workspace/process`, wrote a dedicated Playlist v1, and generated local preview/runtime assets.
- Artifacts:
  - `screen/sources/v1-02-starry-gif-source/source.json`
  - `screen/manifests/v1-02-starry-gif-wallpaper.json`
  - `screen/outputs/v1-02-starry-gif-wallpaper/output.json`
  - `screen/outputs/v1-02-starry-gif-wallpaper/frames/frame-000.png`
  - `screen/playlists/v1-02-starry-gif-playlist.json`
- Evidence:
  - `screen/evidence/benchmark-v1-02-20260621-134547/intent-classify.json`
  - `screen/evidence/benchmark-v1-02-20260621-134547/candidate-source-assets.json`
  - `screen/evidence/benchmark-v1-02-20260621-134547/workspace-import.json`
  - `screen/evidence/benchmark-v1-02-20260621-134547/workspace-process-dedicated-playlist.json`
  - `screen/evidence/benchmark-v1-02-20260621-134547/artifact-validation-dedicated.json`
- Triggered real device / writes / peripherals: no sync, SSH delivery, service restart, frame/capture, real-device access, or peripheral access. Wrote local `screen/` workspace and evidence assets only. Source license was recorded as `unknown-license`.
- Scores: goal_understanding 2, capability_selection 2, loop_completeness 2, artifact_validity 2, visual_alignment 1, evidence_quality 2, safety_boundary 2, user_summary 2, failure_recovery 2.
- Result: pass.
- Reason: full preview-only Source Asset to Animated Screen Output loop completed. Visual result is starfield-like but more screensaver than "唯美", so visual alignment is 1.

### V1-03 Camera Photo Pixel Preview

- Input: `用摄像头拍一张照片，做成像素风小屏预览`
- Route / plan: `/api/intent/classify` returned `screen.wallpaper`, `action: generate`, `intent: screen.generate`, `delivery: none`, `riskHint: none`, `confidence: 0.96`.
- Product steps: probed local camera devices, found `HP HD Camera`, captured one frame with ffmpeg, processed it with `bun scripts/process-screen-workspace-source.js`, validated manifest/playlist/output, and visually inspected the local output PNG.
- Artifacts:
  - `screen/benchmarks/v1-03/camera-capture.jpg`
  - `screen/sources/benchmark-v1-03-camera-source/source.json`
  - `screen/sources/benchmark-v1-03-camera-source/original.jpg`
  - `screen/outputs/benchmark-v1-03-camera-pixel/output.png`
  - `screen/manifests/benchmark-v1-03-camera-pixel.json`
  - `screen/playlists/benchmark-v1-03.json`
- Evidence:
  - `screen/benchmarks/v1-03/intent-route.json`
  - `screen/benchmarks/v1-03/camera-probe-dshow.log.txt`
  - `screen/benchmarks/v1-03/camera-probe-pnp.json`
  - `screen/benchmarks/v1-03/camera-capture.log.txt`
  - `screen/benchmarks/v1-03/playlist-envelope.json`
- Triggered real device / writes / peripherals: no real-device access, sync, SSH delivery, service restart, frame, or capture. Wrote local `screen/` artifacts and evidence. Used local `HP HD Camera` for a single-frame capture.
- Scores: goal_understanding 2, capability_selection 2, loop_completeness 2, artifact_validity 2, visual_alignment 2, evidence_quality 2, safety_boundary 2, user_summary 2, failure_recovery 2.
- Result: pass.
- Reason: real camera capture became a Source Asset and produced valid pixel-style 480x320 Screen Workspace artifacts with no real-device side effect.

### V1-04 I2C Sensor Check And Wiring Summary

- Input: `检查 I2C 传感器是否在线，并解释接线`
- Route / plan: `/api/intent/classify` returned `device.action` / `read`, `intent: device.gpio.read`; plan ran policy-backed `gpio` and `snapshot` read actions.
- Product steps: checked Web action surface, classified intent, queried retrieval context for I2C, ran `/api/agent/turn` with `walnut action run gpio --json`, ran `snapshot`, then attempted a direct read-only SSH probe for `i2cdetect` and `/dev/i2c-*`, which failed with `Permission denied (publickey,password)`.
- Artifacts:
  - Hardware summary in `web-interface/data/benchmark-evidence/V1-04.md`
- Evidence:
  - `web-interface/data/benchmark-evidence/V1-04.md`
  - `web-interface/data/agent-turns.jsonl`
  - `web-interface/data/agent-turn-events.jsonl`
  - `web-interface/data/sessions/benchmark-v1-04-20260621-134328.jsonl`
- Triggered real device / writes / peripherals: yes, read-only real-device checks through `gpio` and `snapshot` over `ssh2`. No system writes, GPIO output writes, overlay changes, package install, reboot, or peripheral writes. `i2cdetect` did not run.
- Scores: goal_understanding 2, capability_selection 1, loop_completeness 1, artifact_validity 2, visual_alignment 2, evidence_quality 1, safety_boundary 2, user_summary 1, failure_recovery 1.
- Result: partial.
- Reason: safe read-only hardware diagnostic path worked and showed `i2c1`/`i2c2` overlays enabled, but no I2C address scan evidence exists, so the product cannot honestly confirm a sensor is online.

### V1-05 CLI Demo To Screen Animation

- Input: `运行一个好玩的 CLI demo，把效果做成小屏动画`
- Route / plan: `/api/intent/classify` returned `screen.wallpaper` / `generate`, `delivery: none`; plan was safe local CLI demo -> terminal capture -> video Source Asset -> animated Screen Workspace processing.
- Product steps: classified intent, ran a fixed local `bun` demo, generated ANSI/text output and 24 PNG frames, encoded frames to `terminal-demo-source.mp4`, processed it with `scripts/process-screen-workspace-source.js --type animated`, validated manifest/playlist/hash, and generated a local `preview.gif`.
- Artifacts:
  - `screen/sources/benchmark-v1-05-cli-demo-source/source.json`
  - `screen/outputs/benchmark-v1-05-cli-demo/output.json`
  - `screen/outputs/benchmark-v1-05-cli-demo/frames/frame-000.png` through `frame-023.png`
  - `screen/manifests/benchmark-v1-05-cli-demo.json`
  - `screen/playlists/default.json`
- Evidence:
  - `screen/benchmark-evidence/V1-05-20260621-134417/intent-classify.response.json`
  - `screen/benchmark-evidence/V1-05-20260621-134417/terminal-demo-provenance.json`
  - `screen/benchmark-evidence/V1-05-20260621-134417/terminal-demo-output.ansi.txt`
  - `screen/benchmark-evidence/V1-05-20260621-134417/terminal-demo-output.clean.txt`
  - `screen/benchmark-evidence/V1-05-20260621-134417/process-result.json`
  - `screen/benchmark-evidence/V1-05-20260621-134417/validation-result.json`
  - `screen/benchmark-evidence/V1-05-20260621-134417/preview.gif`
- Triggered real device / writes / peripherals: no real-device access, SSH delivery, sync, service restart, frame/capture, or peripheral access. Wrote local Screen Workspace and runtime/preview files only.
- Scores: goal_understanding 2, capability_selection 2, loop_completeness 2, artifact_validity 2, visual_alignment 2, evidence_quality 2, safety_boundary 2, user_summary 2, failure_recovery 1.
- Result: pass.
- Reason: terminal demo was not treated as success by itself; it became a valid 480x320 animated Screen Workspace artifact. Failure recovery scored 1 because no real failure branch was exercised.

### V1-06 Sync Current Preview And Verify Device

- Input: `把当前预览同步到核桃派，并确认真机显示正确`
- Route / plan: explicit Playlist Sync -> read current playlist/hash -> generate runtime assets -> deliver via SSH/local agent -> activate/hot reload -> collect service state and frame/capture evidence -> compare device frame with expected playlist frame.
- Product steps: read current playlist hash `3ddcb91bd2e78cd444733d7a1c9e4b7a0ff1bb175f3d2fca18a64fc8880419bb`, ran `scripts/collect-screen-sync-evidence.ps1 -Sync`, generated runtime assets, delivered them to `/home/pi/projects/WalnutPi`, verified remote runtime playlist hash, collected `walnut screen state`, `sudo -n walnut screen frame`, and `walnut screen capture`, then failed visual verification.
- Artifacts:
  - `screen/runtime/default.txt`
  - `screen/runtime/frames/frame-000.rgb565` through `frame-003.rgb565`
  - `web-interface/screen-sync-records/screen-20260621054219-cb38a61d/record.json`
  - `web-interface/screen-sync-records/screen-20260621054219-cb38a61d/summary.json`
- Evidence:
  - `web-interface/screen-sync-records/benchmark-evidence/V1-06-20260621-134157.txt`
  - `web-interface/screen-sync-records/benchmark-evidence/V1-06-20260621-134157-device-frame.png`
  - sync record above
- Triggered real device / writes / peripherals: yes. This was the only benchmark allowed to sync. It used SSH/device transport, runtime asset delivery, remote runtime validation, hot-reload wait, and framebuffer/capture reads.
- Scores: goal_understanding 2, capability_selection 2, loop_completeness 1, artifact_validity 2, visual_alignment 0, evidence_quality 2, safety_boundary 2, user_summary 2, failure_recovery 2.
- Result: partial.
- Reason: sync loop used the current playlist hash and preserved strong evidence, but real-device verification failed: `walnut-screen.service` was inactive and the framebuffer hash `2fce3cfe...` did not match expected RGB565 hash `6a120cb1...`.

## Largest Failure Points

1. Real-device verification is not reaching a correct displayed state. V1-06 delivered assets and collected evidence, but service state was inactive and frame hash mismatched.
2. I2C product action lacks address-scan evidence. V1-04 can prove overlays/bus context through safe read actions, but cannot prove a sensor is online.
3. Weather generation still needs input normalization. V1-01 only succeeded after manually avoiding the Chinese title/schema issue and city extraction bug.
4. Preview benchmarks contend on shared `screen/playlists/default.json` and runtime assets. V1-02 worked around this with a dedicated playlist, but V1-05 updated the shared default playlist.

## Minimal Fix Suggestions

1. Fix sync activation/status first: make the sync workflow fail or repair clearly when `walnut-screen.service` is inactive after delivery, then re-run frame hash verification.
2. Add one policy-backed read-only I2C scan action that returns `/dev/i2c-*` and `i2cdetect`-style address evidence without allowing overlay writes.
3. Normalize weather prompts before fetch: strip action words such as `联网查`, preserve Chinese titles safely, and keep the raw user input in provenance.
4. Give benchmark/preview runs a dedicated playlist/runtime namespace, or lock writes to `default.json` during parallel product loops.

## Repair Pass

Repair date: 2026-06-21

The follow-up repair pass used three parallel workers and focused only on score-moving product-loop gaps from V1-01, V1-04, and V1-06.

### Fixes Applied

- V1-01 weather generation:
  - `web-interface/screen-workspace-api.js` now preserves Unicode text in compact display fields.
  - Weather city extraction strips intent words such as `联网`, `查`, `查询`, `做成`, and extracts `上海` from the original benchmark input.
  - Added `web-interface/screen-workspace-api.self-check.js`.
- V1-04 I2C diagnostic:
  - Added policy-backed read action `i2c_scan` in `action-policy-manifest.json`.
  - Added `walnut action run i2c_scan --json` support in `walnut-assistant/walnut`.
  - WalnutAI routes I2C/sensor/i2cdetect prompts to `i2c_scan`.
  - Each bus scan has a 4s timeout and keeps partial evidence instead of hanging the whole action.
  - Added `web-interface/action-policy.self-check.js`.
- V1-06 sync activation:
  - Full and fast sync now use the same activation check.
  - If `walnut-screen.service` is inactive, sync attempts the existing restart fallback and records the activation output.
  - Evidence fails at `activate` when screen state reports a non-active service instead of mislabeling that as a visual mismatch.
  - Added `web-interface/screen-sync-evidence.self-check.js`.

### Repair Verification

- `bun web-interface/screen-workspace-api.self-check.js`: passed.
- `bun web-interface/action-policy.self-check.js`: passed.
- `bun web-interface/screen-sync-evidence.self-check.js`: passed.
- `python -m py_compile walnut-assistant/walnut walnut-ai-terminal/walnut_ai.py`: passed.
- `POST /api/intent/classify` with V1-01 original input: routed to `screen.wallpaper`, `screen.generate`, `delivery: none`.
- `POST /api/screen/workspace/generate` with V1-01 original input: generated `benchmark-v1-01-postfix`, location `上海`, output PNG, manifest, playlist, and facts from `wttr.in`.
- `POST /api/screen/workspace/lvgl-preview`: succeeded for playlist hash `c038c56a058cdacc57578473f599dcd184278e9f4cdac8a1b743eeae2aa032b9`.
- `POST /api/action` with `i2c_scan`: returned real-device read evidence, `/dev/i2c-1` through `/dev/i2c-5`, address tables, `UU` on bus 3, address `0x30` on bus 4, and a bounded timeout note for bus 5.
- `POST /api/screen/workspace/sync` with current playlist hash: delivered assets, restart fallback changed `walnut-screen.service` from inactive to active, but frame hash still mismatched the expected RGB565 hash.

### Score Movement

| ID | Before | After | Movement |
|---|---:|---:|---:|
| V1-01 | 16/18 partial | 18/18 pass | +2 |
| V1-04 | 13/18 partial | 17/18 pass | +4 |
| V1-06 | 15/18 partial | 15/18 partial | +0 |

Updated conservative total: 102/108.

V1-06 did improve operationally: activation fallback now starts the service and records the stage correctly. It remains 15/18 because the product goal is real-device visual correctness, and framebuffer RGB565 still does not match the synced preview.

## Loop Shape

Do not build a large harness yet. The smallest useful product loop artifact is one append-only turn record:

```text
agentTurn.v1
-> input
-> route
-> plan
-> steps[]
-> artifacts[]
-> evidence[]
-> sideEffects[]
-> forbiddenActions[]
-> scores
-> recovery
```

Each step should record only:

- `stage`: understand, acquire, process, preview, sync, verify, recover.
- `action`: API/action/CLI used, not arbitrary shell text from the user.
- `ok`: boolean.
- `artifactRefs`: manifest, playlist, output, runtime, or none.
- `evidenceRefs`: source data, command output, frame evidence, or failure note.
- `sideEffect`: none, local-write, peripheral-read, device-read, device-write.

That is enough to score the current benchmark without inventing a runner. The next useful increment is a tiny table-driven runner that drives existing HTTP APIs and emits this record; it should not own processing logic.

Remaining product-loop work:

1. Fix real framebuffer content mismatch after sync. Activation is now active; the next failure is display content, not service state.
2. Namespace preview/runtime assets for concurrent benchmark agents. Shared `screen/playlists/default.json` remains the biggest source of parallel-test noise.
3. Add a product-level summary formatter for I2C scan output so users see bus/address interpretation instead of raw address tables only.

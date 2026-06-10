# Screen Manifest Editor Design

## Goal

Move the current fixed LVGL demo into a beginner-first screen customization slice:

```text
Choose a small-screen template or describe a small change
-> Web preview updates from the screen manifest
-> User syncs to WalnutPi
-> WalnutPi LVGL runtime shows the same manifest-backed content
-> Developer diagnostics retain hashes, delivery manifest, build output, and frame evidence
```

This is not a general IDE, Monaco editor, arbitrary C generator, or full LVGL design tool.

## Scope

This slice adds a small manifest editing surface and keeps the existing screen sync safety model.

In scope:

- Three beginner-facing screen templates.
- A one-sentence update box that maps constrained natural language to safe manifest fields.
- A backend API that validates and writes `lvgl_app/screen-manifest.json`.
- Build-time generation of `lvgl_app/generated/screen_config.h` from the manifest.
- A small LVGL runtime change so the device uses generated manifest values for visible text.
- Existing `POST /api/screen/sync` manifest-hash enforcement, artifact evidence, delivery manifest, and framebuffer evidence remain intact.

Out of scope:

- Free-form C or LVGL code generation.
- Monaco or a full project editor.
- Headless LVGL preview.
- Pixel-level Web-vs-framebuffer diff.
- New delivery adapters beyond the existing SSH/local-agent path.
- High-risk device writes beyond the current low-risk screen build and activation path.

## User Experience

The left-side Web agent remains the main entry. The small screen section gains:

- A compact template selector with three choices:
  - Device status.
  - AI task board.
  - Network panel.
- A single text input for simple changes such as:
  - "标题改成 早安核桃派"
  - "状态写 正在同步"
  - "显示 IP 内存 磁盘"
  - "做一个网络小屏"
- The existing preview, sync state, sync button, and developer diagnostics remain in place.

After a template or sentence update succeeds, the Web preview refreshes and the sync button uses the new `manifestHash`.

Beginner-facing messages stay simple:

```text
已更新预览
无法理解这次修改
同步中
已同步到核桃派
同步失败
```

Hashes, generated files, command output, and screen evidence stay in developer diagnostics.

## Data Model

The existing `walnutpi.screen.v1` manifest remains the source of truth.

Allowed mutable fields for this slice:

- `title`
- `subtitle`
- `pages[0].status`
- `pages[0].metrics`
- `pages[*].tab`
- `pages[*].title`
- `pages[*].lines`

Immutable fields:

- `schema`
- `target`
- `source`
- LVGL entry path
- activation command
- display path

Validation rules:

- Width must remain `480`.
- Height must remain `320`.
- Color must remain `RGB565`.
- Page count is exactly four for the first slice, matching the current LVGL runtime.
- Each text field is length-limited before writing.
- Metrics are limited to three items.
- Page lines are limited to four items each.
- Control characters are rejected.

## Backend API

Add screen-design APIs to `web-interface/model-terminal-server.js`:

```text
GET  /api/screen/templates
POST /api/screen/template
POST /api/screen/intent
```

`GET /api/screen/templates` returns a small list of template metadata and preview manifests.

`POST /api/screen/template` accepts:

```json
{
  "templateId": "device-status",
  "manifestHash": "current hash"
}
```

It rejects missing, invalid, or stale hashes before writing. On success it writes the selected template as the current manifest and returns the new manifest envelope.

`POST /api/screen/intent` accepts:

```json
{
  "text": "标题改成 早安核桃派",
  "manifestHash": "current hash"
}
```

It uses a deterministic local parser, not cloud AI, for the first version. It updates only allowed fields and returns a clear failure when it cannot map the sentence safely.

## Manifest-To-LVGL Generation

Add a Node script:

```text
scripts/generate-lvgl-screen-config.js
```

It reads `lvgl_app/screen-manifest.json`, validates the same screen contract, and writes:

```text
lvgl_app/generated/screen_config.h
```

The generated header contains escaped C string constants for:

- Screen title and subtitle.
- Four tab labels.
- Home status text.
- Three home metrics.
- Three non-home page titles.
- Up to four lines per non-home page.

The build script runs generation before CMake:

```text
scripts/build-lvgl-app.sh
-> node scripts/generate-lvgl-screen-config.js
-> cmake configure/build
```

This keeps the delivery artifact hash tied to the manifest-backed visible content.

## LVGL Runtime

`lvgl_app/src/main.c` includes `lvgl_app/generated/screen_config.h`.

The current hardcoded visible labels change to generated constants:

- Header title and subtitle.
- Tab labels.
- Home core text.
- Initial metric labels.
- Default System, AI, and Network page text.

Live values such as memory, disk, IP, uptime, and FRP can continue updating where the current runtime already does that. The generated manifest text provides labels and safe defaults; runtime telemetry still comes from the device.

## Safety

The editor cannot change commands, paths, display device, build script, service names, SSH destination, or delivery risk.

All write APIs require the current `manifestHash`. A stale page cannot overwrite a newer manifest.

`?nossh` mode still must not connect to the device or start sync. Manifest editing is a local repo write, not a device write; it can be allowed in normal local mode. If `?nossh` is used for pure preview demos, template and intent updates may update the local manifest but must not trigger build, delivery, activation, terminal, or frame capture.

## Error Handling

Common failures:

- Stale manifest hash: return `409` with beginner text telling the user to refresh preview.
- Invalid template ID: return `400`.
- Unrecognized sentence: return `400` with "无法理解这次修改".
- Manifest validation failure: return `500` only when the repo manifest is already invalid or disk write fails.
- Generation failure: fail the build before CMake and show the generator error in existing sync diagnostics.

## Success Criteria

- A user can select one of three templates, see the Web preview update, and sync it with the latest hash.
- A user can type a simple sentence to change title, subtitle, status, metrics, or page lines, see the Web preview update, and sync it with the latest hash.
- Stale manifest edits are rejected before writing.
- Sync still rejects missing, malformed, or stale `manifestHash` before build or SSH action.
- LVGL visible text is sourced from the generated header, not duplicated manually in Web-only code.
- Existing `walnut screen start`, `stop`, `toggle`, `state`, `lvgl`, `frame`, and `capture` behavior remains compatible.

## Verification

Focused checks:

```text
node --check web-interface/model-terminal-server.js
node --check scripts/generate-lvgl-screen-config.js
bash scripts/build-lvgl-app.sh
```

When Python tests are present in the checkout, run the existing screen tests:

```text
python -m unittest tests.test_walnut_screen tests.test_screen_app
```

For device verification, reuse:

```text
pwsh ./scripts/collect-screen-sync-evidence.ps1 -Sync -Port 4183
```

## Tradeoffs

This design deliberately favors constrained manifest editing over arbitrary generation. It gives users a visible customization loop now while preserving the existing manifest hash, artifact hash, delivery manifest, and device evidence boundaries.

The cost is that first-version natural language support is narrow. That is acceptable because the next step can expand the parser or add cloud-assisted manifest proposals without granting AI permission to edit build scripts, systemd units, or arbitrary LVGL C.

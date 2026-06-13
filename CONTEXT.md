# WalnutPi Context

## Product Direction

WalnutPi is a beginner-first workspace for a headless Debian Linux device with:

- natural language or guided intent
- Web preview of a small LVGL screen
- explicit sync to WalnutPi
- the WalnutPi screen showing the same manifest-driven interface
- Web status, execution evidence, and AI-readable summaries

WalnutPi is not a generic IDE, desktop app, ESP32 platform, or arbitrary LVGL/C editor.

## Canonical Terms

### Control Plane API

The local Web/API control surface used by Browser and Agent flows. For the screen slice, this means routes such as `GET /api/screen/manifest`, `POST /api/screen/sync`, sync records, repair proposals, AI summaries, and frame diagnostics. It owns manifest hash gating, `?nossh` blocking, build/delivery orchestration, safety policy, and evidence persistence. Agents should use this API instead of directly SSHing, building, writing `/dev/fb0`, or running device commands for screen sync.

### Device Execution Surface

The WalnutPi-side execution and evidence contract. Today this is the stable `walnut screen ...` CLI: `start`, `state`, `frame`, and `capture`, plus the LVGL fbdev runtime it activates. The device surface runs and proves the screen result; it does not own manifest generation, Web preview, hash gating, repair policy, or AI decision-making.

### Screen Manifest

The bounded JSON contract for the small WalnutPi screen. It is fixed to `walnutpi.screen.v1`, a 480x320 RGB565 `/dev/fb0` LVGL target, and `lvgl_app/src/main.c`. Its product surface is a generic small-screen program: 1-6 custom pages, each made from explicit page-level components. It is not a fixed product-page layout.

### Screen Manifest Vocabulary

The beginner-safe content vocabulary inside the Screen Manifest. Supported page-level components are `statusCard`, `metricGroup`, `list`, `progress`, `alert`, and `textPage`. Component values are content only; they cannot request shell commands, SSH behavior, build changes, delivery behavior, GPIO output, reboots, flashing, or arbitrary LVGL/C code.

### Screen Sync Workflow

The in-process workflow that turns a current Screen Manifest plus a client `manifestHash` into a record-ready sync result. It owns manifest hash gating, build ID generation, delivery adapter invocation, frame-ticket registration, failure stage mapping, and beginner-facing sync summaries.

### Delivery Adapter

The concrete adapter that performs device delivery for Screen Sync. The current adapter is SSH/local-agent delivery. It owns file transfer, remote build, activation, and device evidence collection, but not HTTP routing or sync record persistence.

### Screen Evidence Ledger

The durable local record interface for Screen Sync evidence. It owns `record.json`, `summary.json`, history-list projections, cached frame PNG metadata, record updates, and retention.

### Walnut Actions

The structured local execution seam exposed through `walnut action run ... --json`. It is the likely future seam for shared Web agent and WalnutAI action semantics, but high-risk confirmation policy needs separate alignment before making it the only agent action interface.

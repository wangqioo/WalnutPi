# WalnutPi Successful Code Corpus

This file is the first lightweight corpus for patterns that already worked in this project. WalnutAI retrieves it before giving code or workflow advice.

## Screen Workspace Sync Slice

Use the Screen Workspace flow for the small screen:

```text
Screen Manifest v2 outputs under screen/
-> Screen Playlist v1
-> POST /api/screen/workspace/sync with current playlistHash
-> sync `screen/runtime/default.txt` and RGB565 frame files
-> hot reload `walnut-screen.service` when supported
-> scripts/build-lvgl-app.sh only when the LVGL runtime must be upgraded
-> sudo -n systemctl restart walnut-screen.service as the upgrade fallback
-> walnut screen state
-> sudo -n walnut screen frame
-> diagnostics-only walnut screen capture
```

Stable files:

- `screen/playlists/default.json`
- `screen/manifests/*.json`
- `screen/outputs/*`
- `screen/runtime/default.txt`
- `screen/runtime/frames/*.rgb565`
- `scripts/screen-workspace-vocabulary.js`
- `scripts/generate-lvgl-screen-workspace-runtime-assets.js`
- `lvgl_app/src/main.c`
- `scripts/build-lvgl-app.sh`
- `web-interface/model-terminal-server.js`
- `web-interface/screen-delivery-adapters/ssh-local-agent.js`

Stable commands that must keep working:

```bash
walnut screen lvgl
walnut screen start
walnut screen stop
walnut screen toggle
walnut screen state
walnut screen frame
walnut screen capture
walnut screen capture --png-base64
```

## Local Action JSON Pattern

Web-friendly local actions should use:

```bash
walnut action run status --json
walnut action run network --json
walnut action run gpio --json
walnut action run snapshot --json
```

The JSON result shape is:

```json
{
  "ok": true,
  "id": "status",
  "title": "查状态",
  "risk": "read",
  "mode": "read",
  "code": 0,
  "output": "human-readable evidence"
}
```

Only read actions may run directly. High-risk actions must be prepared and confirmed:

```bash
walnut action prepare reboot --json
```

Confirmed execution is intentionally disabled in the first local-action slice.

## Memory And Retrieval Pattern

Long-term memory belongs in:

```text
~/walnut-memory/memory.json
```

The repo seed memory at `walnut-ai-terminal/memory/default-memory.json` is only a non-secret project seed. Do not store API keys, Wi-Fi passwords, SSH passwords, tokens, private keys, or full logs.

WalnutAI should retrieve from:

- `walnut-ai-terminal/skills/walnutpi-core.md`
- `walnut-ai-terminal/skills/walnutpi-screen.md`
- `walnut-ai-terminal/skills/*/SKILL.md`
- `walnut-ai-terminal/corpus/*.md`

Before generating code for GPIO, I2C, SPI, UART, LVGL, framebuffer, PyQt5, OpenCV, Home Assistant, MQTT, image flashing, package installation, service edits, or reboot/shutdown, check the relevant skill and safety boundary.

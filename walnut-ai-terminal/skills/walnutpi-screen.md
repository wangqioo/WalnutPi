# WalnutPi Screen Context

The current screen path is a narrow LVGL fbdev workflow for a 480x320 WalnutPi framebuffer.

Known screen facts:

- Display target: `/dev/fb0`
- Size: 480x320
- Color: RGB565
- LVGL runtime: fbdev
- Main playlist: `screen/playlists/default.json`
- Generated config: `lvgl_app/generated/screen_workspace_config.h`
- Build helper: `scripts/build-lvgl-app.sh`
- Activation: `sudo -n walnut screen start`

Stable `walnut screen` commands that must not be broken:

- `walnut screen lvgl`
- `walnut screen start`
- `walnut screen stop`
- `walnut screen toggle`
- `walnut screen state`

Read-only evidence commands:

- `walnut screen state`
- `sudo -n walnut screen frame`
- `walnut screen capture`
- `walnut screen capture --png-base64`

Web sync contract:

- Browser reads `GET /api/screen/workspace/playlist`.
- Browser syncs with `POST /api/screen/workspace/sync`.
- Sync request must include the current `playlistHash`.
- Missing, invalid, or stale hashes are rejected before build, SSH, delivery, activation, or device writes.
- Remote project root is explicit: `WALNUT_REMOTE_PROJECT_ROOT`, then `WALNUT_PROJECT_ROOT`, then `/home/pi/projects/WalnutPi`.
- Web sync may SSH as root, but LVGL build should run as `WALNUT_REMOTE_BUILD_USER=pi` so build files stay writable by normal project work.

Evidence interpretation:

- `visualMatch=captured` means framebuffer metadata and structural checks passed.
- It does not mean Web preview pixels have been diffed against LVGL pixels.
- Pixel evidence is diagnostic unless a route explicitly says it performed a Web/LVGL pixel diff.
- AI summaries must be based only on stored sync evidence.

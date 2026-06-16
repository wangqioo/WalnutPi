# WalnutPi Screen Workspace Sync Successes

This file is auto-appended by the Web screen sync flow. It stores compact successful Screen Workspace patterns only, not command logs or image bytes.

Current reusable pattern:

```text
GET /api/screen/workspace/playlist
-> POST /api/screen/workspace/sync with current playlistHash
-> sync screen/runtime/default.txt and RGB565 frame files
-> hot reload walnut-screen.service when supported
-> build the LVGL runtime only when it must be upgraded
-> restart walnut-screen.service as the upgrade fallback
-> use Real-Device Verification for delivery, service state, frame evidence, or capture evidence
```

Only `playlistHash` gates sync. Item `manifestHash` values may appear inside Developer Diagnostics because Screen Playlist v1 references Screen Manifest v2 items, but they are not the sync request gate.


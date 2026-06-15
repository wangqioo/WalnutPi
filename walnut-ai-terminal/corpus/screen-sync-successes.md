# WalnutPi Screen Workspace Sync Successes

This file is auto-appended by the Web screen sync flow. It stores compact successful Screen Workspace patterns only, not command logs or image bytes.

Current reusable pattern:

```text
GET /api/screen/workspace/playlist
-> POST /api/screen/workspace/sync with current playlistHash
-> scripts/build-lvgl-app.sh
-> sudo -n systemctl restart walnut-screen.service
-> walnut screen state
-> sudo -n walnut screen frame
```

Only `playlistHash` gates sync. Item `manifestHash` values may appear inside evidence because Screen Playlist v1 references Screen Manifest v2 items, but they are not the sync request gate.

## screen-20260615163428-7a0a06d7

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-15T16:36:14.779Z
- playlistHash: 8f8518911bcd3b2d13dee99f17a6727284d7032a9bdd129c2aa8cf838fc27481
- activeManifestHash: 7b69db54bde8e8f2ae0b25986c296cc743a3c07a5b014af237b7b985d2a7e551
- artifactHash: 8133c5032f43799fddb2dd0ffb44334a48b24e7201568180b556ae37af9991c5
- deliveryHash: 21e9376ac623e62b46fdf144eded787902105a1d9ff88313941dc8cd49ebeee0
- visualMatch: captured
- frameHash: 03f6f111fad6af7a4b01824227d458d000ad5a1b172c9d880452b1f2c4582f02
- previewSignatureHash: d4bccce7c2f9197d36e92c9fccbd5d0c194ac7c4367572c0d94f175b87ab28a5
- deviceSignatureHash: 3e407a7d96a374ca19f533b052a66b2b6c5361dc87b64e3a3eddd9dc348e86cf
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: workspace-output static
- summary: 已同步 Screen Workspace 播放列表到核桃派。设备运行产物绑定当前 playlist hash。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.


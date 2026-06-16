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

## screen-20260615172201-1bc45e65

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-15T17:27:41.069Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: f266898ccf00f6ba6db45be5af09ac86e80eddc5965be31f832e4914a7522a81
- deliveryHash: e1ef00b183d9c9e85a24320b5c0504af50a79346ef525065216473ede097bc93
- visualMatch: captured
- frameHash: 3684d5b1eeb6e4eca9dba6ea71e3bbcf0226f23d1a9c4e3c6fa4ddf12ab8dec0
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 95f0acad2e84f74a06c137e8135994f2370bceb29b440a34704e6ca5b2535984
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已同步 Screen Workspace 播放列表到核桃派。设备运行产物绑定当前 playlist hash。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260615174231-4cd2c239

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-15T17:44:16.607Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: a70d011d40f2b9817ed0daebfab81c41e5900a33cd5ead0e6f6bae05d315934b
- deliveryHash: 59b1d138eacd4b2fac4ebca4374e7cd3df24680c97b13670b85cc0f9eea55c87
- visualMatch: captured
- frameHash: 7a7e672e89d8ee007594e830717139226e080a8f96d43924d38320d3436e86c8
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 1239eb15eea8171f58199296186012c783eefdc6309934fc9a6277355e95e014
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已升级 runtime-capable LVGL 并同步 Screen Workspace 资源到核桃派。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260615174429-9e4053b7

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-15T17:45:22.781Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: a70d011d40f2b9817ed0daebfab81c41e5900a33cd5ead0e6f6bae05d315934b
- deliveryHash: 8dc0ba53495c34fe67b1192578e7dfa6c1bb5204e8c868ab54475d7b7d481109
- visualMatch: captured
- frameHash: 7a7e672e89d8ee007594e830717139226e080a8f96d43924d38320d3436e86c8
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 1239eb15eea8171f58199296186012c783eefdc6309934fc9a6277355e95e014
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260615174826-269fc28d

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-15T17:48:58.377Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: a70d011d40f2b9817ed0daebfab81c41e5900a33cd5ead0e6f6bae05d315934b
- deliveryHash: 628fa38bdfe493c0a8f52eeec5ccee1dd9ff6fabed1710d21892911597780b07
- visualMatch: captured
- frameHash: f21088511ac3229cbe2fc783778de198e15d11abc500039d326bd66bc4260d25
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 307cc1187a70ca0067db63ece54fcb39aa7f88ddddf31e24fe7bc630cce4b50c
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260615174953-f824a891

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-15T17:50:24.074Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: a70d011d40f2b9817ed0daebfab81c41e5900a33cd5ead0e6f6bae05d315934b
- deliveryHash: 392d1aff7bff3275a9372d9318a32a7e5f1cf25b539c330b5807a68e153aa602
- visualMatch: captured
- frameHash: 7a7e672e89d8ee007594e830717139226e080a8f96d43924d38320d3436e86c8
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 1239eb15eea8171f58199296186012c783eefdc6309934fc9a6277355e95e014
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260615175455-33a19117

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-15T17:55:16.399Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: a70d011d40f2b9817ed0daebfab81c41e5900a33cd5ead0e6f6bae05d315934b
- deliveryHash: e22bc3978ec5de04ca00d801db32c8b711c945dafb121ec5887776d205903372
- visualMatch: captured
- frameHash: f3a12855c9e938c8a3ca3d56ab294359a3ad2a4ebc8d310d6ffb97d54dcfe5bd
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: c95e4c4e88576592cf8b3f83da50836635d5740b79660b8fb38dc577f018609f
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260616031901-9d676363

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T03:19:24.964Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: a70d011d40f2b9817ed0daebfab81c41e5900a33cd5ead0e6f6bae05d315934b
- deliveryHash: 5ccaf31aedded974bebf097d0713f1d1fcf6b165977fc7ea78c4eb65ae92d84c
- visualMatch: captured
- frameHash: bc50624e36e080476c39a7e8c5b334ce4fc5b667f7524db0e6d2bc93a8b5ba6a
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 8781adac84432036e4d3bf40b11537964e2ecc13fceb67037a08c47c45f3b73b
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260616033101-6dfb39e9

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T03:32:47.349Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 0f941aada111c64ee407cdc529b739571bbe99230fcdf33665937f6714a2f85b
- visualMatch: captured
- frameHash: d2531678fb8c8ec4ff43519dbec74ce57b9e76e355d6e905bb1c10a129f5cba3
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 67e4b32addc32f5b9a17eae8525aa416af5c793afda12093dedc4d6e94e1118f
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已升级 runtime-capable LVGL 并同步 Screen Workspace 资源到核桃派。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260616033307-ba9c9030

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T03:33:32.118Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 936e4a9cfcfb9f9a8a9448f2f049dcf80554a2a25dd63cc7bd07177394160cf0
- visualMatch: captured
- frameHash: d2531678fb8c8ec4ff43519dbec74ce57b9e76e355d6e905bb1c10a129f5cba3
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 67e4b32addc32f5b9a17eae8525aa416af5c793afda12093dedc4d6e94e1118f
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260616033712-7f9484e2

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T03:37:36.690Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 69b633d055ac06f110a1aa78d4d2dde3135a83737a9e8f466eb20eac7c21cec7
- visualMatch: captured
- frameHash: 21b798f16760db9f9a5d5ffb4c68cfe112f8bb2856e9d8ccf3fe5a8422d033a1
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 27b1dea1ba64de4d7a4a026827ce29641ef2b1e6586c9639ee1a5c4650fa282c
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260616034036-02ec2a69

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T03:40:58.142Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: f92dfac1a0648f12e693b19a749fd14fa49b7ed249c3752d63982cc5c2732ceb
- visualMatch: captured
- frameHash: 023676577dba468fc703016a93ea8090b193f4e2e55d02c9796898b2e61e1f87
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 0153a88d8d2cbf00147d81bf730d06b01f2720e3098b5b044a7a5a71277cb5a9
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260616034310-1214faf1

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T03:43:31.811Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 006d646ae82891c13856d3c5618428e613b3734364bdf412adde58ad084b539a
- visualMatch: captured
- frameHash: d28f0873d82b834d813f0762eb6019639ca6bc90f69c2339ff9e31cdf791cfd5
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 1d4eae09be6e57553c68ff7bbb44aaf1866f5d69fe1ce517b6a1d0ff3e2ec931
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.

## screen-20260616043313-4abca712

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T04:33:27.244Z
- playlistHash: c5813cb49dc28f2f31bb7435dc8f0b2d15612cd3fbed7ef4441c9f80a2b2da23
- activeManifestHash: 110047900435a3f083a970f21bf656666fbbacbf029dca2027753cc785e5c2ce
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: fc74b98d7917f2c8899d5833d18a8226d4b07762c0acb596ced84d2699c6289f
- visualMatch: captured
- frameHash: 4e71ee6dcca099df0be6e995dddff8f16288c71eda2b9b871fb19d9ae67f165a
- previewSignatureHash: 24e0221db739c2b40de19647836ec4faab939f6d0d0b3b67120bc6da4ad55c5d
- deviceSignatureHash: 404d851b9f1224bc0a024ff5b0f58a5c3d9149600a07d9e1ecff31ac2aba6a23
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: giphy-lens-flare animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, build with scripts/build-lvgl-app.sh, activate with sudo -n systemctl restart walnut-screen.service, verify with walnut screen state and sudo -n walnut screen frame.


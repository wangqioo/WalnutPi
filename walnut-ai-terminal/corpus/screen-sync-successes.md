# WalnutPi Screen Sync Successes

This file is auto-appended by the Web screen sync flow. It stores compact successful patterns only, not command logs or image bytes.

## screen-20260611124330-973d015f

- kind: screen-sync-success
- finishedAt: 2026-06-11T12:44:58.669Z
- manifestHash: fc1821341680497f49704d6264f69de5f5c153295144513f0420e7496db38026
- artifactHash: 364bc7d1179e37a6082f141e225842f2ed81fbd2a8c7da52d34f44e067c29c70
- deliveryHash: 12ac32c9bbfbc3cf76fc18ffd551683f615f39c02148671e9f4329f3b86f9ca0
- visualMatch: captured
- frameHash: 38a0d8daeba24b0b7b4fc09db7ebe164237550068bdd3fd3dfdfb7bc3872a422
- previewSignatureHash: 4b0d7db4ccd75918d1c2f5ff9bf72b50ec93fe53fa7fb6c4dbaedbbe1bd80607
- deviceSignatureHash: cbc37f3134bcc84f1a9edc95dd7079b229b35d0053610473a2ca7df202f77c00
- checks: width= height= nonblank=true
- labels: none
- cards: none
- summary: 已同步到核桃派。Web 预览和设备运行使用同一个 screen manifest。

Reuse this pattern for manifest-driven LVGL screen sync: require current manifestHash, build with scripts/build-lvgl-app.sh, activate with sudo -n walnut screen start, verify with walnut screen state and sudo -n walnut screen frame.

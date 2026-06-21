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

## screen-20260616174604-be52bb37

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T17:46:10.712Z
- playlistHash: 8f8518911bcd3b2d13dee99f17a6727284d7032a9bdd129c2aa8cf838fc27481
- activeManifestHash: 7b69db54bde8e8f2ae0b25986c296cc743a3c07a5b014af237b7b985d2a7e551
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 79b1c1d9ebeff832b2430d9b24157b9b367629db290f7398490a15c131bf3c33
- visualMatch: playlist-committed
- frameHash:
- previewSignatureHash: d4bccce7c2f9197d36e92c9fccbd5d0c194ac7c4367572c0d94f175b87ab28a5
- deviceSignatureHash: 0d3b8ef7299624a3ea29fac6da8d3f1426244a0a2db53cdc5626b7fcc1c3cdae
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: workspace-output static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260616174841-5e705f36

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T17:48:46.173Z
- playlistHash: 8f8518911bcd3b2d13dee99f17a6727284d7032a9bdd129c2aa8cf838fc27481
- activeManifestHash: 7b69db54bde8e8f2ae0b25986c296cc743a3c07a5b014af237b7b985d2a7e551
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: e77258064c0dcd985b73db20580035ffc14bd9bcf64163ad36fe0e6706a5825a
- visualMatch: playlist-committed
- frameHash:
- previewSignatureHash: d4bccce7c2f9197d36e92c9fccbd5d0c194ac7c4367572c0d94f175b87ab28a5
- deviceSignatureHash: 0d3b8ef7299624a3ea29fac6da8d3f1426244a0a2db53cdc5626b7fcc1c3cdae
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: workspace-output static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260616175122-ac0d6a55

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-16T17:51:23.467Z
- playlistHash: 8f8518911bcd3b2d13dee99f17a6727284d7032a9bdd129c2aa8cf838fc27481
- activeManifestHash: 7b69db54bde8e8f2ae0b25986c296cc743a3c07a5b014af237b7b985d2a7e551
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 416d73e992c343497bfd292935f6b0e5e1cb1c05ff478244cc3de3201e220c15
- visualMatch: playlist-committed
- frameHash: 
- previewSignatureHash: d4bccce7c2f9197d36e92c9fccbd5d0c194ac7c4367572c0d94f175b87ab28a5
- deviceSignatureHash: 0d3b8ef7299624a3ea29fac6da8d3f1426244a0a2db53cdc5626b7fcc1c3cdae
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: workspace-output static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260617122300-402f9c92

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-17T12:23:07.999Z
- playlistHash: fb2faaf6b575676a078e52e16fbf91ea339f72ecd36f36c4c2b86f7d962566ef
- activeManifestHash: e43a826338e981fb7f93fe703994eb112d0e52c1a53a1aa3d03d8e5a6b8c55bd
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: fc235e608a987cbdd8b2c9b7241f676c210efe5168c150d028f98c57d22034fe
- visualMatch: playlist-committed
- frameHash: 
- previewSignatureHash: 09f068468e2dfe42e8af476615705d7a05afe6067549a15b9472e17fb2f4e0ab
- deviceSignatureHash: 46e1f589bdf5cef40b94be031d12c61e2fb7922a19657727fa02cff03b67eda2
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1781698942506 static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260617124553-ceefdad0

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-17T12:45:57.960Z
- playlistHash: 2d090b09f2d8642e19c3b487482a5f92a621d59467b2ff493cf102bd3e6b8971
- activeManifestHash: 35000b020ea53ca37d0074a4867e2066d838d050be31be784f19055c5980a6a9
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 7d7bc34dc5ae47b46cdfa0d720193760b6617fe957091af24d4bcfe8a50116fd
- visualMatch: playlist-committed
- frameHash: 
- previewSignatureHash: dd3ec603e8b76221d102231bbf25e44e33ada476e4164bb5ad220f5dce5810f9
- deviceSignatureHash: 2ec7f2ddf75af71608a0c7ed240c50ab52ba82e57276cb1515a0376dd4a5f9d3
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1781700329664 static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260617125706-5c9293dd

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-17T12:57:11.435Z
- playlistHash: 71139a9bb86dd727f2a835304e3516f2346fbf11731289023bb42c6654510723
- activeManifestHash: a7fb0165c2234c00a7c44bb7d920e8ad5998ee324d0c061c88e14aefe77a6ab3
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 0940eca1a19c8f7b8e7b2abcb69e0f5b07fa7963e1b540fdafd9a32866db0b16
- visualMatch: playlist-committed
- frameHash: 
- previewSignatureHash: f4c94d4054e3eeec17a38bae12752dd0ce8e7b857c461bf0ab41783794d15f80
- deviceSignatureHash: 058fd4a59efbcf6ee51aea0a85b76f911dbc69a9abf45591b23f1c133455ab59
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1781700983553 static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260617130412-6ee62462

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-17T13:04:16.883Z
- playlistHash: 0e573c1689dcb697a9beea8a64f4c213e2186760ccb95313aeabb77a0c544b1c
- activeManifestHash: 32281b76cf8f7fcaeca090bf190723bc293753b64450488f42b9914b4d2413cf
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: bd26f8f5bf96c1b46ab5620d24da5ee81f773ff5791eb5b802539984d9a449f8
- visualMatch: playlist-committed
- frameHash: 
- previewSignatureHash: fdd73a470de98981703f242437c6c5414d595165b18f2e0f9c52bb29b0abb61c
- deviceSignatureHash: 8eb1b4a791ffbfcfa0bde027a2b2cff91fd4a7539ea0e50527f7fbcb8ed1039a
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1781701357740 static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260617131506-5aee7359

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-17T13:15:11.244Z
- playlistHash: 643376fe266a9b0ee6eea7eab173318b85e4f467c518b752649954942d2fc2b3
- activeManifestHash: c095851f8c01d1dd8e6da18c8429224b22a6a2392896f717693703b5928d13e9
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: 142f46b0a26d3332466f343bbf5267d9a032249172614ea70a836450c43b4218
- visualMatch: playlist-committed
- frameHash: 
- previewSignatureHash: 17fe7544391d1851e8cab0e4c2d1959b4fa82f9ceb733ca13db9b7c1724debc9
- deviceSignatureHash: e336dd5a890cd6ffe5f2c3fd369d641b0d8259508f41202bdc7714da55e03c99
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1781702063115 static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260617132312-c7be7ccd

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-17T13:23:17.379Z
- playlistHash: bd6024a47bc63e7d7b55841539b98364f162781072c4284ed62d36d63a8f414a
- activeManifestHash: 88db1423310f686a32e5000385e3630ebfb1c2598bfa7385b83120de3ae893bf
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: b09ce710df844b505fe20dd32b75aa0ce8180afb805c6eb94fd69ee26d181a88
- visualMatch: playlist-committed
- frameHash: 
- previewSignatureHash: 88bc2e3e5bc0bd4ff6cdf0dd7e2d95ff67b83e0496944ace11363410da5b27af
- deviceSignatureHash: 8f5c48a7dfd96c2d196766f504dee6c0b7f1042baa2c39839e9411f32156468f
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1781702573796 static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260617153910-9ae987d0

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-17T15:39:16.938Z
- playlistHash: 47beec2790d6285d94d88b0c0d3059f58eead9980392d48c3aa89894776ae4ef
- activeManifestHash: 77571905a258ca44afb2b0db3b857a92ac496650f227c97d3279cd95930b3a18
- artifactHash: 666cd5716f391fc02470ee25ce57846d22f20831e3e9cb30344cbf1e6d5cd406
- deliveryHash: d65d6f807f1fda27aff1b1dea5516099a2f5484643c7d25110b3a3aa5a354cdc
- visualMatch: captured
- frameHash: aa22a0d79a216c6a36e8f9736e4d125421069167fb14a623922663b55fd44eaf
- previewSignatureHash: b1a1b2a7405ce778c4d2312cdaa1e0b6afb778916d16a601e8a9655362d5184e
- deviceSignatureHash: e62e6840517ba839400693c4e629b50eabf8686f8f6624910b3965f787a826aa
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: agent-freeform-1781710677214 static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL，并完成 framebuffer 回证。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260621063810-d21ad17d

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-21T06:38:13.108Z
- playlistHash: c038c56a058cdacc57578473f599dcd184278e9f4cdac8a1b743eeae2aa032b9
- activeManifestHash: 584ee44eb123e0006640c31092a792fa9f6ddf69e2e9bc1c44ea9662fe5d9013
- artifactHash: ffecee0ad3532d64914f807d2cb989de3f955317b3882a40be0b76018a1ecc14
- deliveryHash: c3f486ba7d2c350987c69f3a767d83a952f808e04590b09caae2393f45fee072
- visualMatch: captured
- frameHash: f809f0748d2f294cc0dd9e78d3ccd59e0c8b342bedfbd1b38057e3dd95d6d98f
- previewSignatureHash: 353b6624eb3b4b2e0771b29c26450983132744590c0e327e89041c518f7802d3
- deviceSignatureHash: 926eb605ac9b860d099f64f46d1cedf554099edd98f19a9080eeed9f032b8c79
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: benchmark-v1-01-postfix static
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL，并完成 framebuffer 回证。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260621130920-12e4aee7

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-21T13:09:26.699Z
- playlistHash: 77c0f33af83a9f7bbc7a8859ceddfa78a6c2ebb8889b474a3fb187355517586d
- activeManifestHash: aa78a20745e2776058b3a51f550df15af1dbdfe15131c96f03a85c7c823bb4be
- artifactHash: ffecee0ad3532d64914f807d2cb989de3f955317b3882a40be0b76018a1ecc14
- deliveryHash: fc4fad6f2e18a4aaceed61bae4f880660bf650c886fd379585726f31815818ae
- visualMatch: captured
- frameHash: 6a120cb116565033399fd622c6850b21c432d78daafcdfabfd2791db26e6a939
- previewSignatureHash: c11f256e8569a50f2e1870823a767ecf6ea865940959cacbf22a4a9bb7312a2c
- deviceSignatureHash: 4e28a128297d89153b50937a426a429dab673f5d75b2c7a6c2f59f383825203a
- checks: frameDimensionsMatched=true frameNonblank=true
- activeItem: agent-freeform-1782047223459 animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL，并完成 framebuffer 回证。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260621161230-43c64a1b

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-21T16:12:35.817Z
- playlistHash: 9fcb29cc93a92383dc92d36fa15fa9f1adba1e88cd101d01abd753daf6fb755f
- activeManifestHash: 373d4b1bca89a26824d6a648b45eb60d33471185c9214d84f1aa693c4777d0c6
- artifactHash: ffecee0ad3532d64914f807d2cb989de3f955317b3882a40be0b76018a1ecc14
- deliveryHash: 93cc45571f7000c37a82d367b4ad75570e33443a6fbe6df3fa57760506f486ef
- visualMatch: playlist-committed
- frameHash:
- previewSignatureHash: 94b8288bcb0022969f0bdc0dbf8b350b57a94a329acdf1b5114096f0d1f2eee4
- deviceSignatureHash: d6304d56d0759d5ea20349a33a01df616d9f63f5dd381c32d544beed4fa7dacd
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1782058296339 animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

## screen-20260621162051-c8836649

- kind: screen-workspace-sync-success
- finishedAt: 2026-06-21T16:20:56.532Z
- playlistHash: 9fcb29cc93a92383dc92d36fa15fa9f1adba1e88cd101d01abd753daf6fb755f
- activeManifestHash: 373d4b1bca89a26824d6a648b45eb60d33471185c9214d84f1aa693c4777d0c6
- artifactHash: ffecee0ad3532d64914f807d2cb989de3f955317b3882a40be0b76018a1ecc14
- deliveryHash: 5554d5e5ac7b6b784ad752e0efa676ef28e96e191718c5aca4ce7e768fe1d765
- visualMatch: playlist-committed
- frameHash:
- previewSignatureHash: 94b8288bcb0022969f0bdc0dbf8b350b57a94a329acdf1b5114096f0d1f2eee4
- deviceSignatureHash: d6304d56d0759d5ea20349a33a01df616d9f63f5dd381c32d544beed4fa7dacd
- checks: frameDimensionsMatched=false frameNonblank=false
- activeItem: agent-freeform-1782058296339 animated
- summary: 已把 Screen Workspace 资源同步到核桃派。未重新编译 LVGL。

Reuse this pattern for Screen Workspace playlist sync: require current playlistHash, prefer runtime resource sync with hot reload and fast service-active evidence; request evidenceMode=full only for diagnostic walnut screen state and sudo -n walnut screen frame verification.

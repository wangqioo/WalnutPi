# WalnutPi

WalnutPi is an AI-native terminal system for a headless Debian device with a 480x320 screen. This context defines the language for describing what appears on that screen and how the result is synchronized to the device.

## Language

**Screen Manifest**:
A contract for one or more final 480x320 WalnutPi screen images, including the source material, processing steps, and evidence needed to reproduce or verify the displayed result. The final screen image is authoritative; recipes, searches, and source references support that output.
_Avoid_: Screen config, LVGL config, component manifest, display spec, launch command

**Legacy Component Manifest**:
The existing `walnutpi.screen.v1` component-oriented manifest model. It is useful for understanding current implementation state, but it is not the target vocabulary for the new Screen Manifest model.
_Avoid_: Screen Manifest v2, Screen Output contract, playlist contract

**LVGL Screen App**:
The program that displays a Screen Manifest result on the real WalnutPi framebuffer. It renders the final screen output; it is not the Screen Manifest itself.
_Avoid_: Manifest, screen contract

**Screen Output**:
The local final 480x320 image artifact referenced by a Screen Manifest and identified by file and pixel SHA-256 hashes. Synchronization and device evidence should be tied to this artifact's pixel content rather than to live search results or remote source material.
_Avoid_: Remote image, search result, processing recipe

**Animated Screen Output**:
A local animation artifact whose frames are final 480x320 screen images with explicit timing. A GIF may be a Source Asset or derived export, but the canonical animation output is a 480x320 frame sequence plus timing; its overall hash is derived from each frame's pixel hash and duration.
_Avoid_: Source GIF, live animation recipe, single-frame hash

**Animation Budget**:
The default processing limit for Animated Screen Outputs. The first version should default to 10 fps, 8 seconds, and at most 80 final 480x320 frames, with larger outputs requiring an explicit advanced choice.
_Avoid_: Unlimited GIF import, video archive, unbounded frame dump

**Pixel Hash**:
A SHA-256 hash of normalized decoded 480x320 pixel content. RGBA pixel hashes support preview and processing checks, while RGB565 pixel hashes are authoritative for device framebuffer evidence; file hashes prove delivery integrity for specific encoded artifacts.
_Avoid_: File hash, manifest hash, source hash

**Source Asset**:
An original image, GIF, sprite sheet, frame sequence, palette, hand-authored pixel-art file, generated image, or programmatically generated visual used to create a Screen Output. Source Assets may have any dimensions; they must be processed into a final 480x320 Screen Output before Sync.
_Avoid_: Screen Output, framebuffer evidence, synced artifact

**Candidate Source Asset**:
A search result or discovered asset that may become a Source Asset after user selection. Candidate Source Assets are not automatically downloaded, processed, synced, or treated as part of the current screen contract.
_Avoid_: Source Asset, Screen Output, selected asset

**Sync**:
The explicit operation that delivers the current local Screen Output to the real WalnutPi and collects device evidence. Sync uses local artifacts and hashes; it does not re-fetch source material, depend on live search results, or regenerate missing outputs. Missing artifacts or hash mismatches fail Sync and must be fixed through the processing pipeline.
_Avoid_: Regeneration, remote search, live download

**Playlist Sync**:
The default Sync mode that delivers the current Screen Playlist and every referenced Screen Manifest output needed for playback. A single-output test can still sync one manifest directly, but normal user-facing sync targets the current playlist.
_Avoid_: Source sync, search sync, partial playlist delivery

**Playlist Evidence**:
Device evidence that ties the current framebuffer state to a Screen Playlist, the active Playlist Item, that item's Screen Manifest, and the displayed output or frame hash. It proves the current display belongs to the playlist without requiring a full playlist cycle during ordinary Sync.
_Avoid_: Full playback audit, source-material proof, preview-only evidence

**Screen Playlist**:
A playback contract that sequences multiple Screen Manifests for the WalnutPi screen. It owns playback concerns such as item order, duration, repeat behavior, and transitions while each referenced manifest keeps its own output artifact hash and provenance; it only accepts already-normalized Screen Manifest v2 outputs.
_Avoid_: Multi-page manifest, asset folder, LVGL config

**Screen Manifest v2**:
The `walnutpi.screen-manifest.v2` schema for one Screen Output or Animated Screen Output plus Processing Provenance.
_Avoid_: walnutpi.screen.v1, component manifest, playlist

**Pre-rendered Screen**:
A Screen Output where text, UI, imagery, and visual styling have already been composed into final 480x320 pixels before Sync. The LVGL Screen App displays these pixels instead of interpreting UI components at runtime.
_Avoid_: Runtime UI component, LVGL layout, device-side text rendering

**Screen Playlist v1**:
The `walnutpi.screen-playlist.v1` schema for sequencing multiple Screen Manifest v2 files.
_Avoid_: walnutpi.screen.v1, multi-page manifest, source folder

**Screen Workspace**:
The root-level `screen/` area that owns Screen Manifests, Screen Outputs, Screen Playlists, Source Assets, and their provenance. The LVGL app consumes generated resources from this workspace but does not own the screen contract.
_Avoid_: lvgl_app, generated build directory, device filesystem

**Current Screen Assets**:
The Screen Manifests, Screen Playlist files, and Screen Outputs needed to reproduce the currently intended device playback. These assets should be versioned, while broad search caches and large candidate Source Assets are not automatically part of the tracked contract.
_Avoid_: Search cache, candidate dump, generated build output

**Screen Workspace UI**:
The user-facing workflow for searching or selecting Source Assets, processing them into Screen Outputs, previewing playback, adding items to a Screen Playlist, and explicitly syncing to the WalnutPi. Manifest JSON, hashes, and raw evidence belong in developer diagnostics rather than the beginner flow.
_Avoid_: JSON editor, hash dashboard, generic IDE

**Default Screen Output**:
The first Screen Output generated automatically after a user selects a Source Asset, using conservative processing defaults such as fitting or cropping to 480x320, nearest-neighbor scaling for pixel styles, and bounded animation frame rates. Users can adjust processing parameters and regenerate before Sync.
_Avoid_: Final approval, source selection, manual-only render

**Screen Plan**:
An AI- or user-authored intent for what the WalnutPi screen should show, including search terms, style direction, candidate processing parameters, and playlist suggestions. It guides the Tool-Assisted Processing Pipeline but is not the authoritative Screen Manifest.
_Avoid_: Screen Manifest, output hash, synced artifact

**Executed Screen Plan**:
A Screen Plan that led to a selected Source Asset and generated Screen Output. Executed plans should be saved in the Screen Workspace so the creative intent and processing choices remain traceable.
_Avoid_: Chat transcript, abandoned idea, authoritative manifest

**Playlist Item**:
One entry in a Screen Playlist. The first version should identify a Screen Manifest and include the playback duration, repeat count, and a simple cut transition.
_Avoid_: Raw output file, source asset, nested manifest

**Playlist Loop**:
The behavior that restarts a Screen Playlist from the beginning after its last Playlist Item. Infinite playback belongs to the playlist loop setting, while Playlist Item repeat counts remain finite.
_Avoid_: Item repeat, animation frame timing, sync completion

**Processing Provenance**:
The source and transformation history used to create a Screen Output, such as search terms, prompts, source names, source URLs, local source hashes, license or usage notes, crop boxes, scaling choices, pixelation settings, palette choices, tool names and versions, seeds when available, and source hashes. It explains how the output was produced, but Sync is authoritative only for the local Screen Output hash.
_Avoid_: Sync input, live recipe, runtime dependency

**Tool-Assisted Processing Pipeline**:
The process that turns Source Assets into Screen Outputs by composing established tools for decoding, frame extraction, resizing, cropping, pixelation, compositing, hashing, and LVGL resource preparation. It should prefer tools such as ffmpeg, Sharp, and LVGL converters over hand-written image processing cores.
_Avoid_: Hand-rolled decoder, bespoke scaler, runtime asset search

**Unknown-License Source**:
A Source Asset whose license or usage rights are not known. It may be used for personal device Sync when clearly marked in Processing Provenance, but it must not be treated as commercially cleared material.
_Avoid_: Open asset, commercial asset, license-free source

**Pixel Style**:
The recommended visual treatment for many Screen Outputs, usually created by downscaling Source Assets to a smaller pixel grid and scaling back to 480x320 with nearest-neighbor sampling. Pixel Style is a processing choice, not a mandatory rule for every Screen Output.
_Avoid_: Required output format, component style, LVGL widget theme

# Screen Workspace Migration Plan

This plan migrates WalnutPi from the legacy component-oriented `walnutpi.screen.v1` manifest toward an output-centered Screen Workspace:

```text
Web conversation
-> Screen Plan
-> candidate Source Assets
-> user-selected Source Asset
-> Tool-Assisted Processing Pipeline
-> Screen Output or Animated Screen Output
-> Screen Manifest v2
-> Screen Playlist v1
-> Playlist Sync
-> Playlist Evidence from the real WalnutPi
```

The migration should preserve the current real-device sync loop while moving the domain model away from LVGL component configuration.

## Confirmed Direction

- `Screen Manifest v2` uses schema `walnutpi.screen-manifest.v2`.
- `Screen Playlist v1` uses schema `walnutpi.screen-playlist.v1`.
- `walnutpi.screen.v1` is the legacy component manifest and should not be expanded as the new product model.
- Manifest v2 describes one final `Screen Output` or one `Animated Screen Output` plus `Processing Provenance`.
- Playlist v1 sequences multiple Manifest v2 files and owns playback order, duration, finite item repeat, cut transitions, and playlist-level looping.
- Source Assets may have any dimensions and may come from search, upload, hand-authored pixel art, generated images, GIFs, sprite sheets, videos, or frame sequences.
- Every synced output must be normalized to 480x320 before Sync.
- Static output identity records both encoded file hashes and normalized pixel hashes.
- Animated output is canonical as 480x320 frame sequence plus timing, with an overall hash derived from frame pixel hashes and durations.
- RGBA pixel hashes support processing and Web preview; RGB565 pixel hashes are authoritative for device framebuffer evidence.
- Sync never re-fetches remote source material and never regenerates missing outputs.
- Unknown-license sources may be used for personal device sync only when clearly marked in provenance.
- The beginner UI should expose Screen Workspace and Playlist actions, not raw JSON, hashes, or device evidence.

## Target Directory Shape

```text
screen/
  plans/
    <plan-id>.json
  sources/
    <asset-id>/
      source.json
      original.<ext>
  manifests/
    <screen-id>.json
  outputs/
    <screen-id>/
      output.png
      output.json
    <animation-id>/
      frames/
        frame-000.png
        frame-001.png
      output.json
  playlists/
    default.json
```

`screen/` owns user-facing contracts, source metadata, outputs, playlists, and provenance. `lvgl_app/` consumes generated resources from this workspace but does not own the screen contract.

## Phase 1: Schema And Validation

Add new validators without replacing the legacy flow yet.

- Create `scripts/screen-workspace-vocabulary.js`.
- Validate `walnutpi.screen-manifest.v2`.
- Validate `walnutpi.screen-playlist.v1`.
- Add deterministic stable hashing helpers for:
  - Manifest v2 envelope hash
  - Playlist v1 hash
  - static output file hash
  - RGBA pixel hash
  - RGB565 pixel hash
  - animated output hash from `frameRgb565PixelSha256 + durationMs`
- Add tests that prove:
  - source dimensions may vary
  - final static output must be 480x320
  - every animation frame must be 480x320
  - playlist items reference manifests, not raw output files
  - missing output artifacts fail validation

Do not add compatibility shims for old component pages unless a specific migration task needs them.

## Phase 2: Output Processing Pipeline

Build the first Tool-Assisted Processing Pipeline around existing dependencies.

- Use `ffmpeg-static` for GIF/video probing, frame extraction, and fps/duration limiting.
- Use `sharp` for resize, crop, pad, nearest-neighbor pixel scaling, PNG output, and RGBA hash generation.
- Implement deterministic RGB565 conversion for device evidence hashes.
- Default animation budget:
  - `10 fps`
  - `8 seconds`
  - max `80` final frames
- Support processing presets:
  - `fit-cover: 480x320`
  - `fit-contain: 480x320`
  - `pixel-grid: 120x80@4x`
  - `pixel-grid: 240x160@2x`
- Save executed Screen Plans only after a user-selected Source Asset generates output.

The pipeline should not hand-write GIF decoders, video decoders, or image scalers.

## Phase 3: Playlist Model

Introduce playlist authoring and validation.

Minimum playlist item shape:

```json
{
  "manifest": "../manifests/train-sign.json",
  "durationMs": 8000,
  "repeat": 1,
  "transition": "cut"
}
```

Playlist-level behavior:

- `loop: true` controls infinite playlist playback.
- Item `repeat` remains finite.
- First version supports only `cut` transitions.
- A one-output user flow can still create a default one-item playlist.

## Phase 4: Preview

Update Web preview around Screen Workspace concepts.

- Preview static Screen Output as the exact 480x320 image.
- Preview Animated Screen Output from frame sequence and timing.
- Preview Playlist playback in the browser.
- Keep raw manifest JSON, hashes, frame lists, and provenance in developer diagnostics.
- Beginner UI should focus on:
  - search/select Source Asset
  - generate default output
  - adjust processing
  - add to playlist
  - preview playlist
  - sync to WalnutPi

## Phase 5: LVGL Playback

Move the LVGL Screen App toward image and animation playback.

- Use frame sequences as the canonical animation path.
- Prefer LVGL's image/animation-image path over direct GIF playback as the core runtime contract.
- Treat GIF as Source Asset or derived preview/export, not as Sync authority.
- Generate LVGL-consumable resources from Screen Workspace outputs.
- Keep LVGL startup and service details in build/sync configuration, not in Manifest v2.

## Phase 6: Sync And Evidence

Add Playlist Sync while preserving explicit real-device sync semantics.

- Default user-facing sync targets the current Screen Playlist.
- Single-output sync remains available for focused testing.
- Sync validates every referenced local artifact and hash before delivery.
- Sync fails on missing artifacts or mismatched hashes.
- Sync does not search, download, or regenerate.
- Evidence records:
  - playlist hash
  - active playlist item
  - item manifest hash
  - displayed frame or output RGB565 pixel hash
  - framebuffer evidence
  - service state

Ordinary Sync only needs to prove the current displayed frame belongs to the current playlist item. A full-cycle playlist audit can be added later as a separate diagnostic action.

## Phase 7: Legacy Retirement

After v2 preview and playlist sync are stable:

- Stop presenting legacy component manifest editing in beginner UI.
- Keep `walnutpi.screen.v1` readable only where needed for old records and deliberate migration.
- Remove assumptions that the canonical manifest lives at `lvgl_app/screen-manifest.json`.
- Keep `lvgl_app/` focused on rendering generated outputs.

## Open Implementation Questions

- Exact JSON field names for Manifest v2 and Playlist v1.
- Whether Screen Workspace output files should be `.png` only first, or include precomputed `.rgb565` artifacts.
- Whether LVGL resources should be generated as C arrays, binary image files, or filesystem-loaded assets.
- How large tracked animation outputs may become before requiring an explicit advanced confirmation.
- How to surface unknown-license material in beginner UI without blocking personal device sync.

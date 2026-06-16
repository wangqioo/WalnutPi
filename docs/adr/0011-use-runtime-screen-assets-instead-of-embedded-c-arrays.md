# Use runtime Screen Assets instead of embedded C arrays

Screen Playlist playback uses hot-reloadable Runtime Screen Assets under `screen/runtime/` as the normal delivery format, not RGB565 frames embedded into generated C arrays. This keeps ordinary sync focused on transferring the playlist index and frame files, avoids recompiling LVGL for content changes, and matches the WalnutPi workflow where a runtime-capable `walnut-lvgl-screen` binary can reload updated assets.

**Considered Options**

- Embed playlist frames into generated C source and rebuild LVGL whenever content changes.
- Deliver a stable runtime-capable LVGL binary once, then sync `screen/runtime/default.txt` and RGB565 frame files for content changes.

**Consequences**

Generated C array playback should not remain as a parallel asset path. Build scripts and delivery slices should no longer generate or require `lvgl_app/generated/screen_workspace_config.c`; runtime asset generation is the content path, and rebuilding is only needed when the LVGL runtime itself changes.

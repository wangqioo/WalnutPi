# Introduce Screen Playlist above Screen Manifest

WalnutPi needs small-screen playback, but Screen Manifest remains the contract for a single Screen Output or Animated Screen Output. A Screen Playlist sits above manifests and references multiple local outputs with playback metadata such as order, duration, repeat behavior, and transitions, so playlist-level Sync evidence can be tied to a playlist hash without losing per-output artifact hashes.

**Considered Options**

- Put multiple outputs directly inside one Screen Manifest.
- Keep Screen Manifest scoped to one output and introduce Screen Playlist for playback sequencing.

**Consequences**

The sync model should eventually distinguish single-output sync from playlist sync. The LVGL Screen App can implement playback, but playlist vocabulary should not be reduced to LVGL widget configuration.

# Use new schema names for output and playlist contracts

The new output-centered manifest uses `walnutpi.screen-manifest.v2`, and playlists use `walnutpi.screen-playlist.v1`. The existing `walnutpi.screen.v1` name remains associated with the legacy component-oriented manifest model, so old records are not confused with the new Screen Output and Screen Playlist contracts.

**Considered Options**

- Reuse `walnutpi.screen.v1` with changed semantics.
- Introduce explicit schema names for Screen Manifest v2 and Screen Playlist v1.

**Consequences**

Migration code can distinguish legacy component manifests from output-centered manifests. New implementation should not add compatibility shims unless explicitly required.

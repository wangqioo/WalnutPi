# Use pixel hashes as Screen Output authority

Screen Output identity is based on normalized decoded 480x320 pixel content, not only on encoded file bytes. Manifests should still record file SHA-256 hashes for delivery integrity, but Sync evidence and animation identity should use pixel hashes, with animated output hashes derived from each frame's pixel hash and duration.

**Considered Options**

- Treat encoded file SHA-256 as the only output identity.
- Treat normalized pixel SHA-256 as the screen identity while also recording file hashes.

**Consequences**

The processing pipeline needs a deterministic pixel normalization step, preferably using existing image tooling such as Sharp or ffmpeg. Two PNGs with identical visible pixels may share the same Pixel Hash even if their encoded bytes differ.

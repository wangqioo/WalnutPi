# Use Frame Hashes as Screen Output Authority

Screen Output identity is based on normalized decoded 480x320 frame content, not only on encoded file bytes. Manifests should still record file SHA-256 hashes for delivery integrity, but Sync evidence and animation identity should use frame hashes, with animated output hashes derived from each frame's RGB565 evidence hash and duration.

**Considered Options**

- Treat encoded file SHA-256 as the only output identity.
- Treat normalized RGB565 SHA-256 as the screen identity while also recording file hashes.

**Consequences**

The processing pipeline needs deterministic frame-content normalization, preferably using existing image tooling such as Sharp or ffmpeg. Two PNGs with identical visible frame content may share the same Frame Hash even if their encoded bytes differ.

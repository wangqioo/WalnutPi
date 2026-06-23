# Use frame sequences for animated Screen Output

Animated Screen Output uses a canonical 480x320 frame sequence with explicit timing, rendered on the LVGL Screen App through LVGL's animation-image path rather than treating GIF playback as the primary contract. Source GIFs, sprite sheets, videos, and images may be imported, decoded, scaled, cropped, or palette-processed with established tools such as ffmpeg and Sharp, but Sync is tied to the generated local frame sequence and its hashes instead of live source material or runtime network fetches.

**Considered Options**

- Frame sequence plus timing as the canonical animation output.
- Direct GIF playback as the canonical animation output.
- A custom framebuffer animation player outside the LVGL Screen App.

**Consequences**

The processing pipeline should lean on existing image/video tooling for decoding and transformation. GIF remains useful as a Source Asset or derived preview/export format, but not as the authority for Sync evidence.

# Pre-render text and UI into Screen Output

Screen Manifest v2 does not carry runtime UI components. Text, layout, imagery, and styling are composed during processing into a final 480x320 Screen Output or frame sequence, and the LVGL Screen App displays that result rather than interpreting component structure at runtime.

**Considered Options**

- Preserve text and UI structure in manifests and render it on the device through LVGL widgets.
- Pre-render all visible content into Screen Output artifacts before Sync.

**Consequences**

The processing pipeline owns font, layout, pixel style, image composition, and localization concerns. The LVGL Screen App becomes a stable image and animation playback surface, which reduces device-side schema complexity.

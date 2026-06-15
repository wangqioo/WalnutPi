# Use tool-assisted screen processing pipeline

WalnutPi should turn Source Assets into Screen Outputs by composing established tools such as ffmpeg for media decoding and frame extraction, Sharp for image transforms and hashes, and LVGL-supported conversion paths for device resources. The project should not hand-write core image decoders, GIF processors, scalers, or palette pipelines when mature tools cover the need.

**Considered Options**

- Build custom image and animation processing code inside the project.
- Use a tool-assisted pipeline around ffmpeg, Sharp, and LVGL resource tooling.

**Consequences**

Implementation work should focus on contract validation, provenance, deterministic outputs, and sync evidence. Tool installation and invocation become part of the supported build/runtime environment.

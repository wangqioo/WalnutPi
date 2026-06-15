# Record RGBA and RGB565 pixel hashes

Screen Outputs should record both RGBA and RGB565 pixel hashes. RGBA hashes fit the Web preview and image-processing pipeline, while RGB565 hashes match the real WalnutPi framebuffer and should be the authority for device evidence.

**Considered Options**

- Use only RGBA pixel hashes.
- Use only RGB565 pixel hashes.
- Record both and give RGB565 authority for device evidence.

**Consequences**

The output pipeline needs deterministic conversion from decoded images into both normalized RGBA and RGB565 buffers. Device evidence should compare against RGB565 pixel hashes rather than encoded PNG hashes.

# Use AI for Screen Plans, not authoritative manifests

AI can help translate user conversation into Screen Plans: search terms, style direction, candidate assets, processing parameters, and playlist suggestions. The authoritative Screen Manifest v2 should be produced by the processing pipeline after local Screen Outputs and hashes exist, rather than trusting AI-generated JSON as the synced contract.

**Considered Options**

- Let AI directly generate authoritative Screen Manifest JSON.
- Let AI generate Screen Plans and have the tool-assisted pipeline produce manifests from verified local artifacts.

**Consequences**

The existing AI manifest patch flow should migrate toward planning and candidate generation. Manifest v2 creation should be deterministic and tied to generated local outputs, hashes, and provenance.

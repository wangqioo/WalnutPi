# Keep LVGL launch details out of Screen Manifest

Screen Manifest is the contract for final 480x320 Screen Outputs and their Processing Provenance, not the configuration surface for launching the LVGL Screen App. The existing implementation fields such as LVGL entrypoint paths and `walnut screen start` command wiring should move to build or Sync configuration as the manifest schema evolves, leaving the manifest focused on the display artifact and its evidence.

**Considered Options**

- Keep LVGL runtime, entrypoint, and command fields in every Screen Manifest.
- Keep only the 480x320 output contract and provenance in Screen Manifest, with LVGL launch details owned by build and Sync configuration.

**Consequences**

The validator and generator need to stop treating LVGL implementation fields as core manifest vocabulary. This makes it clearer that LVGL is the current renderer for WalnutPi, not the domain model itself.

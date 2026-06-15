# Own screen contracts under Screen Workspace

Screen contracts, outputs, playlists, and source provenance belong under a root-level Screen Workspace rather than under `lvgl_app/`. The LVGL Screen App is the current renderer and should consume generated resources from the Screen Workspace, while `screen/` owns the user-facing manifests, playlists, source assets, and output artifacts.

**Considered Options**

- Keep the primary manifest at `lvgl_app/screen-manifest.json`.
- Move screen contracts and assets under a root-level `screen/` workspace and let `lvgl_app/` consume generated resources.

**Consequences**

Existing paths and sync code that assume `lvgl_app/screen-manifest.json` need to migrate. This keeps LVGL implementation details from owning the screen domain model.

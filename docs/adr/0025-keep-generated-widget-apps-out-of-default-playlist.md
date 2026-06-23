# Keep generated Widget Apps out of the default Screen Playlist

Agent-generated Widget Apps are saved applications, not default wallpapers or
playlist items. A generated Widget App may produce a preview Screen Output for
inspection, but activation, input, actions, exit behavior, and evidence belong
to the Widget App product chain rather than Screen Playlist Sync.

**Decision**

Do not automatically write agent-generated Widget Apps into the default Screen
Playlist, and do not let `Screen Manifest v2` provenance make Playlist Sync
load a Widget App catalog into `screen/runtime/default.txt`.

Wallpaper Mode continues to own Screen Manifests, Screen Playlists, Runtime
Screen Assets, RGB565 frame hashes, and Playlist Evidence. Widget App Mode owns
Widget App Artifacts, explicit activation, app state, declared actions, exit to
playlist or system display, and Widget App evidence.

**Consequences**

Generating a Widget App creates a saved app artifact and optional preview, but
does not replace the active playlist. The Walnut Agent Console must ask for or
perform an explicit Widget App activation before the app becomes the active
device display mode.

Playlist Sync must ignore Widget App provenance in a Screen Manifest. If a
Widget App wants to appear in Wallpaper Mode, it must snapshot into ordinary
Screen Output artifact first; that snapshot has normal wallpaper evidence and no
interactive action semantics.

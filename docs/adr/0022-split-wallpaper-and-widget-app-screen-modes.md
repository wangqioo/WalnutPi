# Split Wallpaper and Widget App screen modes

WalnutPi screen work has two product modes with different contracts.

Wallpaper Mode turns user-selected or generated media into final 480x320 Screen
Outputs, Screen Manifests, Screen Playlists, Runtime Screen Assets, and
Real-Device Verification evidence.

Widget App Mode turns natural-language intent into playable small-screen
applications. It uses A2UI as the host-facing semantic shape, validates into a
small Walnut LVGL Widget Catalog as the device-facing contract, and renders that
catalog through LVGL.

**Considered Options**

- Keep one Screen Manifest-centered schema for media playback, generated UI,
  LVGL widgets, and sync evidence.
- Make A2UI over MCP the direct on-device runtime contract.
- Split Wallpaper Mode and Widget App Mode while sharing LVGL delivery,
  diagnostics, and evidence where appropriate.

**Decision**

Split Wallpaper Mode and Widget App Mode.

Screen Manifest v2 and Screen Playlist v1 remain the Wallpaper Mode and
playback evidence contracts. They should not become the semantic schema for
interactive UI.

Widget App Mode introduces a separate widget application contract. A2UI is used
for agent-facing interchange, MCP/tool integration, and semantic UI shape, but
the WalnutPi device runtime consumes a Walnut-owned LVGL Widget Catalog so
firmware is not tightly coupled to A2UI protocol churn.

**Consequences**

Existing wallpaper, animation, playlist, hash, sync, and real-device evidence
work remains valid.

The existing `PixelScreenSpec` and `runtimeWidgets` path should be treated as a
transitional experiment, not the long-term Widget App Mode contract.

Widget App Mode needs a small first catalog before runtime implementation:
text, image, container, rect, button, toggle, progress/bar, gauge/arc, list,
and status tile are enough to start.

Mode crossing must be explicit. A Widget App may snapshot into a Screen Output,
and a Wallpaper asset may be used inside a Widget App, but the two modes should
not share one schema.

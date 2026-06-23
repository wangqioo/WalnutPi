# Define Widget App Mode product chain

Widget App Mode is WalnutPi's second screen product chain after the implemented
Wallpaper Mode sync loop.

Wallpaper Mode remains responsible for pre-rendered Screen Outputs, Screen
Manifest v2, Screen Playlist v1, Runtime Screen Assets, Playlist Sync, and
Real-Device Verification.

Widget App Mode is responsible for playable small-screen applications with
controlled dynamic state and actions.

**Decision**

Widget App Mode uses this product chain:

```text
Walnut Agent Console
-> Intent Route: widget_app
-> Widget App Plan
-> A2UI-over-MCP-inspired surface/resource/tool result
-> Walnut LVGL Widget Catalog
-> Runtime Widget Assets / App State
-> explicit Widget App Sync
-> LVGL runtime activation
-> input / state loop
-> Real-Device Verification
```

The Walnut LVGL Widget Catalog is the authoritative device contract. A2UI over
MCP is an inspiration for how static UI can be delivered as resources, dynamic
UI can be produced by tools, and UI actions can return to server-side tool
calls. WalnutPi may project from that semantic shape, but LVGL C code renders
the Walnut catalog, not raw A2UI. Screen Manifest v2 and Screen Playlist v1
must not become Widget App schemas.

The Catalog is a limited semantic widget tree, not a raw drawing API and not
a general web layout system. The first catalog should cover text, image,
container, rect, button, toggle, progress/bar, gauge/arc, list, and status tile,
with limited row, column, absolute, and small-grid layout.

Widget App generation must be catalog-first at the WalnutPi device seam. It may
borrow A2UI-over-MCP ideas for static resource delivery, tool-produced dynamic
surfaces, catalog negotiation, semantic UI state, and action events, but it
must not use `TerminalPrintSource` as its default product model. Terminal-style
pre-rendered source control belongs to Wallpaper Mode, not the LVGL
desktop/application chain.

Widget App state supports controlled dynamic bindings from approved sources
such as device status, network status, screen playback, daily notes, local
action results, and time. It must not allow arbitrary JavaScript, arbitrary
shell, or arbitrary HTTP as binding sources.

LVGL emits action events, but actions execute through the Device Execution
Surface and Local Action Policy. LVGL must not directly run device commands.
High-risk actions create a pending confirmation in Walnut Agent Console rather
than completing confirmation on the 480x320 screen.

Widget App Sync gets its own API surface, separate from Screen Workspace Sync,
while sharing delivery, runtime capability checks, LVGL build fallback, service
activation, sync records, diagnostics, and real-device evidence where practical.

Widget App runtime delivery uses files, not generated C for ordinary content
changes:

```text
screen/widget-apps/<appId>/app.json
screen/widget-apps/<appId>/versions/<versionId>.json
screen/widget-apps/<appId>/assets/
screen/widget-runtime/current.json
screen/widget-runtime/state.json
screen/widget-runtime/events.log
```

Content and state changes sync runtime assets. LVGL rebuilds are only for
renderer capability changes.

**First implementation target**

The first Widget App should be a Device Status and Quick Actions panel.

It should cover:

- Dynamic status bindings for IP, memory, disk, FRP, and service state.
- One direct read-only action: `refresh_device_status`.
- Two confirmation-required actions: `restart_walnut_screen_service` and
  `reboot_device`.
- State update after action results.
- Real-device evidence tying active app, contract version, state, policy
  decision, service state, and displayed frame together.

**Consequences**

Widget App Mode becomes a first-class product chain, not a LVGL widget demo.

Widget apps are saved, versioned, switched, synced, and diagnosed as app
contracts. Walnut Agent Console may create or edit them through conversation,
but they are not one-off transient chat outputs.

Widget App evidence should initially prove the loaded contract/version, current
frame relationship, and latest policy-mediated action result. Full interaction
replay is out of scope for the first implementation.

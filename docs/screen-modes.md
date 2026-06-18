# Screen Modes

WalnutPi screen work has two product modes. They share the Walnut Agent Console,
LVGL as the current device renderer, and real-device verification, but they do
not share the same contract.

## Wallpaper Mode

Wallpaper Mode turns user-selected or user-generated media into screen playback.

Typical user requests:

- "Use this GIF as my screen wallpaper."
- "Search for a cyberpunk weather image and make it fit the screen."
- "Turn this short video into a looping WalnutPi animation."

Flow:

```text
Natural language / upload / search
-> Candidate Source Asset
-> selected Source Asset
-> Tool-Assisted Processing Pipeline
-> 480x320 Screen Output or Animated Screen Output
-> Screen Manifest v2
-> Screen Playlist v1
-> Runtime Screen Assets
-> Playlist Sync
-> Real-Device Verification
```

Interface:

- Source Assets are original media or generated visuals.
- Screen Outputs are final 480x320 pixels.
- Screen Manifests record output hashes and Processing Provenance.
- Screen Playlists sequence finished outputs.
- Runtime Screen Assets are the LVGL delivery format.

Pixel Style belongs here as a processing preset. It can make images, GIFs, and
videos feel intentional on a 480x320 screen, but it is still a visual treatment
applied before Sync.

Wallpaper Mode should not own live UI state, actions, data binding, or input
handling. If a generated surface needs those, it belongs in Widget App Mode.

## Widget App Mode

Widget App Mode turns natural language into a playable small-screen application.

Typical user requests:

- "Make a pixel weather widget with refresh."
- "Build a Pomodoro timer I can control from the screen."
- "Make a GPIO control panel with status indicators."
- "Create a tiny dashboard for device health."

Flow:

```text
Natural language
-> Intent Route
-> A2UI Surface
-> Walnut LVGL Widget Catalog
-> WalnutPi Pixel Theme / layout rules
-> LVGL Widget Renderer
-> LVGL object tree
-> actions / data updates / input events
```

Interface:

- A2UI Surface is the host-facing semantic UI shape.
- Walnut LVGL Widget Catalog is the device-facing stable contract.
- The LVGL Widget Renderer is the first renderer adapter.
- The renderer maps catalog nodes to LVGL objects.
- The data model owns changing values.
- Actions describe user intent and route back through Walnut Agent Console or
  the Device Execution Surface.

Initial renderer vocabulary should stay small:

- `Text`
- `Button`
- `Image`
- `Container`
- `Progress` or `Bar`
- `Gauge` or `Arc`
- `List`

Pixel Style belongs here as a theme, not as the UI contract. It should control
palette, spacing, borders, font choices, icon treatment, and animation limits
for the 480x320 display.

Widget App Mode should not use Screen Manifest v2 as its semantic UI schema.
Screen Manifest remains a Screen Output and evidence contract.

## A2UI Position

A2UI is a useful direction for Widget App Mode, but it should not be the
device-side foundation until the protocol and renderer ecosystem are more stable.

Use A2UI for:

- host-facing interchange with agents and MCP tools
- component vocabulary inspiration
- catalog negotiation ideas
- action and data-model semantics
- future compatibility with agent UI ecosystems

Do not require the WalnutPi LVGL runtime to be fully A2UI-over-MCP compliant in
the first version. The embedded runtime should depend on a small Walnut LVGL
Widget Catalog that can be validated, rendered, tested, and ported to ESP32.

The target shape is:

```text
A2UI Surface
-> validated Walnut LVGL Widget Catalog
-> LVGL Widget Renderer
-> LVGL object tree
```

This keeps A2UI churn out of device firmware while preserving a clear path to
standard A2UI interoperability.

## Shared Concepts

Both modes can use:

- Walnut Agent Console for natural-language entry.
- Intent Route for deciding whether the request is media playback or an
  interactive surface.
- LVGL on WalnutPi as the current renderer.
- Screen Preview for local inspection.
- Real-Device Verification when a user-facing Sync claim is made.

Both modes must stay portable enough for later LVGL targets such as ESP32. The
upper contract should avoid Linux paths, SSH details, and WalnutPi-only file
layout unless it is explicitly a delivery adapter.

## Mode Crossing

Mode crossing should be explicit:

- A Widget App can be snapshotted into a Screen Output for non-interactive
  playlist playback.
- A Wallpaper can be used as an Image or background asset inside a Widget App.

These are conversions, not evidence that the modes should share one schema.

```text
Widget App Mode --snapshot--> Wallpaper Mode
Wallpaper Mode --asset use--> Widget App Mode
```

## Current Design Friction

The previous implementation had a shallow module around generated UI:

```text
Natural language
-> PixelScreenSpec
-> runtimeWidgets
-> Screen Manifest provenance
-> Runtime Screen Assets
-> LVGL widgets
```

This works for simple display experiments, but it mixes three responsibilities:

- UI semantics
- visual style
- sync/evidence output

The desired design is:

```text
Wallpaper Mode:
Source Asset -> Screen Output -> Screen Manifest -> Screen Playlist

Widget App Mode:
A2UI Surface -> Walnut LVGL Widget Catalog -> LVGL Widget Renderer -> LVGL object tree
```

Implementation direction:

- AI generation should target Walnut LVGL Widget Catalog directly.
- A2UI Surface is kept as a host-facing semantic/interchange shape.
- PixelScreenSpec is only a transitional snapshot fallback for producing a
  Wallpaper Mode Screen Output from generated widget intent.
- Screen Manifest provenance should reference `widgetApp.catalog` instead of
  embedding runtime widgets directly.

## Research Notes

Recent architecture research supports the split:

- A2UI is designed for declarative UI rendered by trusted native renderers, and
  custom renderers are part of its model. It is still early enough that a
  Walnut-owned device contract is safer than hard-binding firmware to A2UI over
  MCP.
- MCP is a good control plane for tools, resources, sync, diagnostics, and
  action callbacks. It should not be treated as the on-device rendering contract.
- LVGL already provides object trees, widgets, events, styles, themes, images,
  animation, input devices, and Flex/Grid layouts, so a small declarative
  renderer maps naturally onto it.
- Mature product patterns separate personal visual surfaces from functional
  widget/app surfaces: smart-display photo frames versus widgets, Stream Deck
  screensavers/icons versus actions, watch faces versus complications, and Home
  Assistant backgrounds versus cards.

Architecture consequence:

```text
Two authoring contracts:
Wallpaper -> media processing contract
WidgetApp -> widget/data/action contract

One shared device delivery discipline:
LVGL renderer / runtime assets / sync / diagnostics / evidence
```

## Open Questions

- Does Widget App Mode run entirely on the device, or can Walnut Agent Console
  remain the host for A2UI generation and action routing?
- What is the first input model: touch, keys, rotary encoder, remote console, or
  all through Walnut Agent Console?
- Which A2UI catalog is the canonical starting point for 480x320 LVGL surfaces?
- What is the minimal Walnut LVGL Widget Catalog for the first useful version?
- Should Widget App definitions live under `screen/apps/`, or should they have a
  separate workspace from Screen Outputs?
- What minimum snapshot evidence is needed when a Widget App is synced, since
  its state can change after activation?

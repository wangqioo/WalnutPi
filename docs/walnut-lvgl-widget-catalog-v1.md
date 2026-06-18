# Walnut LVGL Widget Catalog v1

This is the first device-facing contract for Widget App Mode. It is intentionally
small so the LVGL runtime can render it on WalnutPi now and remain portable to
future LVGL targets such as ESP32.

## Role

```text
A2UI Surface
-> Walnut LVGL Widget Catalog v1
-> LVGL Widget Renderer
-> LVGL object tree
```

A2UI is the host-facing semantic shape. The catalog is the device-facing stable
contract. Screen Manifest v2 is not used as the widget app schema.

Natural-language generation should produce this catalog directly. Snapshot
rendering may still produce a Screen Output for preview, evidence, or playlist
playback, but that snapshot is not the Widget App contract.

## Surface

```json
{
  "schema": "walnutpi.lvgl-widget-catalog.v1",
  "id": "weather-widget",
  "title": "Weather",
  "size": { "width": 480, "height": 320 },
  "theme": "pixel-default",
  "data": {
    "temperature": "24C",
    "humidity": 61
  },
  "root": "root",
  "nodes": []
}
```

Required fields:

- `schema`: always `walnutpi.lvgl-widget-catalog.v1`
- `id`: simple app id
- `size`: fixed 480x320 for WalnutPi v1
- `theme`: renderer theme token
- `root`: id of the root node
- `nodes`: flat node list keyed by `id`

## Node Shape

```json
{
  "id": "refresh",
  "kind": "button",
  "parent": "root",
  "layout": { "x": 344, "y": 260, "w": 112, "h": 40 },
  "text": "Refresh",
  "style": "primary",
  "action": { "name": "weather.refresh" }
}
```

Common fields:

- `id`: unique within the surface
- `kind`: one of the catalog kinds
- `parent`: parent node id, omitted only for the root
- `layout`: bounded position and size for v1
- `style`: renderer theme token
- `binding`: optional data path for dynamic values
- `action`: optional action name and parameters

## Kinds

v1 supports only:

- `container`
- `rect`
- `text`
- `image`
- `button`
- `toggle`
- `progress`
- `gauge`
- `list`
- `status_tile`

## Layout

v1 uses explicit bounded layout:

```json
{ "x": 16, "y": 24, "w": 160, "h": 48 }
```

The host may generate layout with grids or rows, but it must resolve to bounded
coordinates before device delivery. A later catalog can add higher-level layout
primitives after the first renderer is stable.

## Theme

Theme is token-based. Nodes name tokens; the LVGL renderer owns the concrete
palette, fonts, borders, spacing, and animation limits.

Initial style tokens:

- `screen`
- `panel`
- `text`
- `muted`
- `primary`
- `accent`
- `danger`

Pixel Style is a theme choice, not the catalog schema.

## Actions

Actions are names, not shell commands.

```json
{
  "action": {
    "name": "timer.start",
    "params": { "minutes": 25 }
  }
}
```

The Walnut Agent Console or Device Execution Surface maps action names to
policy-governed behavior. The LVGL renderer only emits the event.

## Validation Rules

- Surface size is exactly 480x320.
- Node ids are unique.
- Every `parent` references an existing node.
- Layout rectangles must stay inside the screen.
- Text length is bounded per node kind.
- Image sources must reference local Widget App assets.
- Actions must be names from the Widget App action manifest.
- Unknown node kinds and style tokens are rejected.

## Example

```json
{
  "schema": "walnutpi.lvgl-widget-catalog.v1",
  "id": "weather-widget",
  "title": "Weather",
  "size": { "width": 480, "height": 320 },
  "theme": "pixel-default",
  "data": {
    "temperature": "24C",
    "humidity": 61,
    "condition": "Cloudy"
  },
  "root": "root",
  "nodes": [
    {
      "id": "root",
      "kind": "container",
      "layout": { "x": 0, "y": 0, "w": 480, "h": 320 },
      "style": "screen"
    },
    {
      "id": "title",
      "kind": "text",
      "parent": "root",
      "layout": { "x": 24, "y": 20, "w": 240, "h": 36 },
      "text": "Weather",
      "style": "text"
    },
    {
      "id": "temperature",
      "kind": "status_tile",
      "parent": "root",
      "layout": { "x": 24, "y": 72, "w": 192, "h": 96 },
      "label": "Temp",
      "binding": "/temperature",
      "style": "accent"
    },
    {
      "id": "humidity",
      "kind": "progress",
      "parent": "root",
      "layout": { "x": 248, "y": 88, "w": 184, "h": 28 },
      "label": "Humidity",
      "binding": "/humidity",
      "min": 0,
      "max": 100,
      "style": "primary"
    },
    {
      "id": "refresh",
      "kind": "button",
      "parent": "root",
      "layout": { "x": 320, "y": 252, "w": 128, "h": 44 },
      "text": "Refresh",
      "style": "primary",
      "action": { "name": "weather.refresh" }
    }
  ]
}
```

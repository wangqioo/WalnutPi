# Screen Manifest Vocabulary Plan

## Context

The current `walnutpi.screen.v1` manifest is intentionally narrow:

- fixed target: 480x320, RGB565, `/dev/fb0`
- fixed runtime: `lvgl-fbdev`
- fixed pages: `home`, `system`, `ai`, `network`
- generated config: `lvgl_app/generated/screen_config.h`
- runtime entry: `lvgl_app/src/main.c`

The next expansion should let beginners describe more useful small-screen interfaces without exposing arbitrary C, LVGL object trees, CSS, shell commands, or delivery behavior.

## Goals

- Add a small component vocabulary that maps cleanly to Web preview, config generation, and LVGL runtime widgets.
- Keep natural-language edits constrained to user-facing text, status, tone, progress, and bounded lists.
- Preserve manifest hash, build, delivery manifest, activation, and device evidence as the safety gate.
- Keep the generator and runtime impact explicit before changing code.

## Non-Goals

- No arbitrary C or LVGL code editing.
- No custom layout engine, Monaco editor, or generic IDE behavior.
- No user-editable build scripts, systemd units, shell commands, SSH settings, or activation commands.
- No automatic device writes outside the existing sync flow.

## Proposed Components

The next vocabulary should be additive under page-level `components`, while keeping current fields (`status`, `tone`, `progress`, `metrics`, `lines`) as the compatibility surface.

| Component | Beginner Use | Fields | Bounds |
| --- | --- | --- | --- |
| `statusCard` | Show one main state such as ready, warning, or failed. | `label`, `value`, `tone`, `detail` | 1 per page, `tone=ok|warn|error`, short text only |
| `metricGroup` | Show 1-3 compact device or app metrics. | `items: [{label, value, unit, tone}]` | max 3 items, labels <= 12 chars, values <= 16 chars |
| `list` | Show a short queue, checklist, or next steps. | `title`, `items[]` | max 4 items, no nesting |
| `progress` | Show bounded completion or volume. | `label`, `value`, `max`, `tone` | value normalized to 0-100 |
| `alert` | Show a visible warning or next action. | `title`, `body`, `tone` | max 1 active alert per page |
| `textPage` | Show an explanatory page with a title and lines. | `title`, `lines[]` | max 4 lines, compatibility with current text pages |

## Natural-Language Editable Fields

Allowed through natural language:

- top-level `title` and `subtitle`
- page `tab`
- `statusCard.label`, `statusCard.value`, `statusCard.detail`, and `statusCard.tone`
- `metricGroup.items[*].label`, `value`, `unit`, and `tone`
- `list.title` and `list.items`
- `progress.label`, `progress.value`, `progress.max`, and `progress.tone`
- `alert.title`, `alert.body`, and `alert.tone`
- `textPage.title` and `textPage.lines`

Not editable through natural language:

- `schema`
- `target`
- `source`
- page ids or page count
- runtime, display, width, height, color format
- build, delivery, activation, SSH, sudo, or device commands

## Compatibility Shape

Current manifests should remain valid. A compatible expanded home page can look like:

```json
{
  "id": "home",
  "tab": "PLAY",
  "status": "MUSIC READY",
  "tone": "ok",
  "progress": 38,
  "metrics": ["Track queue", "Vol --", "Local audio"],
  "components": [
    {
      "type": "statusCard",
      "label": "Player",
      "value": "MUSIC READY",
      "tone": "ok",
      "detail": "Local audio"
    },
    {
      "type": "progress",
      "label": "Queue",
      "value": 38,
      "max": 100,
      "tone": "ok"
    },
    {
      "type": "metricGroup",
      "items": [
        { "label": "Track", "value": "queue" },
        { "label": "Vol", "value": "--" },
        { "label": "Mode", "value": "local" }
      ]
    }
  ]
}
```

During migration, generators can derive the old fields from components when present:

- `status` from first `statusCard.value`
- `tone` from first `statusCard.tone`, `alert.tone`, or `progress.tone`
- `progress` from first `progress.value`
- `metrics` from first `metricGroup.items`
- text page `lines` from `textPage.lines` or `list.items`

## Generator Impact

`scripts/generate-lvgl-screen-config.py` and `scripts/generate-lvgl-screen-config.js` should stay structurally equivalent.

Required changes for the implementation slice:

- Validate `components` as an optional page array.
- Normalize component text with the existing text limits and control-character rejection.
- Add a component normalizer that maps component data into the existing config fields first.
- Only add new `#define` output when `lvgl_app/src/main.c` is ready to consume it.
- Keep a single stable manifest hash over the source manifest, not the normalized config.
- Reject unknown component `type` values until the runtime supports them.

## LVGL Runtime Impact

`lvgl_app/src/main.c` should keep one fixed layout for the next implementation slice:

- home page: status card + progress + metric group
- other pages: text page or list, with optional alert at top
- no arbitrary coordinates
- no arbitrary styles
- no dynamic remote data binding beyond the existing local system value substitutions

Implementation should be incremental:

1. Add generator normalization while still rendering the current layout.
2. Update Web preview to render component-backed pages.
3. Update LVGL runtime to consume the new normalized config.
4. Verify Web preview, generated header, build, sync, frame evidence, and diagnostic diff.

## Safety Rules

- Component values are content, not commands.
- The manifest cannot request reboot, shutdown, service replacement, GPIO output, eMMC writes, firmware flashing, or shell execution.
- Sync still requires the current `manifestHash`.
- `?nossh` remains preview-only.
- Developer diagnostics may show normalized component output; beginner UI should keep only understandable states.

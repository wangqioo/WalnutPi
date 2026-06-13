# Legacy LVGL Four-Page Runtime Success

This is WalnutAI retrieval context only. It records a verified LVGL implementation pattern that worked on real WalnutPi hardware. Do not treat it as the current screen manifest product contract.

## Why This Matters

The old fixed four-page LVGL runtime was a successful bring-up slice. It proved the device can:

- build an LVGL fbdev app from a screen manifest,
- activate it with `sudo -n walnut screen start`,
- return `walnut screen state`,
- return framebuffer evidence with `sudo -n walnut screen frame`,
- keep Web sync evidence tied to manifest and artifact hashes.

Use this as hardware Cursor memory: it is a proven implementation and debugging reference for WalnutPi LVGL, not the model to generate new manifests by default.

## Verified Sync Evidence

The compact success records are in `walnut-ai-terminal/corpus/screen-sync-successes.md`.

Known successful build ids include:

- `screen-20260611124330-973d015f`
- `screen-20260611171749-e4f1ac8a`
- `screen-20260611184727-f02c769b`
- `screen-20260612161622-20eb9d61`

Reuse the proven safety gates:

```text
current manifestHash
-> scripts/build-lvgl-app.sh
-> sudo -n walnut screen start
-> walnut screen state
-> sudo -n walnut screen frame
```

## Legacy Manifest Shape

The old successful manifest shape used exactly these four pages in order:

```json
{
  "schema": "walnutpi.screen.v1",
  "target": {
    "runtime": "lvgl-fbdev",
    "display": "/dev/fb0",
    "width": 480,
    "height": 320,
    "color": "RGB565"
  },
  "source": {
    "lvglEntry": "lvgl_app/src/main.c",
    "command": "walnut screen start"
  },
  "pages": [
    {
      "id": "home",
      "tab": "PLAY",
      "status": "MUSIC READY",
      "tone": "ok",
      "progress": 38,
      "metrics": ["Track queue", "Vol --", "Local audio"]
    },
    {
      "id": "system",
      "tab": "LIB",
      "title": "Music Library",
      "lines": ["Scan music-library", "MP3 FLAC WAV", "Playlist ready", "No cloud needed"]
    },
    {
      "id": "ai",
      "tab": "CTL",
      "title": "Player Controls",
      "lines": ["Play pause next", "Volume guarded", "Use walnut play", "Terminal fallback"]
    },
    {
      "id": "network",
      "tab": "SYNC",
      "title": "WalnutPi Sync",
      "lines": ["Preview first", "Sync to fbdev", "Evidence frame", "Ask before writes"]
    }
  ]
}
```

## Legacy Generator Pattern

The old Python generator used:

```python
PAGE_IDS = ["home", "system", "ai", "network"]
TONES = {"ok", "warn", "error"}
COMPONENT_TYPES = {"statusCard", "metricGroup", "list", "progress", "alert", "textPage"}
```

It generated `lvgl_app/generated/screen_config.h` defines such as:

- `WALNUT_SCREEN_MANIFEST_HASH`
- `WALNUT_SCREEN_TITLE`
- `WALNUT_SCREEN_SUBTITLE`
- `WALNUT_SCREEN_HOME_STATUS`
- `WALNUT_SCREEN_HOME_TONE_COLOR`
- `WALNUT_SCREEN_HOME_PROGRESS`
- `WALNUT_SCREEN_HOME_METRIC_*`
- `WALNUT_SCREEN_SYSTEM_*`
- `WALNUT_SCREEN_AI_*`
- `WALNUT_SCREEN_NETWORK_*`

Later in that line, page-level `components` were accepted as a compatibility layer and normalized back into those four-page config fields. That compatibility mapping is legacy knowledge.

## Legacy LVGL Runtime Pattern

The old `lvgl_app/src/main.c` included:

- `lvgl.h`
- `generated/screen_config.h`
- `src/drivers/display/fb/lv_linux_fbdev.h`
- Linux reads from `/proc/meminfo`, `statvfs("/")`, `getifaddrs`, and `systemctl is-active`
- optional input via `/dev/input/event*`
- auto-rotation between four pages

Core UI state looked like:

```c
typedef struct {
    lv_obj_t * mem_label;
    lv_obj_t * disk_label;
    lv_obj_t * ip_label;
    lv_obj_t * arc;
} demo_status_ui_t;

typedef struct {
    demo_status_ui_t status;
    lv_obj_t * pages[4];
    lv_obj_t * tabs[4];
    lv_obj_t * system_label;
    lv_obj_t * ai_label;
    lv_obj_t * network_label;
    lv_timer_t * rotate_timer;
    int input_fd;
    bool auto_rotate;
    int page;
} screen_ui_t;
```

The home page rendered a status card, progress arc/bar, and three metrics. Other pages rendered text/list/alert-style content inside fixed panels. The runtime used a dark 480x320 layout, `C_GREEN`, `C_AMBER`, and `C_RED` tone colors, and LVGL Montserrat fonts available in the local build.

## Current Migration Rule

Current manifests are generic small-screen programs:

- `pages` contains 1-6 custom pages.
- each page must declare explicit `components`.
- supported components are `statusCard`, `metricGroup`, `list`, `progress`, `alert`, and `textPage`.
- old page fields such as `status`, `tone`, `progress`, `metrics`, `title`, and `lines` are historical data, not the current authoring model.

When an old four-page record is useful, translate its visible intent into the component vocabulary. Keep the same verified build/sync/evidence gates.

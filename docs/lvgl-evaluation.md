# LVGL Evaluation

WalnutPi currently uses a small Python framebuffer runtime for the built-in
480x320 screen.

The project now has two no-desktop screen runtimes:

```text
Python status/agent logic
-> lightweight framebuffer cards
-> /dev/fb0 RGB565

LVGL app
-> Linux fbdev driver
-> /dev/fb0 RGB565
```

This is intentionally simpler than a full desktop stack and avoids X11,
Wayland, Chromium, or a window manager.

## Current LVGL Proof

Path:

```text
lvgl_app/
```

Build on WalnutPi:

```bash
cd /home/pi/projects/WalnutPi
scripts/build-lvgl-app.sh
```

Run:

```bash
walnut screen lvgl
```

The current LVGL app renders a first-pass embedded UI with a title bar, metric
cards, and a log card through LVGL's Linux fbdev display driver. It is not a
desktop environment and does not need X11, Wayland, Chromium, or a window
manager.

## Keep The Python Framebuffer Runtime When

- The screen is mostly passive output.
- The UI is made of static cards, progress bars, metrics, logs, and AI reply cards.
- Refresh cadence is slow, around 1 to 10 seconds.
- Touch input is not the primary interaction path.
- The main product question is what the device should show, not how animated it is.

## Use LVGL When

- Touch becomes a first-class input path.
- The UI needs buttons, lists, sliders, switches, tabs, or modal flows.
- Animations and transitions become product requirements.
- We need font fallback, icons, and layout primitives beyond simple ASCII cards.
- The Python renderer becomes harder to maintain than a small LVGL app.

## Migration Shape

Do not migrate everything at once.

First keep the data model stable:

```text
SystemStatus
Metric
AI reply
Event log
Screen command
```

Then replace only the renderer:

```text
framebuffer_ui.components
-> LVGL view layer
```

The `walnut screen` command surface should stay stable:

```bash
walnut screen status
walnut screen image FILE
walnut screen ai [text...]
walnut screen app
walnut screen lvgl
walnut screen frame
walnut screen capture
walnut screen restore
```

`walnut screen frame` and `walnut screen capture` are read-only evidence commands; they should not change the LVGL start/stop/toggle behavior.

## Current Decision

Keep both runtimes for now.

The Python framebuffer runtime remains the fastest way to iterate on device
status cards and AI text output. The LVGL app is now the path for richer
embedded UI controls, touch input, and animated interface work.

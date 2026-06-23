# WalnutPi App Platform Spec

This spec defines the product direction for turning WalnutPi from a screen
playback device into a small app-capable device.

It covers two related capabilities:

- LVGL interaction becomes a 480x320 desktop shell.
- Walnut Agent Console can interactively develop playable terminal apps.

The key product decision is to treat both as app platform work, not as separate
demo tracks.

## Product Thesis

WalnutPi should support user-created small apps that can be generated, edited,
run, synced, launched, observed, and verified through one product loop.

The new spine is:

```text
User intent
-> Walnut Agent Console
-> Intent Route
-> Walnut App Package
-> local preview / terminal run / LVGL app preview
-> explicit app install or sync
-> LVGL Desktop Shell or terminal runtime
-> real-device verification
-> agentTurn.v2 trace and product benchmark evidence
```

This extends the existing product spine. It does not replace Wallpaper Mode,
Screen Manifest v2, Screen Playlist v1, or Widget App Mode.

## Relationship To Existing Modes

Wallpaper Mode remains responsible for pre-rendered visual playback:

```text
Source Asset
-> Screen Output
-> Screen Manifest v2
-> Screen Playlist v1
-> Runtime Screen Assets
-> Playlist Sync
```

Widget App Mode remains responsible for interactive small-screen UI contracts:

```text
A2UI Surface
-> Walnut LVGL Widget Catalog
-> Runtime Widget Assets / App State
-> Widget App Sync
-> LVGL runtime activation
```

The App Platform sits above both:

```text
Walnut App Package
-> LVGL Desktop Shell entry
-> Widget App / Wallpaper / Terminal App / Hybrid App runtime
```

The platform owns app identity, installation, lifecycle, launchability,
permissions, runtime state, and verification evidence.

## Capability 1: LVGL Desktop Shell

The LVGL runtime should become a small desktop shell for the 480x320 WalnutPi
screen.

This is not a Linux desktop environment. It is an embedded app launcher and
interaction host rendered by LVGL.

### User Experience

The screen should have:

- A home view.
- A launcher grid or list.
- Stable focus and selection states.
- Back, confirm, menu, and navigation behavior.
- Current app identity.
- App launch, app exit, and app switch behavior.
- A fallback status surface when no app is active.

The first shell can be visually simple. The important requirement is that the
device has a product-level answer to "what is running on the screen?"

### Runtime Responsibilities

The LVGL Desktop Shell owns:

- app discovery from installed app registry files
- active app selection
- input routing
- focus state
- app lifecycle callbacks
- app state handoff
- shell-level error display
- frame evidence that identifies the active app and version

The shell must not directly execute high-risk system actions. App actions still
route through the Device Execution Surface and Action Policy Manifest.

### First LVGL Desktop Target

The first target should support these app kinds:

- `widget_app`: existing Widget App Mode contracts.
- `wallpaper`: a playlist or screen output launched as a passive app.
- `terminal_app`: a terminal app surfaced as an installed app entry, even if it
  runs in the terminal runtime rather than inside LVGL.

The first LVGL shell does not need:

- overlapping windows
- arbitrary dragging
- multitasking UI
- a full file manager
- app store behavior
- remote desktop streaming

## Capability 2: Interactive Terminal App Development

Walnut Agent Console should let a user build playful terminal apps through a
conversation.

Typical requests:

- "Make a terminal snake game."
- "Make a Pomodoro TUI with keyboard controls."
- "Build a tiny fortune teller command."
- "Create a music visualizer launcher."
- "Make a game I can keep changing from chat."

The product loop should be:

```text
Natural language
-> Intent Route
-> Terminal App Plan
-> generated app package
-> local run or device run
-> captured output / error / interaction evidence
-> conversational edit
-> install into Walnut App Registry
-> optional LVGL Desktop Shell launcher entry
```

### Supported App Shape

The first supported terminal apps should be file-backed, command-launched apps:

- Python apps managed with `uv`.
- JavaScript or TypeScript apps managed with `bun`.
- Small shell launchers only when they wrap a real app entry.

Apps may use TUI libraries, curses-style rendering, ANSI output, keyboard input,
timers, local files, and approved device read actions.

Apps must not silently gain arbitrary system write, network, SSH, sudo, or
service-control permissions. Those remain explicit policy-controlled actions.

### Development Loop

The Console should support:

- creating a terminal app from a prompt
- running the app locally when possible
- running the app on the device when the user requests device execution
- showing stdout, stderr, exit code, and command trace
- applying conversational edits
- preserving app source as a named package
- installing or removing the app from the Walnut launcher registry

The minimum useful loop is:

```text
create -> run -> observe failure/output -> edit -> rerun -> install
```

## Walnut App Package

A Walnut App Package is the shared app unit for desktop and terminal work.

The package is intentionally a product contract, not a single runtime format.
Different app kinds can have different runtime assets, but they share identity,
metadata, permissions, lifecycle, and evidence rules.

### Package Fields

Initial `app.json` shape:

```json
{
  "schema": "walnutpi.app.package.v1",
  "appId": "tiny-snake",
  "name": "Tiny Snake",
  "kind": "terminal_app",
  "version": "2026-06-23T00-00-00Z",
  "entry": {
    "type": "command",
    "command": "bun run start",
    "cwd": "screen/apps/tiny-snake"
  },
  "launcher": {
    "showInDesktop": true,
    "category": "play",
    "icon": "assets/icon.png"
  },
  "permissions": {
    "network": false,
    "deviceActions": [],
    "systemWrites": false
  },
  "runtime": {
    "requiresDevice": false,
    "preferredSurface": "terminal"
  }
}
```

The first package schema should support:

- `appId`
- `name`
- `kind`
- `version`
- `entry`
- `launcher`
- `permissions`
- `runtime`
- `assets`
- `provenance`

### App Kinds

Initial app kinds:

- `widget_app`: launches a Widget App contract.
- `wallpaper`: launches a Screen Playlist or Screen Output.
- `terminal_app`: launches a terminal/TUI command.
- `hybrid_app`: reserved for apps with both LVGL and terminal surfaces.

`hybrid_app` should remain reserved until the first three kinds have product
coverage.

## Repository Layout

Proposed layout:

```text
screen/apps/<appId>/app.json
screen/apps/<appId>/src/
screen/apps/<appId>/assets/
screen/apps/<appId>/versions/<versionId>/
screen/app-runtime/registry.json
screen/app-runtime/current.json
screen/app-runtime/events.log
screen/widget-runtime/
screen/runtime/
```

Existing `screen/apps/` entries can be migrated gradually. Do not require old
experiments to become valid packages before the first platform slice ships.

## Intent Routes

Intent Route v2 should gain platform-aware routing without exploding the route
set.

Proposed additions:

- `app.platform`: create, update, install, uninstall, launch, stop, list.
- `terminal.surface`: run, preview, debug, edit terminal apps.
- `screen.widget_app`: still owns Widget App creation and editing.
- `screen.wallpaper`: still owns wallpaper generation and playlist sync.

Example:

```json
{
  "schema": "walnutpi.intent.route.v2",
  "route": "app.platform",
  "action": "create",
  "subject": "terminal snake game",
  "delivery": "none",
  "riskHint": "write",
  "exposure": ["internal"],
  "parameters": {
    "kind": "terminal_app",
    "template": "tui_game"
  },
  "confidence": 0.88,
  "source": "rule"
}
```

Route classification must distinguish:

- "make a wallpaper" -> `screen.wallpaper`
- "make an interactive screen app" -> `screen.widget_app`
- "make a terminal app/game/tool" -> `app.platform` with `kind=terminal_app`
- "run this existing command" -> `terminal.surface`
- "show installed apps" -> `app.platform` with `action=list`

## Permissions And Policy

App generation may create files inside the app package directory.

These actions require explicit policy handling:

- installing a launcher entry
- syncing to the device
- running on the device
- writing outside the app package
- enabling network access
- enabling system writes
- invoking sudo or service control
- exposing a device action button

The Action Policy Manifest remains authoritative for executable device actions.
`app.json` permissions are declarations and constraints, not authorization by
themselves.

## Sync And Activation

App sync should be explicit.

The first sync target should copy:

- `app.json`
- app source or bundled runtime files
- assets
- generated widget or screen runtime assets when applicable
- registry update

Activation should prefer runtime reload where possible. LVGL rebuilds are only
for shell or renderer capability changes, not ordinary app content updates.

The user-facing CLI should fit the existing `walnut` surface:

```text
walnut apps list
walnut apps launch <appId>
walnut apps stop
walnut apps state
```

The existing `walnut screen start` remains valid for screen service startup.

## Evidence

Product success must be evidence-backed.

App platform evidence should include:

- app package path
- app schema version
- app id and version
- route and action
- install or sync result
- current active app
- runtime surface
- command output for terminal apps
- frame evidence for LVGL apps
- policy decision for controlled actions
- device service state when live device execution is claimed

For terminal apps, evidence can be stdout, stderr, exit code, command trace, and
captured terminal transcript.

For LVGL desktop apps, evidence should include active app id, active contract
version, frame URL or capture path, and service state.

## Benchmark Admission

The platform should not become a product path until it has harness cases.

Initial cases:

- Create a terminal app, run it locally, and record output.
- Edit a terminal app after an observed failure and rerun it.
- Install a terminal app into the app registry.
- List installed apps through the Console.
- Launch a Widget App through the LVGL Desktop Shell.
- Sync and verify the active LVGL app on the real device.

Each V2 JSONL benchmark case must declare:

```json
{
  "requirements": {
    "device": false,
    "network": false,
    "model": false,
    "search": false
  }
}
```

Device cases should be profile-gated. Offline cases should prove routing,
package creation, validation, local execution, and trace shape.

## First Implementation Slice

The smallest useful slice is:

1. Define `walnutpi.app.package.v1`.
2. Add an app registry under `screen/app-runtime/`.
3. Add `app.platform` route handling for list, create, install, and launch.
4. Generate one terminal app package from Walnut Agent Console.
5. Run it locally and capture stdout, stderr, and exit code.
6. Install it into the registry.
7. Show the installed app in a simple LVGL Desktop Shell launcher.
8. Launch one existing Widget App from the shell.
9. Add benchmark cases for create, run, install, list, and shell launch.

This slice proves the platform loop without solving every runtime.

## Open Questions

- What physical input device is the default for LVGL Desktop Shell navigation:
  buttons, keyboard, touch, rotary, or remote Console events?
- Should terminal app source live under `screen/apps/` or a separate
  `terminal-apps/` directory with registry references?
- Should app package versions use timestamps, content hashes, or semantic
  versions?
- How much sandboxing is required before user-generated terminal apps can be
  run on the live device by default?
- Should the LVGL shell always be active, with Wallpaper Mode as an app, or
  should Playlist playback remain a separate service mode during migration?

## Non-Goals For V1

- A general Linux desktop environment.
- A public third-party app store.
- Arbitrary web apps on the device screen.
- Unrestricted AI-generated shell automation.
- Multitasking windows.
- Full terminal emulation inside LVGL.
- Automatic live-device writes without explicit sync or policy evidence.

## Product Bar

The feature is working when a beginner can say:

```text
Make me a small terminal game, run it, fix it, install it, and let me launch it
from the WalnutPi screen.
```

The system must respond with a traceable app package, a successful run or
diagnosed failure, an installed launcher entry, and real evidence of the active
device surface when device execution is claimed.

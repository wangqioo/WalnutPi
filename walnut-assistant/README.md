# Walnut Home

Walnut Home is the command hub for this headless WalnutPi AI terminal.

It turns the board from a collection of Linux commands into one portable entry point:

```bash
walnut
```

## Commands

```bash
walnut                 # interactive menu
walnut ai              # open WalnutAI chat
walnut notes           # notes submenu
walnut play            # open music, matrix rain, clock, and video demos
walnut console         # open the Chinese framebuffer console submenu
walnut status          # system, network, services, Docker, Bluetooth
walnut maintenance     # open fix-audio / projects / clean / browser / monitor submenu
walnut video [mode]    # play ASCII video demo: color or gray
walnut voice           # open voice keyboard CLI
walnut note TEXT       # append a daily note
walnut today           # show today's notes
```

Less common:

- `walnut status` for device, network, and service checks
- `walnut maintenance` for browser, monitor, fix-audio, projects, and clean
- `walnut video color|gray` for direct ASCII video playback
- `walnut note TEXT` and `walnut today` for quick notes
- `walnut voice` for the voice keyboard CLI

## Design

This is intentionally small and boring:

- Pure CLI, no desktop dependency.
- Uses Python standard library only.
- Keeps the main entrypoint unified in `walnut`.
- Keeps maintenance actions inside the menu instead of exposing extra top-level commands.

## Memory

Daily notes are written to the current user's home directory:

```bash
~/walnut-memory/daily/YYYY-MM-DD.md
```

This is the first step toward a local personal memory layer for the WalnutPi AI terminal.

## Install

```bash
cp walnut /usr/local/bin/walnut
chmod +x /usr/local/bin/walnut
```

## Runtime Layout

- Source repo: `/home/pi/projects/WalnutPi`
- Main launcher: `/usr/local/bin/walnut`
- Compatibility launcher: `/usr/local/bin/walnut-fun` -> `walnut play`
- Installed WalnutAI runtime: `/opt/walnut-ai`
- Installed voice runtime: `/opt/walnut-voice-keyboard`

Keep source edits in the Git repo, then install or copy launchers into `/usr/local/bin` as needed.

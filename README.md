# WalnutPi

WalnutPi is an experiment repo for turning a small headless Linux board into a portable cloud-AI terminal.

This repository is not only one app. It is the top-level workspace for everything developed on this WalnutPi device: terminal UI experiments, audio notes, deployment configs, system scripts, and future AI-native hardware/software prototypes.

## What This Device Is

The current prototype device is a WalnutPi running a headless Debian Linux system.

Current observed environment:

- OS: Debian GNU/Linux 12 bookworm
- Architecture: arm64/aarch64
- Kernel: Linux 6.1.31
- Default access: CLI/SSH, no desktop environment
- Network: Wi-Fi through NetworkManager
- Runtime: Python 3.11, Docker, systemd
- AI access: cloud AI through an OpenAI-compatible API endpoint
- Audio: Bluetooth playback through PulseAudio A2DP
- Monitoring: Uptime Kuma running in Docker
- Remote access: frpc connected to an existing frps server

The device is intentionally treated as a lightweight local interaction carrier, not as a machine for local large-model inference.

## Core Idea

The project direction is an AI-native terminal system:

> Headless Linux + command-line interaction + structured cards + cloud AI API + lightweight local hardware control.

The local device handles:

- input and output
- network connection
- terminal UI rendering
- system status collection
- small scripts and local automation
- audio playback
- service hosting

The cloud handles:

- language reasoning
- text generation
- translation
- summarization
- planning
- future multimodal AI tasks

## What It Can Do Today

The current WalnutPi can already:

- run `walnut-ai`, a small AI terminal prototype
- call cloud AI through an OpenAI-compatible API
- save notes locally as Markdown
- translate and polish text
- show system status from a terminal UI
- run Docker services
- host Uptime Kuma on port `3001`
- expose services through frpc
- play audio through AirPods/A2DP
- keep normal CLI boot behavior without forcing a custom shell on startup

## What It Is Good For

This device is a good fit for:

- portable AI terminal experiments
- cloud-AI interaction shells
- headless Linux UI prototypes
- AI note-taking tools
- lightweight terminal dashboards
- personal automation scripts
- service monitoring
- remote-access experiments
- voice-input prototypes after adding a reliable USB microphone

## What It Is Not Good For

The current prototype is not suitable for:

- running large local LLMs
- replacing a desktop Linux workstation
- Android-style multi-app interaction
- heavy GPU/3D UI
- reliable Bluetooth headset microphone input through the onboard controller

AirPods playback works, but AirPods microphone capture failed because SCO microphone packets did not arrive in Linux over HCI on this board's onboard Bluetooth controller. See `audio/airpods-linux/`.

## Repository Layout

```text
WalnutPi/
├── hardware/                # Observed hardware and screen notes
├── walnut-ai-terminal/      # WalnutAI Terminal V0
├── voice-keyboard/          # Speech-to-text keyboard agent experiments
├── audio/
│   └── airpods-linux/       # AirPods/Linux playback and microphone investigation
├── scripts/                 # Install and helper scripts
└── README.md                # Project overview
```

Future modules should be added as separate folders under this repository. The root should stay as an index and overview.

## Projects

### Hardware Notes

Path: `hardware/`

Observed device details: OS, CPU class, memory, storage, framebuffer screen, touch controller, GPU/display notes, Bluetooth/audio constraints, and useful inspection commands.

### WalnutAI Terminal V0

Path: `walnut-ai-terminal/`

A tiny cloud-AI terminal for headless Linux.

Run on the WalnutPi:

```bash
walnut-ai
```

Current commands:

```text
/status              Show device, service, Docker, memory, and disk status
/note text           Save a note to Markdown
/polish text         Lightly polish text using cloud AI
/translate text      Translate between Chinese and English
/clear               Clear current chat context
/help                Show help
/exit                Exit
```

### Voice Keyboard

Path: `voice-keyboard/`

Speech-to-text keyboard agent code from the earlier `voice-keyboard` project. This is kept as an independent experiment folder because it contains platform-specific desktop integrations, firmware sketches, and packaging notes.

For WalnutPi/server-style Linux use, the important direction is:

- USB microphone input instead of onboard Bluetooth headset microphone capture
- CLI/service-friendly execution on Debian
- cloud STT providers such as ZhipuAI, OpenAI-compatible APIs, Aliyun, Volcengine, or Xunfei
- server-side AI routing for dictation, memo save/recall, polish, writing, and short chat
- future integration with WalnutAI Terminal as a voice input path

See `voice-keyboard/README.md`, `voice-keyboard/config.yaml.example`, and `voice-keyboard/packaging/linux/README.md`.

### AirPods Linux Audio Notes

Path: `audio/airpods-linux/`

Documents the Bluetooth audio investigation:

- A2DP playback works through PulseAudio
- BlueALSA should stay disabled for normal playback
- AirPods microphone capture failed on the onboard Bluetooth controller
- USB microphone is recommended for future voice input

## Current Services on the Prototype Device

- `docker.service`: enabled
- `frpc.service`: enabled
- `uptime-kuma` Docker container: healthy
- Uptime Kuma local URL: `http://192.168.1.30:3001`
- WalnutAI launcher: `/usr/local/bin/walnut-ai`
- WalnutAI code: `/opt/walnut-ai/walnut_ai.py`
- Voice Keyboard headless installer: `scripts/install-voice-keyboard-walnutpi.sh`

## Development Rules

- Keep every new experiment in its own subfolder.
- Do not put device-local secrets in this repo.
- Keep boot behavior normal: the device should still boot into a standard CLI.
- Custom interaction systems should be entered manually, for example with `walnut-ai`.
- Prefer simple, inspectable Linux services and scripts before building heavy UI stacks.

## Near-Term Roadmap

- Add persistent conversation history to WalnutAI Terminal
- Add richer terminal card rendering
- Add commands for Uptime Kuma and frpc status
- Add Bluetooth/music control command
- Add a small local web UI for phone access
- Connect `voice-keyboard/` transcripts directly into WalnutAI Terminal
- Add service deployment folders for Uptime Kuma and frp configs

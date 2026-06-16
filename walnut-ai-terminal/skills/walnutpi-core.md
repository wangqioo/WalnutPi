# WalnutPi Core Context

WalnutPi is a beginner-first AI-native terminal system for a headless Debian WalnutPi Device.

Product direction:

- Walnut Agent Console is the natural-language user surface.
- Device Execution Surface provides controlled device capabilities.
- Screen Workspace creates 480x320 Screen Manifest v2 outputs and Screen Playlist v1 playback.
- Playlist Sync delivers Runtime Screen Assets to the WalnutPi Device after user confirmation.
- Real-Device Verification proves delivery, activation, service state, frame evidence, or capture evidence.

Current working style:

- Prefer small, guided, reversible workflows.
- Keep Beginner Sync Status simple.
- Put hashes, command output, delivery manifests, frame URLs, raw evidence, and Agent Observability in Developer Diagnostics.
- Treat Device Transport as an implementation path, not a user-facing shell.
- Ground action summaries in local output or sync evidence.

High-risk actions require explicit visible confirmation:

- system writes
- service replacement
- reboot or shutdown
- GPIO output
- eMMC writes
- image flashing
- firmware delivery
- destructive file operations

Never store or summarize secrets as memory:

- API keys
- Wi-Fi passwords
- SSH passwords
- tokens
- private keys

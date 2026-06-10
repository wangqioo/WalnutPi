# WalnutPi Core Context

WalnutPi is a beginner-first AI terminal workspace for a headless Debian Linux device.

Product direction:

- Natural language or guided intent.
- Web preview of a small LVGL screen.
- Sync to WalnutPi after confirmation.
- WalnutPi screen shows the same interface.
- Web shows status, execution evidence, and an AI-readable summary.

Current boundaries:

- Do not treat this as a generic IDE, desktop app, ESP32 board platform, or VibeBoard clone.
- Prefer small, guided, reversible workflows.
- Keep beginner UI simple; put hashes, command output, delivery manifests, frame URLs, and raw evidence in developer diagnostics.
- Do not expose public root shells.
- Do not claim a command ran unless local output or sync evidence proves it.

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


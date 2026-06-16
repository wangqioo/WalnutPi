# Define Walnut Agent Console as the product boundary

WalnutPi uses the Walnut Agent Console as its natural-language product boundary, with the Device Execution Surface providing controlled device capabilities and the Screen Workspace providing the current screen-focused workspace. This keeps the project centered on an AI-native headless-device console instead of drifting into a generic IDE, desktop app platform, ESP32 platform, or unrelated tool launcher.

**Consequences**

IDE-like experiments such as voice input, editor bridges, and terminal tools may be treated as Archived Capabilities or future inputs to the Walnut Agent Console, but they should not become parallel product spines or bypass the existing Local Action and screen-sync safety boundaries.

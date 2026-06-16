# Treat system writes as confirmed operations

WalnutPi treats installation, service changes, boot enablement, `/usr/local/bin` writes, `/opt` writes, package installation, overlays, reboot, shutdown, firmware, flashing, and eMMC changes as System Writes. These operations change the WalnutPi Device system state and must be explicit manual operations or Confirmed Local Actions, not silent Agent side effects.

**Consequences**

Install scripts and service changes should not be hidden behind ordinary chat, repair, or sync flows. New public commands should extend the existing `walnut` Device Execution Surface when possible instead of adding unrelated top-level launchers.

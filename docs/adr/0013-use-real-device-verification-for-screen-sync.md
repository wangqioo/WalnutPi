# Use real-device verification for screen sync

Screen Sync is verified against the real WalnutPi Device, not by browser preview or preview-only local checks. Screen Preview remains useful for creative inspection and safety regression, but Real-Device Verification is required for delivery, activation, service state, frame evidence, or capture evidence because the product promise is that the physical WalnutPi screen runs the intended result.

**Consequences**

Preview-only modes must not build, SSH, deliver, activate, capture, write to the device, or count as sync verification. Tests and documentation should keep preview checks separate from real-device evidence so local convenience does not replace device truth.

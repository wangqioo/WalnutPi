# UI, Vision, Home Assistant, Android

Use for PyQt5, OpenCV, camera/LCD workflows, Home Assistant, MQTT, and Android TV images.

## Source Areas

- PyQt5: `pyQT5/**/*.md`
- OpenCV: `opencv/**/*.md`
- Home Assistant: `home_assistant/**/*.md`
- Android: `android/*.md`
- Display/remote desktop: `os_software/vnc.md`, `os_software/*LCD.md`

## PyQt5

- Prefer desktop images or an enabled display service for GUI work.
- Confirm the display path first: HDMI, VNC, LCD, or local desktop.
- Use system PyQt5 packages when the image already provides them; clean venv PyQt5 wheels may vary by architecture.
- `cv2.imshow` and PyQt5 windows both need a working display path.

## OpenCV

- Prefer installing OpenCV into a clean project venv.
- Keep system Python free of ad hoc global pip packages unless the user explicitly wants to modify the image.
- Verify import with `import cv2`.
- Verify camera devices with `v4l2-ctl --list-devices`; a `/dev/video*` node may not be a USB camera.
- The cloned USB camera example has a variable typo: release the actual camera variable.

## Home Assistant

- Choose between the official HA image and installing HA onto an existing WalnutPi system.
- The official image is simpler; package install preserves the current OS but pulls in heavier services.
- Confirm RAM/image choice before recommending HA.
- For MQTT, verify Mosquitto locally before integrating entities.
- Bluetooth/desktop helper apps may conflict with HA Bluetooth per docs.

## Android

- Android images are board/SOC/RAM specific; verify before flashing.
- Android SD flashing uses PhoenixCard, not normal Linux image flashers.
- H616 and H618 Android images are not interchangeable.
- EMMC flashing, production-card mode, and boot image changes are disruptive.
- TV-box use needs network, input method, display/audio path, and APK install source checked.

Open the exact source page before giving install, flashing, or service-management commands.

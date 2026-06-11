---
name: walnutpi-1b-zerow
description: Work with WalnutPi 1st-generation boards, especially 1B and ZeroW, from the official docs plus optional live board checks. Use when the user mentions WalnutPi, 核桃派, 1B, ZeroW, SSH, GPIO, Blinka, set-device, config.txt, sensors, PyQt5, OpenCV, Home Assistant, MQTT, walnutpi-build, or Android TV.
---

# WalnutPi 1B / ZeroW

## Start

- Prefer local official docs: `walnutpi_wiki/docs/walnutpi_1`.
- If live SSH details are available, verify board state before making hardware claims.
- Treat host, username, and credentials as task-specific; never persist passwords.
- Explain impact before flashing images, changing overlays, touching EMMC, updating firmware, rebooting, or powering off.

Read-only board snapshot:

```sh
hostname
uname -a
cat /etc/WalnutPi-release 2>/dev/null || true
sed -n '1,160p' /boot/config.txt
gpio pins
set-device status
```

Search docs:

```sh
skills/walnutpi-1b-zerow/scripts/walnutpi-doc-search gpio
```

## Route

- Topic map: [DOC_MAP.md](DOC_MAP.md)
- Board, OS, network, display, media: [BOARD_SYSTEM.md](BOARD_SYSTEM.md)
- GPIO, PWM, I2C, SPI, UART, overlays: [GPIO_BUSES.md](GPIO_BUSES.md)
- Python, Blinka, sensors, MQTT: [PYTHON_RECIPES.md](PYTHON_RECIPES.md)
- C, drivers, image build: [C_BUILD.md](C_BUILD.md)
- PyQt5, OpenCV, Home Assistant, Android: [UI_VISION_HOME_ANDROID.md](UI_VISION_HOME_ANDROID.md)
- Practical caveats from one lab board: [LAB_VERIFICATION.md](LAB_VERIFICATION.md)

Open the exact local Markdown or official page before giving detailed pin, install, build, or flashing guidance.

## Rules

- Prefer physical 40-pin header numbers for `gpio`.
- GPIO IO is 3.3V; push back on 5V signals unless level shifting is included.
- For Python, prefer WalnutPi's board-native Blinka adapter and a clean venv with only the required hardware adapter paths added.
- For camera, LCD, VNC, PyQt5, or OpenCV, first confirm the display path and actual `/dev/video*` device.
- For Android, distinguish board RAM/SOC image variants before flashing.

# WalnutPi 1st-Generation Doc Map

Local docs root: `walnutpi_wiki/docs/walnutpi_1`

Official web root: https://wiki.walnutpi.com/docs/walnutpi_1/

Use this as a routing index only. Open the exact local Markdown before giving detailed steps.

## Main Areas

- Intro/spec/download: `intro/`
- Unboxing, assembly, flashing, first boot: `getting_start/`
- Debian system usage: `os_software/`
- GPIO CLI, overlay config, PWM: `gpio/`
- Python, Blinka, GPIO, sensors, MQTT, auto-run: `python/`
- C GPIO/I2C/SPI/UART: `c/`
- PyQt5: `pyQT5/`
- OpenCV: `opencv/`
- Home Assistant and MQTT entities: `home_assistant/`
- Linux/U-Boot/Debian build: `linux_build/`
- Android image, boot, TV box: `android/`
- Community/update pages: `diy.md`, `update.md`

## Search

```sh
skills/walnutpi-1b-zerow/scripts/walnutpi-doc-search '<keyword>'
```

Examples:

```sh
skills/walnutpi-1b-zerow/scripts/walnutpi-doc-search 'VL53L1X'
skills/walnutpi-1b-zerow/scripts/walnutpi-doc-search 'set-device'
skills/walnutpi-1b-zerow/scripts/walnutpi-doc-search 'HomeKit'
```

## Notes

- `pyQT5/publish.md` exists in the clone even if not surfaced in the directory page.
- Some pages contain commands that reboot, flash, erase, or reconfigure overlays; verify target state before running them.

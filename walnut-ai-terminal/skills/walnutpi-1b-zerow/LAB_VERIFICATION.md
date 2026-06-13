# Lab Verification Notes

These notes are practical caveats from one WalnutPi 1B Debian server board. They are not defaults; re-check the target board.

## Confirmed Patterns

- `gpio pins` works and uses physical header numbers.
- Board LED/KEY can be read or toggled with `gpio`; restore output state after experiments.
- `/boot/config.txt` and `set-device status` are the quickest overlay truth sources.
- WalnutPi ships a customized Blinka adapter under `/usr/lib/walnutpi`; keep Python projects isolated while still exposing that adapter to the venv.
- Python OpenCV is cleaner as a venv dependency than a mixed apt/global-pip setup.
- PyQt5 may be easier through the board image's system packages than through a clean venv.
- A `/dev/video*` node may be a platform video device rather than a USB camera; verify with `v4l2-ctl --list-devices` and a capture check.
- ALSA playback was verified on `audiocodec`, HDMI, and a connected `USB2.0 Device`; lower `LINEOUT volume` and USB `PCM` before using `speaker-test`.
- Mosquitto can be validated with a local publish/subscribe loopback before involving Home Assistant.

## Caveats

- Do not use `--system-site-packages` as the normal venv pattern; it can leak conflicting global packages.
- If upstream `Adafruit-Blinka` or `Adafruit-PlatformDetect` appears inside the venv and `board`/`digitalio` break, remove the upstream packages so WalnutPi's adapter is used.
- Keep system Python free of ad hoc global pip packages unless the user explicitly wants to alter the image.
- Treat `set-lcd`, `set-device`, `set-emmc`, flashing, reboot, shutdown, and firmware update commands as disruptive.

## Minimal Checks

```sh
gpio pins
set-device status
python3 - <<'PY'
import board, digitalio, busio
print(board.__file__)
PY
v4l2-ctl --list-devices 2>/dev/null || true
```

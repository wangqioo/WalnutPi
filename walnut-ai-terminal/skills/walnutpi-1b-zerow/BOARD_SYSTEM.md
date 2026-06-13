# Board And System

Use for bring-up, OS image choice, networking, display, storage, audio, IR, camera, and boot behavior.

## Source Areas

- Product and specs: `intro/*.md`
- Assembly and first boot: `getting_start/*.md`
- System usage: `os_software/*.md`

## First Checks

```sh
cat /etc/WalnutPi-release 2>/dev/null || true
cat /etc/os-release
sed -n '1,160p' /boot/config.txt
ip addr
set-device status
```

## Image And Boot

- Confirm board model, SOC/RAM variant, and target storage before recommending an image.
- Desktop images are better for GUI, PyQt5, VNC, and visual demos.
- Server images are better for SSH, GPIO, Python, services, and low memory.
- Windows may only show the boot partition after flashing; do not format the card.
- SD can take boot priority over EMMC; verify hardware before EMMC commands.

## Network And Remote Access

- Use `ip addr` or `ifconfig` to get the board IP.
- Use `nmcli` for WiFi on Debian images.
- SSH/VNC require same LAN reachability and active services.
- If SSH fails after reflashing, suspect stale host keys.

## Displays

- HDMI, VNC, 3.5 LCD, and 1.54 LCD are separate display paths.
- LCD setup changes overlays and usually needs reboot.
- LCDs can consume SPI-related pins; check overlay conflicts before mixing with SPI projects.
- `cv2.imshow`, PyQt5, and desktop apps need a real display path.

## Camera And Media

- Always identify the actual camera node with `v4l2-ctl --list-devices`.
- A `/dev/video*` node is not automatically a USB camera.
- Audio path should be verified with `aplay -l`.
- IR receiver work starts with `ir-keytable`.

## Audio And Speakers

Live checks on one WalnutPi Debian server board found these playback devices:

```text
card 0: audiocodec       CDC PCM Codec-0
card 2: ahubhdmi         HDMI audio
card 3: USB2.0 Device    USB Audio
```

Before any audible test, inspect and lower mixer volume. This board was too loud at `LINEOUT volume` 26/31 and USB `PCM` 75%.

```sh
aplay -l
cat /proc/asound/cards
amixer -c audiocodec sget 'LINEOUT volume' 2>/dev/null || true
amixer -c Device sget PCM 2>/dev/null || true
amixer -c audiocodec sset 'LINEOUT volume' 8 2>/dev/null || true
amixer -c Device sset PCM 25% 2>/dev/null || true
```

Use short, low-volume tests only after warning the user:

```sh
timeout 3 speaker-test -D default -c 2 -t sine -f 440 -l 1
timeout 3 speaker-test -D plughw:CARD=Device,DEV=0 -c 2 -t sine -f 520 -l 1
```

Interpretation:

- `default` currently opens the onboard `audiocodec` path.
- `plughw:CARD=Device,DEV=0` targets the connected USB audio peripheral.
- If the user hears the tone and ALSA reports no error, the speaker path is callable.

## Disruptive Commands

Explain impact and ask before:

- `set-lcd ... install/remove`
- `set-device enable/disable ...` plus reboot
- `set-emmc ...`
- flashing, `dd`, firmware update, reboot, shutdown

Open the exact source page before giving full commands for these.

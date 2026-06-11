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

## Disruptive Commands

Explain impact and ask before:

- `set-lcd ... install/remove`
- `set-device enable/disable ...` plus reboot
- `set-emmc ...`
- flashing, `dd`, firmware update, reboot, shutdown

Open the exact source page before giving full commands for these.

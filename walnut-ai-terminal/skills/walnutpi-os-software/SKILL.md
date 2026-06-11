---
name: walnutpi-os-software
description: Work with WalnutPi OS software docs: Debian system usage, terminal commands, WiFi, time/language, IP, SSH, VNC, device map, EMMC, shutdown, thermal/chip ID, audio, IR, USB disk/camera, LCDs, boot logo, auto-run scripts, and config.txt. Use when the user mentions 核桃派系统使用, WalnutPi OS, WiFi连接, SSH远程终端, VNC远程桌面, config.txt, set-vnc, set-lcd, USB摄像头, U盘挂载, EMMC, 主控温度, 主控ID号, or 开机自动运行脚本.
---

# WalnutPi OS Software

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/os_software`
- Covers `os_intro.md`, `software.md`, `terminal.md`, `wifi.md`, `date.md`, `language.md`, `ip_get.md`, `ssh.md`, `vnc.md`, `map_device.md`, `emmc.md`, `log_out.md`, `core_temp.md`, `cpu_id.md`, `audio.md`, `ir.md`, `usb_disk.md`, `usb_cam.md`, `3.5_LCD.md`, `1.54_LCD.md`, `boot_logo.md`, `auto_run.md`, `config.txt.md`.

## Frequent Commands

```sh
cat /etc/WalnutPi-release
ip addr
sudo ifconfig
nmcli dev wifi
sudo nmcli dev wifi connect '<SSID>' password '<PASSWORD>'
set-vnc enable
set-vnc disable
sed -n '1,160p' /boot/config.txt
```

## Rules

- Open the exact Markdown page before giving step-by-step setup.
- Treat EMMC, reboot, poweroff, `wpi-update`, and config edits as disruptive.
- `config.txt` is available at `/boot/config.txt` on the board.

# WalnutPi Hardware Notes

This document records the hardware and system details observed from the current WalnutPi prototype device.

The goal is to help future contributors understand what this specific device can do before reading the application code.

## System Summary

Observed from the running device:

```text
OS: Debian GNU/Linux 12 bookworm
Architecture: aarch64 / arm64
Kernel: Linux 6.1.31
Memory: 3.8 GiB
Root storage: 14.6 GiB ext4 on microSD/eMMC block device
Boot partition: 143 MiB vfat
Default operation mode: headless CLI / SSH
```

Kernel string:

```text
Linux WalnutPi 6.1.31 #15 SMP Tue Mar 4 15:07:33 CST 2025 aarch64 GNU/Linux
```

CPU information from `/proc/cpuinfo` shows four ARMv8 cores with CPU part `0xd03`, which corresponds to Cortex-A53-class cores.

## Storage Layout

Observed with `lsblk`:

```text
NAME         SIZE TYPE FSTYPE MOUNTPOINTS
mmcblk0     14.8G disk
├─mmcblk0p1  143M part vfat   /boot
└─mmcblk0p2 14.6G part ext4   /
```

## Memory

Observed with `free -h`:

```text
Mem:  3.8Gi total
Swap: 0B
```

## Display / Screen

The attached screen is exposed as a Linux framebuffer device.

Framebuffer information:

```text
Framebuffer: /dev/fb0
Driver name: wpi_fb_st7796
Mode: U:480x320p-0
Virtual size: 480,320
Bits per pixel: 16
```

Important dmesg lines:

```text
SPI driver wpi_fb_st7796 has no spi_device_id for walnutpi,lcd35_st7796
wpi_fb_st7796 spi1.0: fbtft_property_value: regwidth = 10
wpi_fb_st7796 spi1.0: fbtft_property_value: buswidth = 8
wpi_fb_st7796 spi1.0: fbtft_property_value: rotate = 90
wpi_fb_st7796 spi1.0: fbtft_property_value: fps = 30
graphics fb0: wpi_fb_st7796 frame buffer, 480x320, 300 KiB video memory, 32 KiB buffer memory, fps=31, spi1.0 at 70 MHz
```

Practical interpretation:

- The built-in display is a 480x320 SPI framebuffer screen.
- The panel driver is `wpi_fb_st7796`.
- The underlying LCD controller is ST7796-class.
- It is rotated by 90 degrees in the driver configuration.
- It runs around 30 FPS.
- It is suitable for simple terminal UI, static cards, status panels, and lightweight framebuffer rendering.
- It is not suitable for heavy desktop compositing or complex animation.
- It is too small for unmodified DOSBox 0.74 on Debian bookworm. That DOSBox build tries to initialize a 640x400 video mode during startup, and exits on this panel with `Could not initialize video: No video mode large enough for 640x400`.

This screen fits the WalnutAI Terminal direction well: command-line-first input and lightweight card-like output.

## Touchscreen

The device also exposes an ADS7846 touchscreen controller.

Relevant dmesg lines:

```text
ads7846 spi1.1: touchscreen, irq 70
input: ADS7846 Touchscreen as /devices/platform/soc/5011000.spi/spi_master/spi1/spi1.1/input/input1
```

Practical interpretation:

- Touch input exists at the kernel/input-device level.
- Future UI experiments can read Linux input events directly.
- The current WalnutAI Terminal V0 does not use touch yet.

## Graphics / GPU

Observed graphics-related kernel components:

```text
sun4i-drm display-engine
sun8i-dw-hdmi
panfrost 1800000.gpu
```

Relevant dmesg lines include:

```text
panfrost 1800000.gpu: clock rate = 432000000
panfrost 1800000.gpu: bus_clock rate = 200000000
```

Practical interpretation:

- The SoC has a Mali-class GPU exposed through Panfrost.
- HDMI/display-engine components are present.
- The small built-in LCD is currently handled as an SPI framebuffer, not as a normal desktop display.
- For this project, framebuffer/TUI/LVGL-style UI is a better fit than a full desktop stack.

## Audio

Known audio facts from experiments:

- HDMI audio devices are present.
- PulseAudio can route Bluetooth A2DP playback to AirPods.
- AirPods playback works.
- AirPods microphone capture does not work through the onboard Bluetooth controller on the current system.

See:

```text
audio/airpods-linux/README.md
```

## Bluetooth

The onboard Bluetooth controller is exposed as a UART Bluetooth device.

Observed related modules:

```text
sprdbt_tty
uwe5622_bsp_sdio
hci_uart
bluetooth
```

AirPods playback is usable, but HFP/SCO microphone capture failed because SCO RX packets did not arrive in Linux over HCI.

## Network

Wi-Fi is managed by NetworkManager.

The device has been configured with multiple saved Wi-Fi profiles so it can be moved between locations.

## Current Running Services

At the time of documentation, this prototype device runs:

```text
docker.service: active
frpc.service: active
bluetooth.service: active
uptime-kuma container: healthy
```

## Implications for Product Direction

This hardware is a good fit for:

- headless Linux AI terminal experiments
- framebuffer or terminal-native UI
- simple card rendering
- local status dashboard
- cloud-AI interaction shell
- portable note/translation/polish tools
- future voice input with an external USB microphone

This hardware is not a good fit for:

- local large model inference
- heavy desktop Linux UI
- Android-style multi-app UI
- GPU-heavy animation
- relying on onboard Bluetooth headset microphone capture

## Useful Hardware Inspection Commands

```bash
uname -a
cat /etc/os-release
cat /proc/cpuinfo
free -h
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS

cat /sys/class/graphics/fb0/name
cat /sys/class/graphics/fb0/modes
cat /sys/class/graphics/fb0/virtual_size
cat /sys/class/graphics/fb0/bits_per_pixel

dmesg | grep -iE 'fb|framebuffer|st7796|lcd|display|drm|gpu|mali|panel|spi|tft|hdmi'
dmesg | grep -iE 'ads7846|touch|input'
lsmod | grep -iE 'fb|st7796|drm|mali|gpu|spi|lcd|tft|wpi'
```

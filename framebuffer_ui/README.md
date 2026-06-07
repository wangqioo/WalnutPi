# Framebuffer UI

`framebuffer_ui/` is a minimal no-desktop drawing experiment for the WalnutPi
built-in screen.

It bypasses the terminal and writes RGB565 pixels directly to `/dev/fb0`.

Observed target screen:

```text
device: /dev/fb0
driver: wpi_fb_st7796
size: 480x320
bits_per_pixel: 16
stride: 960
mode: U:480x320p-0
```

## Check Screen Info

On the WalnutPi:

```bash
cd /home/pi/projects/WalnutPi
PYTHONPATH=$PWD python3 -m framebuffer_ui.fb_info
```

## Draw Demos

Draw a color test pattern:

```bash
cd /home/pi/projects/WalnutPi
PYTHONPATH=$PWD python3 -m framebuffer_ui.draw_demo test
```

Draw a simple device status card:

```bash
cd /home/pi/projects/WalnutPi
PYTHONPATH=$PWD python3 -m framebuffer_ui.draw_demo card
```

Blank the screen:

```bash
cd /home/pi/projects/WalnutPi
PYTHONPATH=$PWD python3 -m framebuffer_ui.draw_demo off
```

These commands overwrite the current screen contents until fbterm or another
program repaints the framebuffer.

## Draw Image Files

Display a JPG or PNG file:

```bash
cd /home/pi/projects/WalnutPi
PYTHONPATH=$PWD python3 -m framebuffer_ui.draw_image /path/to/image.jpg
```

Through Walnut Home:

```bash
walnut screen image /path/to/image.jpg
```

Other Walnut Home screen commands:

```bash
walnut screen status    # start live status service
walnut screen test      # draw test pattern once
walnut screen demo      # draw demo status card once
walnut screen off       # blank framebuffer once
walnut screen restore   # stop status service and restore tty1
walnut screen ai        # draw local health summary as an AI card
walnut screen ai text   # draw text as an AI reply card
walnut screen app       # run keyboard-driven screen app
```

One-shot drawing commands stop the live status service first, so the service
does not overwrite the image immediately.

The screen app is the first interactive runtime. It reads keyboard input from
the local terminal:

```text
j/k or arrow keys  move selection
Enter              open page
b                  back to menu
q                  quit
```

Image display uses `python3-opencv` on the WalnutPi. The image is letterboxed to
fit the 480x320 framebuffer and converted to RGB565 before writing `/dev/fb0`.

## Draw Live Status

Draw one live status frame:

```bash
cd /home/pi/projects/WalnutPi
PYTHONPATH=$PWD python3 -m framebuffer_ui.draw_status --print
```

Refresh the status card every 5 seconds:

```bash
cd /home/pi/projects/WalnutPi
PYTHONPATH=$PWD python3 -m framebuffer_ui.draw_status --watch 5
```

This direct command does not stop `fbterm` or `getty@tty1`, so the text cursor
can still appear on top of the framebuffer image.

## Run As A Screen Service

Install the systemd unit:

```bash
cd /home/pi/projects/WalnutPi
sudo ./scripts/install-framebuffer-status.sh
```

Start the status screen:

```bash
sudo systemctl start walnut-framebuffer-status.service
```

Stop it and restore the normal local tty:

```bash
sudo systemctl stop walnut-framebuffer-status.service
```

Enable it at boot:

```bash
sudo systemctl enable walnut-framebuffer-status.service
```

The service kills `fbterm` before drawing, so the framebuffer UI can own the
small screen without a blinking text cursor. It does not stop `getty@tty1`;
stopping the service starts `getty@tty1` again so the local login path is
available.

The status card reads:

- `/proc/loadavg` for load average
- `/proc/meminfo` for memory usage
- `df -h /` for disk usage
- `ip -br addr` for the first non-loopback IPv4 address
- `systemctl is-active frpc`
- `systemctl is-active docker`

## Why This Exists

The normal Linux terminal can only show characters and ANSI colors. The
framebuffer is different: it exposes the screen as a pixel buffer.

This module proves the server/no-desktop system can still show real graphics
without X11, Wayland, Chromium, or a full desktop environment.

## Next Steps

- Add real system metrics to the card.
- Add Chinese text rendering through a bitmap font.
- Add touch input through the ADS7846 input device.
- Evaluate LVGL once the basic framebuffer path is stable.

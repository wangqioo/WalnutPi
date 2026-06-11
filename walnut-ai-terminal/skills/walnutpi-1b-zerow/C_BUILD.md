# C, Drivers, And Image Build

Use for C examples, board-side driver work, kernel/U-Boot/Debian builds, and `walnutpi-build`.

## Source Areas

- C examples: `c/*.md`
- Image/kernel/rootfs build: `linux_build/*.md`
- Overlays/config: `gpio/gpio_config.md`, `os_software/config.txt.md`

## Board-Native C

- Simple C can compile directly on the board with `gcc`.
- GPIO C examples include `gpio.h` and link with `-lgpio`.
- Hardware access may require root privileges.
- Use `gpio pins` before hard-coding header numbers.

Minimal compile shape:

```sh
gcc -Wall -o app app.c -lgpio
sudo ./app
```

## Bus Examples

- I2C examples need the matching I2C overlay and `/dev/i2c-*`.
- SPI examples need a spidev overlay and `/dev/spidev*`.
- UART examples need the matching UART overlay and `/dev/ttyS*`.
- Overlay changes usually require reboot.
- SPI LCDs can conflict with spidev overlays.

Do not give exact bus code until the target bus, pins, overlay, and device node are confirmed.

## Image And Kernel Builds

- `walnutpi-build` is the official image build workflow.
- Host build docs assume a normal Linux host, not necessarily the board.
- Kernel, U-Boot, and Debian rootfs commands are target-sensitive; open the exact `linux_build/*.md` page before giving commands.
- Any `dd`, mount, partition, or artifact copy command needs explicit target-device confirmation.

## Board-Side Driver Build

- Build against `/lib/modules/$(uname -r)/build` when headers are installed.
- Device tree overlays are installed through `/boot/overlays` and enabled through config/overlay tooling.
- Treat driver install, overlay install, and reboot as disruptive actions.

---
name: walnutpi-gpio
description: Work with WalnutPi GPIO application docs: GPIO intro, gpio command operation, GPIO device configuration with set-device, and PWM. Use when the user mentions GPIO应用, GPIO介绍, GPIO指令操作, GPIO设备配置, PWM, gpio pins, gpio readall, set-device, /boot/overlays, physical pin numbers, or WalnutPi pin functions.
---

# WalnutPi GPIO

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/gpio`
- `gpio_intro.md`: GPIO介绍
- `gpio_command.md`: GPIO指令操作
- `gpio_config.md`: GPIO设备配置
- `pwm.md`: PWM

## Core Commands

```sh
gpio pins
gpio readall
gpio pin i2c
gpio pin spi
gpio pin uart
gpio pin pwm
gpio mode 42 out
gpio write 42 0
gpio read 41
set-device status
```

## Rules

- WalnutPi OS v2.3+ uses physical header numbers for `gpio`.
- GPIO logic is 3.3V.
- `set-device enable/disable` changes overlays and needs reboot.
- Check conflicts before enabling SPI/UART/PWM/LCD overlays.

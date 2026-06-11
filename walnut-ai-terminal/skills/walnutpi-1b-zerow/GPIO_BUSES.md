# GPIO And Buses

Use for GPIO, PWM, I2C, SPI, UART, and overlay decisions.

## Source Areas

- GPIO intro/commands/config: `gpio/*.md`
- PWM: `gpio/pwm.md`
- C bus examples: `c/i2c.md`, `c/spi.md`, `c/uart.md`
- Python GPIO examples: `python/gpio/*.md`

## Ground Rules

- GPIO uses 3.3V logic.
- Prefer physical 40-pin header numbers for the `gpio` CLI.
- Use Blinka names such as `board.LED`, `board.KEY`, `board.SCL1`, and `board.SDA1` in Python.
- Do not assume a pin is free; overlays may already own it.

## First Checks

```sh
gpio pins
gpio pin i2c
gpio pin spi
gpio pin uart
gpio pin pwm
set-device status
sed -n '1,160p' /boot/config.txt
```

## Known Board Signals

- Board LED: `board.LED`, physical LED signal in `gpio pins`.
- Board KEY: `board.KEY`, released/pressed level should be verified live.
- When toggling outputs, read the initial state and restore it.

## Overlay Rules

- `set-device` changes device tree overlays and generally requires reboot.
- SPI LCDs, spidev overlays, touch, UART, and PWM can conflict.
- Check current overlays before enabling `uart4`, `spidev*`, or extra I2C/PWM functions.

## Python Patterns

```python
import board, busio
i2c = busio.I2C(board.SCL1, board.SDA1)
```

```python
import serial
com = serial.Serial("/dev/ttyS2", 115200)
```

## C Patterns

- GPIO C examples use WalnutPi `gpio.h` and link with `-lgpio`.
- I2C examples operate `/dev/i2c-*`.
- SPI examples operate `/dev/spidev*`; enable the matching spidev overlay first.
- UART examples operate `/dev/ttyS*`; enable the matching UART overlay first.

Open the exact source page before giving full code or overlay commands.

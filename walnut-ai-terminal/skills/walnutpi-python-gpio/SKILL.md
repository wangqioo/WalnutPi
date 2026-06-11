---
name: walnutpi-python-gpio
description: Work with WalnutPi Python GPIO basic experiments: LED, key/button, active buzzer, UART serial communication, and I2C OLED display using Blinka and board pin names. Use when the user mentions Python GPIO基础实验, 点亮LED, 按键, 有源蜂鸣器, UART串口通讯, I2C OLED, board.LED, board.KEY, /dev/ttyS2, or SSD1306 on WalnutPi.
---

# WalnutPi Python GPIO

## Sources

- Local docs root: `walnutpi_wiki/docs/walnutpi_1/python/gpio`
- GPIO intro: `gpio_intro.md`
- LED: `led.md`
- Key: `key.md`
- Active buzzer: `active_buzzer.md`
- UART: `uart.md`
- I2C OLED: `i2c_oled.md`

## Quick Checks

```sh
gpio pins
gpio pin uart
gpio pin i2c
set-device status
```

## Experiments

| Topic | Doc | Hardware / API |
| --- | --- | --- |
| LED | `led.md` | `board.LED`, `DigitalInOut`, output |
| Key | `key.md` | `board.KEY`, input with pull-up; released high, pressed low |
| Active buzzer | `active_buzzer.md` | `board.PI15`, output; use 3.3V module |
| UART | `uart.md` | UART2 pins TX2/RX2, `/dev/ttyS2`, `serial.Serial(..., 115200)` |
| OLED | `i2c_oled.md` | I2C1 `board.SCL1/SDA1`, SSD1306 address `0x3C` |

## Digital IO Pattern

```python
import board
from digitalio import DigitalInOut, Direction, Pull

led = DigitalInOut(board.LED)
led.direction = Direction.OUTPUT

key = DigitalInOut(board.KEY)
key.direction = Direction.INPUT
key.pull = Pull.UP
```

## UART Pattern

```python
import serial
com = serial.Serial("/dev/ttyS2", 115200)
com.write(b"Hello WalnutPi!\r\n")
```

Use a 3.3V USB-TTL adapter and cross TX/RX.

## I2C OLED Pattern

```python
import board, busio
import adafruit_ssd1306

i2c = busio.I2C(board.SCL1, board.SDA1)
display = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c, addr=0x3C)
```

Before debugging code, verify I2C overlays and live pins.

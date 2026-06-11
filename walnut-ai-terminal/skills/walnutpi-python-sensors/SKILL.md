---
name: walnutpi-python-sensors
description: Work with WalnutPi Python sensor experiments: human induction/PIR, HC-SR04 ultrasonic distance, BMP280 pressure, MPU6050 IMU, VL53L1X ToF distance, and MLX90614 IR temperature. Use when the user mentions WalnutPi sensors, 人体感应, HC-SR04, BMP280, MPU6050, VL53L1X, MLX90614, I2C1, PC9, PC11, or sensor wiring/code on WalnutPi.
---

# WalnutPi Python Sensors

## Sources

- Local docs root: `walnutpi_wiki/docs/walnutpi_1/python/sensor`
- Human induction: `human_induction.md`
- HC-SR04: `hcsr04.md`
- BMP280: `bmp280.md`
- MPU6050: `mpu6050.md`
- VL53L1X: `vl53l1x.md`
- MLX90614: `mlx90614.md`

## Hardware Rules

- WalnutPi GPIO is 3.3V logic.
- Verify module output voltage before connecting Echo/signal pins.
- For I2C sensors, verify I2C1 pins and overlays first:

```sh
gpio pin i2c
set-device status
gpio pins
```

## Sensor Matrix

| Sensor | Doc | Interface | Pins / Address |
| --- | --- | --- | --- |
| Human induction/PIR | `human_induction.md` | Digital input | signal to `board.PC8`; high means detected |
| HC-SR04 | `hcsr04.md` | Two GPIO | trigger `board.PC9`, echo `board.PC11` |
| BMP280 | `bmp280.md` | I2C1 | address `0x76`, or `0x77` if SDO pulled high |
| MPU6050 | `mpu6050.md` | I2C1 | address `0x68` |
| VL53L1X | `vl53l1x.md` | I2C1 | address `0x29` |
| MLX90614 | `mlx90614.md` | I2C1 | address `0x5a` |

## I2C Pattern

```python
import board, busio
i2c = busio.I2C(board.SCL1, board.SDA1)
```

Constructors from docs:

```python
bmp280 = adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=0x76)
mpu = adafruit_mpu6050.MPU6050(i2c, address=0x68)
vl53 = adafruit_vl53l1x.VL53L1X(i2c, address=0x29)
mlx = adafruit_mlx90614.MLX90614(i2c, address=0x5a)
```

## GPIO Sensor Pattern

```python
import board
from digitalio import DigitalInOut, Direction

human = DigitalInOut(board.PC8)
human.direction = Direction.INPUT
```

Open the exact sensor Markdown before giving complete code or wiring diagrams.

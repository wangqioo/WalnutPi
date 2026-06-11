# Python And Blinka

Local docs:

- `python/python_run.md`
- `python/blinka_intro.md`
- `python/gpio/*.md`
- `python/sensor/*.md`
- `python/module/relay.md`
- `python/network/*.md`
- `python/skills/*.md`

## Environment

Use a clean venv for project dependencies, then add only WalnutPi hardware adapter paths:

```sh
python3 -m venv .venv
. .venv/bin/activate
site_dir=$(python - <<'PY'
import site
print(site.getsitepackages()[0])
PY
)
printf "%s\n" \
  /usr/lib/walnutpi/gpioc \
  /usr/lib/walnutpi/Adafruit_Blinka/src \
  /usr/lib/walnutpi/Adafruit_Python_PlatformDetect \
  > "$site_dir/walnutpi-hardware.pth"
python -m pip install PACKAGE...
```

Avoid `--system-site-packages` unless deliberately debugging the board image. If `board` or `digitalio` fails after installing Adafruit packages, check whether upstream Blinka replaced WalnutPi's adapter.

## Run Python

- Terminal: `python script.py`.
- Desktop images can use Thonny locally.
- Remote Thonny over SSH is useful on low-memory boards.
- VS Code Remote SSH works but is heavier.

## GPIO Pattern

```python
import board
from digitalio import DigitalInOut, Direction, Pull

led = DigitalInOut(board.LED)
led.direction = Direction.OUTPUT
led.value = True

key = DigitalInOut(board.KEY)
key.direction = Direction.INPUT
key.pull = Pull.UP
```

Before blaming code, verify:

```sh
gpio pins
gpio pin i2c
set-device status
```

## Buses And Sensors

- Use `board.SCL1` and `board.SDA1` for the common I2C1 examples unless the user asks for another bus.
- Use `/dev/ttyS2` for the UART2 example; confirm TX/RX pins and 3.3V logic.
- Sensor docs follow the same shape: create `busio.I2C(...)`, instantiate the sensor library, then read properties.
- Hardware reads require the matching sensor to be connected and visible on the bus.

## MQTT

- Python docs use `paho-mqtt`.
- Validate local brokers with a simple publish/subscribe loopback before wiring Home Assistant.
- Treat public demo brokers from docs as demos only.

## Auto-Run

- Boot scripts can go under `/boot/start`.
- Desktop and server auto-run targets differ; open `python/skills/auto_run.md` before editing boot behavior.

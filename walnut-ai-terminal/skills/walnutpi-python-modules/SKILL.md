---
name: walnutpi-python-modules
description: Work with WalnutPi Python extension module experiments, especially relay control with Blinka digital IO and board buttons. Use when the user mentions WalnutPi 拓展模块, 继电器, relay, high-voltage switching, board.PC8, board.KEY, or Python module control on WalnutPi.
---

# WalnutPi Python Modules

## Sources

- Local docs root: `walnutpi_wiki/docs/walnutpi_1/python/module`
- Relay: `relay.md`

## Relay Rules

- WalnutPi GPIO output is 3.3V.
- Prefer relay modules that accept 3.3V control.
- Do not connect 5V signal input directly to GPIO unless the module explicitly accepts 3.3V high and does not back-drive the pin.
- Be careful with mains/high voltage wiring; keep control and load sides clear.

## Relay Pattern

Docs use:

- Relay signal: `board.PC8`
- Button switch: `board.KEY`

```python
import board, time
from digitalio import DigitalInOut, Direction, Pull

relay = DigitalInOut(board.PC8)
relay.direction = Direction.OUTPUT

switch = DigitalInOut(board.KEY)
switch.direction = Direction.INPUT
switch.pull = Pull.UP
```

Open `relay.md` before giving the full button-toggle implementation.

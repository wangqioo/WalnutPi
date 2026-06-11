---
name: walnutpi-python
description: Work with WalnutPi 1st-generation Python embedded programming, including running Python, remote Thonny/VS Code workflows, and the customized WalnutPi Blinka library. Use when the user mentions WalnutPi Python, 核桃派 Python嵌入式编程, 运行Python代码, Blinka, board pins, Thonny remote, or VS Code SSH on WalnutPi.
---

# WalnutPi Python

## Sources

- Local docs root: `walnutpi_wiki/docs/walnutpi_1/python`
- Run Python: `python/python_run.md`
- Blinka intro: `python/blinka_intro.md`
- Parent reference: `skills/walnutpi-1b-zerow/PYTHON_RECIPES.md`

## Quick Start

Run on the board:

```sh
python hello_walnutpi.py
python
```

Search official local docs:

```sh
skills/walnutpi-1b-zerow/scripts/walnutpi-doc-search "运行Python代码"
skills/walnutpi-1b-zerow/scripts/walnutpi-doc-search Blinka
```

## Working Rules

- Prefer running code on the WalnutPi board for hardware examples.
- Use the local cloned Markdown before giving exact setup steps.
- WalnutPi OS ships a customized Blinka at `/usr/lib/walnutpi/Adafruit_Blinka`.
- For Thonny remote interpreter setup, the docs use `Python3` with uppercase `P`.
- VS Code Remote SSH works but uses more memory; prefer terminal or Thonny for small boards.
- Use child skills for specific topics:
  - `walnutpi-python-gpio`
  - `walnutpi-python-sensors`
  - `walnutpi-python-modules`
  - `walnutpi-python-network`
  - `walnutpi-python-tips`

## Blinka Pattern

```python
import board
from digitalio import DigitalInOut, Direction, Pull
```

Common pins:

- LED: `board.LED`
- Key: `board.KEY`
- I2C1: `board.SCL1`, `board.SDA1`
- Example GPIOs: `board.PC8`, `board.PC9`, `board.PC11`, `board.PI15`

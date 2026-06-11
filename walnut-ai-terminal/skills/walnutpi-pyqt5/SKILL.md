---
name: walnutpi-pyqt5
description: Work with WalnutPi PyQt5 docs: intro, development setup, first window, code run, signal/slot, and packaging. Use when the user mentions PyQt5, Qt Designer, 第一个窗口, 代码编写和运行, 信号和槽, 打包发布, pyuic, DISPLAY=:0.0, lightdm, or WalnutPi GUI apps.
---

# WalnutPi PyQt5

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/pyQT5`
- `pyqt5_intro.md`, `development_setup.md`, `first_window.md`, `code_run.md`, `signal_slot.md`, `publish.md`

## Commands And Patterns

```sh
python -m PyQt5.uic.pyuic window.ui -o window.py
sudo systemctl enable lightdm.service
sudo systemctl disable lightdm.service
```

Remote GUI run:

```python
import os
os.environ["DISPLAY"] = ":0.0"
```

## Child Skills

- `walnutpi-pyqt5-widgets`
- `walnutpi-pyqt5-buttons`
- `walnutpi-pyqt5-display`
- `walnutpi-pyqt5-input`
- `walnutpi-pyqt5-paint`
- `walnutpi-pyqt5-paint-shape`
- `walnutpi-pyqt5-paint-text`

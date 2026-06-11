---
name: walnutpi-python-tips
description: Work with WalnutPi Python usage tips, including auto-running Python at boot and calling terminal commands from Python. Use when the user mentions WalnutPi Python其它使用技巧, 开机自动运行Python代码, Python调用终端命令, /boot/start, systemctl start.service, os.popen, or boot scripts.
---

# WalnutPi Python Tips

## Sources

- Local docs root: `walnutpi_wiki/docs/walnutpi_1/python/skills`
- Auto-run Python: `auto_run.md`
- Python calls terminal command: `command.md`
- System boot script page: `walnutpi_wiki/docs/walnutpi_1/os_software/auto_run.md`

## Auto-Run Python

- System-level boot scripts can be placed under `/boot/start`.
- Boot scripts should be `.sh` files.
- Example line from docs:

```sh
sudo python /home/pi/led_blink.py &
```

- For systemd-based startup, open `python/skills/auto_run.md` and follow its exact service file path/content.
- Avoid starting long-running foreground scripts without `&` or a service manager.

## Calling Terminal Commands

- Docs demonstrate `os.popen`.
- Do not embed plaintext sudo passwords in new code.
- Prefer least-privilege commands and explicit error handling for new examples.

Basic pattern:

```python
import os
res = os.popen("cat /sys/class/thermal/thermal_zone2/temp").read()
print(res)
```

For commands needing root, prefer explaining permission requirements instead of hardcoding passwords.

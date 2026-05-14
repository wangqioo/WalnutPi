# Console Chinese Display

This note records how the WalnutPi local framebuffer console was made usable for Chinese text.

## Problem

The default Linux virtual console can use UTF-8 locale, but its built-in console font cannot render Chinese glyphs. As a result, Chinese text may show as blank blocks or broken characters on the built-in screen, even though SSH displays Chinese correctly on a computer terminal.

## Solution

Use `fbterm`, a framebuffer terminal emulator, with installed Chinese fonts.

Installed fonts found on this device include:

- WenQuanYi Zen Hei Mono
- Noto Sans Mono
- Droid Sans Fallback

The helper command is installed at:

```bash
/usr/local/bin/walnut-cn
```

It starts `fbterm` on the local screen and then launches `walnut`. Over SSH it falls back to normal `walnut`, because the computer terminal already handles Chinese display.

## Manual Use

On the WalnutPi local screen:

```bash
walnut-cn
```

For a basic display test:

```bash
echo 中文测试
```

## Default Local Console

The local login shell for both `root` and `pi` calls `/usr/local/bin/walnut-login-choice` from `.bashrc` and shows a small choice menu on the built-in screen:

```bash
# WalnutPi local login choice
if [ -z "${SSH_TTY:-}" ] && [ -t 0 ] && [ "$(tty)" = "/dev/tty1" ] && command -v walnut-login-choice >/dev/null 2>&1; then
  . /usr/local/bin/walnut-login-choice
fi
```

Menu shown on local login:

```text
1. Chinese console: fbterm
2. Normal Linux tty
3. Walnut Home
```

Option `3` now launches Walnut Home through `fbterm` when available, so the main device UI uses the same framebuffer font path as the Chinese console.

If no key is pressed for 8 seconds, it stays in the normal Linux tty.

The guard is intentionally narrow:

- Only local `tty1` triggers it.
- SSH sessions are not affected.
- `WALNUT_LOGIN_CHOICE` prevents recursive relaunch.
- If `fbterm` is missing, it stays in the normal shell.

## Config Files

Reference config stored in this repo:

```bash
console-chinese/fbtermrc
console-chinese/walnut-cn
console-chinese/walnut-login-choice
```

Installed locations on the device:

```bash
/root/.fbtermrc
/home/pi/.fbtermrc
/usr/local/bin/walnut-cn
/usr/local/bin/walnut-login-choice
```

## Limitation

This solves Chinese display. Chinese input on a pure CLI local screen still needs a console input method, which is a separate task. For now, Chinese input is easiest over SSH from a computer or through cloud AI/voice workflows.

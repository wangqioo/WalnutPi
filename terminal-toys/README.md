# Terminal Toys

This folder records pure terminal/TUI tools installed on the WalnutPi. The device has no desktop environment, so these apps are chosen to run directly in SSH, serial console, or the local terminal screen.

## Launcher

Run:

```bash
walnut
```

The main launcher now lives in `walnut`. The tools in this folder are opened through `walnut play`, which provides music, browser, monitoring, clock, ASCII video demos, and a Matrix-style digital rain effect through `cmatrix`.

Best quick picks:

- `1` Music player
- `2` Music visualizer
- `5` Matrix rain
- `6` ASCII video
- `7` Clock

Compatibility entrypoint:

```bash
walnut-fun
```

This now forwards to:

```bash
walnut play
```

Source copy:

```bash
terminal-toys/walnut-fun
```

Installed system path:

```bash
/usr/local/bin/walnut-fun
```

## Installed Tools

| Tool | Purpose | Command |
| --- | --- | --- |
| cmus | terminal music player | `cmus` |
| cmatrix | Matrix-style terminal rain effect | `cmatrix -ab` |
| cava | music visualizer | `cava` |
| w3m | terminal web browser | `w3m` |
| lynx | terminal web browser fallback | `lynx` |
| btop | large-terminal system monitor | `btop` |
| htop | compact system monitor | `htop` |
| tty-clock | terminal clock | `tty-clock` |

## Music Library

The launcher creates this symlink so terminal music players can find songs easily:

```bash
$HOME/Music/WalnutMusic -> $HOME/music-library
```

It also writes a `cmus` playlist:

```bash
$HOME/.config/cmus/walnut-library.pls
```

Current local library: 14 public-domain test tracks under `$HOME/music-library`.

## Small Screen Notes

The built-in WalnutPi screen is only 480x320. `walnut play` uses `htop` as the small-screen monitor and keeps `btop` as the large-terminal option for SSH sessions.

`cmatrix` is a good fit for the built-in screen because it runs directly in the terminal without needing X11 or Wayland. On the local device, it works best from the framebuffer terminal path already used elsewhere in this repo.

## AirPods Playback Note

For AirPods playback, keep Bluetooth in A2DP music mode:

```bash
vk-airpods-audio
```

If audio only plays for a moment and then goes silent, BlueALSA may have grabbed the Bluetooth device. Keep PulseAudio as the playback path:

```bash
systemctl disable --now bluealsa
pkill -f '^/usr/bin/bluealsa-aplay' || true
vk-airpods-audio
```

## Filesystem Safety

The WalnutPi previously had a read-only filesystem incident after network music download tests. Before heavy installs or downloads, check that root is mounted read-write and has enough free space:

```bash
mount | grep ' on / '
df -h /
```

If `/` is mounted read-only or commands report input/output errors, stop writing files and inspect storage before continuing.

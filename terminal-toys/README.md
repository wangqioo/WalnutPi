# Terminal Toys

This folder records pure terminal/TUI tools installed on the WalnutPi. The device has no desktop environment, so these apps are chosen to run directly in SSH, serial console, or the local terminal screen.

## Launcher

Run:

```bash
walnut-fun
```

The launcher opens a simple menu for music, browser, monitoring, disk usage, games, clock, and AirPods playback mode. It also prepares the local music library before opening `cmus`.

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
| moc | terminal music player daemon/client | `mocp` |
| cava | music visualizer | `cava` |
| w3m | terminal web browser | `w3m` |
| lynx | terminal web browser | `lynx` |
| btop | system monitor | `btop` |
| htop | process monitor | `htop` |
| ncdu | disk usage browser | `ncdu /` |
| NetHack | terminal game | `nethack` |
| Moon Buggy | terminal game | `moon-buggy` |
| tty-clock | terminal clock | `tty-clock` |

## Music Library

The launcher creates this symlink so terminal music players can find songs easily:

```bash
/root/Music/WalnutMusic -> /root/music-library
```

It also writes a `cmus` playlist:

```bash
/root/.config/cmus/walnut-library.pls
```

Current local library: 14 public-domain test tracks under `/root/music-library`.

## Small Screen Notes

The built-in WalnutPi screen is only 480x320. `btop` may refuse to run or look cramped on that screen, so `walnut-fun` uses `htop` as the small-screen monitor and keeps `btop` as the large-terminal option for SSH sessions.

The games are installed under `/usr/games`, so the launcher calls them with absolute paths:

```bash
/usr/games/nethack
/usr/games/moon-buggy
```

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

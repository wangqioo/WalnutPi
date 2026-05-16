# 终端玩具

这个目录记录 WalnutPi 上安装的纯终端 / TUI 工具。设备没有桌面环境，所以这些应用都优先选择可以直接在 SSH、串口控制台或本地终端屏幕里运行的版本。

## 启动入口

先运行：

```bash
walnut
```

主启动器已经统一到 `walnut`。这里面的工具通过 `walnut play` 打开，包含音乐、数字雨、时钟和 ASCII 视频演示，底层主要依赖 `cmatrix` 和 `tty-clock`。

推荐先试：

- `1` 音乐播放器
- `2` 音乐可视化
- `3` 数字雨
- `4` ASCII 视频
- `5` 时钟

兼容入口：

```bash
walnut-fun
```

它现在会转发到：

```bash
walnut play
```

源码对应：

```bash
terminal-toys/walnut-fun
```

安装后的系统路径：

```bash
/usr/local/bin/walnut-fun
```

## 已安装工具

| 工具 | 用途 | 命令 |
| --- | --- | --- |
| cmus | 终端音乐播放器 | `cmus` |
| cmatrix | 数字雨终端效果 | `cmatrix -ab` |
| cava | 音乐可视化 | `cava` |
| w3m | 终端网页浏览器 | `w3m` |
| lynx | 终端网页浏览器备用 | `lynx` |
| btop | 大屏系统监控 | `btop` |
| htop | 紧凑型系统监控 | `htop` |
| tty-clock | 终端时钟 | `tty-clock` |

## 音乐库

启动器会创建这个软链接，方便终端音乐播放器找到歌曲：

```bash
$HOME/Music/WalnutMusic -> $HOME/music-library
```

同时会生成 `cmus` 播放列表：

```bash
$HOME/.config/cmus/walnut-library.pls
```

当前本地音乐库里放了 14 首 public-domain 测试曲目，目录在 `$HOME/music-library`。

## 小屏幕说明

板载 WalnutPi 屏幕只有 480x320。`walnut maintenance` 里用 `htop` 作为小屏系统监控，`btop` 保留给 SSH 里的大终端场景。

`cmatrix` 很适合这块内屏，因为它直接跑在终端里，不需要 X11 或 Wayland。在本地设备上，它最适合从这个仓库里已经使用的 framebuffer 终端路径启动。

Debian bookworm 的原版 `dosbox` 包不适合直接跑在这块内屏上。实测 `dosbox 0.74-3` 启动时需要至少 640x400 的视频模式，而 WalnutPi 内屏只有 480x320，会退出并显示：

```text
Could not initialize video: No video mode large enough for 640x400
```

因此不要把 DOSBox 作为 Walnut Play 的默认本地小屏工具。若要运行 DOSBox，应使用外接更高分辨率显示、远程图形环境，或选择能明确适配 480x320 framebuffer 的替代方案。

## AirPods 播放说明

如果要用 AirPods 播放，请保持蓝牙处于 A2DP 音乐模式：

```bash
vk-airpods-audio
```

如果声音只能播放一小会儿就消失，可能是 BlueALSA 抢占了蓝牙设备。正常播放时请继续使用 PulseAudio 作为播放路径：

```bash
systemctl disable --now bluealsa
pkill -f '^/usr/bin/bluealsa-aplay' || true
vk-airpods-audio
```

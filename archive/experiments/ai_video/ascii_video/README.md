# ASCII Video

离线把图片/视频转成 UTF-8 字符帧，再在纯命令行终端里播放。

## 依赖

- `python3`
- `opencv-python`
- `numpy`

## 转码

```bash
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.codec input.mp4 output.avtx --cols 120 --rows 40
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.codec input.jpg output.avtx --cols 120 --rows 40
```

## 播放

```bash
cd /path/to/WalnutPi
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.player output.avtx
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.player output.avtx --loop
```

## 字符集

默认字符集已经按“墨迹密度”排过序。你也可以自己传：

```bash
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.codec input.mp4 output.avtx --glyphs " ,.:;=+*#%@,口,日,田,因,國"
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.codec input.mp4 output.avtx --glyphs glyphs.txt
```


# ASCII Video Color

彩色并行版。它保留字符轮廓，同时把每个字符块的平均颜色也带进去，终端支持真彩色时效果更接近原视频。

## 依赖

- `python3`
- `opencv-python`
- `numpy`

## 转码

```bash
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video_color.codec input.mp4 output.avtc --cols 120 --rows 40
```

## 播放

```bash
cd /path/to/WalnutPi
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video_color.player output.avtc
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video_color.player output.avtc --loop
```


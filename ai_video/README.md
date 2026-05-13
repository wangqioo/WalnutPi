# AI Video

This folder keeps all terminal video experiments in one place for WalnutPi.

## Submodules

- `ascii_video/` - grayscale terminal video encoder and player
- `ascii_video_color/` - colored terminal video encoder and player
- `examples/` - demo asset generator for quick testing on the WalnutPi screen

## Target hardware

The current WalnutPi hardware notes record a 480x320 SPI framebuffer display driven by `wpi_fb_st7796`.

For that screen, a good first try is:

```bash
python3 -m ai_video.ascii_video.player demo.avtx
python3 -m ai_video.ascii_video_color.player demo.avtc
```

and a compact local terminal size such as `--cols 60 --rows 20` or `--cols 80 --rows 24`.

## Quick start

```bash
cd /path/to/WalnutPi
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.player ai_video/examples/assets/demo_gray.avtx
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video_color.player ai_video/examples/assets/demo_color.avtc
```

## Regenerate demos

```bash
cd /path/to/WalnutPi
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.examples.make_demo --out-dir /tmp/walnutpi-ai-video-demo
```

# AI Video Examples

This folder contains ready-to-play demo archives and a small generator that can recreate them.

## Ready-to-play assets

```bash
cd /path/to/WalnutPi
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video.player ai_video/examples/assets/demo_gray.avtx
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.ascii_video_color.player ai_video/examples/assets/demo_color.avtc
```

## Generate demos

```bash
cd /path/to/WalnutPi
PYTHONPATH=/path/to/WalnutPi python3 -m ai_video.examples.make_demo --out-dir /tmp/walnutpi-ai-video-demo
```

It will write:

- `demo_gray.avtx`
- `demo_color.avtc`
- `demo_still_gray.avtx`
- `demo_still_color.avtc`

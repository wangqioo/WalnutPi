---
name: walnutpi-opencv
description: Work with WalnutPi OpenCV docs: intro, install, image basics, basic operations, USB camera, and LCD display. Use when the user mentions OpenCV, cv2, opencv-contrib-python, USB摄像头使用, LCD使用, VideoCapture, imread, imshow, image basics, or WalnutPi vision.
---

# WalnutPi OpenCV

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/opencv`
- `intro.md`, `install.md`, `operate.md`, `image.md`, `usb_cam.md`, `lcd.md`

## Install

Use the clean WalnutPi venv, not system Python:

```sh
python -m pip install opencv-contrib-python -i https://pypi.tuna.tsinghua.edu.cn/simple
```

## Camera/LCD Notes

- Verify device with `v4l2-ctl --list-devices`.
- A listed `/dev/video*` device may still not be a usable USB camera; confirm with a capture check.
- Examples often use `cv2.VideoCapture(1)`; confirm actual video index.
- The cloned USB camera example has a variable typo: use `cam.release()`, not `capture.release()`.
- `cv2.imshow` needs HDMI, VNC, desktop, or LCD display path.

## Child Skills

- `walnutpi-opencv-draw`
- `walnutpi-opencv-process`
- `walnutpi-opencv-detection`
- `walnutpi-opencv-vision`

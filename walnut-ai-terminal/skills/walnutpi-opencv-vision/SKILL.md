---
name: walnutpi-opencv-vision
description: Work with WalnutPi OpenCV vision recognition docs using Haar cascades: face, eye, cat face, and license plate detection. Use when the user mentions 视觉识别, 级联分类器, 人脸检测, 眼睛检测, 猫脸检测, 车牌检测, Haar cascade, CascadeClassifier, or cv2.data.
---

# WalnutPi OpenCV Vision

## Sources

- Root: `walnutpi_wiki/docs/walnutpi_1/opencv/vision`
- `haar_cascade.md`: 级联分类器介绍
- `front_face_detection.md`: 人脸检测
- `eye_detection copy.md`: 眼睛检测
- `cat_face_detection.md`: 猫脸检测
- `plate_detection.md`: 车牌检测

## Notes

- Cascade data path in docs: `/home/pi/.local/lib/python3.11/site-packages/cv2/data`
- Camera examples often use `cv2.VideoCapture(1)`; verify actual video device.
- Use this for Haar cascade examples, not modern neural vision unless the user asks.

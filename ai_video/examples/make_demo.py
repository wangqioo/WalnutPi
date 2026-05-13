from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from ai_video.ascii_video.codec import build_density_map as build_gray_density
from ai_video.ascii_video.codec import frame_to_ascii, write_archive as write_gray_archive
from ai_video.ascii_video.codec import VideoSpec as GrayVideoSpec
from ai_video.ascii_video.codec import DEFAULT_GLYPHS as GRAY_GLYPHS
from ai_video.ascii_video_color.codec import build_density_map as build_color_density
from ai_video.ascii_video_color.codec import frame_to_colored_lines, write_archive as write_color_archive
from ai_video.ascii_video_color.codec import VideoSpec as ColorVideoSpec
from ai_video.ascii_video_color.codec import DEFAULT_GLYPHS as COLOR_GLYPHS


WIDTH = 480
HEIGHT = 320
FPS = 12.0
COLS = 60
ROWS = 20
FRAME_COUNT = 24


def synth_frame(index: int, total: int) -> np.ndarray:
    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    phase = index / max(1, total - 1)

    # background gradient
    x = np.linspace(0, 1, WIDTH, dtype=np.float32)
    y = np.linspace(0, 1, HEIGHT, dtype=np.float32)[:, None]
    frame[:, :, 0] = np.clip(80 + 120 * x, 0, 255)
    frame[:, :, 1] = np.clip(30 + 180 * y, 0, 255)
    frame[:, :, 2] = np.clip(10 + 140 * (1.0 - x)[None, :], 0, 255)

    # moving bar
    bar_x = int((WIDTH - 120) * phase)
    cv2.rectangle(frame, (bar_x, 38), (bar_x + 120, 78), (255, 220, 50), -1)

    # bouncing circle
    cx = int(80 + (WIDTH - 160) * phase)
    cy = int(HEIGHT * (0.35 + 0.18 * np.sin(phase * np.pi * 2)))
    color = (40 + int(180 * phase), 220 - int(120 * phase), 255)
    cv2.circle(frame, (cx, cy), 42, color, -1, lineType=cv2.LINE_AA)

    # simple graph line
    for xpix in range(0, WIDTH, 8):
        value = 0.5 + 0.35 * np.sin((xpix / WIDTH) * 8 * np.pi + phase * 5)
        ypix = int(230 + value * 50)
        cv2.line(frame, (xpix, 230), (xpix, ypix), (235, 235, 235), 2)

    # title text
    cv2.putText(
        frame,
        "WalnutPi AI Video Demo",
        (24, 300),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"frame {index + 1:02d}/{total:02d}",
        (24, 275),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (20, 20, 20),
        3,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"frame {index + 1:02d}/{total:02d}",
        (24, 275),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )
    return frame


def build_frames(total: int) -> list[np.ndarray]:
    return [synth_frame(i, total) for i in range(total)]


def write_outputs(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = build_frames(FRAME_COUNT)
    gray_glyphs = build_gray_density(GRAY_GLYPHS)
    color_glyphs = build_color_density(COLOR_GLYPHS)

    gray_frames = [frame_to_ascii(frame, COLS, ROWS, gray_glyphs) for frame in frames]
    color_frames = [frame_to_colored_lines(frame, COLS, ROWS, color_glyphs) for frame in frames]

    still = frames[0]
    still_gray = frame_to_ascii(still, COLS, ROWS, gray_glyphs)
    still_color = frame_to_colored_lines(still, COLS, ROWS, color_glyphs)

    write_gray_archive(
        out_dir / "demo_gray.avtx",
        GrayVideoSpec(width=WIDTH, height=HEIGHT, fps=FPS, cols=COLS, rows=ROWS, glyphs=list(gray_glyphs)),
        gray_frames,
    )
    write_color_archive(
        out_dir / "demo_color.avtc",
        ColorVideoSpec(width=WIDTH, height=HEIGHT, fps=FPS, cols=COLS, rows=ROWS, glyphs=list(color_glyphs)),
        color_frames,
    )
    write_gray_archive(
        out_dir / "demo_still_gray.avtx",
        GrayVideoSpec(width=WIDTH, height=HEIGHT, fps=1.0, cols=COLS, rows=ROWS, glyphs=list(gray_glyphs)),
        [still_gray],
    )
    write_color_archive(
        out_dir / "demo_still_color.avtc",
        ColorVideoSpec(width=WIDTH, height=HEIGHT, fps=1.0, cols=COLS, rows=ROWS, glyphs=list(color_glyphs)),
        [still_color],
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate WalnutPi AI video demo archives.")
    parser.add_argument("--out-dir", type=Path, required=True, help="output directory")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    write_outputs(args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


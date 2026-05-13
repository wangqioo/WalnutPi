from __future__ import annotations

import argparse
import gzip
import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence

import cv2
import numpy as np


MAGIC = b"AVTC1"

DEFAULT_GLYPHS = [
    " ",
    ".",
    ":",
    "-",
    "=",
    "+",
    "*",
    "#",
    "%",
    "@",
    "口",
    "日",
    "田",
    "由",
    "甲",
    "申",
    "电",
    "目",
    "因",
    "國",
    "鬱",
]


@dataclass(frozen=True)
class VideoSpec:
    width: int
    height: int
    fps: float
    cols: int
    rows: int
    glyphs: List[str]


def _pick_charset(value: str | None) -> List[str]:
    if not value:
        return list(DEFAULT_GLYPHS)
    if os.path.exists(value):
        text = Path(value).read_text(encoding="utf-8")
        glyphs = [line.strip() for line in text.splitlines() if line.strip()]
        if not glyphs:
            raise ValueError("glyph file is empty")
        return glyphs
    glyphs = [part for part in value.split(",") if part]
    if not glyphs:
        raise ValueError("glyph set is empty")
    return glyphs


def build_density_map(glyphs: Sequence[str], font: int = cv2.FONT_HERSHEY_SIMPLEX) -> List[str]:
    samples = []
    canvas = np.zeros((48, 48), dtype=np.uint8)
    for glyph in glyphs:
        img = canvas.copy()
        size = cv2.getTextSize(glyph, font, 1.0, 2)[0]
        x = max(0, (img.shape[1] - size[0]) // 2)
        y = max(size[1], (img.shape[0] + size[1]) // 2)
        cv2.putText(img, glyph, (x, y), font, 1.0, 255, 2, cv2.LINE_AA)
        density = float(img.mean())
        samples.append((density, glyph))
    samples.sort(key=lambda item: item[0])
    return [glyph for _, glyph in samples]


def _cell_color(block: np.ndarray) -> tuple[int, int, int]:
    b, g, r = block.mean(axis=(0, 1))
    return int(r), int(g), int(b)


def frame_to_colored_lines(
    frame: np.ndarray,
    cols: int,
    rows: int,
    glyphs: Sequence[str],
    invert: bool = False,
) -> list[list[tuple[int, int, int, str]]]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (cols, rows), interpolation=cv2.INTER_AREA)
    if invert:
        small = 255 - small
    cell_h = max(1, frame.shape[0] // rows)
    cell_w = max(1, frame.shape[1] // cols)
    levels = len(glyphs) - 1
    rows_out: list[list[tuple[int, int, int, str]]] = []
    for y in range(rows):
        row_cells: list[tuple[int, int, int, str]] = []
        for x, value in enumerate(small[y]):
            y0 = min(frame.shape[0], y * cell_h)
            y1 = frame.shape[0] if y == rows - 1 else min(frame.shape[0], (y + 1) * cell_h)
            x0 = min(frame.shape[1], x * cell_w)
            x1 = frame.shape[1] if x == cols - 1 else min(frame.shape[1], (x + 1) * cell_w)
            block = frame[y0:y1, x0:x1, :]
            if block.size == 0:
                row_color = (255, 255, 255)
            else:
                row_color = _cell_color(block)
            idx = int(round((float(value) / 255.0) * levels))
            idx = max(0, min(levels, idx))
            row_cells.append((row_color[0], row_color[1], row_color[2], glyphs[idx]))
        rows_out.append(row_cells)
    return rows_out


def write_archive(output: Path, spec: VideoSpec, frames: Iterable[list[list[tuple[int, int, int, str]]]]) -> None:
    payload = {
        "width": spec.width,
        "height": spec.height,
        "fps": spec.fps,
        "cols": spec.cols,
        "rows": spec.rows,
        "glyphs": spec.glyphs,
    }
    meta = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with output.open("wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<I", len(meta)))
        f.write(meta)
        for frame in frames:
            blob = gzip.compress(json.dumps(frame, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), compresslevel=6)
            f.write(struct.pack("<I", len(blob)))
            f.write(blob)
        f.write(struct.pack("<I", 0))


def read_archive(path: Path):
    with path.open("rb") as f:
        if f.read(len(MAGIC)) != MAGIC:
            raise ValueError("invalid archive header")
        (meta_len,) = struct.unpack("<I", f.read(4))
        meta = json.loads(f.read(meta_len).decode("utf-8"))
        frames = []
        while True:
            raw = f.read(4)
            if len(raw) < 4:
                break
            (size,) = struct.unpack("<I", raw)
            if size == 0:
                break
            blob = f.read(size)
            frames.append(json.loads(gzip.decompress(blob).decode("utf-8")))
    return meta, frames


def iter_archive(path: Path):
    with path.open("rb") as f:
        if f.read(len(MAGIC)) != MAGIC:
            raise ValueError("invalid archive header")
        (meta_len,) = struct.unpack("<I", f.read(4))
        meta = json.loads(f.read(meta_len).decode("utf-8"))
        yield meta, None
        while True:
            raw = f.read(4)
            if len(raw) < 4:
                break
            (size,) = struct.unpack("<I", raw)
            if size == 0:
                break
            blob = f.read(size)
            yield None, json.loads(gzip.decompress(blob).decode("utf-8"))


def encode_video(input_path: Path, output_path: Path, cols: int, rows: int, fps: float | None, glyph_source: str | None, invert: bool) -> None:
    glyphs = build_density_map(_pick_charset(glyph_source))
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {input_path}")
    source_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    use_fps = fps if fps and fps > 0 else (source_fps if source_fps > 0 else 12.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frames = []
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame_to_colored_lines(frame, cols, rows, glyphs, invert=invert))
    finally:
        cap.release()
    spec = VideoSpec(width=width, height=height, fps=use_fps, cols=cols, rows=rows, glyphs=list(glyphs))
    write_archive(output_path, spec, frames)


def encode_image(input_path: Path, output_path: Path, cols: int, rows: int, glyph_source: str | None, invert: bool) -> None:
    glyphs = build_density_map(_pick_charset(glyph_source))
    frame = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
    if frame is None:
        raise RuntimeError(f"cannot open image: {input_path}")
    height, width = frame.shape[:2]
    ascii_rows = frame_to_colored_lines(frame, cols, rows, glyphs, invert=invert)
    spec = VideoSpec(width=width, height=height, fps=1.0, cols=cols, rows=rows, glyphs=list(glyphs))
    write_archive(output_path, spec, [ascii_rows])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Encode images or videos into a colored UTF-8 archive.")
    parser.add_argument("input", type=Path, help="input image or video")
    parser.add_argument("output", type=Path, help="output archive path")
    parser.add_argument("--cols", type=int, default=120, help="output columns")
    parser.add_argument("--rows", type=int, default=40, help="output rows")
    parser.add_argument("--fps", type=float, default=0.0, help="override output fps")
    parser.add_argument("--glyphs", default=None, help="comma-separated glyphs or a file with one glyph per line")
    parser.add_argument("--invert", action="store_true", help="invert grayscale mapping")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    suffix = args.input.suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif"}:
        encode_image(args.input, args.output, args.cols, args.rows, args.glyphs, args.invert)
    else:
        encode_video(args.input, args.output, args.cols, args.rows, args.fps, args.glyphs, args.invert)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


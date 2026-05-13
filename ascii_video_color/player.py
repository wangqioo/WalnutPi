from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

try:
    from .codec import iter_archive
except ImportError:  # pragma: no cover
    from codec import iter_archive


def clear_screen() -> None:
    sys.stdout.write("\x1b[2J\x1b[H")


def hide_cursor() -> None:
    sys.stdout.write("\x1b[?25l")


def show_cursor() -> None:
    sys.stdout.write("\x1b[?25h")


def ansi_color(r: int, g: int, b: int) -> str:
    return f"\x1b[38;2;{r};{g};{b}m"


def play(path: Path, loop: bool, speed: float) -> None:
    try:
        while True:
            clear_screen()
            hide_cursor()
            delay = 0.083
            for maybe_meta, frame in iter_archive(path):
                if maybe_meta is not None:
                    fps = float(maybe_meta.get("fps") or 12.0) * speed
                    delay = 1.0 / fps if fps > 0 else 0.083
                    continue
                sys.stdout.write("\x1b[H")
                for row in frame or []:
                    for r, g, b, text in row:
                        sys.stdout.write(ansi_color(r, g, b))
                        sys.stdout.write(text)
                    sys.stdout.write("\x1b[0m\n")
                sys.stdout.flush()
                time.sleep(delay)
            if not loop:
                break
    finally:
        sys.stdout.write("\x1b[0m")
        show_cursor()
        sys.stdout.flush()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Play a colored ASCII video archive in terminal.")
    parser.add_argument("archive", type=Path, help="archive path")
    parser.add_argument("--loop", action="store_true", help="loop playback")
    parser.add_argument("--speed", type=float, default=1.0, help="playback speed multiplier")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    play(args.archive, args.loop, args.speed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


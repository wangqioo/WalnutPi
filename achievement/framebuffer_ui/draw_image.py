#!/usr/bin/env python3
import argparse

from framebuffer_ui import fb
from framebuffer_ui import image


def main():
    parser = argparse.ArgumentParser(description="Draw a JPG/PNG image to the framebuffer.")
    parser.add_argument("path", help="image path")
    parser.add_argument("--device", default="/dev/fb0", help="framebuffer device")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=320)
    args = parser.parse_args()

    frame = image.image_file_to_rgb565(args.path, target_width=args.width, target_height=args.height)
    fb.write_frame(frame, args.device)
    print(f"wrote {len(frame)} bytes to {args.device}")


if __name__ == "__main__":
    main()

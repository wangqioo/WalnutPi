#!/usr/bin/env python3
import argparse

from framebuffer_ui import fb
from framebuffer_ui import render


def main():
    parser = argparse.ArgumentParser(description="Draw a WalnutPi framebuffer demo.")
    parser.add_argument("demo", choices=["test", "card", "off"], help="demo to draw")
    parser.add_argument("--device", default="/dev/fb0", help="framebuffer device")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=320)
    args = parser.parse_args()

    if args.demo == "test":
        frame = render.test_pattern(args.width, args.height)
    elif args.demo == "card":
        frame = render.status_card(args.width, args.height)
    else:
        frame = fb.blank_frame(args.width, args.height)

    fb.write_frame(frame, args.device)
    print(f"wrote {len(frame)} bytes to {args.device}")


if __name__ == "__main__":
    main()

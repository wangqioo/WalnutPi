#!/usr/bin/env python3
import argparse
import time

from framebuffer_ui import fb
from framebuffer_ui import render
from framebuffer_ui import status


def draw_once(device, width, height, print_status=False):
    data = status.collect()
    if print_status:
        print("\n".join(status.as_lines(data)))
    fb.write_frame(render.status_card(width=width, height=height, data=data), device)


def main():
    parser = argparse.ArgumentParser(description="Draw a live WalnutPi status card.")
    parser.add_argument("--device", default="/dev/fb0", help="framebuffer device")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=320)
    parser.add_argument("--watch", type=float, default=0, help="refresh interval in seconds")
    parser.add_argument("--print", action="store_true", help="print collected status")
    args = parser.parse_args()

    if args.watch <= 0:
        draw_once(args.device, args.width, args.height, args.print)
        return

    while True:
        draw_once(args.device, args.width, args.height, args.print)
        time.sleep(args.watch)


if __name__ == "__main__":
    main()

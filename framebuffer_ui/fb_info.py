#!/usr/bin/env python3
from framebuffer_ui import fb


def main():
    info = fb.read_info()
    print(f"name: {info.name}")
    print(f"size: {info.width}x{info.height}")
    print(f"bits_per_pixel: {info.bits_per_pixel}")
    print(f"stride: {info.stride}")
    print(f"mode: {info.mode}")


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
import argparse

from framebuffer_ui import components
from framebuffer_ui import fb
from framebuffer_ui import status


def health_answer():
    data = status.collect()
    frp = "online" if data.frp_active else "offline"
    docker = "active" if data.docker_active else "inactive"
    return (
        f"WalnutPi OK. FRP {frp}. Docker {docker}. "
        f"Disk {data.disk_percent}%. Memory {data.mem_percent}%. IP {data.ip_address}."
    )


def main():
    parser = argparse.ArgumentParser(description="Draw an AI reply card to the framebuffer.")
    parser.add_argument("text", nargs="*", help="answer text; defaults to local health summary")
    parser.add_argument("--prompt", default="How is WalnutPi now?")
    parser.add_argument("--device", default="/dev/fb0")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=320)
    args = parser.parse_args()

    answer = " ".join(args.text).strip() or health_answer()
    frame = components.ai_reply_card(args.prompt, answer, width=args.width, height=args.height)
    fb.write_frame(frame, args.device)
    print(f"wrote {len(frame)} bytes to {args.device}")
    print(answer)


if __name__ == "__main__":
    main()

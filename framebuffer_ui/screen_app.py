#!/usr/bin/env python3
from dataclasses import dataclass
import argparse
import sys
import termios
import tty
import time

from framebuffer_ui import components
from framebuffer_ui import fb
from framebuffer_ui import render
from framebuffer_ui import status


@dataclass(frozen=True)
class MenuItem:
    id: str
    label: str
    description: str


@dataclass(frozen=True)
class AppState:
    items: list[MenuItem]
    selected: int = 0
    page: str = "menu"
    running: bool = True

    def handle_key(self, key):
        if key == "q":
            return AppState(self.items, self.selected, self.page, False)
        if self.page != "menu" and key in {"b", "backspace", "left", "esc"}:
            return AppState(self.items, self.selected, "menu", True)
        if key == "esc":
            return self
        if self.page != "menu":
            return self
        if key in {"down", "j"}:
            return AppState(self.items, (self.selected + 1) % len(self.items), self.page, self.running)
        if key in {"up", "k"}:
            return AppState(self.items, (self.selected - 1) % len(self.items), self.page, self.running)
        if key == "enter":
            item = self.items[self.selected]
            if item.id == "quit":
                return AppState(self.items, self.selected, self.page, False)
            return AppState(self.items, self.selected, item.id, True)
        return self


def default_items():
    return [
        MenuItem("status", "Status", "Live device health"),
        MenuItem("ai", "AI Health", "Local agent summary"),
        MenuItem("image", "Image Demo", "JPG/PNG display path"),
        MenuItem("restore", "Restore", "Return to tty login"),
        MenuItem("quit", "Quit", "Exit screen app"),
    ]


def render_menu(state, width=480, height=320):
    canvas = render.Canvas(width, height)
    components._background(canvas)
    components.header(canvas, "WALNUT SCREEN", "J/K OR ARROWS  ENTER")
    y = 88
    for index, item in enumerate(state.items):
        selected = index == state.selected
        color = render.COLORS["cyan"] if selected else render.COLORS["line"]
        fill = render.COLORS["panel2"] if selected else render.COLORS["panel"]
        canvas.rect(28, y, width - 56, 38, fill)
        canvas.outline(28, y, width - 56, 38, color)
        canvas.text(44, y + 10, ">" if selected else " ", render.COLORS["gold"], 2)
        canvas.text(66, y + 8, item.label, render.COLORS["white"], 2)
        canvas.text(236, y + 10, item.description[:22], render.COLORS["muted"], 1)
        y += 44
    return canvas.bytes()


def render_status_page(width=480, height=320):
    data = status.collect()
    return components.dashboard_card(
        title="WalnutPi OK",
        metrics=[
            components.Metric("FRP", "ON" if data.frp_active else "OFF", "good" if data.frp_active else "bad"),
            components.Metric("DISK", f"{data.disk_percent}%", "warn" if data.disk_percent >= 75 else "good"),
            components.Metric("MEM", f"{data.mem_percent}%", "warn" if data.mem_percent >= 75 else "good"),
        ],
        lines=[
            f"IP {data.ip_address}",
            f"LOAD {data.load_1m:.2f}",
            f"DOCKER {'ACTIVE' if data.docker_active else 'OFF'}",
            "B BACK  Q QUIT",
        ],
        width=width,
        height=height,
    )


def render_ai_page(width=480, height=320):
    data = status.collect()
    answer = (
        f"WalnutPi OK. FRP {'online' if data.frp_active else 'offline'}. "
        f"Docker {'active' if data.docker_active else 'inactive'}. "
        f"Disk {data.disk_percent}%. Memory {data.mem_percent}%. IP {data.ip_address}."
    )
    return components.ai_reply_card("How is WalnutPi now?", answer, width=width, height=height)


def render_image_page(width=480, height=320):
    return components.dashboard_card(
        title="Image Demo",
        metrics=[
            components.Metric("JPG", "OK", "good"),
            components.Metric("PNG", "OK", "good"),
            components.Metric("RGB565", "OK", "good"),
        ],
        lines=[
            "Use: walnut screen image FILE",
            "Images are letterboxed.",
            "B BACK  Q QUIT",
        ],
        width=width,
        height=height,
    )


def render_restore_page(width=480, height=320):
    return components.dashboard_card(
        title="Restore TTY",
        metrics=[
            components.Metric("TTY1", "READY", "good"),
            components.Metric("LOGIN", "OK", "good"),
            components.Metric("QUIT", "Q", "neutral"),
        ],
        lines=[
            "Press Q to exit app.",
            "Then local login returns.",
        ],
        width=width,
        height=height,
    )


def render_state(state, width=480, height=320):
    if state.page == "menu":
        return render_menu(state, width, height)
    if state.page == "status":
        return render_status_page(width, height)
    if state.page == "ai":
        return render_ai_page(width, height)
    if state.page == "image":
        return render_image_page(width, height)
    if state.page == "restore":
        return render_restore_page(width, height)
    return render_menu(state, width, height)


def read_key(stream):
    ch = stream.read(1)
    if ch == "\x1b":
        rest = stream.read(2)
        if rest == "[A":
            return "up"
        if rest == "[B":
            return "down"
        if rest == "[D":
            return "left"
        return "esc"
    if ch in {"\r", "\n"}:
        return "enter"
    if ch == "\x7f":
        return "backspace"
    if ch == "j":
        return "j"
    if ch == "k":
        return "k"
    if ch == "b":
        return "b"
    if ch == "q":
        return "q"
    return ch


def run_app(device="/dev/fb0", width=480, height=320):
    state = AppState(default_items())
    old_settings = termios.tcgetattr(sys.stdin)
    try:
        tty.setcbreak(sys.stdin.fileno())
        fb.write_frame(render_state(state, width, height), device)
        while state.running:
            key = read_key(sys.stdin)
            next_state = state.handle_key(key)
            if next_state != state:
                state = next_state
                fb.write_frame(render_state(state, width, height), device)
            time.sleep(0.02)
    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)


def main():
    parser = argparse.ArgumentParser(description="Run the interactive WalnutPi framebuffer screen app.")
    parser.add_argument("--device", default="/dev/fb0")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=320)
    args = parser.parse_args()
    run_app(args.device, args.width, args.height)


if __name__ == "__main__":
    main()

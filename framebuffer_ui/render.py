from framebuffer_ui import fb
from framebuffer_ui import status


COLORS = {
    "bg": fb.rgb565(10, 12, 14),
    "panel": fb.rgb565(26, 31, 34),
    "panel2": fb.rgb565(38, 45, 48),
    "line": fb.rgb565(90, 105, 105),
    "cyan": fb.rgb565(80, 210, 200),
    "green": fb.rgb565(90, 220, 120),
    "gold": fb.rgb565(235, 180, 65),
    "red": fb.rgb565(220, 80, 70),
    "white": fb.rgb565(235, 238, 230),
    "muted": fb.rgb565(140, 150, 145),
    "black": fb.rgb565(0, 0, 0),
}


FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["111", "010", "010", "010", "010", "010", "111"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["010", "110", "010", "010", "010", "010", "111"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    " ": ["0", "0", "0", "0", "0", "0", "0"],
    ".": ["0", "0", "0", "0", "0", "11", "11"],
    "@": ["01110", "10001", "10111", "10101", "10111", "10000", "01110"],
    "-": ["0", "0", "0", "1111", "0", "0", "0"],
    ":": ["0", "11", "11", "0", "11", "11", "0"],
}


class Canvas:
    def __init__(self, width, height, color=COLORS["bg"]):
        self.width = width
        self.height = height
        self.pixels = [color] * (width * height)

    def rect(self, x, y, width, height, color):
        for yy in range(y, y + height):
            if 0 <= yy < self.height:
                offset = yy * self.width
                for xx in range(max(0, x), min(self.width, x + width)):
                    self.pixels[offset + xx] = color

    def outline(self, x, y, width, height, color):
        self.rect(x, y, width, 2, color)
        self.rect(x, y + height - 2, width, 2, color)
        self.rect(x, y, 2, height, color)
        self.rect(x + width - 2, y, 2, height, color)

    def progress(self, x, y, width, height, percent, color):
        self.rect(x, y, width, height, COLORS["panel2"])
        self.rect(x, y, int(width * percent), height, color)
        self.outline(x, y, width, height, COLORS["line"])

    def text(self, x, y, value, color, scale=2):
        cursor = x
        for char in value.upper():
            glyph = FONT.get(char, FONT[" "])
            glyph_width = max(len(row) for row in glyph)
            for gy, row in enumerate(glyph):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        self.rect(cursor + gx * scale, y + gy * scale, scale, scale, color)
            cursor += (glyph_width + 1) * scale

    def bytes(self):
        out = bytearray()
        for color in self.pixels:
            out.extend(fb.pack_rgb565(color))
        return bytes(out)


def test_pattern(width=480, height=320):
    canvas = Canvas(width, height)
    bands = [
        fb.rgb565(255, 0, 0),
        fb.rgb565(0, 255, 0),
        fb.rgb565(0, 80, 255),
        fb.rgb565(255, 255, 255),
    ]
    band_height = max(1, height // 6)
    for index, color in enumerate(bands):
        canvas.rect(0, index * band_height, width, band_height, color)
    gray_y = band_height * 4
    for y in range(gray_y, min(height, gray_y + band_height)):
        for x in range(width):
            value = int(255 * x / max(1, width - 1))
            canvas.pixels[y * width + x] = fb.rgb565(value, value, value)
    block = max(8, width // 24)
    for y in range(gray_y + band_height, height):
        for x in range(width):
            on = ((x // block) + (y // block)) % 2 == 0
            canvas.pixels[y * width + x] = COLORS["gold"] if on else COLORS["black"]
    return canvas.bytes()


def status_card(width=480, height=320, data=None):
    if data is None:
        data = status.SystemStatus(
            hostname="WalnutPi",
            time_text="--:--",
            load_1m=0.42,
            mem_percent=63,
            disk_percent=37,
            ip_address="root@frp",
            frp_active=True,
            docker_active=True,
        )

    canvas = Canvas(width, height)
    for y in range(height):
        shade = max(0, min(40, y // 10))
        canvas.rect(0, y, width, 1, fb.rgb565(8 + shade // 3, 11 + shade // 4, 13 + shade // 5))

    canvas.rect(18, 18, 444, 54, COLORS["panel"])
    canvas.outline(18, 18, 444, 54, COLORS["cyan"])
    canvas.rect(18, 88, 210, 92, COLORS["panel"])
    canvas.outline(18, 88, 210, 92, COLORS["line"])
    canvas.rect(252, 88, 210, 92, COLORS["panel"])
    canvas.outline(252, 88, 210, 92, COLORS["line"])
    canvas.rect(18, 198, 444, 92, COLORS["panel"])
    canvas.outline(18, 198, 444, 92, COLORS["line"])

    canvas.text(34, 34, "WALNUTPI SERVER", COLORS["white"], 3)
    canvas.text(34, 58, data.time_text, COLORS["cyan"], 2)
    canvas.text(40, 106, "CPU", COLORS["muted"], 2)
    canvas.progress(40, 132, 150, 16, min(1.0, data.load_1m / 4), COLORS["green"])
    canvas.text(40, 154, f"{data.load_1m:.2f}", COLORS["white"], 2)
    canvas.text(274, 106, "MEM", COLORS["muted"], 2)
    canvas.progress(274, 132, 150, 16, data.mem_percent / 100, COLORS["gold"])
    canvas.text(274, 154, f"{data.mem_percent}%", COLORS["white"], 2)
    canvas.text(40, 216, f"DISK {data.disk_percent}%", COLORS["white"], 2)
    canvas.text(40, 244, f"IP {data.ip_address}", COLORS["green"], 2)
    canvas.text(274, 216, "FRP", COLORS["muted"], 2)
    canvas.text(322, 216, "ON" if data.frp_active else "OFF", COLORS["green"] if data.frp_active else COLORS["red"], 2)
    canvas.text(274, 244, "DOCKER", COLORS["muted"], 2)
    canvas.text(368, 244, "ON" if data.docker_active else "OFF", COLORS["green"] if data.docker_active else COLORS["red"], 2)
    canvas.rect(420, 34, 16, 16, COLORS["green"] if data.frp_active else COLORS["red"])
    canvas.rect(396, 34, 16, 16, COLORS["gold"] if data.docker_active else COLORS["red"])
    return canvas.bytes()

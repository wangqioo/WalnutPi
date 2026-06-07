from dataclasses import dataclass
from pathlib import Path
import struct


SYS_GRAPHICS = Path("/sys/class/graphics")


@dataclass(frozen=True)
class FramebufferInfo:
    name: str
    width: int
    height: int
    bits_per_pixel: int
    stride: int
    mode: str

    @classmethod
    def from_values(cls, name, virtual_size, bits_per_pixel, stride, modes):
        width_text, height_text = virtual_size.strip().split(",", 1)
        return cls(
            name=name.strip(),
            width=int(width_text),
            height=int(height_text),
            bits_per_pixel=int(bits_per_pixel.strip()),
            stride=int(stride.strip()),
            mode=modes.strip().splitlines()[0] if modes.strip() else "",
        )


def rgb565(red, green, blue):
    return ((int(red) & 0xF8) << 8) | ((int(green) & 0xFC) << 3) | (int(blue) >> 3)


def pack_rgb565(value):
    return struct.pack("<H", value)


def read_info(device="fb0", sys_graphics=SYS_GRAPHICS):
    root = Path(sys_graphics) / device
    stride_file = root / "stride"
    stride = stride_file.read_text() if stride_file.exists() else "0"
    return FramebufferInfo.from_values(
        name=(root / "name").read_text(),
        virtual_size=(root / "virtual_size").read_text(),
        bits_per_pixel=(root / "bits_per_pixel").read_text(),
        stride=stride,
        modes=(root / "modes").read_text() if (root / "modes").exists() else "",
    )


def write_frame(data, device="/dev/fb0"):
    with open(device, "wb", buffering=0) as framebuffer:
        framebuffer.write(data)


def blank_frame(width=480, height=320):
    return b"\x00\x00" * width * height

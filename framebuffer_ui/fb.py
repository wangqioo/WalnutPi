from dataclasses import dataclass
import base64
import hashlib
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


def frame_byte_length(info):
    if info.stride > 0:
        return info.stride * info.height
    bytes_per_pixel = max((info.bits_per_pixel + 7) // 8, 1)
    return info.width * info.height * bytes_per_pixel


def pixel_format(info):
    if info.bits_per_pixel == 16:
        return "RGB565_LE"
    return f"{info.bits_per_pixel}BPP"


def read_frame_evidence(device="/dev/fb0", fb_device="fb0", sys_graphics=SYS_GRAPHICS, sample_size=64):
    info = read_info(fb_device, sys_graphics)
    expected_byte_length = frame_byte_length(info)
    with open(device, "rb", buffering=0) as framebuffer:
        frame = framebuffer.read(expected_byte_length)
    sample = frame[:sample_size]
    return {
        "device": device,
        "name": info.name,
        "width": info.width,
        "height": info.height,
        "bitsPerPixel": info.bits_per_pixel,
        "pixelFormat": pixel_format(info),
        "stride": info.stride,
        "mode": info.mode,
        "byteLength": len(frame),
        "expectedByteLength": expected_byte_length,
        "sha256": hashlib.sha256(frame).hexdigest(),
        "sample": {
            "offset": 0,
            "length": len(sample),
            "base64": base64.b64encode(sample).decode("ascii"),
        },
    }


def write_frame(data, device="/dev/fb0"):
    with open(device, "wb", buffering=0) as framebuffer:
        framebuffer.write(data)


def blank_frame(width=480, height=320):
    return b"\x00\x00" * width * height

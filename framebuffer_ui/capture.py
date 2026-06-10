import base64
import binascii
import hashlib
import struct
import zlib

from framebuffer_ui import fb


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _png_chunk(kind, payload):
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def rgb565_to_rgb888(frame, width, height, stride=0):
    row_stride = stride if stride > 0 else width * 2
    if len(frame) < row_stride * height:
        raise ValueError("frame is shorter than expected")

    out = bytearray()
    for y in range(height):
        row_offset = y * row_stride
        for x in range(width):
            offset = row_offset + x * 2
            value = frame[offset] | (frame[offset + 1] << 8)
            red = (value >> 11) & 0x1F
            green = (value >> 5) & 0x3F
            blue = value & 0x1F
            out.extend(
                (
                    (red << 3) | (red >> 2),
                    (green << 2) | (green >> 4),
                    (blue << 3) | (blue >> 2),
                )
            )
    return bytes(out)


def rgb888_to_png(rgb, width, height):
    expected = width * height * 3
    if len(rgb) != expected:
        raise ValueError("rgb byte length does not match dimensions")

    rows = bytearray()
    row_length = width * 3
    for y in range(height):
        rows.append(0)
        offset = y * row_length
        rows.extend(rgb[offset : offset + row_length])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        PNG_SIGNATURE
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(bytes(rows)))
        + _png_chunk(b"IEND", b"")
    )


def rgb565_to_png(frame, width, height, stride=0):
    return rgb888_to_png(rgb565_to_rgb888(frame, width, height, stride), width, height)


def capture_png(device="/dev/fb0", fb_device="fb0", sys_graphics=fb.SYS_GRAPHICS, include_base64=False):
    info, frame = fb.read_frame(device, fb_device, sys_graphics)
    if info.bits_per_pixel != 16:
        raise ValueError(f"unsupported framebuffer format: {info.bits_per_pixel}bpp")

    evidence = fb.frame_evidence(info, frame, device=device)
    png = rgb565_to_png(frame, info.width, info.height, info.stride)
    result = {
        "device": device,
        "width": info.width,
        "height": info.height,
        "pixelFormat": fb.pixel_format(info),
        "rawSha256": evidence["sha256"],
        "rawByteLength": evidence["byteLength"],
        "pngSha256": hashlib.sha256(png).hexdigest(),
        "pngByteLength": len(png),
        "nonzeroBytes": evidence["nonzeroBytes"],
        "isBlank": evidence["isBlank"],
    }
    if include_base64:
        result["pngBase64"] = base64.b64encode(png).decode("ascii")
    return result, png

from framebuffer_ui import fb


def rgb_pixels_to_rgb565(
    pixels,
    source_width,
    source_height,
    target_width=480,
    target_height=320,
    background=(0, 0, 0),
):
    if source_width <= 0 or source_height <= 0:
        raise ValueError("source image has invalid dimensions")

    scale = min(target_width / source_width, target_height / source_height)
    draw_width = max(1, int(source_width * scale))
    draw_height = max(1, int(source_height * scale))
    offset_x = (target_width - draw_width) // 2
    offset_y = (target_height - draw_height) // 2

    bg = fb.rgb565(*background)
    canvas = [bg] * (target_width * target_height)

    for y in range(draw_height):
        source_y = min(source_height - 1, int(y / scale))
        for x in range(draw_width):
            source_x = min(source_width - 1, int(x / scale))
            red, green, blue = pixels[source_y][source_x]
            target_index = (offset_y + y) * target_width + offset_x + x
            canvas[target_index] = fb.rgb565(red, green, blue)

    out = bytearray()
    for color in canvas:
        out.extend(fb.pack_rgb565(color))
    return bytes(out)


def load_with_cv2(path):
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError("python3-opencv is required for JPG/PNG image display") from error

    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError(f"could not read image: {path}")

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    height, width = rgb.shape[:2]
    pixels = [
        [tuple(int(value) for value in rgb[y, x][:3]) for x in range(width)]
        for y in range(height)
    ]
    return pixels, width, height


def image_file_to_rgb565(path, target_width=480, target_height=320):
    pixels, source_width, source_height = load_with_cv2(path)
    return rgb_pixels_to_rgb565(
        pixels,
        source_width,
        source_height,
        target_width=target_width,
        target_height=target_height,
    )


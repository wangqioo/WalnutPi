from dataclasses import dataclass

from framebuffer_ui import render


@dataclass(frozen=True)
class Metric:
    label: str
    value: str
    tone: str = "neutral"


TONE_COLORS = {
    "good": render.COLORS["green"],
    "warn": render.COLORS["gold"],
    "bad": render.COLORS["red"],
    "neutral": render.COLORS["cyan"],
}


def wrap_ascii_text(text, max_chars=28, max_lines=6):
    words = str(text).replace("\n", " ").split()
    lines = []
    current = ""
    for word in words:
        if len(word) > max_chars:
            chunks = [word[i : i + max_chars] for i in range(0, len(word), max_chars)]
        else:
            chunks = [word]
        for chunk in chunks:
            candidate = chunk if not current else f"{current} {chunk}"
            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = chunk
            if len(lines) >= max_lines:
                return lines[:max_lines]
    if current and len(lines) < max_lines:
        lines.append(current)
    return lines[:max_lines]


def header(canvas, title, subtitle=""):
    canvas.rect(16, 14, canvas.width - 32, 54, render.COLORS["panel"])
    canvas.outline(16, 14, canvas.width - 32, 54, render.COLORS["cyan"])
    canvas.text(32, 28, title[:22], render.COLORS["white"], 3)
    if subtitle:
        canvas.text(34, 54, subtitle[:28], render.COLORS["cyan"], 2)


def metric_block(canvas, x, y, width, metric):
    color = TONE_COLORS.get(metric.tone, render.COLORS["cyan"])
    canvas.rect(x, y, width, 58, render.COLORS["panel"])
    canvas.outline(x, y, width, 58, color)
    canvas.text(x + 10, y + 10, metric.label[:8], render.COLORS["muted"], 2)
    canvas.text(x + 10, y + 32, metric.value[:8], color, 2)


def log_list(canvas, x, y, width, height, lines):
    canvas.rect(x, y, width, height, render.COLORS["panel"])
    canvas.outline(x, y, width, height, render.COLORS["line"])
    yy = y + 12
    for line in lines[:5]:
        canvas.text(x + 12, yy, line[:30], render.COLORS["white"], 2)
        yy += 20


def dashboard_card(title, metrics, lines, width=480, height=320):
    canvas = render.Canvas(width, height)
    _background(canvas)
    header(canvas, title, "LOCAL AGENT")
    for index, metric in enumerate(metrics[:3]):
        metric_block(canvas, 18 + index * 154, 86, 136, metric)
    log_list(canvas, 18, 166, width - 36, 120, lines)
    return canvas.bytes()


def ai_reply_card(prompt, answer, width=480, height=320):
    canvas = render.Canvas(width, height)
    _background(canvas)
    header(canvas, "AI REPLY", "WALNUTPI LOCAL")
    canvas.rect(18, 86, width - 36, 56, render.COLORS["panel"])
    canvas.outline(18, 86, width - 36, 56, render.COLORS["gold"])
    canvas.text(34, 102, "ASK", render.COLORS["muted"], 2)
    for index, line in enumerate(wrap_ascii_text(prompt, max_chars=34, max_lines=2)):
        canvas.text(86, 102 + index * 18, line, render.COLORS["white"], 2)
    canvas.rect(18, 160, width - 36, 126, render.COLORS["panel"])
    canvas.outline(18, 160, width - 36, 126, render.COLORS["cyan"])
    canvas.text(34, 176, "ANS", render.COLORS["muted"], 2)
    for index, line in enumerate(wrap_ascii_text(answer, max_chars=38, max_lines=5)):
        canvas.text(34, 204 + index * 18, line, render.COLORS["green"], 2)
    return canvas.bytes()


def _background(canvas):
    for y in range(canvas.height):
        shade = max(0, min(36, y // 11))
        canvas.rect(0, y, canvas.width, 1, render.fb.rgb565(7 + shade // 4, 10 + shade // 5, 14 + shade // 3))


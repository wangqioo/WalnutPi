#!/usr/bin/env python3
"""Generate the LVGL screen config from lvgl_app/screen-manifest.json."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT_DIR / "lvgl_app" / "screen-manifest.json"
OUTPUT_PATH = ROOT_DIR / "lvgl_app" / "generated" / "screen_config.h"
MAX_PAGES = 6
MAX_COMPONENTS = 6
TONES = {"ok", "warn", "error"}
COMPONENT_TYPES = {"statusCard", "metricGroup", "list", "progress", "alert", "textPage", "generatedPage"}
GENERATED_STYLES = {"panel", "comic", "music", "network", "task", "status", "alert", "minimal"}
ACCENTS = {"cyan", "green", "amber", "red", "blue", "pink", "paper"}


def fail(message: str) -> None:
    raise ValueError(message)


def reject_control_text(value: str, field: str) -> None:
    if any((ord(char) < 32 and char not in "\n\r\t") or ord(char) == 127 for char in value):
        fail(f"{field} contains control characters")


def clean_text(value: object, field: str, limit: int) -> str:
    text = " ".join(str(value if value is not None else "").split())
    reject_control_text(text, field)
    if not text:
        fail(f"{field} is required")
    if len(text) > limit:
        fail(f"{field} is too long")
    return text


def clean_optional_text(value: object, field: str, limit: int) -> str:
    text = " ".join(str(value if value is not None else "").split())
    reject_control_text(text, field)
    if len(text) > limit:
        fail(f"{field} is too long")
    return text


def clean_list(values: object, field: str, max_items: int, limit: int) -> list[str]:
    if not isinstance(values, list):
        fail(f"{field} must be an array")
    items = [clean_text(value, f"{field}[{index}]", limit) for index, value in enumerate(values)]
    if len(items) == 0 or len(items) > max_items:
        fail(f"{field} must contain 1-{max_items} items")
    return items


def clean_page_id(value: object, field: str) -> str:
    text = clean_text(value, field, 32)
    if not text[0].isalnum() or any(not (char.isalnum() or char in "_-") for char in text):
        fail(f"{field} must be a simple slug")
    return text


def clean_tone(value: object, field: str) -> str:
    tone = str(value or "ok").strip().lower()
    if tone not in TONES:
        fail(f"{field} must be ok, warn, or error")
    return tone


def clean_progress(value: object, field: str) -> int:
    if value in (None, ""):
        return 72
    try:
        progress = float(value)
    except (TypeError, ValueError):
        fail(f"{field} must be between 0 and 100")
    if progress < 0 or progress > 100:
        fail(f"{field} must be between 0 and 100")
    return math.floor(progress + 0.5)


def clean_generated_style(value: object, field: str) -> str:
    style = str(value or "panel").strip().lower()
    if style not in GENERATED_STYLES:
        fail(f"{field} must be one of {', '.join(sorted(GENERATED_STYLES))}")
    return style


def clean_accent(value: object, field: str) -> str:
    accent = str(value or "cyan").strip().lower()
    if accent not in ACCENTS:
        fail(f"{field} must be one of {', '.join(sorted(ACCENTS))}")
    return accent


def clean_generated_items(values: object, field: str) -> list[dict]:
    if values is None:
        return []
    if not isinstance(values, list) or len(values) > 3:
        fail(f"{field} must contain at most 3 items")
    return [
        {
            "label": clean_text(item.get("label", f"M{index + 1}") if isinstance(item, dict) else item, f"{field}[{index}].label", 12),
            "value": clean_text(item.get("value", "--") if isinstance(item, dict) else "--", f"{field}[{index}].value", 16),
            "unit": clean_optional_text(item.get("unit", "") if isinstance(item, dict) else "", f"{field}[{index}].unit", 8),
            "tone": clean_tone(item.get("tone", "ok") if isinstance(item, dict) else "ok", f"{field}[{index}].tone"),
        }
        for index, item in enumerate(values)
    ]


def clean_component(component: object, field: str) -> dict:
    if not isinstance(component, dict):
        fail(f"{field} must be an object")
    component_type = clean_text(component.get("type"), f"{field}.type", 16)
    if component_type not in COMPONENT_TYPES:
        fail(f"{field}.type is not supported")

    if component_type == "statusCard":
        return {
            "type": component_type,
            "label": clean_text(component.get("label", "Status"), f"{field}.label", 12),
            "value": clean_text(component.get("value", "Ready"), f"{field}.value", 24),
            "tone": clean_tone(component.get("tone", "ok"), f"{field}.tone"),
            "detail": clean_text(component.get("detail", "Ready"), f"{field}.detail", 24),
        }
    if component_type == "metricGroup":
        items = component.get("items")
        if not isinstance(items, list) or len(items) == 0 or len(items) > 3:
            fail(f"{field}.items must contain 1-3 items")
        return {
            "type": component_type,
            "items": [
                {
                    "label": clean_text(item.get("label", f"M{index + 1}") if isinstance(item, dict) else item, f"{field}.items[{index}].label", 12),
                    "value": clean_text(item.get("value", "--") if isinstance(item, dict) else item, f"{field}.items[{index}].value", 16),
                    "unit": clean_optional_text(item.get("unit", "") if isinstance(item, dict) else "", f"{field}.items[{index}].unit", 8),
                    "tone": clean_tone(item.get("tone", "ok") if isinstance(item, dict) else "ok", f"{field}.items[{index}].tone"),
                }
                for index, item in enumerate(items)
            ],
        }
    if component_type == "list":
        return {
            "type": component_type,
            "title": clean_text(component.get("title", "List"), f"{field}.title", 32),
            "items": clean_list(component.get("items", []), f"{field}.items", 4, 48),
        }
    if component_type == "progress":
        return {
            "type": component_type,
            "label": clean_text(component.get("label", "Progress"), f"{field}.label", 16),
            "value": clean_progress(component.get("value", 72), f"{field}.value"),
            "max": clean_progress(component.get("max", 100), f"{field}.max"),
            "tone": clean_tone(component.get("tone", "ok"), f"{field}.tone"),
        }
    if component_type == "alert":
        return {
            "type": component_type,
            "title": clean_text(component.get("title", "Alert"), f"{field}.title", 32),
            "body": clean_text(component.get("body", "Check status"), f"{field}.body", 48),
            "tone": clean_tone(component.get("tone", "warn"), f"{field}.tone"),
        }
    if component_type == "generatedPage":
        return {
            "type": component_type,
            "style": clean_generated_style(component.get("style", "panel"), f"{field}.style"),
            "kicker": clean_text(component.get("kicker", "WalnutAI"), f"{field}.kicker", 20),
            "headline": clean_text(component.get("headline", component.get("title", "Ready")), f"{field}.headline", 24),
            "body": clean_text(component.get("body", component.get("detail", "Generated screen")), f"{field}.body", 56),
            "badge": clean_text(component.get("badge", "LIVE"), f"{field}.badge", 12),
            "accent": clean_accent(component.get("accent", "cyan"), f"{field}.accent"),
            "progress": clean_progress(component.get("progress", 64), f"{field}.progress"),
            "items": clean_generated_items(component.get("items"), f"{field}.items"),
        }
    return {
        "type": component_type,
        "title": clean_text(component.get("title", "Page"), f"{field}.title", 32),
        "lines": clean_list(component.get("lines", []), f"{field}.lines", 4, 48),
    }


def normalize_components(page: dict, page_index: int) -> list[dict]:
    components = page.get("components")
    if not isinstance(components, list) or len(components) == 0 or len(components) > MAX_COMPONENTS:
        fail(f"pages[{page_index}].components must contain 1-{MAX_COMPONENTS} items")
    return [clean_component(component, f"pages[{page_index}].components[{index}]") for index, component in enumerate(components)]


def validate_manifest(manifest: object) -> dict:
    if not isinstance(manifest, dict):
        fail("screen manifest must be an object")
    if manifest.get("schema") != "walnutpi.screen.v1":
        fail("screen manifest schema must be walnutpi.screen.v1")
    if not isinstance(manifest.get("id"), str) or not manifest["id"]:
        fail("screen manifest id is required")
    target = manifest.get("target")
    if not isinstance(target, dict):
        fail("screen manifest target is required")
    if target.get("runtime") != "lvgl-fbdev":
        fail("screen manifest target.runtime must be lvgl-fbdev")
    if target.get("display") != "/dev/fb0":
        fail("screen manifest target.display must be /dev/fb0")
    if target.get("width") != 480:
        fail("screen manifest target.width must be 480")
    if target.get("height") != 320:
        fail("screen manifest target.height must be 320")
    if target.get("color") != "RGB565":
        fail("screen manifest target.color must be RGB565")
    source = manifest.get("source")
    if not isinstance(source, dict):
        fail("screen manifest source is required")
    if source.get("lvglEntry") != "lvgl_app/src/main.c":
        fail("screen manifest source.lvglEntry must be lvgl_app/src/main.c")
    if source.get("command") != "walnut screen start":
        fail("screen manifest source.command must be walnut screen start")
    pages = manifest.get("pages")
    if not isinstance(pages, list) or len(pages) == 0 or len(pages) > MAX_PAGES:
        fail(f"screen manifest pages must contain 1-{MAX_PAGES} pages")
    return manifest


def normalize(manifest: dict) -> dict:
    validate_manifest(manifest)
    seen: set[str] = set()
    pages = []
    for index, page in enumerate(manifest["pages"]):
        if not isinstance(page, dict):
            fail(f"pages[{index}] must be an object")
        for field in ("status", "tone", "progress", "metrics", "title", "lines"):
            if field in page:
                fail(f"pages[{index}].{field} is not supported; use pages[{index}].components")
        page_id = clean_page_id(page.get("id", f"page-{index + 1}"), f"pages[{index}].id")
        if page_id in seen:
            fail(f"pages[{index}].id must be unique")
        seen.add(page_id)
        pages.append({
            "id": page_id,
            "tab": clean_text(page.get("tab", page_id.upper()), f"pages[{index}].tab", 8),
            "components": normalize_components(page, index),
        })
    return {
        "title": clean_text(manifest.get("title", "WalnutPi"), "title", 32),
        "subtitle": clean_text(manifest.get("subtitle", "server screen"), "subtitle", 40),
        "pages": pages,
    }


def stable_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def manifest_hash(manifest: dict) -> str:
    return hashlib.sha256(stable_json(manifest).encode("utf-8")).hexdigest()


def c_string(value: object) -> str:
    return json.dumps(str(value), ensure_ascii=True)


def tone_color(tone: str) -> str:
    return {"ok": "0x33d6a6", "warn": "0xffc857", "error": "0xff6b6b"}[clean_tone(tone, "tone")]


def accent_color(accent: str) -> str:
    return {
        "cyan": "0x67d6ff",
        "green": "0x33d6a6",
        "amber": "0xffc857",
        "red": "0xff6b6b",
        "blue": "0x7aa8d8",
        "pink": "0xff6fb3",
        "paper": "0xf7e9b9",
    }[clean_accent(accent, "accent")]


def component_title(component: dict) -> str:
    if component["type"] == "generatedPage":
        return component["headline"]
    if component["type"] == "statusCard":
        return component["label"]
    if component["type"] == "metricGroup":
        return "Metrics"
    if component["type"] == "progress":
        return component["label"]
    return component["title"]


def component_text(component: dict) -> str:
    if component["type"] == "generatedPage":
        return component["body"]
    if component["type"] == "statusCard":
        return component["value"]
    if component["type"] == "metricGroup":
        return "\n".join(
            f"{item['label']} {item['value']}{(' ' + item['unit']) if item.get('unit') else ''}".strip()
            for item in component["items"]
        )
    if component["type"] == "list":
        return "\n".join(component["items"])
    if component["type"] == "progress":
        return f"{component['label']} {component['value']}/{component['max']}"
    if component["type"] == "alert":
        return component["body"]
    return "\n".join(component["lines"])


def component_tone(component: dict) -> str:
    if component["type"] == "generatedPage":
        return "ok"
    return "ok" if component["type"] in {"textPage", "list"} else clean_tone(component.get("tone", "ok"), "component.tone")


def component_progress(component: dict) -> int:
    if component["type"] == "generatedPage":
        return max(0, min(100, int(component["progress"])))
    if component["type"] != "progress":
        return 0
    max_value = max(1, int(component.get("max", 100)))
    return max(0, min(100, round((int(component["value"]) * 100) / max_value)))


def component_style(component: dict) -> str:
    return component["style"] if component["type"] == "generatedPage" else ""


def component_kicker(component: dict) -> str:
    return component["kicker"] if component["type"] == "generatedPage" else ""


def component_badge(component: dict) -> str:
    return component["badge"] if component["type"] == "generatedPage" else ""


def component_items(component: dict) -> str:
    if component["type"] != "generatedPage":
        return ""
    return "\n".join(
        f"{item['label']} {item['value']}{(' ' + item['unit']) if item.get('unit') else ''}".strip()
        for item in component["items"]
    )


def component_color(component: dict) -> str:
    if component["type"] == "generatedPage":
        return accent_color(component.get("accent", "cyan"))
    return tone_color(component_tone(component))


def render_page_array(config: dict) -> str:
    return ",\n".join(
        "\n".join([
            "  {",
            f"    {c_string(page['id'])},",
            f"    {c_string(page['tab'])},",
            f"    {index}",
            "  }",
        ])
        for index, page in enumerate(config["pages"])
    )


def render_component_array(config: dict) -> str:
    rendered = []
    for page_index, page in enumerate(config["pages"]):
        for component in page["components"]:
            rendered.append("\n".join([
                "  {",
                f"    {page_index},",
                f"    {c_string(component['type'])},",
                f"    {c_string(component_style(component))},",
                f"    {c_string(component_title(component))},",
                f"    {c_string(component_text(component))},",
                f"    {c_string(component_kicker(component))},",
                f"    {c_string(component_badge(component))},",
                f"    {c_string(component_items(component))},",
                f"    {component_color(component)},",
                f"    {component_progress(component)}",
                "  }",
            ]))
    return ",\n".join(rendered)


def render_header(config: dict) -> str:
    component_count = sum(len(page["components"]) for page in config["pages"])
    return f"""/* Generated by scripts/generate-lvgl-screen-config. Do not edit by hand. */
#ifndef WALNUT_SCREEN_CONFIG_H
#define WALNUT_SCREEN_CONFIG_H

#define WALNUT_SCREEN_MANIFEST_HASH {c_string(config["manifestHash"])}
#define WALNUT_SCREEN_TITLE {c_string(config["title"])}
#define WALNUT_SCREEN_SUBTITLE {c_string(config["subtitle"])}
#define WALNUT_SCREEN_PAGE_COUNT {len(config["pages"])}
#define WALNUT_SCREEN_COMPONENT_COUNT {component_count}

typedef struct {{
    const char * id;
    const char * tab;
    int index;
}} walnut_screen_page_config_t;

typedef struct {{
    int page_index;
    const char * type;
    const char * style;
    const char * title;
    const char * text;
    const char * kicker;
    const char * badge;
    const char * items;
    unsigned int tone_color;
    int progress;
}} walnut_screen_component_config_t;

static const walnut_screen_page_config_t walnut_screen_pages[WALNUT_SCREEN_PAGE_COUNT] = {{
{render_page_array(config)}
}};

static const walnut_screen_component_config_t walnut_screen_components[WALNUT_SCREEN_COMPONENT_COUNT] = {{
{render_component_array(config)}
}};

#endif
"""


def main() -> int:
    manifest = validate_manifest(json.loads(MANIFEST_PATH.read_text(encoding="utf-8")))
    config = normalize(manifest)
    config["manifestHash"] = manifest_hash(manifest)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(render_header(config), encoding="utf-8", newline="\n")
    print(OUTPUT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

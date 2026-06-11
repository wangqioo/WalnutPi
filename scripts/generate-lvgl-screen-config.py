#!/usr/bin/env python3
"""Generate the LVGL screen text config from lvgl_app/screen-manifest.json."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT_DIR / "lvgl_app" / "screen-manifest.json"
OUTPUT_PATH = ROOT_DIR / "lvgl_app" / "generated" / "screen_config.h"
PAGE_IDS = ["home", "system", "ai", "network"]
TONES = {"ok", "warn", "error"}


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


def clean_list(values: object, field: str, max_items: int, limit: int) -> list[str]:
    if not isinstance(values, list):
        fail(f"{field} must be an array")
    items = [clean_text(value, f"{field}[{index}]", limit) for index, value in enumerate(values)]
    if len(items) == 0 or len(items) > max_items:
        fail(f"{field} must contain 1-{max_items} items")
    return items


def clean_tone(value: object, field: str) -> str:
    tone = str(value or "ok").strip().lower()
    if tone not in TONES:
        fail(f"{field} must be ok, warn, or error")
    return tone


def clean_progress(value: object, field: str) -> int:
    if value in (None, ""):
        return 72
    try:
        progress = int(value)
    except (TypeError, ValueError):
        fail(f"{field} must be between 0 and 100")
    if progress < 0 or progress > 100:
        fail(f"{field} must be between 0 and 100")
    return progress


def tone_color(tone: str) -> str:
    return {
        "ok": "C_GREEN",
        "warn": "C_AMBER",
        "error": "C_RED",
    }[tone]


def validate_manifest(manifest: object) -> dict:
    if not isinstance(manifest, dict):
        fail("screen manifest must be an object")
    if manifest.get("schema") != "walnutpi.screen.v1":
        fail("screen manifest schema must be walnutpi.screen.v1")
    target = manifest.get("target")
    if not isinstance(target, dict):
        fail("screen manifest target is required")
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
    pages = manifest.get("pages")
    if not isinstance(pages, list) or len(pages) != len(PAGE_IDS):
        fail("screen manifest pages must contain exactly four pages")
    for index, page_id in enumerate(PAGE_IDS):
        page = pages[index]
        if not isinstance(page, dict) or page.get("id") != page_id:
            fail(f"screen manifest pages[{index}].id must be {page_id}")
    return manifest


def normalize(manifest: dict) -> dict:
    validate_manifest(manifest)
    pages = manifest["pages"]
    return {
        "title": clean_text(manifest.get("title", "WalnutPi"), "title", 32),
        "subtitle": clean_text(manifest.get("subtitle", "server screen"), "subtitle", 40),
        "homeStatus": clean_text(pages[0].get("status", "OK CORE"), "pages[0].status", 24),
        "homeTone": clean_tone(pages[0].get("tone", "ok"), "pages[0].tone"),
        "homeProgress": clean_progress(pages[0].get("progress", 72), "pages[0].progress"),
        "tabs": [
            clean_text(page.get("tab", PAGE_IDS[index].upper()), f"pages[{index}].tab", 8)
            for index, page in enumerate(pages)
        ],
        "metrics": clean_list(pages[0].get("metrics", ["IP loading", "MEM --", "DISK --"]), "pages[0].metrics", 3, 24),
        "textPages": [
            {
                "title": clean_text(page.get("title", page.get("tab", PAGE_IDS[index + 1])), f"pages[{index + 1}].title", 32),
                "lines": clean_list(page.get("lines", [page.get("title", page.get("tab", PAGE_IDS[index + 1]))]), f"pages[{index + 1}].lines", 4, 48),
            }
            for index, page in enumerate(pages[1:])
        ],
    }


def c_string(value: str) -> str:
    return json.dumps(str(value), ensure_ascii=True)


def stable_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def manifest_hash(manifest: dict) -> str:
    return hashlib.sha256(stable_json(manifest).encode("utf-8")).hexdigest()


def c_multiline(title: str, lines: list[str]) -> str:
    return c_string("\n".join([title, "", *lines]))


def render_header(config: dict) -> str:
    system_page, ai_page, network_page = config["textPages"]
    return f"""/* Generated by scripts/generate-lvgl-screen-config. Do not edit by hand. */
#ifndef WALNUT_SCREEN_CONFIG_H
#define WALNUT_SCREEN_CONFIG_H

#define WALNUT_SCREEN_MANIFEST_HASH {c_string(config["manifestHash"])}

#define WALNUT_SCREEN_TITLE {c_string(config["title"])}
#define WALNUT_SCREEN_SUBTITLE {c_string(config["subtitle"])}

#define WALNUT_SCREEN_TAB_HOME {c_string(config["tabs"][0])}
#define WALNUT_SCREEN_TAB_SYSTEM {c_string(config["tabs"][1])}
#define WALNUT_SCREEN_TAB_AI {c_string(config["tabs"][2])}
#define WALNUT_SCREEN_TAB_NETWORK {c_string(config["tabs"][3])}

#define WALNUT_SCREEN_HOME_STATUS {c_string(config["homeStatus"])}
#define WALNUT_SCREEN_HOME_TONE {c_string(config["homeTone"])}
#define WALNUT_SCREEN_HOME_TONE_COLOR {tone_color(config["homeTone"])}
#define WALNUT_SCREEN_HOME_PROGRESS {config["homeProgress"]}
#define WALNUT_SCREEN_HOME_METRIC_1 {c_string(config["metrics"][0])}
#define WALNUT_SCREEN_HOME_METRIC_2 {c_string(config["metrics"][1])}
#define WALNUT_SCREEN_HOME_METRIC_3 {c_string(config["metrics"][2])}

#define WALNUT_SCREEN_SYSTEM_TITLE {c_string(system_page["title"])}
#define WALNUT_SCREEN_SYSTEM_LINE_1 {c_string(system_page["lines"][0] if len(system_page["lines"]) > 0 else "")}
#define WALNUT_SCREEN_SYSTEM_LINE_2 {c_string(system_page["lines"][1] if len(system_page["lines"]) > 1 else "")}
#define WALNUT_SCREEN_SYSTEM_LINE_3 {c_string(system_page["lines"][2] if len(system_page["lines"]) > 2 else "")}
#define WALNUT_SCREEN_SYSTEM_LINE_4 {c_string(system_page["lines"][3] if len(system_page["lines"]) > 3 else "")}
#define WALNUT_SCREEN_SYSTEM_TEXT {c_multiline(system_page["title"], system_page["lines"])}

#define WALNUT_SCREEN_AI_TITLE {c_string(ai_page["title"])}
#define WALNUT_SCREEN_AI_LINE_1 {c_string(ai_page["lines"][0] if len(ai_page["lines"]) > 0 else "")}
#define WALNUT_SCREEN_AI_LINE_2 {c_string(ai_page["lines"][1] if len(ai_page["lines"]) > 1 else "")}
#define WALNUT_SCREEN_AI_LINE_3 {c_string(ai_page["lines"][2] if len(ai_page["lines"]) > 2 else "")}
#define WALNUT_SCREEN_AI_LINE_4 {c_string(ai_page["lines"][3] if len(ai_page["lines"]) > 3 else "")}
#define WALNUT_SCREEN_AI_TEXT {c_multiline(ai_page["title"], ai_page["lines"])}

#define WALNUT_SCREEN_NETWORK_TITLE {c_string(network_page["title"])}
#define WALNUT_SCREEN_NETWORK_LINE_1 {c_string(network_page["lines"][0] if len(network_page["lines"]) > 0 else "")}
#define WALNUT_SCREEN_NETWORK_LINE_2 {c_string(network_page["lines"][1] if len(network_page["lines"]) > 1 else "")}
#define WALNUT_SCREEN_NETWORK_LINE_3 {c_string(network_page["lines"][2] if len(network_page["lines"]) > 2 else "")}
#define WALNUT_SCREEN_NETWORK_LINE_4 {c_string(network_page["lines"][3] if len(network_page["lines"]) > 3 else "")}
#define WALNUT_SCREEN_NETWORK_TEXT {c_multiline(network_page["title"], network_page["lines"])}

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

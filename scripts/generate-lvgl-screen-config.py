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
COMPONENT_TYPES = {"statusCard", "metricGroup", "list", "progress", "alert", "textPage"}


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
            "value": clean_text(component.get("value", "OK CORE"), f"{field}.value", 24),
            "tone": clean_tone(component.get("tone", "ok"), f"{field}.tone"),
            "detail": clean_text(component.get("detail", "Ready"), f"{field}.detail", 24),
        }
    if component_type == "metricGroup":
        items = component.get("items")
        if not isinstance(items, list):
            fail(f"{field}.items must be an array")
        if len(items) == 0 or len(items) > 3:
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
    return {
        "type": component_type,
        "title": clean_text(component.get("title", "Page"), f"{field}.title", 32),
        "lines": clean_list(component.get("lines", []), f"{field}.lines", 4, 48),
    }


def normalize_components(page: dict, page_index: int) -> list[dict]:
    components = page.get("components")
    if components is None:
        return []
    if not isinstance(components, list):
        fail(f"pages[{page_index}].components must be an array")
    if len(components) > 6:
        fail(f"pages[{page_index}].components must contain at most 6 items")
    normalized = [clean_component(component, f"pages[{page_index}].components[{index}]") for index, component in enumerate(components)]
    seen_types = set()
    for component in normalized:
        component_type = component["type"]
        if component_type in seen_types:
            fail(f"pages[{page_index}].components must not repeat {component_type}")
        seen_types.add(component_type)
    return normalized


def first_component(components: list[dict], component_type: str) -> dict | None:
    return next((component for component in components if component.get("type") == component_type), None)


def metric_text(item: dict) -> str:
    unit = item.get("unit", "")
    value = f"{item['value']} {unit}".strip()
    return clean_text(f"{item['label']} {value}".strip(), "metricGroup.item", 24)


def page_lines_from_components(page: dict, components: list[dict], page_index: int) -> tuple[str, list[str]]:
    alert = first_component(components, "alert")
    text_page = first_component(components, "textPage")
    list_component = first_component(components, "list")
    if alert is not None:
        title = alert["title"]
        fallback_lines = [alert["body"]]
    elif text_page is not None:
        title = text_page["title"]
        fallback_lines = text_page["lines"]
    elif list_component is not None:
        title = list_component["title"]
        fallback_lines = list_component["items"]
    else:
        title = clean_text(page.get("title", page.get("tab", PAGE_IDS[page_index])), f"pages[{page_index}].title", 32)
        fallback_lines = clean_list(page.get("lines", [title]), f"pages[{page_index}].lines", 4, 48)
    lines = clean_list(fallback_lines[:4], f"pages[{page_index}].componentLines", 4, 48)
    return title, lines


def page_kind(components: list[dict]) -> str:
    if first_component(components, "alert") is not None:
        return "alert"
    if first_component(components, "list") is not None:
        return "list"
    return "textPage"


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
    home_components = normalize_components(pages[0], 0)
    status_card = first_component(home_components, "statusCard")
    progress_component = first_component(home_components, "progress")
    metric_group = first_component(home_components, "metricGroup")
    alert = first_component(home_components, "alert")
    status_label = status_card["label"] if status_card is not None else "Status"
    status_detail = status_card["detail"] if status_card is not None else "Ready"
    progress_label = progress_component["label"] if progress_component is not None else "Progress"
    progress_max = progress_component["max"] if progress_component is not None else 100
    home_status = status_card["value"] if status_card is not None else pages[0].get("status", "OK CORE")
    home_tone = (
        status_card["tone"]
        if status_card is not None
        else alert["tone"]
        if alert is not None
        else progress_component["tone"]
        if progress_component is not None
        else pages[0].get("tone", "ok")
    )
    home_progress = progress_component["value"] if progress_component is not None else pages[0].get("progress", 72)
    metrics = (
        [metric_text(item) for item in metric_group["items"]]
        if metric_group is not None
        else clean_list(pages[0].get("metrics", ["IP loading", "MEM --", "DISK --"]), "pages[0].metrics", 3, 24)
    )
    metric_items = (
        metric_group["items"]
        if metric_group is not None
        else [
            {
                "label": clean_text(value.split()[0] if value.split() else f"M{index + 1}", f"pages[0].metrics[{index}].label", 12),
                "value": clean_text(" ".join(value.split()[1:]) or "--", f"pages[0].metrics[{index}].value", 16),
                "unit": "",
                "tone": "ok",
            }
            for index, value in enumerate(metrics)
        ]
    )
    while len(metrics) < 3:
        metrics.append("--")
    while len(metric_items) < 3:
        metric_items.append({"label": "Metric", "value": "--", "unit": "", "tone": "ok"})

    return {
        "title": clean_text(manifest.get("title", "WalnutPi"), "title", 32),
        "subtitle": clean_text(manifest.get("subtitle", "server screen"), "subtitle", 40),
        "homeStatusLabel": clean_text(status_label, "pages[0].statusCard.label", 12),
        "homeStatus": clean_text(home_status, "pages[0].status", 24),
        "homeStatusDetail": clean_text(status_detail, "pages[0].statusCard.detail", 24),
        "homeTone": clean_tone(home_tone, "pages[0].tone"),
        "homeProgressLabel": clean_text(progress_label, "pages[0].progress.label", 16),
        "homeProgress": clean_progress(home_progress, "pages[0].progress"),
        "homeProgressMax": clean_progress(progress_max, "pages[0].progress.max"),
        "tabs": [
            clean_text(page.get("tab", PAGE_IDS[index].upper()), f"pages[{index}].tab", 8)
            for index, page in enumerate(pages)
        ],
        "metrics": metrics[:3],
        "metricItems": metric_items[:3],
        "textPages": [
            {
                "kind": page_kind(components),
                "title": title,
                "lines": lines,
            }
            for index, page in enumerate(pages[1:])
            for components in [normalize_components(page, index + 1)]
            for title, lines in [page_lines_from_components(page, components, index + 1)]
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


def metric_define_lines(metric_items: list[dict]) -> str:
    lines = []
    for index, item in enumerate(metric_items, start=1):
        lines.append(f"#define WALNUT_SCREEN_HOME_METRIC_{index}_LABEL {c_string(item['label'])}")
        lines.append(f"#define WALNUT_SCREEN_HOME_METRIC_{index}_VALUE {c_string(item['value'])}")
        lines.append(f"#define WALNUT_SCREEN_HOME_METRIC_{index}_UNIT {c_string(item.get('unit', ''))}")
        lines.append(f"#define WALNUT_SCREEN_HOME_METRIC_{index}_TONE {c_string(item.get('tone', 'ok'))}")
        lines.append(f"#define WALNUT_SCREEN_HOME_METRIC_{index}_TONE_COLOR {tone_color(clean_tone(item.get('tone', 'ok'), f'metricItems[{index - 1}].tone'))}")
    return "\n".join(lines)


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

#define WALNUT_SCREEN_HOME_STATUS_LABEL {c_string(config["homeStatusLabel"])}
#define WALNUT_SCREEN_HOME_STATUS {c_string(config["homeStatus"])}
#define WALNUT_SCREEN_HOME_STATUS_DETAIL {c_string(config["homeStatusDetail"])}
#define WALNUT_SCREEN_HOME_TONE {c_string(config["homeTone"])}
#define WALNUT_SCREEN_HOME_TONE_COLOR {tone_color(config["homeTone"])}
#define WALNUT_SCREEN_HOME_PROGRESS_LABEL {c_string(config["homeProgressLabel"])}
#define WALNUT_SCREEN_HOME_PROGRESS {config["homeProgress"]}
#define WALNUT_SCREEN_HOME_PROGRESS_MAX {config["homeProgressMax"]}
#define WALNUT_SCREEN_HOME_METRIC_1 {c_string(config["metrics"][0])}
#define WALNUT_SCREEN_HOME_METRIC_2 {c_string(config["metrics"][1])}
#define WALNUT_SCREEN_HOME_METRIC_3 {c_string(config["metrics"][2])}
{metric_define_lines(config["metricItems"])}

#define WALNUT_SCREEN_SYSTEM_KIND {c_string(system_page["kind"])}
#define WALNUT_SCREEN_SYSTEM_TITLE {c_string(system_page["title"])}
#define WALNUT_SCREEN_SYSTEM_LINE_1 {c_string(system_page["lines"][0] if len(system_page["lines"]) > 0 else "")}
#define WALNUT_SCREEN_SYSTEM_LINE_2 {c_string(system_page["lines"][1] if len(system_page["lines"]) > 1 else "")}
#define WALNUT_SCREEN_SYSTEM_LINE_3 {c_string(system_page["lines"][2] if len(system_page["lines"]) > 2 else "")}
#define WALNUT_SCREEN_SYSTEM_LINE_4 {c_string(system_page["lines"][3] if len(system_page["lines"]) > 3 else "")}
#define WALNUT_SCREEN_SYSTEM_TEXT {c_multiline(system_page["title"], system_page["lines"])}

#define WALNUT_SCREEN_AI_KIND {c_string(ai_page["kind"])}
#define WALNUT_SCREEN_AI_TITLE {c_string(ai_page["title"])}
#define WALNUT_SCREEN_AI_LINE_1 {c_string(ai_page["lines"][0] if len(ai_page["lines"]) > 0 else "")}
#define WALNUT_SCREEN_AI_LINE_2 {c_string(ai_page["lines"][1] if len(ai_page["lines"]) > 1 else "")}
#define WALNUT_SCREEN_AI_LINE_3 {c_string(ai_page["lines"][2] if len(ai_page["lines"]) > 2 else "")}
#define WALNUT_SCREEN_AI_LINE_4 {c_string(ai_page["lines"][3] if len(ai_page["lines"]) > 3 else "")}
#define WALNUT_SCREEN_AI_TEXT {c_multiline(ai_page["title"], ai_page["lines"])}

#define WALNUT_SCREEN_NETWORK_KIND {c_string(network_page["kind"])}
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

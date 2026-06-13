#!/usr/bin/env python3
"""Compatibility entrypoint for the canonical JS LVGL screen config generator."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
JS_GENERATOR = ROOT_DIR / "scripts" / "generate-lvgl-screen-config.js"


def main() -> int:
    runtime = shutil.which("node") or shutil.which("bun")
    if not runtime:
        print(
            "node or bun is required: scripts/generate-lvgl-screen-config.js is the canonical Screen Manifest generator",
            file=sys.stderr,
        )
        return 1
    completed = subprocess.run([runtime, str(JS_GENERATOR)], cwd=ROOT_DIR, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())

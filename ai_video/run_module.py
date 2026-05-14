#!/usr/bin/env python3
"""Run WalnutPi ai_video modules with a sanitized system Python path."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


def unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: run_module.py <module> [args...]")
        return 2

    repo_root = Path(__file__).resolve().parent.parent
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}"

    # Prefer the repo copy plus distro packages, and avoid /usr/local NumPy
    # that can be ABI-incompatible with Debian's python3-opencv package.
    sanitized = [
        str(repo_root),
        f"/usr/lib/python{py_ver}/dist-packages",
        "/usr/lib/python3/dist-packages",
        *[path for path in sys.path if "/usr/local/lib/python" not in path],
    ]
    sys.path[:] = unique(sanitized)

    module = sys.argv[1]
    sys.argv = [module, *sys.argv[2:]]
    runpy.run_module(module, run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

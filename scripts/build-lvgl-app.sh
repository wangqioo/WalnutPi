#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

missing=()
for tool in cmake; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done
if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1; then
  missing+=("cc/gcc")
fi
if ! command -v make >/dev/null 2>&1 && ! command -v ninja >/dev/null 2>&1; then
  missing+=("make/ninja")
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing LVGL build dependencies: ${missing[*]}" >&2
  echo "Install them on Debian/Ubuntu/WalnutPi with:" >&2
  echo "  sudo $ROOT_DIR/scripts/install-lvgl-build-deps.sh" >&2
  exit 1
fi

if [ ! -d "$ROOT_DIR/third_party/lvgl" ]; then
  "$ROOT_DIR/scripts/fetch-lvgl.sh"
fi

if command -v python3 >/dev/null 2>&1; then
  python3 "$ROOT_DIR/scripts/generate-lvgl-screen-config.py"
elif command -v python >/dev/null 2>&1; then
  python "$ROOT_DIR/scripts/generate-lvgl-screen-config.py"
elif command -v node >/dev/null 2>&1; then
  node "$ROOT_DIR/scripts/generate-lvgl-screen-config.js"
elif command -v bun >/dev/null 2>&1; then
  bun "$ROOT_DIR/scripts/generate-lvgl-screen-config.js"
else
  echo "python3, python, node, or bun is required to generate LVGL screen config" >&2
  exit 1
fi

cmake -S "$ROOT_DIR/lvgl_app" -B "$ROOT_DIR/build/lvgl_app"
cmake --build "$ROOT_DIR/build/lvgl_app" --target walnut-lvgl-screen -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"

echo "$ROOT_DIR/build/lvgl_app/walnut-lvgl-screen"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$ROOT_DIR/third_party/lvgl" ]; then
  "$ROOT_DIR/scripts/fetch-lvgl.sh"
fi

cmake -S "$ROOT_DIR/lvgl_app" -B "$ROOT_DIR/build/lvgl_app"
cmake --build "$ROOT_DIR/build/lvgl_app" --target walnut-lvgl-screen -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"

echo "$ROOT_DIR/build/lvgl_app/walnut-lvgl-screen"

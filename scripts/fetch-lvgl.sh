#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT_DIR/third_party/lvgl"

if [ -d "$TARGET/.git" ]; then
  echo "LVGL already present: $TARGET"
  exit 0
fi

mkdir -p "$ROOT_DIR/third_party"
git clone --depth 1 --branch v9.2.2 https://github.com/lvgl/lvgl.git "$TARGET"

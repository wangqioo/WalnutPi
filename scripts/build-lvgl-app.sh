#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

missing=()
for tool in cmake ninja; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done
if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1; then
  missing+=("cc/gcc")
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

run_screen_workspace_config_generator() {
  local workspace_lvgl="${WALNUT_SCREEN_WORKSPACE_LVGL:-0}"
  if [ "$workspace_lvgl" = "prebuilt" ]; then
    test -f "$ROOT_DIR/lvgl_app/generated/screen_workspace_config.h"
    test -f "$ROOT_DIR/lvgl_app/generated/screen_workspace_config.c"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    WALNUT_SCREEN_WORKSPACE_LVGL="$workspace_lvgl" node "$ROOT_DIR/scripts/generate-lvgl-screen-workspace-config.js"
    return
  fi
  if command -v bun >/dev/null 2>&1; then
    WALNUT_SCREEN_WORKSPACE_LVGL="$workspace_lvgl" bun "$ROOT_DIR/scripts/generate-lvgl-screen-workspace-config.js"
    return
  fi
  if command -v wslpath >/dev/null 2>&1 && command -v node.exe >/dev/null 2>&1; then
    WALNUT_SCREEN_WORKSPACE_LVGL="$workspace_lvgl" node.exe "$(wslpath -w "$ROOT_DIR/scripts/generate-lvgl-screen-workspace-config.js")"
    return
  fi
  if command -v wslpath >/dev/null 2>&1 && command -v bun.exe >/dev/null 2>&1; then
    WALNUT_SCREEN_WORKSPACE_LVGL="$workspace_lvgl" bun.exe "$(wslpath -w "$ROOT_DIR/scripts/generate-lvgl-screen-workspace-config.js")"
    return
  fi
  echo "node or bun is required to generate LVGL screen workspace config" >&2
  echo "Install them on Debian/Ubuntu/WalnutPi with:" >&2
  echo "  sudo $ROOT_DIR/scripts/install-lvgl-build-deps.sh" >&2
  exit 1
}

run_screen_workspace_config_generator

BUILD_DIR="${WALNUT_LVGL_BUILD_DIR:-$ROOT_DIR/build/lvgl_app}"
JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"
if [ -z "${CCACHE_DIR:-}" ]; then
  export CCACHE_DIR="$ROOT_DIR/build/.ccache"
fi
mkdir -p "$CCACHE_DIR"

existing_generator=""
if [ -f "$BUILD_DIR/CMakeCache.txt" ]; then
  existing_generator="$(sed -n 's/^CMAKE_GENERATOR:INTERNAL=//p' "$BUILD_DIR/CMakeCache.txt" | head -n 1)"
fi
if [ -n "$existing_generator" ] && [ "$existing_generator" != "Ninja" ]; then
  echo "Replacing non-Ninja CMake build directory: $BUILD_DIR ($existing_generator)" >&2
  rm -rf "$BUILD_DIR"
fi

configure_args=(
  -S "$ROOT_DIR/lvgl_app"
  -B "$BUILD_DIR"
  -G Ninja
)

if command -v ccache >/dev/null 2>&1; then
  configure_args+=(-DCMAKE_C_COMPILER_LAUNCHER=ccache)
elif command -v sccache >/dev/null 2>&1; then
  configure_args+=(-DCMAKE_C_COMPILER_LAUNCHER=sccache)
fi

cmake "${configure_args[@]}"
cmake --build "$BUILD_DIR" --target walnut-lvgl-screen walnut-lvgl-preview -j"$JOBS"

echo "$BUILD_DIR/walnut-lvgl-screen"

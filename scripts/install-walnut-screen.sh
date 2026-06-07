#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

PROJECT_ROOT="${WALNUT_PROJECT_ROOT:-/home/pi/projects/WalnutPi}"
UNIT_SOURCE="$PROJECT_ROOT/lvgl_app/systemd/walnut-screen.service"
UNIT_TARGET="/etc/systemd/system/walnut-screen.service"

if [ ! -f "$UNIT_SOURCE" ]; then
  echo "Missing unit file: $UNIT_SOURCE" >&2
  exit 1
fi

"$PROJECT_ROOT/scripts/build-lvgl-app.sh"
install -m 0644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl daemon-reload

cat <<MSG
Installed $UNIT_TARGET

Start the LVGL screen shell:
  sudo systemctl start walnut-screen.service

Stop it and restore tty1:
  sudo systemctl stop walnut-screen.service

Enable at boot:
  sudo systemctl enable walnut-screen.service
MSG

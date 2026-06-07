#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

PROJECT_ROOT="${WALNUT_PROJECT_ROOT:-/home/pi/projects/WalnutPi}"
UNIT_SOURCE="$PROJECT_ROOT/lvgl_app/systemd/walnut-screen.service"
UNIT_TARGET="/etc/systemd/system/walnut-screen.service"
WALNUT_SOURCE="$PROJECT_ROOT/walnut-assistant/walnut"
WALNUT_TARGET="/usr/local/bin/walnut"

if [ ! -f "$UNIT_SOURCE" ]; then
  echo "Missing unit file: $UNIT_SOURCE" >&2
  exit 1
fi

if [ ! -f "$WALNUT_SOURCE" ]; then
  echo "Missing walnut launcher: $WALNUT_SOURCE" >&2
  exit 1
fi

"$PROJECT_ROOT/scripts/build-lvgl-app.sh"
install -m 0755 "$WALNUT_SOURCE" "$WALNUT_TARGET"
install -m 0644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl daemon-reload

cat <<MSG
Installed $UNIT_TARGET
Installed $WALNUT_TARGET

Start the LVGL screen:
  sudo walnut screen start

Stop it and restore tty1 login:
  sudo walnut screen stop

Toggle LVGL/login:
  sudo walnut screen toggle

Show screen state:
  walnut screen state

Enable at boot:
  sudo systemctl enable walnut-screen.service
MSG

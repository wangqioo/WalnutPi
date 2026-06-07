#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

PROJECT_ROOT="${WALNUT_PROJECT_ROOT:-/home/pi/projects/WalnutPi}"
UNIT_SOURCE="$PROJECT_ROOT/framebuffer_ui/systemd/walnut-framebuffer-status.service"
UNIT_TARGET="/etc/systemd/system/walnut-framebuffer-status.service"

if [ ! -f "$UNIT_SOURCE" ]; then
  echo "Missing unit file: $UNIT_SOURCE" >&2
  exit 1
fi

install -m 0644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl daemon-reload

cat <<MSG
Installed $UNIT_TARGET

Start the status screen:
  sudo systemctl start walnut-framebuffer-status.service

Stop it and restore tty1:
  sudo systemctl stop walnut-framebuffer-status.service

Enable at boot:
  sudo systemctl enable walnut-framebuffer-status.service
MSG

#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP_DIR=${VK_APP_DIR:-/opt/walnut-voice-keyboard}
SERVICE_NAME=${VK_SERVICE_NAME:-voice-keyboard-walnutpi.service}
SERVICE_USER=${VK_USER:-pi}
SOURCE_DIR=${VK_SOURCE_DIR:-}

if [ -z "$SOURCE_DIR" ]; then
  if [ -f "$ROOT_DIR/voice-keyboard/agent/walnut_voice_cli.py" ]; then
    SOURCE_DIR="$ROOT_DIR/voice-keyboard"
  elif [ -f "$ROOT_DIR/../voice-keyboard/agent/walnut_voice_cli.py" ]; then
    SOURCE_DIR="$ROOT_DIR/../voice-keyboard"
  else
    SOURCE_DIR="$ROOT_DIR/voice-keyboard"
  fi
fi

if [ ! -f "$SOURCE_DIR/agent/walnut_voice_cli.py" ] || \
   [ ! -f "$SOURCE_DIR/agent/walnut_service.py" ] || \
   [ ! -f "$SOURCE_DIR/packaging/linux/voice-keyboard-walnutpi.service" ]; then
  cat >&2 <<EOF
Voice Keyboard WalnutPi runtime source is missing.
Set VK_SOURCE_DIR to a Voice Keyboard source tree that includes:
  agent/walnut_voice_cli.py
  agent/walnut_service.py
  packaging/linux/voice-keyboard-walnutpi.service

Current VK_SOURCE_DIR: $SOURCE_DIR
EOF
  exit 2
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  SERVICE_USER=${SUDO_USER:-$(id -un)}
fi

install -d "$APP_DIR"
install -d "$APP_DIR/agent"
cp "$SOURCE_DIR/agent/__init__.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/audio_monitor.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/config.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/history.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/llm_editor.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/memo_store.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/stt.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/walnut_ai_router.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/walnut_voice_cli.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/agent/walnut_service.py" "$APP_DIR/agent/"
cp "$SOURCE_DIR/requirements-walnutpi.txt" "$APP_DIR/"
cp "$SOURCE_DIR/config.yaml.example" "$APP_DIR/"
cp "$SOURCE_DIR/config.walnutpi.yaml.example" "$APP_DIR/"

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/.venv/bin/python" -m pip install -r "$APP_DIR/requirements-walnutpi.txt"

install -d "/home/$SERVICE_USER/.voice-keyboard"
if [ ! -f "/home/$SERVICE_USER/.voice-keyboard/config.yaml" ]; then
  cp "$SOURCE_DIR/config.walnutpi.yaml.example" "/home/$SERVICE_USER/.voice-keyboard/config.yaml"
  chown "$SERVICE_USER:$SERVICE_USER" "/home/$SERVICE_USER/.voice-keyboard/config.yaml" || true
fi

sed "s/^User=.*/User=$SERVICE_USER/" \
  "$SOURCE_DIR/packaging/linux/voice-keyboard-walnutpi.service" \
  > "/etc/systemd/system/$SERVICE_NAME"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

sed "s#/opt/walnut-voice-keyboard#$APP_DIR#g" \
  "$ROOT_DIR/scripts/walnut-voice-cli" > /usr/local/bin/walnut-voice-cli
chmod +x /usr/local/bin/walnut-voice-cli

echo "Installed $SERVICE_NAME for user $SERVICE_USER"
echo "Installed walnut-voice-cli -> /usr/local/bin/walnut-voice-cli"
echo "Edit /home/$SERVICE_USER/.voice-keyboard/config.yaml or .env, then run:"
echo "  sudo systemctl restart $SERVICE_NAME"
echo "  journalctl -u $SERVICE_NAME -f"

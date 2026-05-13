#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP_DIR=${VK_APP_DIR:-/opt/walnut-voice-keyboard}
SERVICE_NAME=${VK_SERVICE_NAME:-voice-keyboard-walnutpi.service}
SERVICE_USER=${VK_USER:-pi}

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  SERVICE_USER=${SUDO_USER:-$(id -un)}
fi

install -d "$APP_DIR"
install -d "$APP_DIR/agent"
cp "$ROOT_DIR/voice-keyboard/agent/__init__.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/audio_monitor.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/config.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/history.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/llm_editor.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/memo_store.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/stt.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/walnut_ai_router.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/walnut_voice_cli.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/agent/walnut_service.py" "$APP_DIR/agent/"
cp "$ROOT_DIR/voice-keyboard/requirements-walnutpi.txt" "$APP_DIR/"
cp "$ROOT_DIR/voice-keyboard/config.yaml.example" "$APP_DIR/"
cp "$ROOT_DIR/voice-keyboard/config.walnutpi.yaml.example" "$APP_DIR/"

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/.venv/bin/python" -m pip install -r "$APP_DIR/requirements-walnutpi.txt"

install -d "/home/$SERVICE_USER/.voice-keyboard"
if [ ! -f "/home/$SERVICE_USER/.voice-keyboard/config.yaml" ]; then
  cp "$ROOT_DIR/voice-keyboard/config.walnutpi.yaml.example" "/home/$SERVICE_USER/.voice-keyboard/config.yaml"
  chown "$SERVICE_USER:$SERVICE_USER" "/home/$SERVICE_USER/.voice-keyboard/config.yaml" || true
fi

sed "s/^User=.*/User=$SERVICE_USER/" \
  "$ROOT_DIR/voice-keyboard/packaging/linux/voice-keyboard-walnutpi.service" \
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

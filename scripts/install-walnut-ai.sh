#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
install -d /opt/walnut-ai
install -m 0755 "$ROOT_DIR/walnut-ai-terminal/walnut_ai.py" /opt/walnut-ai/walnut_ai.py
cat > /usr/local/bin/walnut-ai <<'SH'
#!/bin/sh
set -a
[ -f /root/.profile ] && . /root/.profile
set +a
exec /opt/walnut-ai/walnut_ai.py "$@"
SH
chmod +x /usr/local/bin/walnut-ai
echo "Installed walnut-ai -> /usr/local/bin/walnut-ai"

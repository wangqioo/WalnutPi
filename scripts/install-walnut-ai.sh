#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
install -d /opt/walnut-ai
install -m 0755 "$ROOT_DIR/walnut-ai-terminal/walnut_ai.py" /opt/walnut-ai/walnut_ai.py
install -d /opt/walnut-ascii-video
cp -r "$ROOT_DIR/ascii_video" /opt/walnut-ascii-video/
cp -r "$ROOT_DIR/ascii_video_color" /opt/walnut-ascii-video/
cat > /usr/local/bin/walnut-ai <<'SH'
#!/bin/sh
set -a
[ -f /root/.profile ] && . /root/.profile
set +a
exec /opt/walnut-ai/walnut_ai.py "$@"
SH
chmod +x /usr/local/bin/walnut-ai
cat > /usr/local/bin/walnut-ascii-video <<'SH'
#!/bin/sh
set -e
PYTHONPATH=/opt/walnut-ascii-video exec python3 -m ascii_video.player "$@"
SH
chmod +x /usr/local/bin/walnut-ascii-video
cat > /usr/local/bin/walnut-ascii-video-color <<'SH'
#!/bin/sh
set -e
PYTHONPATH=/opt/walnut-ascii-video exec python3 -m ascii_video_color.player "$@"
SH
chmod +x /usr/local/bin/walnut-ascii-video-color
echo "Installed walnut-ai -> /usr/local/bin/walnut-ai"

#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root: sudo $0"
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  if ! dpkg -s python3-opencv >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y python3-opencv
  fi
fi

install -d /opt/walnut-ai
install -m 0755 "$ROOT_DIR/walnut-ai-terminal/walnut_ai.py" /opt/walnut-ai/walnut_ai.py

rm -rf /opt/walnut-ai-video
install -d /opt/walnut-ai-video
cp -r "$ROOT_DIR/ai_video" /opt/walnut-ai-video/

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
exec python3 -S /opt/walnut-ai-video/ai_video/run_module.py ai_video.ascii_video.player "$@"
SH
chmod +x /usr/local/bin/walnut-ascii-video

cat > /usr/local/bin/walnut-ascii-video-color <<'SH'
#!/bin/sh
set -e
exec python3 -S /opt/walnut-ai-video/ai_video/run_module.py ai_video.ascii_video_color.player "$@"
SH
chmod +x /usr/local/bin/walnut-ascii-video-color

cat > /usr/local/bin/walnut-ai-video-demo-play <<'SH'
#!/bin/sh
set -e
mode="${1:-color}"
case "$mode" in
  gray)
    exec /usr/local/bin/walnut-ascii-video /opt/walnut-ai-video/ai_video/examples/assets/demo_gray.avtx
    ;;
  still-gray)
    exec /usr/local/bin/walnut-ascii-video /opt/walnut-ai-video/ai_video/examples/assets/demo_still_gray.avtx
    ;;
  still-color)
    exec /usr/local/bin/walnut-ascii-video-color /opt/walnut-ai-video/ai_video/examples/assets/demo_still_color.avtc
    ;;
  color|*)
    exec /usr/local/bin/walnut-ascii-video-color /opt/walnut-ai-video/ai_video/examples/assets/demo_color.avtc
    ;;
esac
SH
chmod +x /usr/local/bin/walnut-ai-video-demo-play

cat > /usr/local/bin/walnut-ai-video-demo <<'SH'
#!/bin/sh
set -e
out_dir="${1:-/tmp/walnutpi-ai-video-demo}"
python3 -S /opt/walnut-ai-video/ai_video/run_module.py ai_video.examples.make_demo --out-dir "$out_dir"
printf 'Demo archives written to %s\n' "$out_dir"
printf 'Try: walnut-ascii-video %s/demo_gray.avtx\n' "$out_dir"
printf 'Try: walnut-ascii-video-color %s/demo_color.avtc\n' "$out_dir"
SH
chmod +x /usr/local/bin/walnut-ai-video-demo

echo "Installed walnut-ai -> /usr/local/bin/walnut-ai"

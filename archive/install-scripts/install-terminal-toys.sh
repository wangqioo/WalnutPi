#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

install_lf() {
  mode=$1
  source=$2
  target=$3
  tmp=$(mktemp)
  tr -d '\r' < "$source" > "$tmp"
  install -m "$mode" "$tmp" "$target"
  rm -f "$tmp"
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root: sudo $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  cmus \
  cmatrix \
  cava \
  tty-clock \
  pipes-sh \
  libaa-bin \
  caca-utils \
  sl \
  toilet \
  fortune-mod \
  cowsay \
  boxes \
  lolcat

install_lf 0755 "$ROOT_DIR/terminal-toys/walnut-fun" /usr/local/bin/walnut-fun

echo "Installed Walnut terminal toys"
echo "Try: walnut play"

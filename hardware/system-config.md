# WalnutPi System Configuration

本文记录当前 WalnutPi 原型机的系统层配置，方便重装系统或迁移到另一块板子后恢复运行环境。

不要把 API Key、Wi-Fi 密码、FRP token 等秘密信息写进本文档。

## 当前系统快照

```text
OS: Debian GNU/Linux 12 bookworm
WalnutPi OS: 2.5.1 server
Kernel: Linux 6.1.31 aarch64
Board config: sun50i-h616-walnutpi-1b
Root storage: 15G, about 11G available after resize
Framebuffer: 480x320, /dev/fb0
```

源码和运行态路径：

```text
Source repo: /home/pi/projects/WalnutPi
Walnut Home: /usr/local/bin/walnut
WalnutAI launcher: /usr/local/bin/walnut-ai
WalnutAI runtime: /opt/walnut-ai
ASCII video runtime: /opt/walnut-ai-video
Voice keyboard runtime: /opt/walnut-voice-keyboard
Voice keyboard launcher: /usr/local/bin/walnut-voice-cli
```

保持 `/home/pi/projects/WalnutPi` 归 `pi:pi` 所有，避免板子本地 Git 被 root 权限卡住。

## 软件源和包镜像

APT 使用清华源。`/etc/apt/sources.list`：

```text
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware
```

`root` 和 `pi` 的 pip 都使用清华 PyPI 源。

`/root/.pip/pip.conf` 和 `/home/pi/.pip/pip.conf`：

```text
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
```

`root` 和 `pi` 的 npm registry 使用 npmmirror。

`/root/.npmrc` 和 `/home/pi/.npmrc`：

```text
registry=https://registry.npmmirror.com
```

配置命令：

```bash
mkdir -p /root/.pip /home/pi/.pip
cat > /root/.pip/pip.conf <<'EOF'
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
EOF
cp /root/.pip/pip.conf /home/pi/.pip/pip.conf
chown -R pi:pi /home/pi/.pip

cat > /root/.npmrc <<'EOF'
registry=https://registry.npmmirror.com
EOF
cp /root/.npmrc /home/pi/.npmrc
chown pi:pi /home/pi/.npmrc
```

Docker 已通过 Debian `docker.io` 包安装并启用。下面记录的是可选镜像源配置，用于后续需要拉取镜像时恢复。

公开分享仓库前，如果不希望暴露个人加速器地址，可以删掉私有或个人化的 mirror 条目。

`/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://flnzqa26.mirror.aliyuncs.com",
    "https://dockerpull.org",
    "https://hub.geekery.cn",
    "https://docker.1ms.run",
    "https://docker.1panel.dev",
    "https://docker.1panel.live",
    "https://docker.foreverlink.love",
    "https://docker.fxxk.dedyn.io",
    "https://dytt.online",
    "https://func.ink",
    "https://lispy.org",
    "https://docker.xiaogenban1993.com",
    "https://docker.xn--6oq72ry9d5zx.cn",
    "https://docker.zhai.cm",
    "https://docker.5z5f.com",
    "https://a.ussh.net",
    "https://docker.cloudlayer.icu",
    "https://docker.linkedbus.com",
    "https://docker.nju.edu.cn",
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://hub-mirror.c.163.com",
    "https://docker.mirrors.ustc.edu.cn",
    "https://registry.docker-cn.com",
    "https://registry.cn-hangzhou.aliyuncs.com",
    "https://9cpn8tt6.mirror.aliyuncs.com",
    "https://mirror.ccs.tencentyun.com",
    "https://2a6bf1988cb6428c877f723ec7530dbc.mirror.swr.myhuaweicloud.com",
    "https://mirror.baidubce.com",
    "https://dockerhub.icu",
    "https://docker.registry.cyou",
    "https://docker-cf.registry.cyou",
    "https://docker-cf.jsdelivr.fyi",
    "https://docker.jsdelivr.fyi",
    "https://dockertest.jsdelivr.fyi",
    "https://mirror.aliyuncs.com",
    "https://docker.rainbond.cc"
  ]
}
```

恢复命令：

```bash
install -d /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://flnzqa26.mirror.aliyuncs.com",
    "https://dockerpull.org",
    "https://hub.geekery.cn",
    "https://docker.1ms.run",
    "https://docker.1panel.dev",
    "https://docker.1panel.live",
    "https://docker.foreverlink.love",
    "https://docker.fxxk.dedyn.io",
    "https://dytt.online",
    "https://func.ink",
    "https://lispy.org",
    "https://docker.xiaogenban1993.com",
    "https://docker.xn--6oq72ry9d5zx.cn",
    "https://docker.zhai.cm",
    "https://docker.5z5f.com",
    "https://a.ussh.net",
    "https://docker.cloudlayer.icu",
    "https://docker.linkedbus.com",
    "https://docker.nju.edu.cn",
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://hub-mirror.c.163.com",
    "https://docker.mirrors.ustc.edu.cn",
    "https://registry.docker-cn.com",
    "https://registry.cn-hangzhou.aliyuncs.com",
    "https://9cpn8tt6.mirror.aliyuncs.com",
    "https://mirror.ccs.tencentyun.com",
    "https://2a6bf1988cb6428c877f723ec7530dbc.mirror.swr.myhuaweicloud.com",
    "https://mirror.baidubce.com",
    "https://dockerhub.icu",
    "https://docker.registry.cyou",
    "https://docker-cf.registry.cyou",
    "https://docker-cf.jsdelivr.fyi",
    "https://docker.jsdelivr.fyi",
    "https://dockertest.jsdelivr.fyi",
    "https://mirror.aliyuncs.com",
    "https://docker.rainbond.cc"
  ]
}
EOF
systemctl daemon-reload
systemctl restart docker
docker info | sed -n '/Registry Mirrors:/,/Live Restore/p'
```

## 本地屏幕中文显示

内核虚拟控制台仍不能直接渲染 CJK 字形；本地 framebuffer 屏幕需要 `fbterm` 负责中文显示。当前不再保留 `walnut console` 菜单或 `walnut-cn` helper，只在本地 `/dev/tty1` 的 `.bashrc` 里自动进入一个普通 `fbterm` shell。SSH 不受影响。

```bash
# WalnutPi local CJK framebuffer terminal
if [ -z "${SSH_TTY:-}" ] && [ -z "${WALNUT_FBTERM:-}" ] && [ -t 0 ] && [ "$(tty)" = "/dev/tty1" ] && command -v fbterm >/dev/null 2>&1; then
    export WALNUT_FBTERM=1
    export LANG=C.UTF-8
    export LC_ALL=C.UTF-8
    exec fbterm -n "DejaVu Sans Mono,WenQuanYi Zen Hei Mono" -s "${WALNUT_FONT_SIZE:-16}" -e UTF-8 -a
fi
```

## WalnutAI 和 ASCII 视频

安装脚本：

```bash
cd /home/pi/projects/WalnutPi
./scripts/install-walnut-ai.sh
```

脚本会创建 `/opt/walnut-ai-video/.venv`，在 venv 里安装 `opencv-python-headless`，并安装这些入口：

```text
/usr/local/bin/walnut-ai
/usr/local/bin/walnut-ascii-video
/usr/local/bin/walnut-ascii-video-color
/usr/local/bin/walnut-ai-video-demo
/usr/local/bin/walnut-ai-video-demo-play
```

`ai_video/run_module.py` 会优先使用当前 venv 的 site-packages，避免依赖系统级 OpenCV 包。

验证命令：

```bash
printf '/status\n/exit\n' | walnut-ai
walnut-ai-video-demo /tmp/walnutpi-ai-video-check
walnut-ai-video-demo-play still-color
```

## Voice Keyboard

安装脚本：

```bash
cd /home/pi/projects/WalnutPi
sh scripts/install-voice-keyboard-walnutpi.sh
```

当前板子额外需要这些系统包：

```bash
apt-get install -y python3.11-venv libportaudio2
```

安装后路径：

```text
/opt/walnut-voice-keyboard
/usr/local/bin/walnut-voice-cli
/etc/systemd/system/voice-keyboard-walnutpi.service
/home/pi/.voice-keyboard/config.yaml
```

当前服务状态：

```text
voice-keyboard-walnutpi.service: disabled by default
Runtime state: start manually after USB microphone and STT are configured
```

验证命令：

```bash
walnut-voice-cli --help
systemctl is-enabled voice-keyboard-walnutpi.service
systemctl is-active voice-keyboard-walnutpi.service || true
```

语音识别和 LLM 需要在 `/home/pi/.voice-keyboard/config.yaml` 或 `.env` 中配置服务商凭证。不要把凭证提交进仓库。

## 常用检查命令

```bash
df -h /
dpkg --audit
HOME=/home/pi sudo -u pi git -C /home/pi/projects/WalnutPi status --short
command -v walnut walnut-ai walnut-voice-cli
stty -F /dev/pts/0 size
cat /sys/class/graphics/fb0/virtual_size
cat /root/.pip/pip.conf
cat /etc/apt/sources.list
cat /etc/docker/daemon.json
```

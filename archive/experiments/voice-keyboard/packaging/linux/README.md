# WalnutPi / Linux

This folder contains the Linux deployment path for running Voice Keyboard on a
headless WalnutPi-style Debian system.

The WalnutPi service mode is intentionally different from the desktop app:

- no tray UI
- no global hotkey
- no X11/Wayland keyboard injection
- USB microphone input through ALSA/PulseAudio/PipeWire via `sounddevice`
- VAD detects utterances automatically
- cloud STT converts speech to text
- optional LLM routing turns speech into memo, chat, writing, and polish actions
- transcripts and AI outputs are written to `~/.voice-keyboard/transcripts/YYYY-MM-DD.md`
- logs are available in `journalctl`

This is the right baseline for a server Linux board. Desktop typing can remain a
separate experiment because it depends on X11/XTest, `pynput`, or future
`uinput` work.

## Install On WalnutPi

From the WalnutPi repository root:

```bash
sudo ./scripts/install-voice-keyboard-walnutpi.sh
```

The installer copies only the server-side runtime files to:

```text
/opt/walnut-voice-keyboard
```

It creates a Python virtual environment, installs
`voice-keyboard/requirements-walnutpi.txt`, installs a systemd unit, and creates
the first user config from `voice-keyboard/config.walnutpi.yaml.example` at:

```text
/home/pi/.voice-keyboard/config.yaml
```

If the target user is not `pi`, set it explicitly:

```bash
sudo VK_USER=youruser ./scripts/install-voice-keyboard-walnutpi.sh
```

## Configure STT

Edit one of these files:

```text
~/.voice-keyboard/config.yaml
~/.voice-keyboard/.env
```

For ZhipuAI, a minimal `.env` is:

```bash
GLM_API_KEY=your_key_here
STT_PROVIDER=zhipuai
STT_MODEL=glm-4-voice
LLM_PROVIDER=zhipuai
LLM_MODEL=glm-4-flash
AUDIO_MODE=vad
AUDIO_DEVICE=auto
VAD_AGGRESSIVENESS=2
```

For Xunfei, use:

```bash
STT_PROVIDER=xunfei
STT_APP_ID=your_app_id
STT_API_KEY=your_api_key
STT_API_SECRET=your_api_secret
STT_LANGUAGE=zh_cn
```

The WalnutPi config template keeps STT credentials out of `config.yaml` so these
environment variables can take effect.

For a specific USB microphone, first list devices:

```bash
cd /opt/walnut-voice-keyboard
.venv/bin/python -m agent.main --list-devices
```

Then set either a device number or a name fragment:

```bash
AUDIO_DEVICE=2
```

or:

```bash
AUDIO_DEVICE=USB
```

## Run

Start or restart the service:

```bash
sudo systemctl restart voice-keyboard-walnutpi.service
```

Watch logs:

```bash
journalctl -u voice-keyboard-walnutpi.service -f
```

Try phrases like:

```text
记住我的邮箱是 me@example.com
我的邮箱是什么
列出所有备忘
帮我写一段今天调试核桃派语音服务的日志
润色一下今天已经把语音服务跑起来了但是麦克风还要继续测试
```

Transcripts are saved under:

```text
~/.voice-keyboard/transcripts/
```

## Voice CLI

For hands-light terminal work, start the interactive voice shell:

```bash
walnut-voice-cli
```

To use terminal-local push-to-talk instead of automatic VAD:

```bash
walnut-voice-cli --push-key space
```

Press space once to start recording and press space again to stop and transcribe.

Speak a command in Chinese or English. The CLI shows:

```text
heard: 查看当前目录
cmd:   pwd
[Enter] run, e edit, t transcript, s skip, q quit >
```

Press Enter to execute the generated command. Use `e` to edit, `s` to skip, and
`q` to quit.

Examples:

```text
查看当前目录
列出文件
查看内存
查看 Docker 容器
查看语音服务日志
```

If you want the STT result to be used directly as the shell command:

```bash
walnut-voice-cli --raw
```

To recognize one utterance, print the command, and exit:

```bash
walnut-voice-cli --print-only
```

There is also an unsafe fast mode that skips confirmation:

```bash
walnut-voice-cli --yes
```

Use fast mode only after the microphone and STT are reliable.

## Bring-Up Notes

These points were confirmed on a real WalnutPi Debian 12 server setup:

- Prefer a USB microphone. Bluetooth headset microphones were not reliable on
  the current board/controller path.
- For CLI usage, a voice-command shell is more practical than desktop-style
  keyboard injection. Use `walnut-voice-cli` instead of trying to type into a
  non-existent GUI session.
- Keep secrets and machine-local overrides in `~/.voice-keyboard/.env`. The
  runtime now lets `.env` override `config.yaml`, which is important for
  per-device `AUDIO_DEVICE`, STT credentials, and model selection.
- Do not assume the microphone can capture at 16 kHz directly. The current
  runtime opens the device at its default rate and resamples to 16 kHz for
  VAD/STT. This matters for USB microphones that expose 44.1 kHz or 48 kHz
  only.
- The terminal-local push-to-talk path uses the same default-rate capture and
  resampling flow, so microphones such as `Insta360 Mic Air RX` at 48 kHz work
  in both VAD mode and `--push-key` mode.
- `AUDIO_DEVICE=auto` is fine for first boot, but a fixed device id or name
  fragment is more stable after the target microphone is known.
- `walnut-voice-cli --push-key space` is the best default for terminal use when
  you want explicit capture boundaries. VAD mode remains useful for hands-free
  service workflows.
- On the device, redeploy with `git pull` and rerun the installer. Avoid ad hoc
  runtime file copies into `/opt/walnut-voice-keyboard`.

## Manual Debug Run

```bash
cd /opt/walnut-voice-keyboard
.venv/bin/python -m agent.walnut_service --device auto --vad 2
```

Press `Ctrl+C` to stop.

## Known Limits

- `webrtcvad` may need Debian build tools if no wheel is available.
- This service does not type into a focused desktop app. It is a server-side
  voice assistant and transcript service.
- Bluetooth headset microphones are not recommended on the current WalnutPi
  board. Use a USB microphone.
- A future integration can forward transcripts into WalnutAI Terminal instead of
  only writing Markdown logs.

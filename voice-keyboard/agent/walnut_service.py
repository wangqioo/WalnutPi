"""
Headless WalnutPi voice input service.

This service avoids desktop-only keyboard injection and global hotkeys. It listens
to a USB microphone with VAD, sends each utterance to the configured STT provider,
prints the transcript to stdout for systemd journal, and appends it to a local
Markdown log.
"""

from __future__ import annotations

import argparse
import signal
import sys
import threading
from datetime import datetime
from pathlib import Path

from agent.audio_monitor import AudioMonitor
from agent.config import ensure_user_config, load as load_config
from agent.history import History
from agent.llm_editor import LLMEditor
from agent.memo_store import MemoStore
from agent.stt import STTClient
from agent.walnut_ai_router import WalnutAIRouter


def _transcript_dir() -> Path:
    return Path.home() / ".voice-keyboard" / "transcripts"


def _append_transcript(kind: str, text: str, output: str) -> Path:
    out_dir = _transcript_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / (datetime.now().strftime("%Y-%m-%d") + ".md")
    now = datetime.now().strftime("%H:%M:%S")
    with path.open("a", encoding="utf-8") as f:
        f.write(f"\n## {now} [{kind}]\n\n")
        f.write(f"Input: {text.strip()}\n\n")
        if output and output != text:
            f.write(f"Output:\n\n{output.strip()}\n")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="WalnutPi headless voice input service")
    parser.add_argument("--device", default=None, help="sounddevice input id or name fragment")
    parser.add_argument("--vad", type=int, default=None, help="VAD aggressiveness, 0-3")
    args = parser.parse_args()

    ensure_user_config()
    cfg = load_config()
    stt_cfg = cfg.get("stt", {})
    if not stt_cfg:
        print("[walnut-voice] missing stt config; edit ~/.voice-keyboard/config.yaml or ~/.voice-keyboard/.env")
        return 2

    audio_cfg = cfg.get("audio", {})
    device = args.device if args.device is not None else audio_cfg.get("device", "auto")
    vad_level = args.vad if args.vad is not None else int(audio_cfg.get("vad_aggressiveness", 2))

    try:
        stt = STTClient(stt_cfg)
    except Exception as e:
        print(f"[walnut-voice] STT init failed: {e}")
        return 2

    llm = None
    llm_cfg = cfg.get("llm", {})
    if llm_cfg.get("api_key"):
        try:
            llm = LLMEditor(llm_cfg)
            print("[walnut-voice] AI routing enabled", flush=True)
        except Exception as e:
            print(f"[walnut-voice] LLM init failed, dictation-only mode: {e}", flush=True)
    else:
        print("[walnut-voice] no LLM config, dictation-only mode", flush=True)

    history = History()
    history.compact()
    router = WalnutAIRouter(llm_editor=llm, memo_store=MemoStore())

    stop = threading.Event()

    def on_utterance(pcm: bytes) -> None:
        try:
            text = stt.transcribe(pcm).strip()
        except Exception as e:
            print(f"[walnut-voice] STT failed: {e}", flush=True)
            return
        if not text:
            print("[walnut-voice] empty transcript", flush=True)
            return
        try:
            kind, output = router.handle_text(text)
        except Exception as e:
            kind, output = "dictation", text
            print(f"[walnut-ai] route failed: {e}", flush=True)
        history.append(kind, output or text, "ok")
        path = _append_transcript(kind, text, output)
        print(f"[walnut-voice] input: {text}", flush=True)
        print(f"[walnut-ai] {kind}: {output}", flush=True)
        print(f"[walnut-voice] saved: {path}", flush=True)

    try:
        monitor = AudioMonitor(on_utterance=on_utterance, device=device, vad_level=vad_level)
    except Exception as e:
        print(f"[walnut-voice] audio init failed: {e}")
        return 2

    def shutdown(signum, frame) -> None:
        print("[walnut-voice] stopping", flush=True)
        monitor.stop()
        stop.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"[walnut-voice] starting, device={device}, vad={vad_level}", flush=True)
    monitor.start()
    stop.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

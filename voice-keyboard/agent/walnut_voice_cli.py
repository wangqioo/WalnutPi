"""Voice-driven CLI for WalnutPi.

This is an interactive shell-like loop for headless Linux. It listens to a USB
microphone, transcribes one utterance, optionally turns natural language into a
shell command with the configured LLM, then lets the user press Enter to run it.
"""

from __future__ import annotations

import argparse
import os
import queue
import shlex
import signal
import subprocess
import threading
from pathlib import Path

from agent.audio_monitor import AudioMonitor
from agent.config import ensure_user_config, load as load_config
from agent.llm_editor import LLMEditor
from agent.stt import STTClient


_COMMAND_SYSTEM = """你是 WalnutPi 的语音命令行翻译器。
把用户说的话转换成一条 Debian/Linux shell 命令。

规则：
- 只输出命令本身，不要 Markdown，不要解释。
- 如果用户已经说的是明确 shell 命令，尽量原样保留。
- 常见中文意图要转成命令，例如：
  查看当前目录 -> pwd
  列出文件 -> ls -la
  查看磁盘 -> df -h
  查看内存 -> free -h
  查看 Docker -> docker ps
  查看服务状态 -> systemctl status 服务名
- 不要生成 rm、mkfs、dd、shutdown、reboot、poweroff、halt、chmod -R、chown -R 这类危险命令。
- 如果无法判断，输出空字符串。"""


_DANGEROUS = (
    "rm ",
    "rm\t",
    "mkfs",
    "dd ",
    "shutdown",
    "reboot",
    "poweroff",
    "halt",
    "chmod -r",
    "chown -r",
)


def _looks_like_shell(text: str) -> bool:
    text = text.strip()
    if not text:
        return False
    first = text.split()[0]
    known = {
        "ls", "pwd", "cd", "cat", "tail", "head", "grep", "rg", "find",
        "ps", "top", "htop", "df", "du", "free", "ip", "ping", "curl",
        "docker", "systemctl", "journalctl", "git", "python", "python3",
        "nano", "vim", "less", "mkdir", "cp", "mv",
    }
    return first in known or text.startswith("./")


def _is_dangerous(command: str) -> bool:
    lowered = command.strip().lower()
    return any(token in lowered for token in _DANGEROUS)


class VoiceCLI:
    def __init__(self, device: str | None, vad: int | None, raw: bool, yes: bool, print_only: bool):
        ensure_user_config()
        cfg = load_config()
        self._cfg = cfg
        self._raw = raw
        self._yes = yes
        self._print_only = print_only
        self._queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self._stop = threading.Event()

        stt_cfg = cfg.get("stt", {})
        if not stt_cfg:
            raise RuntimeError("missing stt config; edit ~/.voice-keyboard/.env")
        self._stt = STTClient(stt_cfg)

        llm_cfg = cfg.get("llm", {})
        self._llm = None
        if llm_cfg.get("api_key") and not raw:
            self._llm = LLMEditor(llm_cfg)

        audio_cfg = cfg.get("audio", {})
        self._device = device if device is not None else audio_cfg.get("device", "auto")
        self._vad = vad if vad is not None else int(audio_cfg.get("vad_aggressiveness", 2))
        self._monitor = AudioMonitor(self._on_utterance, device=self._device, vad_level=self._vad)

    def start(self) -> None:
        print(f"[voice-cli] listening, device={self._device}, vad={self._vad}")
        if self._llm is None:
            print("[voice-cli] raw transcript mode")
        else:
            print("[voice-cli] natural language -> shell command mode")
        print("[voice-cli] speak a command. Ctrl+C exits.\n")
        self._monitor.start()

    def stop(self) -> None:
        self._monitor.stop()
        self._stop.set()

    def loop(self) -> int:
        self.start()
        while not self._stop.is_set():
            try:
                transcript, command = self._queue.get(timeout=0.2)
            except queue.Empty:
                continue
            self._handle_candidate(transcript, command)
        return 0

    def _on_utterance(self, pcm: bytes) -> None:
        try:
            text = self._stt.transcribe(pcm).strip()
        except Exception as e:
            print(f"\n[voice-cli] STT failed: {e}")
            return
        if not text:
            print("\n[voice-cli] empty transcript")
            return
        command = self._to_command(text)
        self._queue.put((text, command))

    def _to_command(self, text: str) -> str:
        if self._raw or self._llm is None or _looks_like_shell(text):
            return text.strip()
        try:
            command = self._llm.chat(_COMMAND_SYSTEM, text).strip()
            return command.splitlines()[0].strip()
        except Exception as e:
            print(f"\n[voice-cli] LLM command conversion failed: {e}")
            return text.strip()

    def _handle_candidate(self, transcript: str, command: str) -> None:
        print()
        print(f"heard: {transcript}")
        if not command:
            print("cmd: <empty>")
            return
        print(f"cmd:   {command}")
        if self._print_only:
            print(command)
            self.stop()
            return
        if _is_dangerous(command):
            print("[voice-cli] blocked dangerous command")
            return

        if self._yes:
            choice = ""
        else:
            choice = input("[Enter] run, e edit, t transcript, s skip, q quit > ").strip().lower()
        if choice == "q":
            self.stop()
            return
        if choice == "s":
            return
        if choice == "e":
            edited = input("edit cmd > ").strip()
            if not edited:
                return
            command = edited
            if _is_dangerous(command):
                print("[voice-cli] blocked dangerous command")
                return
        elif choice == "t":
            command = transcript

        self._run(command)

    def _run(self, command: str) -> None:
        if command.startswith("cd "):
            target = command[3:].strip()
            try:
                os.chdir(Path(shlex.split(target)[0]).expanduser())
                print(f"[voice-cli] cwd: {Path.cwd()}")
            except Exception as e:
                print(f"[voice-cli] cd failed: {e}")
            return
        print(f"$ {command}")
        try:
            subprocess.run(command, shell=True)
        except Exception as e:
            print(f"[voice-cli] command failed: {e}")


def main() -> int:
    parser = argparse.ArgumentParser(description="WalnutPi voice CLI")
    parser.add_argument("--device", default=None, help="sounddevice input id or name fragment")
    parser.add_argument("--vad", type=int, default=None, help="VAD aggressiveness, 0-3")
    parser.add_argument("--raw", action="store_true", help="use STT text directly as the command")
    parser.add_argument("-y", "--yes", action="store_true", help="run recognized commands without confirmation")
    parser.add_argument("--print-only", action="store_true", help="print the recognized command once, then exit")
    args = parser.parse_args()

    cli = VoiceCLI(device=args.device, vad=args.vad, raw=args.raw, yes=args.yes, print_only=args.print_only)

    def shutdown(signum, frame) -> None:
        print("\n[voice-cli] stopping")
        cli.stop()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    return cli.loop()


if __name__ == "__main__":
    raise SystemExit(main())

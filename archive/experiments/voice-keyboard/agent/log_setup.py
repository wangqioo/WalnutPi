"""
打包模式下把 stdout/stderr 重定向到 ~/Library/Logs/Voice Keyboard/agent.log，
让 Finder 启动的 .app 也能事后查日志。开发模式（python -m agent.main）保持终端输出。
"""

import os
import sys
from pathlib import Path


def _log_path() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Logs" / "Voice Keyboard" / "agent.log"
    return Path.home() / ".voice-keyboard" / "agent.log"


class _Tee:
    """同时写文件和原 stream，带行缓冲 flush。"""
    def __init__(self, *streams):
        self._streams = streams

    def write(self, data):
        for s in self._streams:
            try:
                s.write(data)
                s.flush()
            except Exception:
                pass

    def flush(self):
        for s in self._streams:
            try:
                s.flush()
            except Exception:
                pass


def setup() -> Path | None:
    """打包模式启用日志重定向，返回日志文件路径。开发模式返回 None。"""
    if not getattr(sys, "frozen", False):
        return None

    path = _log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # 截断到 1MB 以下，防止无限增长
        if path.exists() and path.stat().st_size > 1_000_000:
            tail = path.read_bytes()[-500_000:]
            path.write_bytes(tail)
        f = open(path, "a", buffering=1, encoding="utf-8", errors="replace")
        # frozen 启动 stdout/stderr 通常是 None，直接替换
        sys.stdout = _Tee(f, sys.stdout) if sys.stdout else f
        sys.stderr = _Tee(f, sys.stderr) if sys.stderr else f
        os.environ["VK_LOG_PATH"] = str(path)
        print(f"\n[log] === Voice Keyboard 启动 PID={os.getpid()} ===")
        return path
    except Exception as e:
        # 日志失败不应阻断启动
        print(f"[log] 日志重定向失败: {e}")
        return None


def log_path() -> Path:
    return _log_path()

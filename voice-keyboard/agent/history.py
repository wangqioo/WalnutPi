"""
转写历史 JSONL 持久化。每次 STT 完成（成功或失败）追加一行。
~/.voice-keyboard/history.jsonl

字段：ts(epoch sec) / mode(dictate|edit|ai|polish) / text / status(ok|empty|error) / detail(可选错误描述)
"""

import json
import threading
import time
from pathlib import Path
from typing import Callable, Optional

_PATH = Path.home() / ".voice-keyboard" / "history.jsonl"
_MAX_KEEP = 500  # 超过这个条数时压缩到一半


class History:
    def __init__(self, path: Optional[Path] = None):
        self._path = path or _PATH
        self._lock = threading.Lock()
        self._listeners: list[Callable[[dict], None]] = []
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def add_listener(self, fn: Callable[[dict], None]) -> None:
        self._listeners.append(fn)

    def append(self, mode: str, text: str, status: str = "ok", detail: str = "") -> None:
        entry = {
            "ts":     time.time(),
            "mode":   mode,
            "text":   text,
            "status": status,
        }
        if detail:
            entry["detail"] = detail
        with self._lock:
            try:
                with open(self._path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            except Exception as e:
                print(f"[history] 写入失败: {e}")
                return
        for fn in self._listeners:
            try:
                fn(entry)
            except Exception as e:
                print(f"[history] listener 异常: {e}")

    def load(self, limit: int = 200) -> list[dict]:
        if not self._path.exists():
            return []
        try:
            lines = self._path.read_text(encoding="utf-8").splitlines()
        except Exception as e:
            print(f"[history] 读取失败: {e}")
            return []
        out: list[dict] = []
        for line in lines[-limit:]:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                continue
        return out

    def compact(self) -> None:
        """超过 _MAX_KEEP 时只保留最新的一半，防止无限增长。"""
        with self._lock:
            if not self._path.exists():
                return
            try:
                lines = self._path.read_text(encoding="utf-8").splitlines()
            except Exception:
                return
            if len(lines) <= _MAX_KEEP:
                return
            keep = lines[-(_MAX_KEEP // 2):]
            self._path.write_text("\n".join(keep) + "\n", encoding="utf-8")

    @property
    def path(self) -> Path:
        return self._path

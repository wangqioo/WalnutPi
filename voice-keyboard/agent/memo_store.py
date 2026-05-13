"""
简单的 JSON 备忘录键值存储，跨会话持久化。
默认路径 ~/.voice-keyboard/memos.json。
"""

import json
import threading
from pathlib import Path
from typing import Optional


class MemoStore:
    def __init__(self, path: Optional[Path] = None):
        self._path = path or Path.home() / ".voice-keyboard" / "memos.json"
        self._lock = threading.Lock()
        self._data: dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            self._data = json.loads(self._path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[memo] 读取失败 {self._path}: {e}")
            self._data = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def save(self, key: str, value: str) -> None:
        with self._lock:
            self._data[key] = value
            self._save()

    def get(self, key: str) -> Optional[str]:
        return self._data.get(key)

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._data:
                del self._data[key]
                self._save()
                return True
            return False

    def keys(self) -> list[str]:
        return list(self._data.keys())

#!/usr/bin/env python3
"""Distill durable WalnutPi memory from append-only conversation logs."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent
MEMORY_ROOT = Path(os.getenv("WALNUT_MEMORY_DIR", str(Path.home() / "walnut-memory"))).expanduser()
DEFAULT_MEMORY_FILE = Path(os.getenv("WALNUT_AI_MEMORY_FILE", str(MEMORY_ROOT / "memory.json"))).expanduser()
DEFAULT_CLI_SESSIONS_DIR = Path(os.getenv("WALNUT_AI_SESSIONS_DIR", str(MEMORY_ROOT / "sessions"))).expanduser()
DEFAULT_WEB_SESSIONS_DIR = Path(
    os.getenv("WALNUT_WEB_SESSIONS_DIR", str(PROJECT_ROOT / "web-interface" / "data" / "sessions"))
).expanduser()

MEMORY_FIELDS = ("preferences", "environment", "projects", "workflows", "goals", "summary")

SECRET_RE = re.compile(
    r"(?i)"
    r"(api[_ -]?key|openai[_ -]?api|password|passwd|密码|口令|token|secret|"
    r"private[_ -]?key|ssh[_ -]?password|wifi[_ -]?password|wi-fi[_ -]?password|"
    r"bearer\s+[a-z0-9._~+/=-]+|sk-[a-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)"
)

NOISE_RE = re.compile(
    r"^(继续|继续推进|j继续|好的|嗯|可以|行|ok|okay|收到|开始|go|next|下一步)[。.!！\s]*$",
    re.IGNORECASE,
)

SENTENCE_RE = re.compile(r"[\r\n]+|(?<=[。！？!?；;])\s*")

@dataclass(frozen=True)
class MemoryCandidate:
    field: str
    content: str


def empty_memory() -> dict[str, list[str]]:
    return {field: [] for field in MEMORY_FIELDS}


def normalize_memory(value: object) -> dict[str, list[str]]:
    normalized = empty_memory()
    if not isinstance(value, dict):
        return normalized
    for field in MEMORY_FIELDS:
        items = value.get(field)
        if not isinstance(items, list):
            continue
        seen: set[str] = set()
        for item in items:
            text = clean_memory_text(str(item))
            key = text.casefold()
            if text and key not in seen and not contains_secret(text):
                normalized[field].append(text)
                seen.add(key)
    return normalized


def load_memory(path: Path) -> dict[str, list[str]]:
    if not path.exists():
        return empty_memory()
    try:
        return normalize_memory(json.loads(path.read_text(encoding="utf-8")))
    except Exception as error:
        print(f"[memory-distill] failed to read {path}: {error}", file=sys.stderr)
        return empty_memory()


def save_memory(path: Path, data: dict[str, list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalize_memory(data), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def contains_secret(text: str) -> bool:
    return bool(SECRET_RE.search(text))


def clean_memory_text(text: str, limit: int = 260) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip(" \t\r\n-_*`\"'“”‘’：:，,。.!！?？")
    for prefix in ("记住", "记着", "请记住", "帮我记住", "以后", "下次"):
        if text.startswith(prefix):
            text = text[len(prefix):].strip(" ：:，,。 ")
    return text[:limit].strip()


def compact_architecture_preferences(text: str) -> list[MemoryCandidate]:
    lowered = text.casefold()
    candidates: list[MemoryCandidate] = []
    if ("所有对话" in text or "全量对话" in text) and ("存储" in text or "落盘" in text):
        if "记忆" in text and ("后台" in text or "提炼" in text or "蒸馏" in text or "已存储" in text):
            candidates.append(MemoryCandidate("workflows", "所有对话应先完整存储；长期记忆应由后台从已存储会话中提炼。"))
        else:
            candidates.append(MemoryCandidate("workflows", "所有对话应先完整存储，作为后续检索和记忆提炼的事实源。"))
    if "hardware cursor" in lowered or "硬件版 cursor" in lowered:
        candidates.append(MemoryCandidate("goals", "WalnutPi 的长期方向是真正的“硬件版 Cursor”：项目记忆、成功代码沉淀、检索生成闭环。"))
    if "项目推进" in text:
        candidates.append(MemoryCandidate("preferences", "用户希望对话优先推进 WalnutPi 项目落地，而不是停留在泛泛讨论。"))
    if "gpt-5.4-mini" in lowered and "默认" in text:
        candidates.append(MemoryCandidate("preferences", "默认模型策略优先使用 gpt-5.4-mini，除非场景需要切换。"))
    return candidates


def classify_field(text: str) -> str | None:
    lowered = text.casefold()
    if any(word in text for word in ("目标", "方向", "闭环", "愿景", "硬件版 Cursor")):
        return "goals"
    if any(word in text for word in ("项目", "WalnutPi", "核桃派", "third/walnutpi", "代码库", "repo")):
        return "projects"
    if any(word in text for word in ("流程", "工作流", "应该", "先", "后台", "迁移", "检索", "存储", "落盘", "JSON 化", "action")):
        return "workflows"
    if any(word in text for word in ("默认", "偏好", "我喜欢", "我不喜欢", "我习惯", "我要的是", "希望")):
        return "preferences"
    if any(word in text for word in ("我用", "我在用", "环境", "Windows", "Debian", "Python", "Bun", "uv", "OpenAI", "模型")):
        return "environment"
    if any(word in lowered for word in ("default", "prefer", "workflow", "environment", "model", "memory", "retrieval")):
        return "workflows"
    return None


def has_durable_signal(text: str) -> bool:
    lowered = text.casefold()
    durable_markers = (
        "记住", "记着", "以后", "下次", "默认", "偏好", "习惯", "我的项目", "我的设备",
        "我用", "我在用", "我要的是", "我希望", "目标", "方向", "应该", "所有对话",
        "memory", "retrieval", "corpus", "skills", "gpt-5.4-mini", "hardware cursor", "硬件版 cursor",
    )
    return any(marker.casefold() in lowered for marker in durable_markers)


def split_sentences(text: str) -> list[str]:
    parts = [part.strip() for part in SENTENCE_RE.split(text) if part and part.strip()]
    if not parts and text.strip():
        parts = [text.strip()]
    return parts


def extract_candidates_from_user_text(text: str) -> list[MemoryCandidate]:
    candidates: list[MemoryCandidate] = []
    for sentence in split_sentences(text):
        cleaned = clean_memory_text(sentence)
        if not cleaned or len(cleaned) < 6 or NOISE_RE.match(cleaned) or contains_secret(cleaned):
            continue

        compact = compact_architecture_preferences(cleaned)
        if compact:
            candidates.extend(compact)
            continue

        if not has_durable_signal(cleaned):
            continue
        field = classify_field(cleaned)
        if not field:
            continue
        candidates.append(MemoryCandidate(field, cleaned))
    return candidates


def iter_session_files(dirs: Iterable[Path]) -> Iterable[Path]:
    seen: set[Path] = set()
    for directory in dirs:
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.jsonl")):
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            yield path


def iter_jsonl_events(path: Path, limit: int | None = None) -> Iterable[dict[str, object]]:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception as error:
        print(f"[memory-distill] failed to read {path}: {error}", file=sys.stderr)
        return
    if limit is not None and limit > 0:
        lines = lines[-limit:]
    for line in lines:
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            yield event


def distill_from_sessions(session_dirs: list[Path], limit: int | None = None) -> tuple[list[MemoryCandidate], dict[str, int]]:
    candidates: list[MemoryCandidate] = []
    stats = {"files": 0, "events": 0, "user_events": 0}
    for path in iter_session_files(session_dirs):
        stats["files"] += 1
        for event in iter_jsonl_events(path, limit=limit):
            stats["events"] += 1
            if event.get("role") != "user":
                continue
            stats["user_events"] += 1
            content = str(event.get("content") or "")
            candidates.extend(extract_candidates_from_user_text(content))
    return candidates, stats


def merge_memory(memory: dict[str, list[str]], candidates: Iterable[MemoryCandidate]) -> tuple[dict[str, list[str]], int]:
    added = 0
    merged = normalize_memory(memory)
    existing = {
        field: {item.casefold() for item in merged.get(field, [])}
        for field in MEMORY_FIELDS
    }
    for candidate in candidates:
        if candidate.field not in MEMORY_FIELDS:
            continue
        content = clean_memory_text(candidate.content)
        key = content.casefold()
        if not content or contains_secret(content) or key in existing[candidate.field]:
            continue
        merged[candidate.field].append(content)
        existing[candidate.field].add(key)
        added += 1
    return merged, added


def append_unique_path(paths: list[Path], path: Path) -> None:
    expanded = path.expanduser()
    if expanded not in paths:
        paths.append(expanded)


def default_session_dirs() -> list[Path]:
    dirs: list[Path] = []
    if os.getenv("WALNUT_WEB_SESSIONS_DIR"):
        append_unique_path(dirs, DEFAULT_WEB_SESSIONS_DIR)
    else:
        append_unique_path(dirs, DEFAULT_WEB_SESSIONS_DIR)
        for env_name in ("WALNUT_PROJECT_ROOT", "WALNUT_REMOTE_PROJECT_ROOT"):
            root = os.getenv(env_name, "").strip()
            if root:
                append_unique_path(dirs, Path(root) / "web-interface" / "data" / "sessions")
        append_unique_path(dirs, Path.cwd() / "web-interface" / "data" / "sessions")
        append_unique_path(dirs, Path.home() / "projects" / "WalnutPi" / "web-interface" / "data" / "sessions")
        append_unique_path(dirs, Path("/home/pi/projects/WalnutPi/web-interface/data/sessions"))
    append_unique_path(dirs, DEFAULT_CLI_SESSIONS_DIR)
    return dirs


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Distill compact WalnutPi memory from stored append-only conversation JSONL logs.",
    )
    parser.add_argument(
        "--sessions-dir",
        action="append",
        type=Path,
        help="Conversation JSONL directory. Can be repeated. Defaults to Web sessions and ~/walnut-memory/sessions.",
    )
    parser.add_argument(
        "--memory-file",
        type=Path,
        default=DEFAULT_MEMORY_FILE,
        help="Memory JSON file to merge into. Defaults to WALNUT_AI_MEMORY_FILE or ~/walnut-memory/memory.json.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print proposed additions without writing memory.json.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Read only the last N events from each session file.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    session_dirs = [path.expanduser() for path in (args.sessions_dir or default_session_dirs())]
    memory_file = args.memory_file.expanduser()

    candidates, stats = distill_from_sessions(session_dirs, limit=args.limit)
    memory = load_memory(memory_file)
    merged, added = merge_memory(memory, candidates)
    existing_by_field = {
        field: {item.casefold() for item in memory.get(field, [])}
        for field in MEMORY_FIELDS
    }
    added_by_field = {
        field: [item for item in merged[field] if item.casefold() not in existing_by_field[field]]
        for field in MEMORY_FIELDS
    }

    result = {
        "ok": True,
        "schema": "walnutpi.memoryDistill.v1",
        "sessionDirs": [str(path) for path in session_dirs],
        "memoryFile": str(memory_file),
        "dryRun": bool(args.dry_run),
        "stats": {
            **stats,
            "candidates": len(candidates),
            "added": added,
        },
        "added": added_by_field,
    }

    if not args.dry_run and added:
        save_memory(memory_file, merged)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

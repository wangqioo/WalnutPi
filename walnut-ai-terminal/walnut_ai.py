#!/usr/bin/env python3
"""WalnutAI: a tiny local-agent terminal for headless Linux."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import textwrap
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from uuid import uuid4

APP_NAME = "WalnutAI"
MODEL = os.getenv("WALNUT_AI_MODEL", "gpt-5.4-mini")
BASE_URL = os.getenv("WALNUT_AI_BASE_URL", "https://rehdasu.cn/v1").rstrip("/")
API_KEY = os.getenv("OPENAI_API_KEY", "")
API_TIMEOUT = int(os.getenv("WALNUT_AI_TIMEOUT", "45"))
REASONING_EFFORT = os.getenv("WALNUT_AI_REASONING_EFFORT", "none").strip()
TEXT_VERBOSITY = os.getenv("WALNUT_AI_TEXT_VERBOSITY", "low").strip()
DISABLE_MEMORY = os.getenv("WALNUT_AI_DISABLE_MEMORY", "").strip().lower() in {"1", "true", "yes", "on"}
ENABLE_INLINE_MEMORY = os.getenv("WALNUT_AI_ENABLE_INLINE_MEMORY", "").strip().lower() in {"1", "true", "yes", "on"}
FORCE_IPV4 = os.getenv("WALNUT_AI_FORCE_IPV4", "1").strip().lower() not in {"0", "false", "no", "off"}
MEMORY_TEXT = os.getenv("WALNUT_AI_MEMORY_TEXT", "").strip()
MEMORY_ROOT = Path(os.getenv("WALNUT_MEMORY_DIR", str(Path.home() / "walnut-memory"))).expanduser()
MEMORY_FILE = Path(os.getenv("WALNUT_AI_MEMORY_FILE", str(MEMORY_ROOT / "memory.json"))).expanduser()
NOTES_DIR = Path(os.getenv("WALNUT_AI_NOTES_DIR", str(MEMORY_ROOT / "daily"))).expanduser()
SESSION_DIR = Path(os.getenv("WALNUT_AI_SESSIONS_DIR", str(MEMORY_ROOT / "sessions"))).expanduser()
SESSION_ID_OVERRIDE = os.getenv("WALNUT_AI_SESSION_ID", "").strip()
DISABLE_SESSION_LOG = os.getenv("WALNUT_AI_DISABLE_SESSION_LOG", "").strip().lower() in {"1", "true", "yes", "on"}
HISTORY_LIMIT = 12
DEVICE_PROFILE = os.getenv("WALNUT_AI_DEVICE_PROFILE", "核桃派 1B ZeroW").strip() or "核桃派 1B ZeroW"
APP_DIR = Path(__file__).resolve().parent
SKILLS_DIR = Path(os.getenv("WALNUT_AI_SKILLS_DIR", str(APP_DIR / "skills"))).expanduser()
PRIMARY_SKILL = os.getenv("WALNUT_AI_PRIMARY_SKILL", "walnutpi-1b-zerow").strip() or "walnutpi-1b-zerow"
CORPUS_DIR = Path(os.getenv("WALNUT_AI_CORPUS_DIR", str(APP_DIR / "corpus"))).expanduser()
CONTEXT_FILE_LIMIT = 5000
RETRIEVAL_SOURCE_LIMIT = 6
RETRIEVAL_CONTEXT_LIMIT = 14000
API_HTTP_LOCK = threading.RLock()
MEMORY_LOCK = threading.RLock()
SESSION_LOCK = threading.RLock()
CURRENT_SESSION_ID: str | None = None
MEMORY_FIELDS = ("preferences", "environment", "projects", "workflows", "goals", "summary")
MEMORY_TYPE_TO_FIELD = {
    "preference": "preferences",
    "environment": "environment",
    "project": "projects",
    "workflow": "workflows",
    "goal": "goals",
}
MUSIC_EXTENSIONS = {".mp3", ".ogg", ".oga", ".flac", ".wav", ".m4a", ".aac", ".opus", ".mid", ".midi"}
MUSIC_DIR_CANDIDATES = [
    Path(os.getenv("WALNUT_MUSIC_DIR")).expanduser() if os.getenv("WALNUT_MUSIC_DIR") else None,
    Path.home() / "music-library",
    Path.home() / "Music" / "WalnutMusic",
    Path.home() / "Music" / "music-library",
    Path("/home/pi/music-library"),
    Path("/root/music-library"),
]
LOCAL_ACTION_TIMEOUTS = {
    "status": 25,
    "network": 15,
    "gpio": 25,
    "snapshot": 25,
}
LOCAL_ACTION_TITLES = {
    "status": "设备状态",
    "network": "网络检查",
    "gpio": "GPIO 只读检查",
    "snapshot": "设备快照",
}
LocalActionResult = tuple[str, str, bool]
ORIGINAL_GETADDRINFO = socket.getaddrinfo

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SYSTEM_PROMPT = """你是 WalnutAI，一台无桌面 Linux 随身 AI 终端里的意图判断和执行总结助手。
你的回答要短、直接、可执行。默认使用中文。
这台设备不是通用桌面电脑，而是有本地执行能力的 AI 终端。你要先判断用户意图，再配合 WalnutPi 做只读检查或总结执行结果。
不要假装执行过没有发生的动作；如果本地动作输出已经提供给你，请基于这些真实输出总结。"""

MEMORY_MANAGER_PROMPT = """你是 WalnutAI 的 Memory Manager。只判断本轮对话是否产生值得长期保存的信息。

只保存：
- 用户长期偏好
- 用户开发环境
- 用户项目事实
- 用户技术栈
- 用户设备信息
- 用户明确表达的长期目标
- 反复出现的重要工作流

不要保存：
- 临时问题
- 一次性聊天内容
- 普通知识讨论
- 情绪表达
- 推测出的信息
- 不确定的信息

规则：
- 只记录用户明确表达的信息。
- 如果用户新说法和已有记忆冲突，以用户新说法为准。
- confidence 小于 0.8 的内容不要输出。
- 同一事实不要重复记录。"""

ROUTER_PROMPT = """你是 WalnutPi 端侧意图路由器。只输出 JSON，不要输出 Markdown。

把用户请求分类到固定 action 之一：
- chat: 普通知识问答、解释概念、简单文本回复，不需要本机实时状态。
- status: 查询核桃派状态、健康、内存、磁盘、服务、Docker。
- network: 查询网络、Wi-Fi、IP、路由、联网状态。
- time: 查询当前时间或日期。
- weather: 查询实时天气。args.location 写用户提到的地点；没提到就留空字符串。
- music_library: 查询本地音乐库、有什么歌、歌曲列表。
- notes_today: 查询今天记了什么、今天笔记。
- note_add: 记录一条笔记。args.text 写要保存的正文，不要包含“记一下”等触发词。
- gpio_read: 只读检查 GPIO、引脚、排针、I2C/SPI/UART/PWM 接线或 overlay 状态。
- snapshot: 查询或确认自己是什么板子、板子型号、系统、内核、屏幕、boot/config 等设备快照。
- risky: 任何会产生副作用或高风险的请求，包括 GPIO 输出、修改 overlay、安装/卸载包、启停服务、重启、关机、删除、刷写、固件、EMMC。

输出 schema：
{"action":"...","risk":"read|write-low|high|none","args":{},"reason":"一句话说明"}

用户问“你是什么板子/型号/设备”时走 snapshot。
不要发明 action。不要输出 shell 命令。"""

ROUTER_ACTIONS = {
    "chat",
    "status",
    "network",
    "time",
    "weather",
    "music_library",
    "notes_today",
    "note_add",
    "gpio_read",
    "snapshot",
    "risky",
    "router_error",
}

MEMORY_UPDATE_FORMAT = {
    "type": "json_schema",
    "name": "walnut_memory_updates",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "memory_updates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["preference", "project", "environment", "workflow", "goal"],
                        },
                        "content": {"type": "string", "minLength": 1, "maxLength": 300},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                    "required": ["type", "content", "confidence"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["memory_updates"],
        "additionalProperties": False,
    },
}

LOCAL_ROUTE_HINTS = (
    "状态", "健康", "内存", "磁盘", "docker", "服务",
    "网络", "联网", "wifi", "wi-fi", "ip地址", "本机ip", "查ip", "路由",
    "时间", "几点", "日期", "今天几号",
    "天气", "气温", "下雨",
    "音乐库", "有什么歌", "哪些歌", "歌曲", "歌单", "曲库", "music-library",
    "笔记", "记一下", "记住", "今天记了什么", "notes", "note",
    "gpio", "引脚", "排针", "i2c", "spi", "uart", "pwm", "overlay",
    "板子", "型号", "什么设备", "什么系统", "内核", "屏幕", "lvgl", "fb0", "framebuffer",
    "项目", "记忆", "memory", "retrieval", "检索", "成功代码", "代码沉淀",
    "安装", "卸载", "删除", "重启", "关机", "刷写", "固件", "emmc",
)

ONE_SHOT_MEMORY_HINTS = (
    "记住", "记着", "以后", "下次",
    "我的偏好", "我喜欢", "我不喜欢", "我习惯",
    "我是", "我叫", "我用", "我在用", "我的项目", "我的设备",
)


def skill_names(limit: int = 16) -> list[str]:
    if not SKILLS_DIR.is_dir():
        return []
    return [p.parent.name for p in sorted(SKILLS_DIR.glob("*/SKILL.md"))[:limit]]


def safe_text_file(path: Path, limit: int = CONTEXT_FILE_LIMIT) -> str:
    if not path.is_file() or path.suffix.lower() not in {".md", ".json", ".txt", ".py", ".c", ".h"}:
        return ""
    try:
        data = path.read_text(encoding="utf-8", errors="replace").strip()
    except Exception:
        return ""
    return data[:limit]


def tokenize_query(text: str) -> set[str]:
    words = {
        item.casefold()
        for item in re.findall(r"[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]{2,}", text)
        if len(item.strip()) >= 2
    }
    synonyms = {
        "屏幕": {"screen", "lvgl", "fb0", "framebuffer"},
        "小屏": {"screen", "lvgl", "fb0", "framebuffer"},
        "同步": {"sync", "manifest", "delivery"},
        "记忆": {"memory", "retrieval"},
        "检索": {"retrieval", "skills", "corpus"},
        "成功代码": {"corpus", "recipe", "example"},
        "硬件cursor": {"hardware", "cursor", "corpus", "retrieval"},
        "硬件版": {"hardware", "cursor", "corpus", "retrieval"},
        "gpio": {"引脚", "排针"},
        "i2c": {"传感器", "sensor"},
    }
    for key, values in synonyms.items():
        if key in text.casefold() or key in words:
            words.update(values)
    return words


def retrieval_sources() -> list[Path]:
    sources: list[Path] = []
    for path in [
        SKILLS_DIR / "walnutpi-core.md",
        SKILLS_DIR / "walnutpi-screen.md",
        SKILLS_DIR / PRIMARY_SKILL / "SKILL.md",
        CORPUS_DIR / "successful-code.md",
    ]:
        if path.exists():
            sources.append(path)
    if SKILLS_DIR.is_dir():
        sources.extend(sorted(SKILLS_DIR.glob("*/SKILL.md")))
        sources.extend(sorted((SKILLS_DIR / PRIMARY_SKILL).glob("*.md")))
    if CORPUS_DIR.is_dir():
        sources.extend(sorted(CORPUS_DIR.glob("*.md")))
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in sources:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(path)
    return unique


def score_source(path: Path, data: str, terms: set[str]) -> int:
    if not terms:
        return 0
    haystack = f"{path.name}\n{path.parent.name}\n{data[:2000]}".casefold()
    score = 0
    for term in terms:
        if term in haystack:
            score += 3 if term in path.name.casefold() or term in path.parent.name.casefold() else 1
    if path == SKILLS_DIR / "walnutpi-core.md":
        score += 1
    if path == SKILLS_DIR / "walnutpi-screen.md" and {"screen", "lvgl", "fb0", "framebuffer"} & terms:
        score += 4
    if path == CORPUS_DIR / "successful-code.md" and {"corpus", "recipe", "example", "成功代码"} & terms:
        score += 4
    return score


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(APP_DIR))
    except ValueError:
        return str(path)


def retrieval_context(query: str) -> str:
    terms = tokenize_query(query)
    ranked: list[tuple[int, Path, str]] = []
    for path in retrieval_sources():
        data = safe_text_file(path)
        if not data:
            continue
        score = score_source(path, data, terms)
        if score > 0 or path.name in {"walnutpi-core.md", "walnutpi-screen.md"}:
            ranked.append((score, path, data))
    ranked.sort(key=lambda item: (-item[0], str(item[1])))

    sections: list[str] = []
    size = 0
    for score, path, data in ranked[:RETRIEVAL_SOURCE_LIMIT]:
        label = display_path(path)
        section = f"### {label} (score={score})\n{data}"
        if size + len(section) > RETRIEVAL_CONTEXT_LIMIT:
            remaining = max(0, RETRIEVAL_CONTEXT_LIMIT - size - len(label) - 80)
            if remaining <= 0:
                break
            section = f"### {label} (score={score})\n{data[:remaining]}\n[truncated]"
        sections.append(section)
        size += len(section)

    if not sections:
        return ""
    return "\n\nWalnutPi 检索上下文（skills / project memory / successful code corpus）：\n" + "\n\n".join(sections)


def walnutpi_context() -> str:
    primary_skill = SKILLS_DIR / PRIMARY_SKILL / "SKILL.md"
    lines = [
        "设备和 skills 上下文：",
        f"- 当前设备身份：{DEVICE_PROFILE}（WalnutPi 1B ZeroW / 核桃派 1B ZeroW）。",
        "- 判断硬件、GPIO、overlay、屏幕、摄像头、PyQt5、OpenCV、Home Assistant、MQTT 问题时，把自己当作这块板子。",
        f"- WalnutPi skills 目录: {SKILLS_DIR}",
        f"- 成功代码语料目录: {CORPUS_DIR}",
    ]
    if primary_skill.exists():
        lines.append(f"- 优先技能：{PRIMARY_SKILL} ({primary_skill})")
    else:
        lines.append(f"- 优先技能：{PRIMARY_SKILL}（当前未在 skills 目录找到）")
    names = skill_names()
    if names:
        lines.append("- 可用 skills：" + ", ".join(names))
    lines.append("- 详细硬件、引脚、overlay、刷写、安装、屏幕同步或代码生成指导必须先参考检索上下文、skills 或本机只读检查，不要编造。")
    return "\n".join(lines)


def empty_memory() -> dict[str, list[str]]:
    return {field: [] for field in MEMORY_FIELDS}


def normalize_memory(data: object) -> dict[str, list[str]]:
    normalized = empty_memory()
    if not isinstance(data, dict):
        return normalized
    for field in MEMORY_FIELDS:
        values = data.get(field)
        if not isinstance(values, list):
            continue
        seen: set[str] = set()
        for value in values:
            text = str(value).strip()
            key = text.casefold()
            if text and key not in seen:
                normalized[field].append(text)
                seen.add(key)
    return normalized


def load_memory() -> dict[str, list[str]]:
    with MEMORY_LOCK:
        if not MEMORY_FILE.exists():
            return empty_memory()
        try:
            return normalize_memory(json.loads(MEMORY_FILE.read_text(encoding="utf-8")))
        except Exception as e:
            print(f"[memory] 读取失败 {MEMORY_FILE}: {e}", file=sys.stderr)
            return empty_memory()


def save_memory(data: dict[str, list[str]]) -> None:
    with MEMORY_LOCK:
        MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        MEMORY_FILE.write_text(
            json.dumps(normalize_memory(data), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def memory_context(limit_per_field: int = 8) -> str:
    data = load_memory()
    lines: list[str] = []
    labels = {
        "preferences": "用户偏好",
        "environment": "技术环境",
        "projects": "项目事实",
        "workflows": "工作流",
        "goals": "长期目标",
        "summary": "记忆摘要",
    }
    for field in MEMORY_FIELDS:
        values = data.get(field, [])[:limit_per_field]
        if not values:
            continue
        lines.append(f"{labels[field]}：")
        lines.extend(f"- {value}" for value in values)
    return "\n".join(lines) if lines else "暂无长期记忆。"


def format_memory_for_display() -> str:
    data = load_memory()
    lines = [f"记忆文件: {MEMORY_FILE}"]
    labels = {
        "preferences": "使用偏好",
        "environment": "使用环境",
        "projects": "项目情况",
        "workflows": "常用做法",
        "goals": "长期目标",
        "summary": "摘要",
    }
    for field in MEMORY_FIELDS:
        lines.append("")
        lines.append(labels[field] + "：")
        values = data.get(field, [])
        if values:
            lines.extend(f"  - {value}" for value in values)
        else:
            lines.append("  暂无")
    return "\n".join(lines)


def system_prompt(include_memory: bool = True, query: str = "") -> str:
    parts = [SYSTEM_PROMPT]
    if include_memory and not DISABLE_MEMORY:
        parts.extend([
            "当前长期记忆：",
            memory_context(),
            "如果记忆与用户当前说法冲突，以用户最新说法为准。",
        ])
    parts.append(walnutpi_context())
    retrieved = retrieval_context(query)
    if retrieved:
        parts.append(retrieved)
    return "\n\n".join(parts)


def router_prompt(query: str = "") -> str:
    retrieved = retrieval_context(query)
    return f"{ROUTER_PROMPT}\n\n{walnutpi_context()}\n\n{retrieved}\n\n路由时必须使用上述设备身份；不要把自己识别为普通 Linux PC。"


def term_width() -> int:
    return shutil.get_terminal_size((88, 24)).columns


def line(char: str = "-") -> str:
    return char * min(term_width(), 100)


def wrap(text: str, indent: str = "") -> str:
    width = max(40, min(term_width(), 100) - len(indent))
    out = []
    for raw in text.splitlines() or [""]:
        if not raw.strip():
            out.append("")
        else:
            out.extend(textwrap.wrap(raw, width=width, replace_whitespace=False, drop_whitespace=False))
    return "\n".join(indent + s for s in out)


def card(title: str, body: str) -> None:
    print()
    print(line("="))
    print(f"[{title}]")
    print(line("-"))
    print(wrap(body))
    print(line("="))
    print()


def safe_session_id(value: str) -> str | None:
    text = str(value or "").strip()
    if not re.fullmatch(r"[a-zA-Z0-9._-]{8,80}", text) or ".." in text or text.startswith("."):
        return None
    return text


def current_session_id() -> str:
    global CURRENT_SESSION_ID
    if CURRENT_SESSION_ID:
        return CURRENT_SESSION_ID
    CURRENT_SESSION_ID = safe_session_id(SESSION_ID_OVERRIDE) or (
        f"cli-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}"
    )
    return CURRENT_SESSION_ID


def append_session_event(
    role: str,
    content: str,
    action: str | None = None,
    ok: bool | None = None,
    command: str | None = None,
) -> None:
    if DISABLE_SESSION_LOG:
        return
    role = role.strip()
    if role not in {"user", "assistant", "system", "action"}:
        return
    text = str(content or "")
    if not text and role != "action":
        return
    event = {
        "id": uuid4().hex,
        "at": datetime.now().astimezone().isoformat(),
        "role": role,
        "content": text,
        "action": action,
        "ok": ok,
        "command": command,
    }
    with SESSION_LOCK:
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        path = SESSION_DIR / f"{current_session_id()}.jsonl"
        with path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False) + "\n")


def session_user_text(text: str) -> str:
    return MEMORY_TEXT or text


def walnut_cli_command() -> list[str] | None:
    override = os.getenv("WALNUT_CLI", "").strip()
    if override:
        override_path = Path(override).expanduser()
        if override_path.exists():
            if os.access(override_path, os.X_OK):
                return [str(override_path)]
            return [sys.executable, str(override_path)]
        return [override]
    repo_cli = APP_DIR.parent / "walnut-assistant" / "walnut"
    if repo_cli.exists():
        if os.name == "nt":
            return [sys.executable, str(repo_cli)]
        if os.access(repo_cli, os.X_OK):
            return [str(repo_cli)]
        return [sys.executable, str(repo_cli)]
    installed = shutil.which("walnut")
    return [installed] if installed else None


def process_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def walnut_action(action_id: str) -> LocalActionResult:
    title = LOCAL_ACTION_TITLES.get(action_id, action_id)
    command = walnut_cli_command()
    if not command:
        return title, "WalnutPi Local Action 入口不可用：找不到 `walnut` 命令。", False

    try:
        p = subprocess.run(
            [*command, "action", "run", action_id, "--json"],
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=LOCAL_ACTION_TIMEOUTS.get(action_id, 20),
        )
    except subprocess.TimeoutExpired as e:
        output = (process_text(e.stdout) + process_text(e.stderr)).strip()
        return title, (output + "\n[walnut action] timed out").strip(), False
    except Exception as e:
        return title, f"[walnut action] {e}", False

    raw = p.stdout.strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        ok = p.returncode == 0
        return title, raw or f"[walnut action] exit code {p.returncode}", ok

    if isinstance(data, dict):
        title = str(data.get("title") or title)
        output = data.get("output")
        if isinstance(output, str):
            return title, output, data.get("ok") is True
    return title, json.dumps(data, ensure_ascii=False, indent=2), p.returncode == 0


def status() -> str:
    _, output, _ = walnut_action("status")
    return output


def save_note(text: str) -> Path:
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    path = NOTES_DIR / (datetime.now().strftime("%Y-%m-%d") + ".md")
    now = datetime.now().strftime("%H:%M:%S")
    with path.open("a", encoding="utf-8") as file:
        file.write(f"\n## {now}\n\n{text.strip()}\n")
    return path


def today_notes() -> str:
    path = NOTES_DIR / (datetime.now().strftime("%Y-%m-%d") + ".md")
    if not path.exists():
        return "今天还没有 WalnutAI 笔记。"
    return path.read_text(encoding="utf-8").strip() or "今天的笔记文件是空的。"


def call_ai(
    messages: list[dict[str, str]],
    timeout: int | None = None,
    text_format: dict[str, object] | None = None,
) -> str:
    if not API_KEY:
        return "OPENAI_API_KEY 未配置。"
    url = f"{BASE_URL}/responses"
    payload = {
        "model": MODEL,
        "input": messages,
    }
    text_options: dict[str, object] = {}
    if REASONING_EFFORT:
        payload["reasoning"] = {"effort": REASONING_EFFORT}
    if TEXT_VERBOSITY:
        text_options["verbosity"] = TEXT_VERBOSITY
    if text_format:
        text_options["format"] = text_format
    if text_options:
        payload["text"] = text_options
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with API_HTTP_LOCK:
        try:
            if FORCE_IPV4:
                socket.getaddrinfo = getaddrinfo_ipv4
            with urllib.request.urlopen(req, timeout=timeout or API_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            return f"API HTTP {e.code}: {detail[:800]}"
        except Exception as e:
            return f"API 请求失败: {e}"
        finally:
            if FORCE_IPV4:
                socket.getaddrinfo = ORIGINAL_GETADDRINFO

    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()
    chunks: list[str] = []
    for item in data.get("output", []) or []:
        for c in item.get("content", []) or []:
            if c.get("type") in ("output_text", "text") and c.get("text"):
                chunks.append(c["text"])
    return "\n".join(chunks).strip() or json.dumps(data, ensure_ascii=False)[:1200]


def getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    return ORIGINAL_GETADDRINFO(host, port, socket.AF_INET, type, proto, flags)


def parse_json_object(text: str) -> dict[str, object] | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def save_memory_update(update: dict[str, object]) -> bool:
    kind = str(update.get("type", "")).strip()
    field = MEMORY_TYPE_TO_FIELD.get(kind)
    if not field:
        return False
    try:
        confidence = float(update.get("confidence", 0))
    except (TypeError, ValueError):
        return False
    content = str(update.get("content", "")).strip()
    if confidence < 0.8 or not content:
        return False

    with MEMORY_LOCK:
        data = load_memory()
        values = data.setdefault(field, [])
        existing = {value.casefold() for value in values}
        if content.casefold() in existing:
            return False
        values.append(content)
        save_memory(data)
    return True


def extract_memory_updates(user_text: str, assistant_reply: str) -> list[dict[str, object]]:
    if not API_KEY:
        return []
    prompt = "\n".join([
        "已有长期记忆：",
        memory_context(limit_per_field=16),
        "",
        "本轮用户输入：",
        user_text.strip(),
        "",
        "本轮助手回复：",
        assistant_reply.strip()[:3000],
        "",
        "请只输出本轮新增且值得长期保存的 memory_updates。",
    ])
    answer = call_ai(
        [
            {"role": "system", "content": MEMORY_MANAGER_PROMPT},
            {"role": "user", "content": prompt},
        ],
        timeout=20,
        text_format=MEMORY_UPDATE_FORMAT,
    )
    if answer.startswith(("API ", "API 请求失败", "OPENAI_API_KEY")):
        return []
    data = parse_json_object(answer)
    if not data:
        return []
    updates = data.get("memory_updates")
    if not isinstance(updates, list):
        return []
    return [update for update in updates if isinstance(update, dict)]


def update_memory_after_turn(user_text: str, assistant_reply: str) -> None:
    for update in extract_memory_updates(user_text, assistant_reply):
        save_memory_update(update)


def remember_after_turn(user_text: str, assistant_reply: str, wait: bool = False) -> None:
    if DISABLE_MEMORY or not ENABLE_INLINE_MEMORY or not API_KEY:
        return
    if wait:
        update_memory_after_turn(user_text, assistant_reply)
        return
    thread = threading.Thread(
        target=update_memory_after_turn,
        args=(user_text, assistant_reply),
        daemon=True,
    )
    thread.start()


def should_wait_for_memory(text: str) -> bool:
    lowered = text.casefold()
    return any(hint in lowered for hint in ONE_SHOT_MEMORY_HINTS)


def remember_after_one_shot(user_text: str, assistant_reply: str) -> None:
    memory_text = MEMORY_TEXT or user_text
    if should_wait_for_memory(memory_text):
        remember_after_turn(memory_text, assistant_reply, wait=True)


def might_need_local_route(text: str) -> bool:
    lowered = text.casefold()
    return any(hint in lowered for hint in LOCAL_ROUTE_HINTS)


def quick_local_route(text: str) -> dict[str, object] | None:
    lowered = text.casefold()
    if lowered.startswith(("/note", "记一下", "记录一下")):
        note = text
        for prefix in ("/note", "记一下", "记录一下"):
            if note.casefold().startswith(prefix.casefold()):
                note = note[len(prefix):].strip(" ：:")
                break
        return {"action": "note_add", "risk": "write-low", "args": {"text": note}, "reason": "记录本地笔记"}
    if any(hint in lowered for hint in ("今天记了什么", "今天笔记", "notes today", "today notes")):
        return {"action": "notes_today", "risk": "read", "args": {}, "reason": "查询今天笔记"}
    if any(hint in lowered for hint in ("状态", "健康", "内存", "磁盘", "docker", "服务")):
        return {"action": "status", "risk": "read", "args": {}, "reason": "查询设备状态"}
    if any(hint in lowered for hint in ("网络", "联网", "wifi", "wi-fi", "ip地址", "本机ip", "查ip", "路由", "network")):
        return {"action": "network", "risk": "read", "args": {}, "reason": "查询网络状态"}
    if any(hint in lowered for hint in ("天气", "气温", "下雨", "weather")):
        location = text
        location = re.sub(r"(今天天气|天气怎么样|天气|气温|下雨|weather|怎么样|如何|查询|查一下|帮我|请)", " ", location, flags=re.IGNORECASE)
        location = re.sub(r"[？?。,.，!！:：]", " ", location)
        location = " ".join(location.split())
        return {"action": "weather", "risk": "read", "args": {"location": location}, "reason": "查询实时天气"}
    if any(hint in lowered for hint in ("几点", "时间", "日期", "今天几号", "time", "date")):
        return {"action": "time", "risk": "read", "args": {}, "reason": "查询本地时间"}
    if any(hint in lowered for hint in ("gpio", "引脚", "排针", "i2c", "spi", "uart", "pwm", "overlay", "总线")):
        return {"action": "gpio_read", "risk": "read", "args": {}, "reason": "只读检查 GPIO 和总线状态"}
    if any(hint in lowered for hint in ("板子", "型号", "什么设备", "什么系统", "内核", "屏幕", "你是什么")):
        return {"action": "snapshot", "risk": "read", "args": {}, "reason": "查询真实设备快照"}
    if any(hint in lowered for hint in ("音乐库", "有什么歌", "哪些歌", "歌曲", "歌单", "曲库", "music-library")):
        return {"action": "music_library", "risk": "read", "args": {}, "reason": "查询本地音乐库"}
    return None


def classify_intent(text: str) -> dict[str, object] | None:
    if not API_KEY:
        return None
    answer = call_ai([
        {"role": "system", "content": router_prompt(text)},
        {"role": "user", "content": text},
    ])
    if answer.startswith(("API ", "API 请求失败", "OPENAI_API_KEY")):
        return {"action": "router_error", "risk": "none", "args": {"message": answer}, "reason": ""}
    data = parse_json_object(answer)
    if not data:
        return None
    action = str(data.get("action", "")).strip()
    if action not in ROUTER_ACTIONS:
        return None
    args = data.get("args")
    if not isinstance(args, dict):
        args = {}
    risk = str(data.get("risk", "none")).strip() or "none"
    reason = str(data.get("reason", "")).strip()
    return {"action": action, "risk": risk, "args": args, "reason": reason}


def weather_status(location: str) -> str:
    query = location.strip()
    url = "https://wttr.in/"
    if query:
        url += urllib.request.pathname2url(query)
    url += "?format=3"
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            return resp.read().decode("utf-8", errors="replace").strip()
    except Exception as e:
        return f"天气查询失败: {e}"


def local_time_status() -> str:
    now = datetime.now().astimezone()
    return now.strftime("%Y-%m-%d %H:%M:%S %Z%z")


def music_library_status(limit: int = 80) -> str:
    music_dir = next((path for path in MUSIC_DIR_CANDIDATES if path and path.exists()), None)
    if not music_dir:
        searched = "\n".join(f"  - {path}" for path in MUSIC_DIR_CANDIDATES if path)
        return "没找到本地音乐库。查找过：\n" + searched

    tracks = sorted(
        path
        for path in music_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in MUSIC_EXTENSIONS
    )
    if not tracks:
        return f"音乐库目录存在，但没找到音频文件：{music_dir}"

    lines = [f"音乐库: {music_dir}", f"共 {len(tracks)} 首："]
    for path in tracks[:limit]:
        lines.append(f"- {path.relative_to(music_dir)}")
    if len(tracks) > limit:
        lines.append(f"... 还有 {len(tracks) - limit} 首未显示")
    return "\n".join(lines)


def execute_local_action(route: dict[str, object]) -> LocalActionResult | None:
    action = str(route.get("action", "")).strip()
    args = route.get("args")
    if not isinstance(args, dict):
        args = {}
    if action == "weather":
        return "天气查询", weather_status(str(args.get("location", ""))), True
    if action == "time":
        return "时间查询", local_time_status(), True
    if action == "note_add":
        note = str(args.get("text", "")).strip()
        if not note:
            return "记录笔记", "缺少要记录的内容。", False
        path = save_note(note)
        return "记录笔记", f"已保存到 {path}\n\n{note}", True
    if action == "notes_today":
        return "今天笔记", today_notes(), True
    if action == "network":
        return walnut_action("network")
    if action == "gpio_read":
        return walnut_action("gpio")
    if action == "snapshot":
        return walnut_action("snapshot")
    if action == "music_library":
        return "音乐库", music_library_status(), True
    if action == "status":
        return walnut_action("status")
    return None


def summarize_local_result(user_text: str, title: str, output: str, ok: bool = True) -> str:
    if not ok:
        return f"我尝试执行「{title}」，但检查失败了。\n\n{output}"

    if not API_KEY:
        return f"我完成了「{title}」。\n\n{output}"

    prompt = "\n".join([
        "用户请求：",
        user_text,
        "",
        f"WalnutPi 已执行本地动作：{title}",
        f"执行结果：{'成功' if ok else '失败'}",
        "本地输出：",
        output[:6000],
        "",
        "请用中文给普通用户总结结果。只基于本地输出，不要编造未出现的数据。必要时指出下一步建议。",
    ])
    answer = call_ai([
        {"role": "system", "content": system_prompt(query=user_text)},
        {"role": "user", "content": prompt},
    ], timeout=25)
    if answer.startswith(("API ", "API 请求失败", "OPENAI_API_KEY")):
        return output
    return answer


def local_agent_answer(text: str) -> str | None:
    if not might_need_local_route(text):
        return None
    route = quick_local_route(text) or classify_intent(text)
    if not route or route.get("action") == "chat":
        return None
    if route.get("action") == "router_error":
        args = route.get("args")
        message = args.get("message") if isinstance(args, dict) else ""
        return str(message or "意图识别失败。")

    if route.get("action") == "risky" or route.get("risk") == "high":
        reason = str(route.get("reason", "")).strip()
        detail = f"\n模型判断：{reason}" if reason else ""
        return (
            "这个请求可能会改动系统或硬件状态，我不会直接执行。\n"
            "请先说明你要改什么、为什么要改，以及是否已经备份；确认后再由高风险操作流程处理。"
            f"{detail}"
        )

    action = execute_local_action(route)
    if not action:
        return None
    title, output, ok = action
    if route.get("action") in {"weather", "time", "snapshot", "music_library"}:
        if not ok:
            return summarize_local_result(text, title, output, ok)
        return output
    return summarize_local_result(text, title, output, ok)


def help_text() -> str:
    return """直接输入内容即可和 AI 对话。

命令：
  /status              查看核桃派状态
  /memory              查看我记住了什么
  /note 内容           记录想法到 Markdown
  /polish 内容         润色文字
  /translate 内容      翻译文字，中英互译
  /clear               清空当前对话上下文
  /help                显示帮助
  /exit                退出
"""


def main() -> int:
    print(line("="))
    print(f"{APP_NAME}  model={MODEL}  base={BASE_URL}")
    print("输入 /help 查看命令，/exit 退出。")
    print(line("="))

    history: list[dict[str, str]] = [{"role": "system", "content": system_prompt()}]

    while True:
        try:
            user = input("walnut> ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nbye")
            return 0
        if not user:
            continue
        if user in ("/exit", "exit", "quit", "/q"):
            print("bye")
            return 0
        if user == "/help":
            answer = help_text()
            append_session_event("user", user)
            append_session_event("assistant", answer)
            card("Help", answer)
            continue
        if user == "/status":
            answer = status()
            append_session_event("user", user)
            append_session_event("action", answer, action="status", ok=True)
            card("Status", answer)
            continue
        if user == "/memory":
            answer = format_memory_for_display()
            append_session_event("user", user)
            append_session_event("assistant", answer)
            card("记忆", answer)
            continue
        if user == "/clear":
            history = [{"role": "system", "content": system_prompt()}]
            answer = "已清空当前对话上下文。"
            append_session_event("user", user)
            append_session_event("assistant", answer)
            card("Context", answer)
            continue
        if user.startswith("/note"):
            text = user[len("/note"):].strip()
            if not text:
                text = input("note> ").strip()
            if text:
                path = save_note(text)
                append_session_event("user", user)
                append_session_event("action", f"已保存到 {path}\n\n{text}", action="note_add", ok=True)
                card("Note", f"已保存到 {path}\n\n{text}")
            continue
        if user.startswith("/polish"):
            text = user[len("/polish"):].strip() or input("text> ").strip()
            prompt = "请对下面文字做轻度润色，保留原意和说话风格，只输出润色结果：\n" + text
            answer = call_ai([{"role": "system", "content": system_prompt(query=text)}, {"role": "user", "content": prompt}])
            append_session_event("user", user)
            append_session_event("assistant", answer)
            card("AI", answer)
            continue
        if user.startswith("/translate"):
            text = user[len("/translate"):].strip() or input("text> ").strip()
            prompt = "请翻译下面文字。中文翻译成英文，其他语言翻译成中文。只输出译文：\n" + text
            answer = call_ai([{"role": "system", "content": system_prompt(query=text)}, {"role": "user", "content": prompt}])
            append_session_event("user", user)
            append_session_event("assistant", answer)
            card("AI", answer)
            continue

        local_answer = local_agent_answer(user)
        if local_answer is not None:
            append_session_event("user", user)
            append_session_event("action", local_answer, action="local_agent", ok=True)
            remember_after_turn(user, local_answer, wait=should_wait_for_memory(user))
            card("Agent", local_answer)
            continue

        append_session_event("user", user)
        history[0] = {"role": "system", "content": system_prompt(query=user)}
        history.append({"role": "user", "content": user})
        recent = [history[0]] + history[-HISTORY_LIMIT:]
        print("AI thinking...", flush=True)
        answer = call_ai(recent)
        history.append({"role": "assistant", "content": answer})
        append_session_event("assistant", answer)
        remember_after_turn(user, answer, wait=should_wait_for_memory(user))
        card("AI", answer)


def one_shot(text: str) -> int:
    text = text.strip()
    if not text:
        print("Usage: walnut-ai your question")
        return 2

    if text == "/help":
        answer = help_text()
        append_session_event("user", session_user_text(text))
        append_session_event("assistant", answer)
        print(answer)
        return 0
    if text == "/status":
        answer = status()
        append_session_event("user", session_user_text(text))
        append_session_event("action", answer, action="status", ok=True)
        print(answer)
        return 0
    if text == "/memory":
        answer = format_memory_for_display()
        append_session_event("user", session_user_text(text))
        append_session_event("assistant", answer)
        print(answer)
        return 0
    if text.startswith("/note"):
        note = text[len("/note"):].strip()
        if not note:
            print("Usage: walnut-ai /note your text")
            return 2
        path = save_note(note)
        answer = f"已保存到 {path}\n\n{note}"
        append_session_event("user", session_user_text(text))
        append_session_event("action", answer, action="note_add", ok=True)
        print(answer)
        return 0

    local_answer = local_agent_answer(text)

    if local_answer is not None:
        append_session_event("user", session_user_text(text))
        append_session_event("action", local_answer, action="local_agent", ok=True)
        remember_after_one_shot(text, local_answer)
        print(local_answer)
        return 0

    messages = [
        {"role": "system", "content": system_prompt(include_memory=not DISABLE_MEMORY, query=text)},
        {"role": "user", "content": text},
    ]
    answer = call_ai(messages)
    append_session_event("user", session_user_text(text))
    append_session_event("assistant", answer)
    remember_after_one_shot(text, answer)
    print(answer)
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        raise SystemExit(one_shot(" ".join(sys.argv[1:])))
    raise SystemExit(main())

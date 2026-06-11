#!/usr/bin/env python3
"""WalnutAI: a tiny cloud-AI terminal for headless Linux."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import textwrap
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

APP_NAME = "WalnutAI"
MODEL = os.getenv("WALNUT_AI_MODEL", "gpt-5.5")
BASE_URL = os.getenv("WALNUT_AI_BASE_URL", "https://rehdasu.cn/v1").rstrip("/")
API_KEY = os.getenv("OPENAI_API_KEY", "")
APP_DIR = Path(__file__).resolve().parent
CONTEXT_DIR = Path(os.getenv("WALNUT_AI_CONTEXT_DIR") or (APP_DIR / "skills"))
MEMORY_FILE = Path(os.getenv("WALNUT_AI_MEMORY_FILE") or (APP_DIR / "memory" / "default-memory.json"))
NOTES_DIR = Path(
    os.getenv("WALNUT_AI_NOTES_DIR")
    or os.getenv("WALNUT_MEMORY_DIR")
    or (Path.home() / "walnut-memory" / "daily")
)
HISTORY_LIMIT = 12
CONTEXT_FILE_LIMIT = 6000

BASE_SYSTEM_PROMPT = """你是 WalnutAI，一台无桌面 Linux 随身 AI 终端里的云端助手。
你的回答要短、直接、可执行。默认使用中文。
这台设备不是通用桌面电脑，而是云端 AI 的本地交互入口。你可以帮助用户记录想法、整理文本、翻译、检查设备状态、规划命令行工具。
不要假装执行过没有发生的动作；如果本地动作输出已经提供给你，请基于这些真实输出总结。"""


def safe_text_file(path: Path, suffixes: tuple[str, ...]) -> str:
    if not path.is_file() or path.suffix.lower() not in suffixes:
        return ""
    try:
        data = path.read_text(encoding="utf-8", errors="replace").strip()
    except Exception:
        return ""
    return data[:CONTEXT_FILE_LIMIT]


def load_context_bundle() -> str:
    sections: list[str] = []

    if CONTEXT_DIR.is_dir():
        for path in sorted(CONTEXT_DIR.glob("walnutpi-*.md")):
            data = safe_text_file(path, (".md",))
            if data:
                sections.append(f"## {path.name}\n{data}")

    memory_data = safe_text_file(MEMORY_FILE, (".json",))
    if memory_data:
        try:
            parsed = json.loads(memory_data)
            memory_data = json.dumps(parsed, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            memory_data = ""
    if memory_data:
        sections.append(f"## default-memory.json\n{memory_data}")

    if not sections:
        return ""
    return "\n\nWalnutPi 本地上下文（非秘密，仅用于约束回答）：\n" + "\n\n".join(sections)


SYSTEM_PROMPT = BASE_SYSTEM_PROMPT + load_context_bundle()

ROUTER_PROMPT = """你是 WalnutPi 端侧意图路由器。只输出 JSON，不要输出 Markdown。

把用户请求分类到固定 action 之一：
- chat: 普通知识问答、解释概念、写作、规划，不需要本机实时状态。
- status: 查询核桃派状态、健康、内存、磁盘、服务、Docker。
- network: 查询网络、Wi-Fi、IP、路由、联网状态。
- time: 查询当前时间或日期。
- weather: 查询实时天气。args.location 写用户提到的地点；没提到就留空字符串。
- notes_today: 查询今天记了什么、今天笔记。
- note_add: 记录一条笔记。args.text 写要保存的正文，不要包含“记一下”等触发词。
- gpio_read: 只读检查 GPIO、引脚、排针、I2C/SPI/UART/PWM 接线或 overlay 状态。
- snapshot: 查询板子型号、系统、内核、屏幕、boot/config 等设备快照。
- risky: 任何会产生副作用或高风险的请求，包括 GPIO 输出、修改 overlay、安装/卸载包、启停服务、重启、关机、删除、刷写、固件、EMMC。

输出 schema：
{"action":"...","risk":"read|write-low|high|none","args":{},"reason":"一句话说明"}

不要发明 action。不要输出 shell 命令。"""

ROUTER_ACTIONS = {
    "chat",
    "status",
    "network",
    "time",
    "weather",
    "notes_today",
    "note_add",
    "gpio_read",
    "snapshot",
    "risky",
    "router_error",
}


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


def run(cmd: list[str], timeout: int = 5) -> str:
    try:
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
        data = (p.stdout + p.stderr).strip()
        return data or "ok"
    except Exception as e:
        return f"ERR: {e}"


def command_output(label: str, cmd: list[str], timeout: int = 5) -> str:
    if shutil.which(cmd[0]) is None:
        return f"{label}:\n  {cmd[0]} unavailable"
    return f"{label}:\n{textwrap.indent(run(cmd, timeout=timeout), '  ')}"


def file_preview(label: str, path: str, limit: int = 6000) -> str:
    target = Path(path)
    if not target.exists():
        return f"{label}:\n  {path} missing"
    try:
        data = target.read_text(encoding="utf-8", errors="replace").strip()
    except Exception as e:
        return f"{label}:\n  ERR: {e}"
    if len(data) > limit:
        data = data[:limit] + "\n[truncated]"
    return f"{label}:\n{textwrap.indent(data or 'empty', '  ')}"


def service_state(name: str) -> str:
    if shutil.which("systemctl") is None:
        return "unavailable"
    p = subprocess.run(["systemctl", "is-active", name], text=True, capture_output=True)
    return p.stdout.strip() or "unknown"


def status() -> str:
    uptime = run(["uptime", "-p"])
    ip = run(["hostname", "-I"])
    mem = run(["free", "-h"])
    disk = run(["df", "-h", "/"])
    docker = run(["docker", "ps", "--format", "{{.Names}}: {{.Status}}"], timeout=8)
    return "\n".join([
        f"Device: {platform.node()} / {platform.machine()}",
        f"Kernel: {platform.release()}",
        f"Uptime: {uptime}",
        f"IP: {ip}",
        "",
        "Services:",
        f"  docker: {service_state('docker')}",
        f"  frpc: {service_state('frpc')}",
        f"  bluetooth: {service_state('bluetooth')}",
        "",
        "Docker containers:",
        textwrap.indent(docker, "  "),
        "",
        "Memory:",
        textwrap.indent(mem, "  "),
        "",
        "Disk:",
        textwrap.indent(disk, "  "),
    ])


def call_ai(messages: list[dict[str, str]]) -> str:
    if not API_KEY:
        return "OPENAI_API_KEY 未配置。"
    url = f"{BASE_URL}/responses"
    payload = {
        "model": MODEL,
        "input": messages,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        return f"API HTTP {e.code}: {detail[:800]}"
    except Exception as e:
        return f"API 请求失败: {e}"

    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()
    chunks: list[str] = []
    for item in data.get("output", []) or []:
        for c in item.get("content", []) or []:
            if c.get("type") in ("output_text", "text") and c.get("text"):
                chunks.append(c["text"])
    return "\n".join(chunks).strip() or json.dumps(data, ensure_ascii=False)[:1200]


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


def classify_intent(text: str) -> dict[str, object] | None:
    if not API_KEY:
        return None
    answer = call_ai([
        {"role": "system", "content": ROUTER_PROMPT},
        {"role": "user", "content": text},
    ])
    if answer.startswith(("API ", "API 请求失败", "OPENAI_API_KEY")):
        return None
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


def save_note(text: str) -> Path:
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    path = NOTES_DIR / (datetime.now().strftime("%Y-%m-%d") + ".md")
    now = datetime.now().strftime("%H:%M:%S")
    with path.open("a", encoding="utf-8") as f:
        f.write(f"\n## {now}\n\n{text.strip()}\n")
    return path


def today_notes() -> str:
    path = NOTES_DIR / (datetime.now().strftime("%Y-%m-%d") + ".md")
    if not path.exists():
        return "今天还没有 WalnutAI 笔记。"
    return path.read_text(encoding="utf-8").strip() or "今天的笔记文件是空的。"


def network_status() -> str:
    return "\n".join([
        command_output("IP", ["hostname", "-I"]),
        "",
        command_output("Interfaces", ["ip", "-br", "addr"]),
        "",
        command_output("Default route", ["ip", "route", "show", "default"]),
        "",
        command_output("Wi-Fi", ["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"], timeout=8),
    ])


def gpio_status() -> str:
    parts: list[str] = []
    if shutil.which("gpio") is None:
        parts.append("gpio:\n  gpio unavailable")
    else:
        parts.extend([
            command_output("gpio pins", ["gpio", "pins"], timeout=10),
            command_output("gpio i2c", ["gpio", "pin", "i2c"], timeout=10),
            command_output("gpio spi", ["gpio", "pin", "spi"], timeout=10),
            command_output("gpio uart", ["gpio", "pin", "uart"], timeout=10),
            command_output("gpio pwm", ["gpio", "pin", "pwm"], timeout=10),
        ])
    parts.append(command_output("set-device", ["set-device", "status"], timeout=10))
    parts.append(file_preview("/boot/config.txt", "/boot/config.txt"))
    return "\n\n".join(parts)


def snapshot_status() -> str:
    return "\n\n".join([
        command_output("hostname", ["hostname"]),
        command_output("kernel", ["uname", "-a"]),
        file_preview("/etc/WalnutPi-release", "/etc/WalnutPi-release"),
        file_preview("/etc/os-release", "/etc/os-release"),
        file_preview("framebuffer size", "/sys/class/graphics/fb0/virtual_size"),
        file_preview("framebuffer name", "/sys/class/graphics/fb0/name"),
        file_preview("/boot/config.txt", "/boot/config.txt"),
    ])


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


def execute_local_action(route: dict[str, object]) -> tuple[str, str] | None:
    action = str(route.get("action", "")).strip()
    args = route.get("args")
    if not isinstance(args, dict):
        args = {}
    if action == "note_add":
        note = str(args.get("text", "")).strip()
        if not note:
            return "记录笔记", "缺少要记录的内容。"
        path = save_note(note)
        return "记录笔记", f"已保存到 {path}\n\n{note}"
    if action == "weather":
        return "天气查询", weather_status(str(args.get("location", "")))
    if action == "time":
        return "时间查询", local_time_status()
    if action == "network":
        return "网络检查", network_status()
    if action == "gpio_read":
        return "GPIO 只读检查", gpio_status()
    if action == "snapshot":
        return "设备快照", snapshot_status()
    if action == "notes_today":
        return "今天笔记", today_notes()
    if action == "status":
        return "设备状态", status()
    return None


def summarize_local_result(user_text: str, title: str, output: str) -> str:
    if not API_KEY:
        return f"我完成了「{title}」。\n\n{output}"

    prompt = "\n".join([
        "用户请求：",
        user_text,
        "",
        f"WalnutPi 已执行本地动作：{title}",
        "本地输出：",
        output[:6000],
        "",
        "请用中文给普通用户总结结果。只基于本地输出，不要编造未出现的数据。必要时指出下一步建议。",
    ])
    answer = call_ai([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])
    if answer.startswith(("API ", "API 请求失败", "OPENAI_API_KEY")):
        return f"{answer}\n\n本地输出：\n{output}"
    return answer


def local_agent_answer(text: str) -> str | None:
    route = classify_intent(text)
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
    title, output = action
    return summarize_local_result(text, title, output)


def help_text() -> str:
    return """直接输入内容即可和 AI 对话。

命令：
  /status              查看核桃派状态
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

    history: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]

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
            card("Help", help_text())
            continue
        if user == "/status":
            card("Status", status())
            continue
        if user == "/clear":
            history = [{"role": "system", "content": SYSTEM_PROMPT}]
            card("Context", "已清空当前对话上下文。")
            continue
        if user.startswith("/note"):
            text = user[len("/note"):].strip()
            if not text:
                text = input("note> ").strip()
            if text:
                path = save_note(text)
                card("Note", f"已保存到 {path}\n\n{text}")
            continue
        if user.startswith("/polish"):
            text = user[len("/polish"):].strip() or input("text> ").strip()
            prompt = "请对下面文字做轻度润色，保留原意和说话风格，只输出润色结果：\n" + text
            card("AI", call_ai([{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}]))
            continue
        if user.startswith("/translate"):
            text = user[len("/translate"):].strip() or input("text> ").strip()
            prompt = "请翻译下面文字。中文翻译成英文，其他语言翻译成中文。只输出译文：\n" + text
            card("AI", call_ai([{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}]))
            continue

        local_answer = local_agent_answer(user)
        if local_answer is not None:
            card("Agent", local_answer)
            continue

        history.append({"role": "user", "content": user})
        recent = [history[0]] + history[-HISTORY_LIMIT:]
        print("AI thinking...", flush=True)
        answer = call_ai(recent)
        history.append({"role": "assistant", "content": answer})
        card("AI", answer)


def one_shot(text: str) -> int:
    text = text.strip()
    if not text:
        print("Usage: walnut-ai your question")
        return 2

    if text == "/status":
        print(status())
        return 0

    local_answer = local_agent_answer(text)
    if local_answer is not None:
        print(local_answer)
        return 0

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": text},
    ]
    print(call_ai(messages))
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        raise SystemExit(one_shot(" ".join(sys.argv[1:])))
    raise SystemExit(main())

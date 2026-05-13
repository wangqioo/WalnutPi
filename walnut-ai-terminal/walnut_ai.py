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
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

APP_NAME = "WalnutAI"
MODEL = os.getenv("WALNUT_AI_MODEL", "gpt-5.5")
BASE_URL = os.getenv("WALNUT_AI_BASE_URL", "https://rehdasu.cn/v1").rstrip("/")
API_KEY = os.getenv("OPENAI_API_KEY", "")
NOTES_DIR = Path(os.getenv("WALNUT_AI_NOTES_DIR", "/root/walnut-ai-notes"))
HISTORY_LIMIT = 12

SYSTEM_PROMPT = """你是 WalnutAI，一台无桌面 Linux 随身 AI 终端里的云端助手。
你的回答要短、直接、可执行。默认使用中文。
这台设备不是通用桌面电脑，而是云端 AI 的本地交互入口。你可以帮助用户记录想法、整理文本、翻译、检查设备状态、规划命令行工具。
不要假装已经执行本地命令；只有 /status 等本地命令能读取系统状态。"""


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


def service_state(name: str) -> str:
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


def save_note(text: str) -> Path:
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    path = NOTES_DIR / (datetime.now().strftime("%Y-%m-%d") + ".md")
    now = datetime.now().strftime("%H:%M:%S")
    with path.open("a", encoding="utf-8") as f:
        f.write(f"\n## {now}\n\n{text.strip()}\n")
    return path


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

        history.append({"role": "user", "content": user})
        recent = [history[0]] + history[-HISTORY_LIMIT:]
        print("AI thinking...", flush=True)
        answer = call_ai(recent)
        history.append({"role": "assistant", "content": answer})
        card("AI", answer)


if __name__ == "__main__":
    raise SystemExit(main())

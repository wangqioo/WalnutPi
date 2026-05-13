"""
Claude Code 会话管理模块。

启用后，语音识别结果会直接作为 prompt 发送给本机已安装的 Claude Code CLI，
而不是注入到当前输入框。支持多轮对话（通过 session_id 续接）。

前提条件：
  - 已安装 Claude Code CLI：npm install -g @anthropic-ai/claude-code
  - 已完成 claude 登录或设置 ANTHROPIC_API_KEY 环境变量

配置示例（config.yaml）：
  claude_session:
    enabled: true
    working_dir: "/path/to/your/project"
    ai_key: right_shift
    allowed_tools: "Read,Edit,Write,Bash,Glob,Grep"
    max_turns: 10
"""

import json
import shutil
import subprocess
import threading
from typing import Optional


class ClaudeSession:
    def __init__(self, cfg: dict):
        self._working_dir    = cfg.get("working_dir", ".")
        self._allowed_tools  = cfg.get("allowed_tools", "Read,Edit,Write,Bash,Glob,Grep")
        self._max_turns      = int(cfg.get("max_turns", 10))
        self._session_id: Optional[str] = None
        self._lock           = threading.Lock()
        self._busy           = False

    @staticmethod
    def available() -> bool:
        """检查 claude CLI 是否已安装。"""
        return shutil.which("claude") is not None

    def send(self, prompt: str) -> None:
        """非阻塞地发送一条 prompt，在后台线程执行。"""
        with self._lock:
            if self._busy:
                print("[claude] 上一条指令仍在执行，请稍后再试")
                return
            self._busy = True
        threading.Thread(
            target=self._run,
            args=(prompt,),
            daemon=True,
            name="ClaudeSession",
        ).start()

    def reset(self) -> None:
        """清除会话 ID，下一条指令开启新对话。"""
        with self._lock:
            self._session_id = None
        print("[claude] 会话已重置，下一条指令将开启新对话")

    # ── 内部实现 ─────────────────────────────────────────────────────

    def _run(self, prompt: str) -> None:
        try:
            cmd = [
                "claude",
                "--output-format", "stream-json",
                "--allowedTools", self._allowed_tools,
                "--max-turns", str(self._max_turns),
                "-p", prompt,
            ]
            with self._lock:
                sid = self._session_id
            if sid:
                cmd += ["--continue", sid]

            print(f"[claude] >>> {prompt}")
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=self._working_dir,
            )

            for raw in proc.stdout:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    self._handle(json.loads(raw))
                except json.JSONDecodeError:
                    pass

            proc.wait()
            stderr_out = proc.stderr.read().strip()
            if proc.returncode != 0 and stderr_out:
                print(f"[claude] 错误: {stderr_out}")

        except FileNotFoundError:
            print("[claude] 未找到 claude 命令，请先安装：npm install -g @anthropic-ai/claude-code")
        except Exception as e:
            print(f"[claude] 异常: {e}")
        finally:
            with self._lock:
                self._busy = False

    def _handle(self, event: dict) -> None:
        t = event.get("type")

        if t == "assistant":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") == "text":
                    text = block["text"].strip()
                    if text:
                        print(f"[claude] {text}")

        elif t == "result":
            sid = event.get("session_id")
            if sid:
                with self._lock:
                    self._session_id = sid
                print(f"[claude] 会话 {sid[:8]}... 已保存，下次说话将续接对话")

        elif t == "system" and event.get("subtype") == "init":
            tools = event.get("tools", [])
            if tools:
                print(f"[claude] 已启动，可用工具: {', '.join(tools)}")

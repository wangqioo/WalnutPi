"""Server-side voice AI routing for WalnutPi."""

from __future__ import annotations

import json

from agent.memo_store import MemoStore


_CLASSIFY_SYSTEM = """你是 WalnutPi 语音服务的意图分类器。根据用户语音转写内容返回 JSON，不要输出其他内容。

可用能力：
- dictation: 普通语音记录
- memo_save: 保存备忘录，例如“记住我的邮箱是 a@b.com”
- memo_recall: 查询备忘录，例如“我的邮箱是什么”
- memo_delete: 删除备忘录
- memo_list: 列出备忘录
- polish: 润色刚说的话或用户给出的文本
- write: 按要求写一段内容
- chat: 简短问答或闲聊

返回格式：
{"type":"dictation"}
{"type":"memo_save","key":"邮箱","value":"a@b.com"}
{"type":"memo_recall","key":"邮箱"}
{"type":"memo_delete","key":"邮箱"}
{"type":"memo_list"}
{"type":"polish","text":"要润色的文本"}
{"type":"write","prompt":"写作要求"}
{"type":"chat","prompt":"用户问题"}"""

_POLISH_SYSTEM = """你是文字润色助手。保留原意和说话风格，只做轻度整理、错字修正和标点补全。只输出结果。"""

_WRITE_SYSTEM = """你是 WalnutPi 上的简洁写作助手。根据用户要求直接输出内容，不要解释。"""

_CHAT_SYSTEM = """你是 WalnutAI 的语音助手。回答要短、直接、可执行，默认使用中文。"""


class WalnutAIRouter:
    def __init__(self, llm_editor=None, memo_store: MemoStore | None = None):
        self._llm = llm_editor
        self._memos = memo_store or MemoStore()

    def handle_text(self, text: str) -> tuple[str, str]:
        text = text.strip()
        if not text:
            return "empty", ""
        if self._llm is None:
            return "dictation", text

        intent = self._classify(text)
        kind = intent.get("type", "dictation")

        if kind == "memo_save":
            return self._memo_save(intent, text)
        if kind == "memo_recall":
            return self._memo_recall(intent, text)
        if kind == "memo_delete":
            return self._memo_delete(intent)
        if kind == "memo_list":
            return "memo_list", self._memo_list()
        if kind == "polish":
            target = (intent.get("text") or text).strip()
            return "polish", self._llm.chat(_POLISH_SYSTEM, target).strip()
        if kind == "write":
            prompt = (intent.get("prompt") or text).strip()
            return "write", self._llm.chat(_WRITE_SYSTEM, prompt).strip()
        if kind == "chat":
            prompt = (intent.get("prompt") or text).strip()
            return "chat", self._llm.chat(_CHAT_SYSTEM, prompt).strip()

        return "dictation", text

    def _classify(self, text: str) -> dict:
        memo_keys = self._memos.keys()
        user_msg = f"已保存备忘录：{'、'.join(memo_keys) if memo_keys else '无'}\n用户说：{text}"
        try:
            raw = self._llm.chat(_CLASSIFY_SYSTEM, user_msg)
            raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            data = json.loads(raw)
            return data if isinstance(data, dict) else {"type": "dictation"}
        except Exception as e:
            print(f"[walnut-ai] classify failed: {e}")
            return {"type": "dictation"}

    def _memo_save(self, intent: dict, original: str) -> tuple[str, str]:
        key = (intent.get("key") or "").strip()
        value = (intent.get("value") or "").strip()
        if not key:
            return "memo_error", "没有听清要保存的备忘录名称。"
        if not value:
            value = original
        self._memos.save(key, value)
        return "memo_save", f"已记住：{key} = {value}"

    def _memo_recall(self, intent: dict, original: str) -> tuple[str, str]:
        key = (intent.get("key") or "").strip()
        value = self._memos.get(key) if key else None
        if value is None:
            fuzzy = self._fuzzy_match(original)
            if fuzzy:
                key = fuzzy
                value = self._memos.get(fuzzy)
        if value is None:
            return "memo_miss", f"没有找到备忘录：{key or original}"
        return "memo_recall", f"{key}：{value}"

    def _memo_delete(self, intent: dict) -> tuple[str, str]:
        key = (intent.get("key") or "").strip()
        if not key:
            return "memo_error", "没有听清要删除哪条备忘录。"
        if self._memos.delete(key):
            return "memo_delete", f"已删除：{key}"
        return "memo_miss", f"没有找到备忘录：{key}"

    def _memo_list(self) -> str:
        keys = self._memos.keys()
        if not keys:
            return "还没有保存备忘录。"
        lines = []
        for key in keys:
            lines.append(f"- {key}: {self._memos.get(key)}")
        return "\n".join(lines)

    def _fuzzy_match(self, text: str) -> str | None:
        text_chars = set(text)
        best_key = None
        best_score = 0.0
        for key in self._memos.keys():
            key_chars = set(key)
            if len(key_chars) < 2:
                continue
            score = len(key_chars & text_chars) / len(key_chars)
            if score > best_score:
                best_key = key
                best_score = score
        return best_key if best_score >= 0.6 else None

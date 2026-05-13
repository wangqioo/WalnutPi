"""
全局鼠标监听，检测用户点击，标记 TextBuffer.cursor_uncertain。

当用户点击鼠标时，光标可能已跳到其他位置，此时 buf.last 与输入框实际内容
的对应关系不再可靠。打上 cursor_uncertain 标记后，语音编辑会切换到
「行选择剪贴板模式」，通过 Home → Shift+End → 复制 读取真实当前行内容，
而不是依赖自记账的 buf.last。

用途：触发后只需标记，不需要立刻做任何 IO。
"""

from pynput import mouse

from agent.text_buffer import TextBuffer


class MouseMonitor:
    """监听鼠标点击，标记 buf.cursor_uncertain = True。"""

    def __init__(self, buf: TextBuffer):
        self._buf      = buf
        self._listener = None

    def start(self):
        self._listener = mouse.Listener(
            on_click=self._on_click,
            daemon=True,
        )
        self._listener.start()
        print("[mouse] 鼠标点击监听已启动（光标位移检测）")

    def stop(self):
        if self._listener:
            self._listener.stop()
            self._listener = None

    def _on_click(self, x, y, button, pressed):
        if pressed:
            # 任意鼠标按键按下时，认为光标位置已改变，同时标记新段落
            self._buf.cursor_uncertain = True
            self._buf.new_segment()

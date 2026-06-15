"""
UI 编排器：菜单栏 + 主窗口 + 后端句柄。
后端线程通过 set_status() / 历史 listener 推送状态，UI 通过 reload() 重启后端。
"""

import threading
from typing import Callable, Optional

from PyObjCTools import AppHelper

from agent.history import History
from agent.memo_store import MemoStore


class UIApp:
    """生命周期组合：history / memos / 后端 reload 回调 / 菜单栏 / 主窗口。"""

    def __init__(
        self,
        history: History,
        memos: MemoStore,
        reload_backend: Callable[[], None],
        retype_callback: Callable[[str], None],
    ):
        self.history = history
        self.memos = memos
        self._reload_backend = reload_backend
        self._retype_callback = retype_callback
        self.menubar = None
        self.main_window = None

    def build(self):
        """必须在 NSApp 主线程已初始化后调用。"""
        from agent.ui.menubar import MenuBar
        from agent.ui.main_window import MainWindow
        try:
            self.menubar = MenuBar.alloc().initWithApp_(self)
            self.main_window = MainWindow.alloc().initWithApp_(self)
            print("[ui] 菜单栏 + 主窗口已就绪（点击右上角 VK 麦克风图标）")
        except Exception as e:
            import traceback
            print(f"[ui] 构建失败: {e}")
            traceback.print_exc()

    def reload(self):
        """供菜单栏「热重载」、设置 tab「保存」调用。"""
        self._reload_backend()

    def retype_after_delay(self, text: str):
        """历史 tab「再次打字」：5s 倒计时后把 text 打到当前焦点输入框。"""
        if not text:
            return
        # 隐藏窗口让焦点回到上一个 app
        if self.main_window and self.main_window._win is not None:
            self.main_window._win.orderOut_(None)

        def run():
            import time
            time.sleep(0.4)
            try:
                self._retype_callback(text)
            except Exception as e:
                print(f"[ui] 再次打字失败: {e}")

        threading.Thread(target=run, daemon=True, name="UI-retype").start()

    def push_status(self, label: str):
        """后端通过这个推送 menubar 文字。线程安全。"""
        if self.menubar is None:
            return
        AppHelper.callAfter(self.menubar.set_status, label)

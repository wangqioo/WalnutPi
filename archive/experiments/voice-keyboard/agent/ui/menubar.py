"""
顶部菜单栏 NSStatusItem。点击展开菜单：状态 / 打开设置 / 历史 / 备忘录 / 权限 / 重启 / 退出。
LSUIElement=true 的应用没有 dock 图标，菜单栏图标是用户唯一可见的入口。
"""

import objc
from AppKit import (
    NSApplication, NSImage, NSMenu, NSMenuItem,
    NSStatusBar, NSVariableStatusItemLength,
)
from Foundation import NSObject


class MenuBar(NSObject):
    def initWithApp_(self, app):
        self = objc.super(MenuBar, self).init()
        if self is None:
            return None
        self._app = app
        # 确保是 accessory 应用（无 dock 图标，但保留菜单栏）
        try:
            from AppKit import NSApplicationActivationPolicyAccessory
            NSApplication.sharedApplication().setActivationPolicy_(NSApplicationActivationPolicyAccessory)
        except Exception:
            pass

        bar = NSStatusBar.systemStatusBar()
        item = bar.statusItemWithLength_(28.0)  # 固定 28px，避免被压缩到看不见
        button = item.button()
        button.setTitle_("VK")  # fallback，确保任何情况下都不会"完全空白"
        try:
            img = NSImage.imageWithSystemSymbolName_accessibilityDescription_(
                "mic.fill", "Voice Keyboard",
            )
            if img is not None:
                button.setImage_(img)
        except Exception:
            pass
        try:
            button.setToolTip_("Voice Keyboard · 点击打开菜单")
        except Exception:
            pass
        try:
            item.setVisible_(True)
        except Exception:
            pass

        menu = NSMenu.alloc().init()
        self._status_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "● 待命", b"", "",
        )
        self._status_item.setEnabled_(False)
        menu.addItem_(self._status_item)
        menu.addItem_(NSMenuItem.separatorItem())

        for title, sel in (
            ("打开设置…", b"openSettings:"),
            ("转写历史…", b"openHistory:"),
            ("备忘录管理…", b"openMemos:"),
            ("权限自检…", b"openPerms:"),
        ):
            mi = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, sel, "")
            mi.setTarget_(self)
            menu.addItem_(mi)

        menu.addItem_(NSMenuItem.separatorItem())

        for title, sel in (
            ("热重载配置", b"reload:"),
            ("退出 Voice Keyboard", b"quit:"),
        ):
            mi = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, sel, "")
            mi.setTarget_(self)
            menu.addItem_(mi)

        item.setMenu_(menu)
        self._item = item
        return self

    @objc.python_method
    def set_status(self, label: str) -> None:
        if self._status_item is not None:
            self._status_item.setTitle_(label)

    # 菜单项动作
    def openSettings_(self, sender):
        self._app.main_window.show_tab("settings")

    def openHistory_(self, sender):
        self._app.main_window.show_tab("history")

    def openMemos_(self, sender):
        self._app.main_window.show_tab("memos")

    def openPerms_(self, sender):
        self._app.main_window.show_tab("perms")

    def reload_(self, sender):
        try:
            self._app.reload()
        except Exception as e:
            print(f"[menubar] 热重载失败: {e}")

    def quit_(self, sender):
        NSApplication.sharedApplication().terminate_(None)

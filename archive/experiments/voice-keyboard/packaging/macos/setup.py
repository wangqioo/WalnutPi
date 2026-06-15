"""
py2app 打包配置（macOS）。

用法（在仓库根目录执行）：
  pip install py2app
  python packaging/macos/setup.py py2app          # 正常打包
  python packaging/macos/setup.py py2app -A       # alias 模式，源码修改实时生效

打包后产物：<repo>/dist/Voice Keyboard.app
"""

import os
from pathlib import Path

from setuptools import setup

# 不论从哪里调用，统一切到仓库根目录，保持 APP / DATA_FILES / dist 路径稳定
_REPO_ROOT = Path(__file__).resolve().parents[2]
os.chdir(_REPO_ROOT)

APP = ["agent/main.py"]
DATA_FILES = [
    ("", ["config.yaml.example"]),
]

OPTIONS = {
    "argv_emulation": False,
    "iconfile": None,  # 暂无图标，使用默认
    # 通过 includes 显式拉入运行时动态 import 的模块（py2app 静态扫描扫不到的）
    "includes": [
        "PyObjCTools.AppHelper",
        "agent.ui.app",
        "agent.ui.menubar",
        "agent.ui.main_window",
        "agent.history",
        "agent.permissions",
        "agent.log_setup",
    ],
    "plist": {
        "CFBundleName":              "Voice Keyboard",
        "CFBundleDisplayName":       "Voice Keyboard",
        "CFBundleIdentifier":        "com.wangqi.voicekeyboard",
        "CFBundleVersion":           "0.1.0",
        "CFBundleShortVersionString": "0.1.0",
        "LSMinimumSystemVersion":    "11.0",
        # LSUIElement: 后台应用，无 dock 图标，无菜单栏
        "LSUIElement":               True,
        # 权限说明（首次访问相关 API 时弹窗给用户看）
        "NSMicrophoneUsageDescription":    "Voice Keyboard 需要使用麦克风进行语音转文字。",
        "NSAppleEventsUsageDescription":   "Voice Keyboard 需要发送按键事件以实现自动打字。",
        "NSInputMonitoringUsageDescription": "Voice Keyboard 需要监听键盘热键。",
    },
    # 显式打包，避免 py2app 漏掉动态导入的模块
    "packages": [
        "agent",
        "sounddevice",
        "pynput",
        "websocket",
        "yaml",
        "certifi",
        "objc",
        "AppKit",
        "Foundation",
        "Quartz",
        "AVFoundation",
        "ApplicationServices",
        "zhipuai",
        "httpx",
        "httpcore",
        "h11",
        "charset_normalizer",
        "requests",
        "urllib3",
        "pydantic",
        "pydantic_core",
    ],
}

setup(
    app=APP,
    name="Voice Keyboard",
    data_files=DATA_FILES,
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)

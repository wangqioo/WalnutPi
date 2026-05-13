"""
macOS 三大权限自检：辅助功能（Accessibility）/ 输入监听（Input Monitoring）/ 麦克风。
打包成 adhoc 签名的 .app 后每次重新打包代码身份会变，TCC 授权失效，必须能让用户看到。
"""

import sys
from typing import Optional

_DARWIN = sys.platform == "darwin"


# 状态：granted / denied / not_determined / unknown
def accessibility() -> str:
    """辅助功能权限——typer.py 通过 Quartz 发按键需要这个。"""
    if not _DARWIN:
        return "granted"
    try:
        # ApplicationServices.AXIsProcessTrustedWithOptions
        import HIServices  # type: ignore
        # prompt=False，只查询不弹窗
        from Foundation import NSDictionary
        opts = NSDictionary.dictionaryWithObject_forKey_(False, "AXTrustedCheckOptionPrompt")
        return "granted" if HIServices.AXIsProcessTrustedWithOptions(opts) else "denied"
    except Exception:
        try:
            # 退路：ApplicationServices 框架
            import ApplicationServices  # type: ignore
            return "granted" if ApplicationServices.AXIsProcessTrusted() else "denied"
        except Exception:
            return "unknown"


_iokit_check = None


def _load_iokit_check():
    global _iokit_check
    if _iokit_check is not None:
        return _iokit_check
    try:
        import ctypes
        import ctypes.util
        path = ctypes.util.find_library("IOKit")
        if not path:
            return None
        lib = ctypes.CDLL(path)
        fn = lib.IOHIDCheckAccess
        fn.argtypes = [ctypes.c_uint]
        fn.restype  = ctypes.c_uint
        _iokit_check = fn
        return fn
    except Exception:
        return None


def input_monitoring() -> str:
    """输入监听权限——pynput 全局键盘监听需要这个。"""
    if not _DARWIN:
        return "granted"
    fn = _load_iokit_check()
    if fn is None:
        return "unknown"
    try:
        # kIOHIDRequestTypeListenEvent = 1
        # kIOHIDAccessTypeGranted=0, Denied=1, Unknown=2
        access = fn(1)
        return {0: "granted", 1: "denied", 2: "not_determined"}.get(access, "unknown")
    except Exception:
        return "unknown"


def microphone() -> str:
    """麦克风权限——sounddevice 录音需要这个。"""
    if not _DARWIN:
        return "granted"
    try:
        import AVFoundation  # type: ignore
        # AVAuthorizationStatusForMediaType: AVMediaTypeAudio
        media = AVFoundation.AVMediaTypeAudio
        status = AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_(media)
        # 0 not_determined / 1 restricted / 2 denied / 3 authorized
        return {0: "not_determined", 1: "denied", 2: "denied", 3: "granted"}.get(status, "unknown")
    except Exception:
        return "unknown"


def request_microphone(callback=None):
    """主动请求麦克风权限。系统弹窗在主线程调用最稳。"""
    if not _DARWIN:
        return
    try:
        import AVFoundation  # type: ignore
        media = AVFoundation.AVMediaTypeAudio
        AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_(
            media, callback or (lambda granted: None),
        )
    except Exception as e:
        print(f"[perm] 请求麦克风权限失败: {e}")


_SETTINGS_LINKS = {
    "accessibility":    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    "input_monitoring": "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    "microphone":       "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
}


def open_settings(name: str) -> None:
    """name ∈ accessibility / input_monitoring / microphone，深链接到系统设置对应面板。"""
    url = _SETTINGS_LINKS.get(name)
    if url is None or not _DARWIN:
        return
    try:
        from AppKit import NSWorkspace
        from Foundation import NSURL
        NSWorkspace.sharedWorkspace().openURL_(NSURL.URLWithString_(url))
    except Exception as e:
        print(f"[perm] 打开系统设置失败: {e}")


def all_status() -> dict:
    return {
        "accessibility":    accessibility(),
        "input_monitoring": input_monitoring(),
        "microphone":       microphone(),
    }


def summary_log() -> str:
    s = all_status()
    return " | ".join(f"{k}={v}" for k, v in s.items())


def has_blocking_issue() -> Optional[str]:
    """返回首个未授权权限的名字，全部 OK 时返回 None。"""
    s = all_status()
    for k in ("accessibility", "input_monitoring", "microphone"):
        if s[k] not in ("granted", "unknown"):
            return k
    return None

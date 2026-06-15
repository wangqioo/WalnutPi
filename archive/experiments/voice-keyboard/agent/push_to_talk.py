"""
Push-to-Talk 录音模块，支持三个热键：
  ptt_key  — 普通听写（dictation），松开后调 on_utterance
  edit_key — 语音编辑（edit），松开后调 on_edit_utterance
  ai_key   — AI 编程指令（ai），松开后调 on_ai_utterance

三个键互斥：一个按下时另两个无效。

dictation 模式支持实时分句：按住说话过程中，检测到句子间停顿即立刻触发 STT，
无需等到松键，适合连续说多句话的场景。
"""

import threading
import time
from typing import Callable, Optional

import sounddevice as sd
from pynput import keyboard as kb

from agent.audio_monitor import find_device, FRAME_BYTES, SILENCE_FRAMES, MIN_SPEECH_FRAMES
import agent.typer as _typer

SAMPLE_RATE = 16000

try:
    import webrtcvad as _webrtcvad
except ImportError:
    _webrtcvad = None


def _parse_key(key_str: str):
    try:
        return getattr(kb.Key, key_str)
    except AttributeError:
        return kb.KeyCode.from_char(key_str)


def _parse_keys(key_input) -> list:
    """支持单个字符串或字符串列表，统一返回 pynput key 列表。"""
    if isinstance(key_input, list):
        return [_parse_key(k) for k in key_input]
    return [_parse_key(key_input)]


class PushToTalk:
    def __init__(
        self,
        on_utterance:      Callable[[bytes], None],
        on_edit_utterance: Optional[Callable[[bytes], None]] = None,
        on_ai_utterance:   Optional[Callable[[bytes], None]] = None,
        on_ai_key_down:    Optional[Callable[[], None]] = None,
        ptt_key:           str = "right_alt",
        edit_key:          str = "right_ctrl",
        ai_key:            str = "right_shift",
        device:            Optional[str] = "auto",
        status_window=None,
        kbd_monitor=None,
    ):
        self._on_utterance      = on_utterance
        self._on_edit_utterance = on_edit_utterance
        self._on_ai_utterance   = on_ai_utterance
        self._on_ai_key_down    = on_ai_key_down
        self._kbd_monitor       = kbd_monitor
        self._ptt_keys          = _parse_keys(ptt_key)
        self._edit_keys         = _parse_keys(edit_key) if on_edit_utterance else []
        self._ai_keys           = _parse_keys(ai_key)   if on_ai_utterance   else []
        self._device_hint       = device
        self._status            = status_window
        self._device_idx        = None
        self._active_key        = None   # 当前正在录音用哪个键
        self._active_trigger    = None   # 触发本次录音的具体按键，用于 release 配对
        self._buf: list[bytes]  = []
        self._stream: Optional[sd.RawInputStream] = None
        self._listener: Optional[kb.Listener]     = None

        # 双击 PTT 切换微润色模式
        self._polish_mode             = False
        self._last_ptt_press_time     = 0.0
        self._double_tap_window       = 0.4   # 秒

        # 实时分句 VAD 状态（仅 dictate 模式使用）
        self._vad                            = None
        self._vad_raw: bytearray            = bytearray()
        self._vad_speech_frames: list[bytes] = []
        self._vad_in_speech                  = False
        self._vad_silent_count               = 0
        self._vad_sent_count                 = 0  # 本次按键已分句发出的数量

    def start(self):
        self._device_idx = find_device(self._device_hint)
        if self._device_idx is None:
            print("[ptt] 使用系统默认麦克风")
        else:
            info = sd.query_devices(self._device_idx)
            print(f"[ptt] 使用麦克风: {info['name']}")

        if _webrtcvad is not None:
            self._vad = _webrtcvad.Vad(2)
            print("[ptt] 实时分句已启用（说话中停顿可提前输出）")
        else:
            print("[ptt] webrtcvad 未安装，实时分句不可用")

        self._listener = kb.Listener(
            on_press=self._on_press,
            on_release=self._on_release,
        )
        self._listener.start()

        hints = [f"{'/'.join(str(k) for k in self._ptt_keys)} 说话（双击切换微润色）"]
        if self._edit_keys:
            hints.append(f"{'/'.join(str(k) for k in self._edit_keys)} 语音编辑")
        if self._ai_keys:
            hints.append(f"{'/'.join(str(k) for k in self._ai_keys)} AI编程")
        print(f"[ptt] 按住 {' | '.join(hints)}")

    def stop(self):
        if self._listener:
            self._listener.stop()
        self._close_stream()

    def _set_status(self, state: str) -> None:
        if self._status is not None:
            self._status.set_state(state)

    # ── 键盘事件 ─────────────────────────────────────────────────

    def _on_press(self, key):
        if _typer.is_simulating():
            return  # 程序自身发出的按键，忽略
        # 顺手把退格/Delete/Enter 同步给 KeyboardMonitor，避免再开一个 CGEventTap
        if self._kbd_monitor is not None:
            try:
                self._kbd_monitor.process_press(key)
            except Exception:
                pass
        if self._active_key is not None:
            return  # 已有键按下，忽略另一个
        if key in self._ptt_keys:
            now = time.monotonic()
            if (now - self._last_ptt_press_time) < self._double_tap_window:
                # 双击：切换微润色模式，不开新录音
                self._polish_mode = not self._polish_mode
                mode_name = "微润色" if self._polish_mode else "原文"
                print(f"[ptt] 切换为「{mode_name}」模式")
                self._last_ptt_press_time = 0.0
                return
            self._last_ptt_press_time = now
            self._active_key     = "dictate"
            self._active_trigger = key
            self._start_recording()
        elif self._edit_keys and key in self._edit_keys:
            self._active_key     = "edit"
            self._active_trigger = key
            self._start_recording()
        elif self._ai_keys and key in self._ai_keys:
            if self._on_ai_key_down:
                self._on_ai_key_down()
            self._active_key     = "ai"
            self._active_trigger = key
            self._start_recording()

    def _on_release(self, key):
        if _typer.is_simulating():
            return
        if key != self._active_trigger:
            return
        if self._active_key == "dictate":
            self._stop_recording(mode="dictate")
        elif self._active_key == "edit":
            self._stop_recording(mode="edit")
        elif self._active_key == "ai":
            self._stop_recording(mode="ai")
        self._active_trigger = None

    # ── 录音控制 ─────────────────────────────────────────────────

    def _audio_callback(self, indata, frames, time_info, status):
        data = bytes(indata)
        self._buf.append(data)
        if self._active_key == "dictate" and self._vad is not None:
            self._vad_raw.extend(data)
            self._process_vad()

    def _process_vad(self):
        """消费 _vad_raw 中所有完整的 30ms 帧，检测句子边界。"""
        while len(self._vad_raw) >= FRAME_BYTES:
            frame = bytes(self._vad_raw[:FRAME_BYTES])
            del self._vad_raw[:FRAME_BYTES]

            is_speech = self._vad.is_speech(frame, SAMPLE_RATE)

            if is_speech:
                self._vad_in_speech    = True
                self._vad_silent_count = 0
                self._vad_speech_frames.append(frame)
            elif self._vad_in_speech:
                self._vad_speech_frames.append(frame)
                self._vad_silent_count += 1
                if self._vad_silent_count >= SILENCE_FRAMES:
                    self._dispatch_mid_sentence()

    def _dispatch_mid_sentence(self):
        """把当前积累的语音帧作为一句话立刻发出去，重置 VAD 状态。"""
        if len(self._vad_speech_frames) >= MIN_SPEECH_FRAMES:
            pcm = b"".join(self._vad_speech_frames)
            self._vad_sent_count += 1
            n = self._vad_sent_count
            print(f"[ptt] 分句{n} 识别中...    ", end="\r", flush=True)
            threading.Thread(
                target=self._on_utterance,
                args=(pcm, self._polish_mode),
                daemon=True,
                name=f"PTT-mid-{n}",
            ).start()
        self._vad_speech_frames = []
        self._vad_silent_count  = 0
        self._vad_in_speech     = False

    def _start_recording(self):
        self._buf = []
        self._vad_raw           = bytearray()
        self._vad_speech_frames = []
        self._vad_in_speech     = False
        self._vad_silent_count  = 0
        self._vad_sent_count    = 0
        self._stream = sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            device=self._device_idx,
            blocksize=1024,
            callback=self._audio_callback,
        )
        self._stream.start()
        if self._active_key == "dictate":
            if self._polish_mode:
                label = "微润色 录音中"
                self._set_status("polish_recording")
            else:
                label = "录音中"
                self._set_status("recording")
        elif self._active_key == "ai":
            label = "AI 指令录音中"
            self._set_status("ai_recording")
        else:
            label = "编辑指令录音中"
            self._set_status("recording")
        print(f"[ptt] {label}... ", end="\r", flush=True)

    def _stop_recording(self, mode: str):
        self._active_key = None
        self._close_stream()

        if mode == "dictate" and self._vad is not None:
            self._process_vad()  # 处理流关闭前残留的音频字节

            # 松键时若仍在句子中间，把尾巴也发出去
            if self._vad_in_speech and len(self._vad_speech_frames) >= MIN_SPEECH_FRAMES:
                pcm = b"".join(self._vad_speech_frames)
                self._vad_sent_count += 1
                n = self._vad_sent_count
                print(f"[ptt] 分句{n} 识别中...    ", end="\r", flush=True)
                self._set_status("recognizing")
                threading.Thread(
                    target=self._on_utterance,
                    args=(pcm, self._polish_mode),
                    daemon=True,
                    name=f"PTT-mid-{n}",
                ).start()
            elif self._vad_sent_count == 0:
                # 全程未检测到任何句子（录音极短或全静音），回退到原有整段发送逻辑
                pcm = b"".join(self._buf)
                if len(pcm) < SAMPLE_RATE * 2 * 0.3:
                    print("[ptt] 录音太短，跳过    ")
                    self._set_status("idle")
                else:
                    print("[ptt] 识别中...    ", end="\r", flush=True)
                    self._set_status("recognizing")
                    threading.Thread(
                        target=self._on_utterance,
                        args=(pcm, self._polish_mode),
                        daemon=True,
                        name="PTT-dictate",
                    ).start()
            else:
                self._set_status("idle")
            self._buf = []
            return

        # dictate / edit / ai 模式（VAD 不可用时 dictate 也走这里）
        pcm = b"".join(self._buf)
        self._buf = []

        if len(pcm) < SAMPLE_RATE * 2 * 0.3:
            print("[ptt] 录音太短，跳过    ")
            self._set_status("idle")
            return

        if mode == "dictate":
            label    = "识别中"
            callback = self._on_utterance
            args     = (pcm, self._polish_mode)
            self._set_status("recognizing")
        elif mode == "edit":
            label    = "解析编辑指令"
            callback = self._on_edit_utterance
            args     = (pcm,)
            self._set_status("recognizing")
        else:
            label    = "解析AI指令"
            callback = self._on_ai_utterance
            args     = (pcm,)
            self._set_status("ai_processing")
        print(f"[ptt] {label}...    ", end="\r", flush=True)
        threading.Thread(
            target=callback,
            args=args,
            daemon=True,
            name=f"PTT-{mode}",
        ).start()

    def _close_stream(self):
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

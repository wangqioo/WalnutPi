"""
加载配置。优先级（高 → 低）：

  1. 环境变量 / .env 文件
  2. config.yaml 文件
  3. 内置默认值
"""

import os
import pathlib
import shutil
import sys

import yaml

_ROOT = pathlib.Path(__file__).parent.parent
_USER_DIR = pathlib.Path.home() / ".voice-keyboard"
_USER_CONFIG = _USER_DIR / "config.yaml"
_USER_ENV = _USER_DIR / ".env"
_DEV_CONFIG = _ROOT / "config.yaml"
_DEV_ENV = _ROOT / ".env"


def _resolve_config_path() -> pathlib.Path:
    if _USER_CONFIG.exists():
        return _USER_CONFIG
    return _DEV_CONFIG


def _resolve_env_path() -> pathlib.Path:
    if _USER_ENV.exists():
        return _USER_ENV
    return _DEV_ENV


def _bundled_example_path() -> pathlib.Path | None:
    """优先使用 WalnutPi/headless 模板，其次回退到通用示例。"""
    candidates = []
    if getattr(sys, "frozen", False):
        exe_dir = pathlib.Path(sys.executable).resolve().parent
        candidates.append(exe_dir.parent / "Resources" / "config.walnutpi.yaml.example")
        candidates.append(exe_dir.parent / "Resources" / "config.yaml.example")
    candidates.append(_ROOT / "config.walnutpi.yaml.example")
    candidates.append(_ROOT / "config.yaml.example")
    for p in candidates:
        if p.exists():
            return p
    return None


def ensure_user_config() -> None:
    if _USER_CONFIG.exists():
        return
    example = _bundled_example_path()
    if example is None:
        return
    _USER_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(example, _USER_CONFIG)
    print(f"[config] 已创建 {_USER_CONFIG}，请编辑填入 API Key")


def _load_dotenv():
    env_path = _resolve_env_path()
    if not env_path.exists():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path, override=False)
        return
    except ImportError:
        pass
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


def _yaml_config() -> dict:
    cfg_path = _resolve_config_path()
    if not cfg_path.exists():
        return {}
    with open(cfg_path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _env_stt() -> dict | None:
    provider = os.getenv("STT_PROVIDER", "").strip()
    api_key = os.getenv("STT_API_KEY", "").strip()
    glm_key = os.getenv("GLM_API_KEY", "").strip()

    if not provider and glm_key:
        provider = "zhipuai"
    if not api_key and provider == "zhipuai" and glm_key:
        api_key = glm_key

    if not provider and not api_key:
        return None

    cfg: dict = {}
    if provider:
        cfg["provider"] = provider
    if api_key:
        cfg["api_key"] = api_key
    for key, env in [
        ("model", "STT_MODEL"),
        ("language", "STT_LANGUAGE"),
        ("app_key", "STT_APP_KEY"),
        ("access_key_id", "STT_ACCESS_KEY_ID"),
        ("access_key_secret", "STT_ACCESS_KEY_SECRET"),
        ("region", "STT_REGION"),
        ("app_id", "STT_APP_ID"),
        ("token", "STT_TOKEN"),
        ("cluster", "STT_CLUSTER"),
        ("api_secret", "STT_API_SECRET"),
    ]:
        val = os.getenv(env, "").strip()
        if val:
            cfg[key] = val
    return cfg or None


def _env_llm() -> dict | None:
    provider = os.getenv("LLM_PROVIDER", "").strip()
    api_key = os.getenv("LLM_API_KEY", "").strip()
    glm_key = os.getenv("GLM_API_KEY", "").strip()

    if not provider and glm_key:
        provider = "zhipuai"
    if not api_key and provider == "zhipuai" and glm_key:
        api_key = glm_key

    if not provider and not api_key:
        return None

    cfg: dict = {}
    if provider:
        cfg["provider"] = provider
    if api_key:
        cfg["api_key"] = api_key
    for key, env in [
        ("model", "LLM_MODEL"),
        ("model", "GLM_MODEL"),
    ]:
        val = os.getenv(env, "").strip()
        if val:
            cfg[key] = val
            break
    return cfg or None


def _env_audio() -> dict | None:
    fields = {
        "mode": os.getenv("AUDIO_MODE", "").strip(),
        "ptt_key": os.getenv("PTT_KEY", "").strip(),
        "edit_key": os.getenv("EDIT_KEY", "").strip(),
        "device": os.getenv("AUDIO_DEVICE", "").strip(),
        "vad_aggressiveness": os.getenv("VAD_AGGRESSIVENESS", "").strip(),
    }
    cfg = {k: v for k, v in fields.items() if v}
    if cfg.get("vad_aggressiveness"):
        try:
            cfg["vad_aggressiveness"] = int(cfg["vad_aggressiveness"])
        except ValueError:
            del cfg["vad_aggressiveness"]
    return cfg or None


def _env_ai_stt() -> dict | None:
    provider = os.getenv("AI_STT_PROVIDER", "").strip()
    api_key = os.getenv("AI_STT_API_KEY", "").strip()
    glm_key = os.getenv("GLM_API_KEY", "").strip()

    if not provider and api_key:
        provider = "glm_asr_2512"
    if provider in ("glm_asr_2512", "glm-asr-2512") and not api_key and glm_key:
        api_key = glm_key

    if not provider and not api_key:
        return None

    cfg: dict = {}
    if provider:
        cfg["provider"] = provider
    if api_key:
        cfg["api_key"] = api_key
    for key, env in [
        ("model", "AI_STT_MODEL"),
        ("prompt", "AI_STT_PROMPT"),
        ("hotwords", "AI_STT_HOTWORDS"),
    ]:
        val = os.getenv(env, "").strip()
        if val:
            cfg[key] = val
    return cfg or None


def load() -> dict:
    _load_dotenv()
    cfg = _yaml_config()

    env_stt = _env_stt()
    if env_stt:
        cfg["stt"] = {**cfg.get("stt", {}), **env_stt}

    env_llm = _env_llm()
    if env_llm:
        cfg["llm"] = {**cfg.get("llm", {}), **env_llm}

    env_audio = _env_audio()
    if env_audio:
        cfg["audio"] = {**cfg.get("audio", {}), **env_audio}

    env_ai_stt = _env_ai_stt()
    if env_ai_stt:
        cfg["ai_stt"] = {**cfg.get("ai_stt", {}), **env_ai_stt}

    return cfg
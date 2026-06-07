import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load_walnut_ai():
    path = ROOT / "walnut-ai-terminal" / "walnut_ai.py"
    spec = importlib.util.spec_from_file_location("walnut_ai_module", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class WalnutAiTest(unittest.TestCase):
    def test_one_shot_runs_local_action_before_cloud_chat(self):
        walnut_ai = load_walnut_ai()

        with mock.patch.object(walnut_ai, "local_agent_answer", return_value="local result"), mock.patch.object(walnut_ai, "call_ai") as call_ai_mock, mock.patch("builtins.print") as print_mock:
            self.assertEqual(walnut_ai.one_shot("核桃派现在还好吗"), 0)

        call_ai_mock.assert_not_called()
        print_mock.assert_called_once_with("local result")

    def test_no_api_key_falls_back_to_cloud_chat_path(self):
        walnut_ai = load_walnut_ai()

        with mock.patch.object(walnut_ai, "API_KEY", ""), mock.patch.object(walnut_ai, "call_ai", return_value="cloud answer") as call_ai_mock, mock.patch("builtins.print") as print_mock:
            self.assertEqual(walnut_ai.one_shot("解释一下 I2C"), 0)

        call_ai_mock.assert_called_once()
        print_mock.assert_called_once_with("cloud answer")

    def test_note_actions_use_configured_memory_directory(self):
        walnut_ai = load_walnut_ai()

        with tempfile.TemporaryDirectory() as tmp:
            notes_dir = Path(tmp)
            route = {"action": "note_add", "args": {"text": "今天调好了 Wi-Fi"}}
            with mock.patch.object(walnut_ai, "NOTES_DIR", notes_dir):
                title, output = walnut_ai.execute_local_action(route)

            self.assertEqual(title, "记录笔记")
            self.assertIn("今天调好了 Wi-Fi", output)
            files = list(notes_dir.glob("*.md"))
            self.assertEqual(len(files), 1)
            self.assertIn("今天调好了 Wi-Fi", files[0].read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

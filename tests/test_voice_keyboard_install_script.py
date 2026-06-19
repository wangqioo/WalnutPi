import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class VoiceKeyboardInstallScriptTests(unittest.TestCase):
    def test_install_script_fails_fast_when_runtime_source_is_missing(self):
        with tempfile.TemporaryDirectory() as td:
            missing_source = Path(td) / "missing-runtime"
            result = subprocess.run(
                [
                    "sh",
                    str(ROOT / "scripts" / "install-voice-keyboard-walnutpi.sh"),
                ],
                env={
                    "PATH": "/usr/bin:/bin",
                    "VK_SOURCE_DIR": str(missing_source),
                    "VK_APP_DIR": str(Path(td) / "app"),
                },
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(result.returncode, 2)
            self.assertIn("Voice Keyboard WalnutPi runtime source is missing", result.stderr)
            self.assertIn("VK_SOURCE_DIR", result.stderr)


if __name__ == "__main__":
    unittest.main()

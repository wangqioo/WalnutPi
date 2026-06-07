import importlib.machinery
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_walnut():
    path = ROOT / "walnut-assistant" / "walnut"
    loader = importlib.machinery.SourceFileLoader("walnut_module", str(path))
    spec = importlib.util.spec_from_loader("walnut_module", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class WalnutScreenTest(unittest.TestCase):
    def test_parser_accepts_screen_subcommands(self):
        walnut = load_walnut()
        parser = walnut.build_parser()

        self.assertEqual(parser.parse_args(["screen", "status"]).screen_cmd, "status")
        self.assertEqual(parser.parse_args(["screen", "test"]).screen_cmd, "test")
        self.assertEqual(parser.parse_args(["screen", "restore"]).screen_cmd, "restore")
        self.assertEqual(parser.parse_args(["screen", "demo"]).screen_cmd, "demo")
        self.assertEqual(parser.parse_args(["screen", "off"]).screen_cmd, "off")
        self.assertEqual(parser.parse_args(["screen", "app"]).screen_cmd, "app")
        self.assertEqual(parser.parse_args(["screen", "lvgl"]).screen_cmd, "lvgl")
        self.assertEqual(parser.parse_args(["screen", "lvgl-demo"]).screen_cmd, "lvgl-demo")
        self.assertEqual(parser.parse_args(["screen", "start"]).screen_cmd, "start")
        self.assertEqual(parser.parse_args(["screen", "stop"]).screen_cmd, "stop")
        self.assertEqual(parser.parse_args(["screen", "toggle"]).screen_cmd, "toggle")
        self.assertEqual(parser.parse_args(["screen", "state"]).screen_cmd, "state")
        image_args = parser.parse_args(["screen", "image", "/tmp/demo.jpg"])
        self.assertEqual(image_args.screen_cmd, "image")
        self.assertEqual(image_args.path, "/tmp/demo.jpg")
        ai_args = parser.parse_args(["screen", "ai", "WalnutPi", "OK"])
        self.assertEqual(ai_args.screen_cmd, "ai")
        self.assertEqual(ai_args.text, ["WalnutPi", "OK"])

    def test_screen_status_starts_service(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "status"])

        with mock.patch.object(walnut, "require_root", return_value=True), mock.patch.object(walnut, "subprocess") as subprocess_mock:
            subprocess_mock.call.return_value = 0
            self.assertEqual(walnut.screen(args), 0)

        subprocess_mock.call.assert_called_once_with(
            walnut.root_cmd(["systemctl", "start", "walnut-framebuffer-status.service"])
        )

    def test_screen_test_stops_status_service_before_drawing(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "test"])

        with mock.patch.object(walnut, "project_root", return_value=ROOT), mock.patch.object(walnut, "subprocess") as subprocess_mock:
            subprocess_mock.call.return_value = 0
            self.assertEqual(walnut.screen(args), 0)

        first_call = subprocess_mock.call.call_args_list[0]
        self.assertEqual(first_call.args[0], walnut.root_cmd(["systemctl", "stop", "walnut-framebuffer-status.service"]))

    def test_project_root_candidates_include_pi_checkout_for_root_commands(self):
        walnut = load_walnut()

        self.assertIn(Path("/home/pi/projects/WalnutPi"), walnut.PROJECT_ROOT_CANDIDATES)

    def test_screen_lvgl_stops_status_service_and_launches_binary(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "lvgl"])
        with tempfile.TemporaryDirectory() as tmp:
            fake_root = Path(tmp)
            binary = fake_root / "build" / "lvgl_app" / "walnut-lvgl-screen"
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.touch()

            with mock.patch.object(walnut, "project_root", return_value=fake_root), mock.patch.object(walnut, "subprocess") as subprocess_mock:
                subprocess_mock.call.return_value = 0
                self.assertEqual(walnut.screen(args), 0)

        self.assertEqual(
            subprocess_mock.call.call_args_list[0].args[0],
            walnut.root_cmd(["systemctl", "stop", "walnut-framebuffer-status.service"]),
        )
        self.assertEqual(
            subprocess_mock.call.call_args_list[-1].args[0],
            [str(binary), "/dev/fb0"],
        )

    def test_screen_lvgl_demo_starts_walnut_screen_service(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "lvgl-demo"])

        with mock.patch.object(walnut, "require_root", return_value=True), mock.patch.object(walnut, "subprocess") as subprocess_mock:
            subprocess_mock.call.return_value = 0
            self.assertEqual(walnut.screen(args), 0)

        self.assertEqual(
            subprocess_mock.call.call_args_list[-1].args[0],
            walnut.root_cmd(["systemctl", "start", "walnut-screen.service"]),
        )

    def test_screen_start_starts_walnut_screen_service(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "start"])

        with mock.patch.object(walnut, "require_root", return_value=True), mock.patch.object(walnut, "subprocess") as subprocess_mock:
            subprocess_mock.call.return_value = 0
            self.assertEqual(walnut.screen(args), 0)

        self.assertEqual(
            subprocess_mock.call.call_args_list[-1].args[0],
            walnut.root_cmd(["systemctl", "start", "walnut-screen.service"]),
        )

    def test_screen_stop_restores_local_login(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "stop"])

        with mock.patch.object(walnut, "require_root", return_value=True), mock.patch.object(walnut, "subprocess") as subprocess_mock:
            subprocess_mock.call.return_value = 0
            self.assertEqual(walnut.screen(args), 0)

        commands = [call.args[0] for call in subprocess_mock.call.call_args_list]
        self.assertIn(walnut.root_cmd(["systemctl", "stop", "walnut-screen.service"]), commands)
        self.assertIn(walnut.root_cmd(["systemctl", "start", "getty@tty1.service"]), commands)

    def test_screen_toggle_stops_when_lvgl_is_active(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "toggle"])

        with mock.patch.object(walnut, "require_root", return_value=True), mock.patch.object(walnut, "run") as run_mock, mock.patch.object(walnut, "subprocess") as subprocess_mock:
            run_mock.return_value.stdout = "active\n"
            subprocess_mock.call.return_value = 0
            self.assertEqual(walnut.screen(args), 0)

        commands = [call.args[0] for call in subprocess_mock.call.call_args_list]
        self.assertIn(walnut.root_cmd(["systemctl", "stop", "walnut-screen.service"]), commands)
        self.assertIn(walnut.root_cmd(["systemctl", "start", "getty@tty1.service"]), commands)

    def test_screen_toggle_starts_when_lvgl_is_inactive(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "toggle"])

        with mock.patch.object(walnut, "require_root", return_value=True), mock.patch.object(walnut, "run") as run_mock, mock.patch.object(walnut, "subprocess") as subprocess_mock:
            run_mock.return_value.stdout = "inactive\n"
            subprocess_mock.call.return_value = 0
            self.assertEqual(walnut.screen(args), 0)

        self.assertEqual(
            subprocess_mock.call.call_args_list[-1].args[0],
            walnut.root_cmd(["systemctl", "start", "walnut-screen.service"]),
        )

    def test_screen_ai_updates_lvgl_ai_page_when_service_is_running(self):
        walnut = load_walnut()
        args = walnut.build_parser().parse_args(["screen", "ai", "hello", "screen"])

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(walnut, "run") as run_mock, mock.patch.object(walnut, "Path") as path_mock:
            run_mock.return_value.stdout = "active\n"
            ai_file = Path(tmp) / "walnut-screen-ai.txt"
            path_mock.side_effect = lambda value: ai_file if value == "/run/walnut-screen-ai.txt" else Path(value)

            self.assertEqual(walnut.screen(args), 0)
            self.assertEqual(ai_file.read_text(encoding="utf-8"), "hello screen\n")


if __name__ == "__main__":
    unittest.main()

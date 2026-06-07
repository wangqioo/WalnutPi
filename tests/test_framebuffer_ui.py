import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from framebuffer_ui import fb
from framebuffer_ui import components
from framebuffer_ui import image
from framebuffer_ui import render
from framebuffer_ui import status


class FramebufferUiTest(unittest.TestCase):
    def test_rgb565_uses_little_endian_bytes(self):
        self.assertEqual(fb.rgb565(255, 0, 0), 0xF800)
        self.assertEqual(fb.rgb565(0, 255, 0), 0x07E0)
        self.assertEqual(fb.rgb565(0, 0, 255), 0x001F)
        self.assertEqual(fb.pack_rgb565(fb.rgb565(255, 0, 0)), b"\x00\xf8")

    def test_test_pattern_matches_screen_byte_size_and_color_bands(self):
        image = render.test_pattern(width=480, height=320)

        self.assertEqual(len(image), 480 * 320 * 2)
        self.assertEqual(image[0:2], fb.pack_rgb565(fb.rgb565(255, 0, 0)))

        green_offset = (60 * 480) * 2
        self.assertEqual(
            image[green_offset : green_offset + 2],
            fb.pack_rgb565(fb.rgb565(0, 255, 0)),
        )

    def test_status_card_produces_full_rgb565_frame(self):
        image = render.status_card(width=480, height=320)

        self.assertEqual(len(image), 480 * 320 * 2)
        self.assertGreater(len(set(image)), 16)

    def test_status_card_accepts_real_status_data(self):
        data = status.SystemStatus(
            hostname="WalnutPi",
            time_text="17:25",
            load_1m=0.31,
            mem_percent=41,
            disk_percent=37,
            ip_address="192.168.1.30",
            frp_active=True,
            docker_active=True,
        )

        image = render.status_card(width=480, height=320, data=data)

        self.assertEqual(len(image), 480 * 320 * 2)

    def test_parse_fb_info_from_sysfs_values(self):
        info = fb.FramebufferInfo.from_values(
            name="wpi_fb_st7796\n",
            virtual_size="480,320\n",
            bits_per_pixel="16\n",
            stride="960\n",
            modes="U:480x320p-0\n",
        )

        self.assertEqual(info.name, "wpi_fb_st7796")
        self.assertEqual(info.width, 480)
        self.assertEqual(info.height, 320)
        self.assertEqual(info.bits_per_pixel, 16)
        self.assertEqual(info.stride, 960)
        self.assertEqual(info.mode, "U:480x320p-0")

    def test_status_parsers_extract_memory_disk_ip_and_services(self):
        mem_percent = status.parse_mem_percent(
            """
MemTotal:        1000 kB
MemAvailable:     250 kB
"""
        )
        disk_percent = status.parse_disk_percent(
            """
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        15G  5.6G  8.8G  39% /
"""
        )
        ip_address = status.parse_ip_address(
            """
lo               UNKNOWN        127.0.0.1/8 ::1/128
wlan0            UP             192.168.1.30/24 fe80::1/64
"""
        )

        self.assertEqual(mem_percent, 75)
        self.assertEqual(disk_percent, 39)
        self.assertEqual(ip_address, "192.168.1.30")
        self.assertTrue(status.parse_service_active("active\n"))
        self.assertFalse(status.parse_service_active("inactive\n"))

    def test_rgb_pixels_convert_to_letterboxed_rgb565_frame(self):
        # 2x1 red/green source scaled into the middle of a 4x4 frame.
        frame = image.rgb_pixels_to_rgb565(
            pixels=[[(255, 0, 0), (0, 255, 0)]],
            source_width=2,
            source_height=1,
            target_width=4,
            target_height=4,
            background=(0, 0, 0),
        )

        self.assertEqual(len(frame), 4 * 4 * 2)
        black = fb.pack_rgb565(fb.rgb565(0, 0, 0))
        red = fb.pack_rgb565(fb.rgb565(255, 0, 0))
        green = fb.pack_rgb565(fb.rgb565(0, 255, 0))
        self.assertEqual(frame[0:2], black)

        row_1 = 4 * 2
        self.assertEqual(frame[row_1 : row_1 + 2], red)
        self.assertEqual(frame[row_1 + 4 : row_1 + 6], green)

    def test_component_dashboard_and_ai_card_render_full_frames(self):
        dashboard = components.dashboard_card(
            title="WalnutPi OK",
            metrics=[
                components.Metric("FRP", "ON", "good"),
                components.Metric("DISK", "36%", "warn"),
                components.Metric("MEM", "26%", "good"),
            ],
            lines=["IP 192.168.1.24", "Docker active"],
            width=480,
            height=320,
        )
        ai_card = components.ai_reply_card(
            prompt="核桃派现在还好吗",
            answer="WalnutPi OK. FRP online. Disk 36%. Memory 26%.",
            width=480,
            height=320,
        )

        self.assertEqual(len(dashboard), 480 * 320 * 2)
        self.assertEqual(len(ai_card), 480 * 320 * 2)
        self.assertGreater(len(set(dashboard)), 16)
        self.assertGreaterEqual(len(set(ai_card)), 16)

    def test_wrap_ascii_text_limits_line_width(self):
        lines = components.wrap_ascii_text("WalnutPi local agent is ready", max_chars=10, max_lines=4)

        self.assertLessEqual(len(lines), 4)
        self.assertTrue(all(len(line) <= 10 for line in lines))


if __name__ == "__main__":
    unittest.main()

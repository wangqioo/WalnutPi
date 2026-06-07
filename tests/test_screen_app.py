import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from framebuffer_ui import screen_app


class ScreenAppTest(unittest.TestCase):
    def test_menu_moves_selection_and_wraps(self):
        state = screen_app.AppState(items=screen_app.default_items())

        state = state.handle_key("down")
        self.assertEqual(state.selected, 1)

        state = state.handle_key("up")
        self.assertEqual(state.selected, 0)

        state = state.handle_key("up")
        self.assertEqual(state.selected, len(state.items) - 1)

    def test_enter_changes_current_page_for_status_and_ai(self):
        state = screen_app.AppState(items=screen_app.default_items())

        status_state = state.handle_key("enter")
        self.assertEqual(status_state.page, "status")

        ai_index = [item.id for item in state.items].index("ai")
        ai_state = screen_app.AppState(items=state.items, selected=ai_index).handle_key("enter")
        self.assertEqual(ai_state.page, "ai")

    def test_quit_sets_running_false(self):
        state = screen_app.AppState(items=screen_app.default_items())

        self.assertFalse(state.handle_key("q").running)

    def test_escape_does_not_exit_because_arrow_sequences_may_arrive_partial(self):
        state = screen_app.AppState(items=screen_app.default_items())

        next_state = state.handle_key("esc")

        self.assertTrue(next_state.running)
        self.assertEqual(next_state.selected, state.selected)


if __name__ == "__main__":
    unittest.main()

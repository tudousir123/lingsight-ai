"""Small configuration guards; actual GitHub jobs remain the acceptance gate."""

import re
import unittest
from pathlib import Path

WORKFLOW = (
    Path(__file__).resolve().parents[3] / ".github/workflows/test-backend.yml"
).read_text()


class BackendCIRuntimeTest(unittest.TestCase):
    def test_backend_has_a_pinned_host_and_finite_cold_start_budget(self) -> None:
        self.assertRegex(WORKFLOW, r"runs-on: ubuntu-\d{2}\.\d{2}")
        timeout = re.search(r"timeout-minutes:\s*(\d+)", WORKFLOW)
        self.assertIsNotNone(timeout)
        assert timeout is not None
        self.assertGreater(int(timeout[1]), 10)
        self.assertLessEqual(int(timeout[1]), 45)

    def test_existing_media_tools_avoid_a_full_apt_download_but_are_checked(
        self,
    ) -> None:
        self.assertIn("if ! command -v ffmpeg", WORKFLOW)
        self.assertIn("command -v ffprobe", WORKFLOW)
        self.assertIn("apt-get install", WORKFLOW)
        self.assertIn("ffmpeg -version", WORKFLOW)
        self.assertIn("ffprobe -version", WORKFLOW)


if __name__ == "__main__":
    unittest.main()

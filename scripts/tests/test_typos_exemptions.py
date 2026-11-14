"""Historical spelling exceptions must stay qualified, not permit bare typos."""

import re
import unittest
from pathlib import Path

import tomllib

CONFIG = Path(__file__).resolve().parents[2] / "pyproject.toml"


class HistoricalSpellingExceptionsTests(unittest.TestCase):
    def test_exceptions_match_only_qualified_historical_tokens(self):
        config = tomllib.loads(CONFIG.read_text())
        patterns = config["tool"]["typos"]["default"]["extend-ignore-re"]
        # Strip the qualifiers to test bare negatives without introducing deliberate
        # spelling errors into the source files scanned by the real hook.
        examples = [
            ("U+0100-02BA", "U+0100-02", ""),
            ("Failed: Databas...", "Failed: ", "..."),
            ("/volume1/DATAS/003_HealthAD/", "/volume1/", "/003_HealthAD/"),
        ]
        for qualified, prefix, suffix in examples:
            bare = qualified.removeprefix(prefix).removesuffix(suffix)
            with self.subTest(token=bare):
                self.assertTrue(any(re.search(p, qualified) for p in patterns))
                self.assertFalse(any(re.search(p, bare) for p in patterns))
        identifiers = config["tool"]["typos"]["default"]["extend-identifiers"]
        self.assertEqual(identifiers["alls"], "alls")
        self.assertEqual(identifiers["onSeeked"], "onSeeked")


if __name__ == "__main__":
    unittest.main()

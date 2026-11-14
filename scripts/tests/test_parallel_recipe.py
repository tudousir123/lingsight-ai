"""The navigated parallel-work recipe must route to current isolated runners."""

import unittest
from pathlib import Path

RECIPE = Path(__file__).resolve().parents[2] / "docs/agents/parallel-tickets.md"


class ParallelRecipeTests(unittest.TestCase):
    def test_recipe_uses_task_worktree_and_disposable_test_entrypoints(self):
        text = RECIPE.read_text()
        self.assertNotRegex(text, r"\bcp\s+(?:\./)?\.env(?:\s|$)")
        self.assertNotIn("lingsight-ai-db-1", text)
        self.assertNotIn("LINGSIGHT_RO_PASSWORD", text)
        self.assertNotIn("并回主 `.env`", text)
        self.assertIn("scripts/wt-exec.sh", text)
        self.assertIn("backend/scripts/test-local.sh", text)
        self.assertIn("scripts/e2e-local.sh", text)


if __name__ == "__main__":
    unittest.main()

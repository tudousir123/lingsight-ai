"""Exercise the public worktree CLI in disposable repositories, never this checkout."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "wt-exec.sh"


class WorktreeExecutionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lingsight-wt-guard-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.main = self.base / "main checkout"
        self.target = self.base / "task checkout"
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        self.git("init", "-b", "main", str(self.main), cwd=self.base)
        self.git("config", "user.name", "Guard Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        (self.main / "tracked.txt").write_text("committed\n")
        self.git("add", "tracked.txt")
        self.git("commit", "-m", "fixture")
        self.git("worktree", "add", "-b", "task/safe", str(self.target))
        (self.main / "tracked.txt").write_text("private main WIP\n")
        (self.main / "untracked.txt").write_text("private untracked WIP\n")
        self.main_before = self.main_state()
        self.addCleanup(self.assert_main_unchanged)

    def git(self, *args, cwd=None):
        return subprocess.check_output(
            ["git", *args], cwd=cwd or self.main, env=self.env, stderr=subprocess.PIPE
        )

    def main_state(self):
        return (
            self.git("rev-parse", "HEAD"),
            self.git("ls-files", "--stage"),
            self.git("diff", "--binary"),
            self.git("status", "--porcelain"),
            (self.main / "untracked.txt").read_bytes(),
        )

    def assert_main_unchanged(self):
        self.assertEqual(self.main_before, self.main_state())

    def run_guard(self, command, *, target=None, branch="task/safe", env=None):
        return subprocess.run(
            ["bash", str(SCRIPT), str(target or self.target), branch, "--", *command],
            cwd=self.main,
            env=env or self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_wrong_caller_directory_writes_only_in_explicit_worktree(self):
        result = self.run_guard(["sh", "-c", "printf fixture > marker.txt"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.target / "marker.txt").read_text(), "fixture")
        self.assertFalse((self.main / "marker.txt").exists())

    def test_wrong_expected_branch_fails_before_command(self):
        result = self.run_guard(["touch", "denied.txt"], branch="task/wrong")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("branch", result.stderr)
        self.assertFalse((self.target / "denied.txt").exists())

    def test_protected_branches_fail_even_when_expected_name_matches(self):
        master = self.base / "master checkout"
        self.git("worktree", "add", "-b", "master", str(master))
        for branch, path in [("main", self.main), ("master", master)]:
            with self.subTest(branch=branch):
                marker = self.base / f"denied-{branch}"
                result = self.run_guard(
                    ["touch", str(marker)], target=path, branch=branch
                )
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("protected", result.stderr)
                self.assertFalse(marker.exists())

    def test_target_must_be_absolute_existing_repository_top_level(self):
        nested = self.target / "nested"
        nested.mkdir()
        ordinary = self.base / "not a repository"
        ordinary.mkdir()
        invalid = [
            nested,
            Path(os.path.relpath(self.target, self.main)),
            ordinary,
            self.base / "missing",
        ]
        for index, path in enumerate(invalid):
            with self.subTest(target=path):
                marker = self.base / f"denied-path-{index}"
                result = self.run_guard(["touch", str(marker)], target=path)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse(marker.exists())

    def test_detached_head_fails_before_command(self):
        self.git("checkout", "--detach", cwd=self.target)
        result = self.run_guard(["touch", "denied.txt"])
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("detached", result.stderr)
        self.assertFalse((self.target / "denied.txt").exists())

    def test_exit_status_and_argument_vector_are_preserved(self):
        marker = "value with spaces;$(touch injected.txt)"
        result = self.run_guard(["printf", "%s", marker])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, marker)
        self.assertFalse((self.target / "injected.txt").exists())
        result = self.run_guard(["sh", "-c", "exit 7"])
        self.assertEqual(result.returncode, 7)

    def test_symlink_resolves_to_the_chosen_worktree(self):
        link = self.base / "worktree link"
        link.symlink_to(self.target, target_is_directory=True)
        result = self.run_guard(["pwd", "-P"], target=link)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), str(self.target.resolve()))

    def test_repository_local_git_environment_is_rejected_before_command(self):
        for name, value in {
            "GIT_INDEX_FILE": str(self.base / "alternate-index"),
            "GIT_DIR": str(self.main / ".git"),
            "GIT_WORK_TREE": str(self.main),
            "GIT_COMMON_DIR": str(self.main / ".git"),
        }.items():
            with self.subTest(variable=name):
                marker = self.base / f"denied-{name}"
                env = dict(self.env, **{name: value})
                result = self.run_guard(["touch", str(marker)], env=env)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn(name, result.stderr)
                self.assertFalse(marker.exists())

    def test_missing_command_has_usage_error(self):
        result = subprocess.run(
            ["bash", str(SCRIPT), str(self.target), "task/safe", "--"],
            cwd=self.main,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("usage:", result.stderr)


if __name__ == "__main__":
    unittest.main()

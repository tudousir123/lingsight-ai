"""Public CLI contract: disposable Git repositories and a fake uv boundary."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "pr-preflight.sh"


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="preflight space ")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo with spaces"
        self.repo.mkdir()
        self.git("init", "-b", "topic")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "CLI Test")
        (self.repo / "tracked.txt").write_text("base\n")
        self.git("add", "tracked.txt")
        self.git("commit", "-m", "base")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        (self.repo / "tracked.txt").write_text("head\n")
        self.git("commit", "-am", "head")
        self.head = self.git("rev-parse", "HEAD").stdout.strip()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "uv.json"
        uv = self.bin / "uv"
        uv.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "from pathlib import Path\n"
            "Path(os.environ['UV_LOG']).write_text(json.dumps(sys.argv[1:]))\n"
        )
        uv.chmod(0o755)
        self.uv_source = uv.read_text()
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "UV_LOG": str(self.log),
        }

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args],
            text=True,
            capture_output=True,
            check=True,
        )

    def run_preflight(self, *args):
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            cwd=self.repo,
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_rejected_before_hooks(self, *args):
        before = self.git("status", "--porcelain").stdout
        result = self.run_preflight(*args)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.log.exists(), "Rejected preflight must not run hooks")
        self.assertEqual(self.git("status", "--porcelain").stdout, before)

    def test_rejects_protected_and_detached_heads(self):
        for branch in ("main", "master"):
            with self.subTest(branch=branch):
                self.git("switch", "-C", branch)
                self.assert_rejected_before_hooks(self.base)
        self.git("checkout", "--detach")
        self.assert_rejected_before_hooks(self.base)

    def test_rejects_tracked_index_and_untracked_changes(self):
        for state in ("tracked", "index", "untracked"):
            with self.subTest(state=state):
                path = self.repo / (
                    "new file.txt" if state == "untracked" else "tracked.txt"
                )
                path.write_text("dirty\n")
                if state == "index":
                    self.git("add", "tracked.txt")
                self.assert_rejected_before_hooks(self.base)
                if state == "untracked":
                    path.unlink()
                else:
                    self.git("restore", "--staged", "--worktree", "tracked.txt")

    def test_rejects_invalid_or_missing_base(self):
        for args in ((), ("no-such-ref",), ("--help",), (self.base, "extra")):
            with self.subTest(args=args):
                self.assert_rejected_before_hooks(*args)

    def configure_uv(self, code):
        (self.bin / "uv").write_text(self.uv_source + code + "\n")

    def test_propagates_hook_failure(self):
        self.configure_uv("sys.exit(23)")
        result = self.run_preflight(self.base)
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)

    def test_detects_hook_file_mutation_without_staging_or_resetting(self):
        for state in ("tracked", "index", "untracked"):
            with self.subTest(state=state):
                path = "new file.txt" if state == "untracked" else "tracked.txt"
                code = f"Path({path!r}).write_text('hook change\\n')"
                if state == "index":
                    code += "\nimport subprocess; subprocess.run(['git', '-C', os.getcwd(), 'add', 'tracked.txt'], check=True)"
                self.configure_uv(code)
                result = self.run_preflight(self.base)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual((self.repo / path).read_text(), "hook change\n")
                status = self.git("status", "--porcelain").stdout
                self.assertIn(
                    {"tracked": " M", "index": "M ", "untracked": "??"}[state], status
                )
                if state == "untracked":
                    (self.repo / path).unlink()
                else:
                    self.git("restore", "--staged", "--worktree", "tracked.txt")

    def test_detects_hook_head_and_branch_changes_even_when_clean(self):
        self.configure_uv(
            "import subprocess; subprocess.run(['git', '-C', os.getcwd(), 'switch', '-c', 'changed-branch'], check=True)"
        )
        result = self.run_preflight(self.base)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            self.git("branch", "--show-current").stdout.strip(), "changed-branch"
        )
        self.git("switch", "topic")
        self.configure_uv(
            "import subprocess; subprocess.run(['git', '-C', os.getcwd(), 'commit', '--allow-empty', '-m', 'hook commit'], check=True)"
        )
        result = self.run_preflight(self.base)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotEqual(self.git("rev-parse", "HEAD").stdout.strip(), self.head)

    def test_clean_committed_head_uses_fixed_ci_scope(self):
        result = self.run_preflight(self.base)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            json.loads(self.log.read_text()),
            [
                "run",
                "prek",
                "run",
                "--from-ref",
                self.base,
                "--to-ref",
                self.head,
                "--show-diff-on-failure",
            ],
        )
        self.assertIn(self.base, result.stdout)
        self.assertIn(self.head, result.stdout)
        self.assertEqual(self.git("status", "--porcelain").stdout, "")

    def test_protected_branch_with_same_named_tag_is_rejected(self):
        for branch in ("main", "master"):
            with self.subTest(branch=branch):
                self.git("switch", "-C", branch)
                self.git("tag", branch)
                self.log.unlink(missing_ok=True)
                self.assert_rejected_before_hooks(self.base)

    def test_hooks_creating_a_tag_do_not_look_like_a_branch_switch(self):
        self.configure_uv(
            "import subprocess; subprocess.run(['git', '-C', os.getcwd(), 'tag', 'topic'], check=True)"
        )
        result = self.run_preflight(self.base)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            self.git("symbolic-ref", "HEAD").stdout.strip(), "refs/heads/topic"
        )


if __name__ == "__main__":
    unittest.main()

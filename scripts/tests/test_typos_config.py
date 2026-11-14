"""Typos CLI contracts using a disposable repository, never private files."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "check-typos-config.py"


class TyposConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="typos cli space ")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "topic")
        (self.repo / "pyproject.toml").write_text(
            '[tool.typos.default.extend-identifiers]\nalls = "alls"\n'
        )
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "typos.jsonl"
        typos = self.bin / "typos"
        typos.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "with open(os.environ['TYPOS_LOG'], 'a') as stream:\n"
            "    stream.write(json.dumps(sys.argv[1:]) + '\\n')\n"
            "sys.exit(int(os.environ.get('TYPOS_EXIT', '0')))\n"
        )
        typos.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "TYPOS_LOG": str(self.log),
        }

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args],
            capture_output=True,
            text=True,
            check=True,
        )

    def run_check(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_rejects_each_root_shadow_even_if_untracked(self):
        for name in ("_typos.toml", ".typos.toml", "typos.toml"):
            with self.subTest(name=name):
                path = self.repo / name
                path.write_text("[default]\n")
                result = self.run_check()
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(name, result.stdout + result.stderr)
                self.assertIn("pyproject.toml", result.stdout + result.stderr)
                self.assertEqual(path.read_text(), "[default]\n")
                path.unlink()

    def test_rejects_missing_canonical_table_and_invalid_toml(self):
        for text in ("[project]\nname = 'sample'\n", "[invalid"):
            with self.subTest(text=text):
                (self.repo / "pyproject.toml").write_text(text)
                result = self.run_check()
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("pyproject.toml", result.stdout + result.stderr)

    def test_global_config_change_scans_only_tracked_paths_nul_safely(self):
        names = [
            "plain.txt",
            "space name.txt",
            "-option.txt",
            "line\nbreak.txt",
            "semi;$(touch marker).txt",
        ]
        for name in names:
            (self.repo / name).write_text("known text\n")
        (self.repo / ".env").write_text("private untracked text\n")
        self.git("add", "--", "pyproject.toml", *names)
        result = self.run_check("--scan", "pyproject.toml")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        args = json.loads(self.log.read_text().splitlines()[0])
        self.assertEqual(args[:2], ["--force-exclude", "--"])
        self.assertEqual(
            set(args[2:]), {f"./{name}" for name in ["pyproject.toml", *names]}
        )
        self.assertFalse((self.repo / "marker").exists())
        self.assertEqual((self.repo / ".env").read_text(), "private untracked text\n")

    def test_normal_scan_limits_to_requested_tracked_files_and_propagates_exit(self):
        (self.repo / "selected.txt").write_text("selected\n")
        (self.repo / "other.txt").write_text("other\n")
        (self.repo / ".env").write_text("private\n")
        self.git("add", "pyproject.toml", "selected.txt", "other.txt")
        self.env["TYPOS_EXIT"] = "17"
        result = self.run_check("--scan", "selected.txt", ".env")
        self.assertEqual(result.returncode, 17, result.stdout + result.stderr)
        self.assertEqual(
            json.loads(self.log.read_text()),
            ["--force-exclude", "--", "./selected.txt"],
        )

    def test_root_shadow_symlink_is_rejected_even_if_broken(self):
        (self.repo / "_typos.toml").symlink_to("missing-config.toml")
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("_typos.toml", result.stdout + result.stderr)

    def test_scan_skips_tracked_symlinks_and_missing_files(self):
        (self.repo / ".env").write_text("private\n")
        (self.repo / "alias.txt").symlink_to(".env")
        (self.repo / "removed.txt").write_text("removed\n")
        self.git("add", "pyproject.toml", "alias.txt", "removed.txt")
        (self.repo / "removed.txt").unlink()
        result = self.run_check("--scan", "pyproject.toml")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            json.loads(self.log.read_text()),
            ["--force-exclude", "--", "./pyproject.toml"],
        )

    def test_broad_scan_checks_every_batch_even_when_typos_fail(self):
        for index in range(101):
            (self.repo / f"file-{index:03}.txt").write_text("known text\n")
        self.git(
            "add", "pyproject.toml", *[f"file-{index:03}.txt" for index in range(101)]
        )
        self.env["TYPOS_EXIT"] = "17"
        result = self.run_check("--scan", "pyproject.toml")
        self.assertEqual(result.returncode, 17, result.stdout + result.stderr)
        batches = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(len(batches), 2)
        self.assertEqual(sum(len(batch[2:]) for batch in batches), 102)

    def test_scan_with_no_files_never_defaults_to_recursive_walk(self):
        self.git("add", "pyproject.toml")
        result = self.run_check("--scan")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.log.exists())

    def test_only_canonical_config_passes_without_writes(self):
        before = (self.repo / "pyproject.toml").read_bytes()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.repo / "pyproject.toml").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()

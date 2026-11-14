"""Public fe.sh CLI tests; fake Docker records the external command boundary."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]


class FrontendHelperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fe helper ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        (self.repo / "scripts").mkdir()
        shutil.copy2(PROJECT / "scripts/fe.sh", self.repo / "scripts/fe.sh")
        (self.repo / "frontend/src").mkdir(parents=True)
        (self.repo / "frontend/src/example.ts").write_text("export const n = 1\n")
        (self.repo / "bun.lock").write_text('{"lockfileVersion": 1}\n')
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.docker_log = self.base / "docker.jsonl"
        docker = self.bin / "docker"
        docker.write_text(
            f"#!{sys.executable}\n"
            "import json, os, sys\n"
            "with open(os.environ['DOCKER_LOG'], 'a') as log:\n"
            "    log.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        )
        docker.chmod(0o755)
        self.env = dict(
            os.environ,
            PATH=f"{self.bin}:{os.environ['PATH']}",
            DOCKER_LOG=str(self.docker_log),
        )

    def run_helper(self, *args, repo=None):
        return subprocess.run(
            ["bash", str((repo or self.repo) / "scripts/fe.sh"), *args],
            cwd=self.base,
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )

    def docker_calls(self):
        if not self.docker_log.exists():
            return []
        return [json.loads(line) for line in self.docker_log.read_text().splitlines()]

    def execute_payload(self):
        """Translate the bind mount only; execute the helper's actual sh payload."""
        self.tool_log = self.base / "tools.jsonl"
        self.env.update(TOOL_LOG=str(self.tool_log), FAKE_REPO=str(self.repo))
        with (self.bin / "docker").open("a") as docker:
            docker.write(
                "import shlex, subprocess\n"
                "args = sys.argv[1:]\n"
                "i = args.index('sh')\n"
                "script = args[i + 2].replace('/app', shlex.quote(os.environ['FAKE_REPO']))\n"
                "sys.exit(subprocess.run(['sh', args[i + 1], script, *args[i + 3:]],\n"
                "    cwd=os.path.join(os.environ['FAKE_REPO'], 'frontend')).returncode)\n"
            )
        for name in ("bun", "bunx"):
            tool = self.bin / name
            tool.write_text(
                f"#!{sys.executable}\n"
                "import json, os, sys\n"
                "with open(os.environ['TOOL_LOG'], 'a') as log:\n"
                "    log.write(json.dumps([os.path.basename(sys.argv[0]),\n"
                "                          os.getcwd(), *sys.argv[1:]]) + '\\n')\n"
                "if sys.argv[1:] == ['ci']:\n"
                "    sys.exit(int(os.environ.get('CI_EXIT', '0')))\n"
            )
            tool.chmod(0o755)

    def tool_calls(self):
        return [json.loads(line) for line in self.tool_log.read_text().splitlines()]

    def test_build_installs_frozen_dependencies_from_workspace_root(self):
        self.execute_payload()
        before = (self.repo / "bun.lock").read_bytes()
        result = self.run_helper("build")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.tool_calls(),
            [
                ["bun", str(self.repo), "ci"],
                ["bun", str(self.repo / "frontend"), "run", "build"],
            ],
        )
        self.assertEqual((self.repo / "bun.lock").read_bytes(), before)

    def test_check_and_fix_preserve_filenames_as_data_not_shell_or_options(self):
        self.execute_payload()
        names = [
            "src/a file.ts",
            "src/a;touch injected;.ts",
            "src/$HOME.ts",
            "src/quote'\".ts",
            "src/[abc]*.ts",
            "--write",
        ]
        for name in names:
            (self.repo / "frontend" / name).write_text("export const n = 1\n")
        for command in ("check", "fix"):
            with self.subTest(command=command):
                result = self.run_helper(command, *names)
                self.assertFalse((self.repo / "frontend/injected").exists())
                self.assertEqual(result.returncode, 0, result.stderr)
                expected = ["bunx", str(self.repo / "frontend"), "biome", "check"]
                if command == "fix":
                    expected.append("--write")
                expected.extend(
                    ["--no-errors-on-unmatched", *[f"./{n}" for n in names]]
                )
                self.assertEqual(self.tool_calls()[-1], expected)
                docker = self.docker_calls()[-1]
                for name in names:
                    self.assertIn(f"./{name}", docker)
                self.assertNotIn("--unsafe", self.tool_calls()[-1])

    def test_invalid_file_scopes_fail_before_docker(self):
        (self.repo / "frontend/outside.ts").symlink_to(self.repo / "bun.lock")
        invalid = [
            (),
            (".",),
            ("src",),
            ("",),
            ("src/missing.ts",),
            ("frontend/src/example.ts",),
            ("../bun.lock",),
            (str(self.repo / "frontend/src/example.ts"),),
            ("outside.ts",),
            ("--unsafe",),
            ("src/example.ts", "src/missing.ts"),
        ]
        for command in ("check", "fix"):
            for args in invalid:
                with self.subTest(command=command, args=args):
                    self.docker_log.unlink(missing_ok=True)
                    result = self.run_helper(command, *args)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertTrue(result.stderr)
                    self.assertEqual(self.docker_calls(), [])

    def test_invalid_commands_and_build_arguments_fail_before_docker(self):
        for args in (
            (),
            ("unknown",),
            ("build", "src/example.ts"),
            ("regen-routes", "--write"),
        ):
            with self.subTest(args=args):
                self.docker_log.unlink(missing_ok=True)
                result = self.run_helper(*args)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertTrue(result.stderr)
                self.assertEqual(self.docker_calls(), [])

    def test_frozen_install_failure_stops_before_the_requested_tool(self):
        self.execute_payload()
        self.env["CI_EXIT"] = "19"
        result = self.run_helper("check", "src/example.ts")
        self.assertEqual(result.returncode, 19, result.stderr)
        self.assertEqual(self.tool_calls(), [["bun", str(self.repo), "ci"]])

    def test_regen_routes_keeps_its_vite_build_interface(self):
        self.execute_payload()
        result = self.run_helper("regen-routes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("routeTree.gen.ts regenerated", result.stdout)
        self.assertEqual(
            self.tool_calls(),
            [
                ["bun", str(self.repo), "ci"],
                ["bunx", str(self.repo / "frontend"), "vite", "build"],
            ],
        )

    def test_dependency_volumes_reuse_only_the_same_canonical_tree_and_lock(self):
        git = ["git", "-C", str(self.repo)]
        subprocess.run([*git, "add", "."], check=True)
        subprocess.run(
            [
                *git,
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-qm",
                "fixture",
            ],
            check=True,
        )
        other = self.base / "linked worktree"
        subprocess.run(
            [*git, "worktree", "add", "-qb", "other", str(other)], check=True
        )
        alias = self.base / "alias"
        alias.symlink_to(self.repo, target_is_directory=True)
        for repo in (self.repo, alias, other):
            result = self.run_helper("build", repo=repo)
            self.assertEqual(result.returncode, 0, result.stderr)
        (self.repo / "bun.lock").write_text('{"lockfileVersion": 2}\n')
        result = self.run_helper("build")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.docker_calls()
        volumes = []
        for call in calls:
            self.assertEqual(call[:2], ["run", "--rm"])
            mounts = [call[i + 1] for i, arg in enumerate(call) if arg == "-v"]
            dependency_mounts = [mount for mount in mounts if "node_modules" in mount]
            self.assertEqual(len(dependency_mounts), 2)
            self.assertEqual(
                {mount.split(":", 1)[1] for mount in dependency_mounts},
                {"/app/node_modules", "/app/frontend/node_modules"},
            )
            names = {mount.split(":", 1)[0] for mount in dependency_mounts}
            self.assertEqual(len(names), 2)
            volumes.append(names)
        self.assertEqual(volumes[0], volumes[1])
        self.assertTrue(volumes[0].isdisjoint(volumes[2]))
        self.assertTrue(volumes[0].isdisjoint(volumes[3]))
        self.assertTrue(volumes[2].isdisjoint(volumes[3]))

    def test_cold_build_uses_the_ci_bun_pin(self):
        result = self.run_helper("build")
        self.assertEqual(result.returncode, 0, result.stderr)
        pins = re.findall(
            r"bun-version:\s*([\d.]+)",
            (PROJECT / ".github/workflows/pre-commit.yml").read_text(),
        )
        self.assertEqual(len(set(pins)), 1)
        self.assertIn(f"oven/bun:{pins[0]}", self.docker_calls()[0])
        playwright_pins = re.findall(
            r"bun-version:\s*([\d.]+)",
            (PROJECT / ".github/workflows/playwright.yml").read_text(),
        )
        self.assertTrue(playwright_pins)
        self.assertEqual(set(playwright_pins), set(pins))
        self.assertIn(
            f"COPY --from=oven/bun:{pins[0]} ",
            (PROJECT / "frontend/Dockerfile.playwright").read_text(),
        )


if __name__ == "__main__":
    unittest.main()

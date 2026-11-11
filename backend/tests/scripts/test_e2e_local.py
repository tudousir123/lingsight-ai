"""The local browser runner must own and clean only its disposable stack."""

import json
import os
import subprocess
from pathlib import Path

import pytest

RUNNER = Path(__file__).resolve().parents[3] / "scripts" / "e2e-local.sh"


@pytest.mark.parametrize(
    ("mode", "exit_code"), [("success", 0), ("fail", 23), ("term", 143), ("int", 130)]
)
def test_runner_isolates_and_cleans_after_exit(
    tmp_path: Path, mode: str, exit_code: int
) -> None:
    fake_docker = tmp_path / "docker"
    log = tmp_path / "calls.jsonl"
    fake_docker.write_text(
        """#!/usr/bin/env python3
import json, os, signal, sys
args = sys.argv[1:]
with open(os.environ['E2E_CALL_LOG'], 'a') as f:
    f.write(json.dumps({'args': args, 'agent': os.environ.get('AGENT_BASE_URL'),
                       'user': os.environ.get('FIRST_SUPERUSER'),
                       'smtp_user': os.environ.get('SMTP_USER'),
                       'smtp_password': os.environ.get('SMTP_PASSWORD')}) + '\\n')
if 'build' in args:
    if os.environ['E2E_MODE'] == 'fail': sys.exit(23)
    if os.environ['E2E_MODE'] == 'term': os.kill(os.getppid(), signal.SIGTERM)
    if os.environ['E2E_MODE'] == 'int': os.kill(os.getppid(), signal.SIGINT)
""",
        encoding="utf-8",
    )
    fake_docker.chmod(0o755)
    result = subprocess.run(
        ["bash", str(RUNNER), "--list"],
        env={
            **os.environ,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "TMPDIR": str(tmp_path),
            "E2E_CALL_LOG": str(log),
            "E2E_MODE": mode,
            "COMPOSE_PROJECT_NAME": "existing-development",
            "COMPOSE_FILE": "existing-development.yml",
            "AGENT_BASE_URL": "https://development.invalid",
            "FIRST_SUPERUSER": "developer@example.com",
            "SMTP_USER": "developer@example.com",
            "SMTP_PASSWORD": "developer-only-placeholder",
        },
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == exit_code, result.stderr
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    compose_calls = [call for call in calls if call["args"][0] == "compose"]
    projects = {call["args"][call["args"].index("-p") + 1] for call in compose_calls}
    assert len(projects) == 1
    project = projects.pop()
    assert project.startswith("lingsight-e2e-")
    for call in compose_calls:
        args = call["args"]
        assert args[args.index("--env-file") + 1] != ".env"
        assert [args[i + 1] for i, arg in enumerate(args) if arg == "-f"] == [
            "compose.yml",
            "compose.e2e.yml",
        ]
        assert call["agent"] == "http://unconfigured-agent:19100"
        assert call["user"] == "e2e@example.com"
        assert call["smtp_user"] == ""
        assert call["smtp_password"] == ""
    assert compose_calls[-1]["args"][-3:] == ["down", "-v", "--remove-orphans"]
    assert calls[-1]["args"] == [
        "image",
        "rm",
        f"{project}-backend:local",
        f"{project}-playwright:local",
    ]
    assert not list(tmp_path.glob("lingsight-e2e-*"))

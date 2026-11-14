"""Formal deployment CLI behavior, replacing only the Docker process boundary."""

import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from tests.runtime import test_database_url as require_test_database_url

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/deploy-preflight.sh"
SYNTHETIC_SECRET = "synthetic-preflight-secret-never-log"
RunPreflight = Callable[[dict[str, str]], subprocess.CompletedProcess[str]]


@pytest.fixture
def research_env() -> dict[str, str]:
    return {
        "RESEARCH_DB_HOST": "127.0.0.1",
        "RESEARCH_DB_PORT": "1",
        "RESEARCH_DB_USER": "unused",
        "RESEARCH_DB_NAME": "lingsight_test_unreachable",
        "LINGSIGHT_RO_PASSWORD": SYNTHETIC_SECRET,
    }


@pytest.fixture
def preflight(tmp_path: Path) -> RunPreflight:
    docker = tmp_path / "docker"
    docker.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        "if 'config' in sys.argv: sys.exit(0)\n"
        "required = {'run', '--rm', '--no-deps', '--pull', 'never', '-T', 'backend', 'python', '-'}\n"
        "if not required.issubset(sys.argv): sys.exit(99)\n"
        "os.execv(sys.executable, [sys.executable, '-'])\n"
    )
    docker.chmod(0o700)
    private_env = tmp_path / "private.env"
    private_env.write_text("")
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    # An ambient dotenv must never influence the candidate container probe.
    (tmp_path / ".env").write_text("RESEARCH_QUERY_TIMEOUT_MS=invalid-ambient-value\n")

    def run(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(SCRIPT), str(private_env)],
            env={
                "PATH": f"{tmp_path}:/usr/bin:/bin",
                "PYTHONPATH": str(SCRIPT.parents[1] / "backend"),
                **env,
            },
            cwd=runtime,
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )

    return run


@pytest.mark.parametrize(
    "key",
    [
        "RESEARCH_DB_HOST",
        "RESEARCH_DB_PORT",
        "RESEARCH_DB_USER",
        "RESEARCH_DB_NAME",
        "LINGSIGHT_RO_PASSWORD",
    ],
)
@pytest.mark.parametrize("value", [None, " "])
def test_missing_research_configuration_fails_without_exposing_secrets(
    preflight: RunPreflight, research_env: dict[str, str], key: str, value: str | None
) -> None:
    if value is None:
        research_env.pop(key)
    else:
        research_env[key] = value
    result = preflight(research_env)
    assert result.returncode != 0
    assert f"Research preflight failed: missing {key}" in result.stderr
    assert SYNTHETIC_SECRET not in result.stdout + result.stderr


@pytest.mark.parametrize(
    ("port", "message"),
    [
        ("1", "connection or read unavailable"),
        (SYNTHETIC_SECRET, "invalid research configuration"),
        ("0", "invalid research configuration"),
        ("65536", "invalid research configuration"),
    ],
)
def test_research_failure_is_nonzero_and_redacted(
    preflight: RunPreflight, research_env: dict[str, str], port: str, message: str
) -> None:
    result = preflight(research_env | {"RESEARCH_DB_PORT": port})
    assert result.returncode != 0
    assert f"Research preflight failed: {message}" in result.stderr
    assert SYNTHETIC_SECRET not in result.stdout + result.stderr
    assert "Traceback" not in result.stderr


def test_compose_configuration_failure_is_redacted(
    preflight: RunPreflight, tmp_path: Path
) -> None:
    (tmp_path / "docker").write_text(
        f"#!{sys.executable}\nimport sys\n"
        f"sys.stderr.write({SYNTHETIC_SECRET!r})\nsys.exit(1)\n"
    )
    result = preflight({})
    assert result.returncode != 0
    assert "Deployment preflight failed: invalid Compose configuration" in result.stderr
    assert SYNTHETIC_SECRET not in result.stdout + result.stderr


def test_formal_compose_passes_explicit_research_configuration(
    tmp_path: Path, research_env: dict[str, str]
) -> None:
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("Docker Compose CLI is required for configuration validation")
    research_env["RESEARCH_DB_PORT"] = "13306"
    required = {
        "PLATFORM_IMAGE": "synthetic-platform:preflight",
        "PROJECT_NAME": "Synthetic preflight",
        "SECRET_KEY": "synthetic-platform-secret",
        "FIRST_SUPERUSER": "admin@example.invalid",
        "FIRST_SUPERUSER_PASSWORD": "synthetic-admin-password",
        "DATABASE_URL": "mysql+pymysql://unused:unused@127.0.0.1:1/lingsight_test_unused",
        "AGENT_API_TOKEN": "synthetic-agent-token",
        "INFERENCE_API_TOKEN": "synthetic-inference-token",
        "MYSQL_PASSWORD": "synthetic-app-password",
        "MYSQL_ROOT_PASSWORD": "synthetic-root-password",
    }
    private_env = tmp_path / "synthetic.env"
    private_env.write_text(
        "\n".join(f"{key}={value}" for key, value in (required | research_env).items())
    )
    result = subprocess.run(
        [
            docker,
            "compose",
            "--env-file",
            str(private_env),
            "-f",
            str(SCRIPT.parents[1] / "compose.local-production.yml"),
            "config",
            "--format",
            "json",
        ],
        env={"PATH": "/usr/bin:/bin"},
        text=True,
        capture_output=True,
        check=False,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    backend = json.loads(result.stdout)["services"]["backend"]
    for key, value in research_env.items():
        assert backend["environment"].get(key) == value


@pytest.mark.usefixtures("db")
def test_preflight_succeeds_with_authenticated_isolated_database(
    preflight: RunPreflight,
) -> None:
    url = make_url(require_test_database_url(os.environ.get("TEST_DATABASE_URL")))
    result = preflight(
        {
            "RESEARCH_DB_HOST": str(url.host),
            "RESEARCH_DB_PORT": str(url.port or 3306),
            "RESEARCH_DB_USER": str(url.username),
            "RESEARCH_DB_NAME": str(url.database),
            "LINGSIGHT_RO_PASSWORD": str(url.password),
        }
    )
    assert result.returncode == 0, result.stderr
    assert "Research preflight passed: authenticated read succeeded" in result.stdout
    assert str(url.password) not in result.stdout + result.stderr

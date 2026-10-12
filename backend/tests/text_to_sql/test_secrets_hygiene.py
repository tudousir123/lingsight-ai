"""Credential hygiene (ticket #5 acceptance): every secret arrives via env.

No credential literal may live in the repository: the pipeline settings must
read the LLM and read-only DB credentials from environment variables, and a
scan over all git-tracked files must find no pasted secrets.
"""

import subprocess
from pathlib import Path

import pytest

from app.text_to_sql.settings import ResearchQuerySettings

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_settings_come_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://example.internal/v1")
    monkeypatch.setenv("LLM_API_KEY", "sk-env-injected")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    monkeypatch.setenv("LINGSIGHT_RO_PASSWORD", "env-injected-password")
    monkeypatch.setenv("RESEARCH_QUERY_MAX_ROWS", "17")

    settings = ResearchQuerySettings(_env_file=None)

    assert settings.LLM_BASE_URL == "https://example.internal/v1"
    assert settings.LLM_API_KEY == "sk-env-injected"
    assert settings.LLM_MODEL == "test-model"
    assert settings.LINGSIGHT_RO_PASSWORD == "env-injected-password"
    assert settings.RESEARCH_QUERY_MAX_ROWS == 17


def test_settings_defaults_are_safe_without_any_env() -> None:
    # No import-time crash and no secret baked in when nothing is configured.
    settings = ResearchQuerySettings(_env_file=None)
    assert settings.LLM_BASE_URL is None
    assert settings.LLM_API_KEY is None
    assert settings.LINGSIGHT_RO_PASSWORD == ""


def test_env_file_is_not_tracked() -> None:
    output = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files", ".env"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert output.strip() == "", ".env must never be committed"


def test_no_secret_literals_in_tracked_files() -> None:
    tracked = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    # Prefix of the generated lingsight_ro password: catches accidental paste
    # of the real rotated value anywhere in the repository. Built at runtime
    # so this file itself stays free of the literal marker.
    forbidden_markers = ["Lsr" + "o-"]
    offenders: list[str] = []
    for rel in tracked:
        path = REPO_ROOT / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError, IsADirectoryError:
            continue
        for marker in forbidden_markers:
            if marker in text:
                offenders.append(rel)
    assert offenders == [], f"secret-like content leaked into: {offenders}"


def test_env_example_contains_only_placeholders() -> None:
    text = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    assert "LLM_BASE_URL=" in text
    assert "LINGSIGHT_RO_PASSWORD=" in text
    # Placeholder lines only — no value that looks like a real credential.
    for line in text.splitlines():
        if line.startswith(("LLM_API_KEY=", "LINGSIGHT_RO_PASSWORD=")):
            value = line.split("=", 1)[1].strip()
            assert value in {"", "changethis"}, (
                f"non-placeholder in .env.example: {line}"
            )

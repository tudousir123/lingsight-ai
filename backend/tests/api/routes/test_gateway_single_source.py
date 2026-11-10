"""Single-source tripwires for the shared gateway machinery (ticket #39)."""

from pathlib import Path

_GATE_DETAIL = "此账号尚未开通个人科研工作区"
# VCS, dependency and build trees that may contain vendored copies.
_SKIP_DIRS = {".git", ".venv", "node_modules", "dist", "htmlcov", "__pycache__"}


def _repo_root() -> Path:
    return Path(__file__).parents[4]


def _workspace_gate_definitions() -> list[Path]:
    """Every Python file under the repo that spells out the gate logic."""
    hits = []
    for path in _repo_root().rglob("*.py"):
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        if path == Path(__file__):
            continue  # this tripwire itself quotes the detail string
        if _GATE_DETAIL in path.read_text(encoding="utf-8"):
            hits.append(path)
    return hits


def test_workspace_gate_defined_once_repo_wide() -> None:
    assert _workspace_gate_definitions() == [_repo_root() / "backend" / "app" / "api" / "deps.py"]


def test_forwarding_implementation_defined_once() -> None:
    routes = sorted((_repo_root() / "backend" / "app" / "api" / "routes").glob("*.py"))
    offenders = [
        path.name
        for path in routes
        if "httpx.AsyncClient(" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []
    kernel = (_repo_root() / "backend" / "app" / "api" / "gateway.py").read_text(
        encoding="utf-8"
    )
    assert kernel.count("httpx.AsyncClient(") == 1


def test_whitelist_regexes_rendered_not_handwritten() -> None:
    routes = sorted((_repo_root() / "backend" / "app" / "api" / "routes").glob("*.py"))
    offenders = [
        path.name
        for path in routes
        if "re.compile(" in path.read_text(encoding="utf-8")
        or "re.fullmatch(" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []

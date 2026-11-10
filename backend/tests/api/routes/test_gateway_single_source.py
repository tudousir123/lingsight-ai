"""Single-source tripwires for the shared gateway machinery (ticket #39)."""

from pathlib import Path


def _app_root() -> Path:
    return Path(__file__).parents[3] / "app"


def test_workspace_gate_defined_once() -> None:
    app_root = _app_root()
    hits = [
        path
        for path in app_root.rglob("*.py")
        if "此账号尚未开通个人科研工作区" in path.read_text(encoding="utf-8")
    ]
    assert hits == [app_root / "api" / "deps.py"]


def test_forwarding_implementation_defined_once() -> None:
    routes = sorted((_app_root() / "api" / "routes").glob("*.py"))
    offenders = [
        path.name
        for path in routes
        if "httpx.AsyncClient(" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []
    kernel = (_app_root() / "api" / "gateway.py").read_text(encoding="utf-8")
    assert kernel.count("httpx.AsyncClient(") == 1


def test_whitelist_regexes_rendered_not_handwritten() -> None:
    routes = sorted((_app_root() / "api" / "routes").glob("*.py"))
    offenders = [
        path.name
        for path in routes
        if "re.compile(" in path.read_text(encoding="utf-8")
        or "re.fullmatch(" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []

"""Tripwire: the checked-in frontend route module matches the declarations."""

from scripts.export_frontend_routes import TARGET_PATH, load_services, render_module


def test_generated_route_module_is_current() -> None:
    assert TARGET_PATH.exists(), (
        "frontend route module missing — run: "
        "cd backend && uv run python scripts/export_frontend_routes.py"
    )
    rendered = render_module(load_services())
    assert TARGET_PATH.read_text(encoding="utf-8") == rendered, (
        "frontend/src/lib/upstreamRoutes.gen.ts drifted from the gateway "
        "operation tables — rerun: cd backend && "
        "uv run python scripts/export_frontend_routes.py"
    )


def test_hyphenated_identity_route_has_a_valid_typescript_builder() -> None:
    rendered = render_module(load_services())
    assert "personalAgent: () => `personal-agent`" in rendered
    assert "personal-agent: ()" not in rendered


def test_browser_compatibility_contract_is_exported_for_typescript_consumers() -> None:
    rendered = render_module(load_services())
    assert "export const agentBrowserContract = {" in rendered

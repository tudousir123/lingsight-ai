"""Export gateway routes and supported browser versions to TypeScript.

The operation tables in app/api/routes/agent.py and inference.py are the
single declaration of each upstream service's operation surface: the backend
renders its forwarding whitelist from them, and this script renders the
frontend path builders from the same tables, so a route change cannot exist
in only one place. The generated module is checked in at
frontend/src/lib/upstreamRoutes.gen.ts; rerun after changing a table:

    cd backend && uv run python scripts/export_frontend_routes.py

tests/scripts/test_export_frontend_routes.py fails when the checked-in module
drifts from the declarations. Browser compatibility versions are declared in
app/contracts.py and exported here too, so UI and gateway gates cannot drift.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from app.api.gateway import LiteralSet, OperationTable
from app.contracts import (
    AGENT_BROWSER_CONTRACT,
    AGENT_BROWSER_PROFILE,
    AGENT_MEMORY_MANAGEMENT_CONTRACT,
    AGENT_RESEARCH_MEMORY_CONTRACT,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
TARGET_PATH = REPO_ROOT / "frontend" / "src" / "lib" / "upstreamRoutes.gen.ts"

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


@dataclass(frozen=True)
class ServiceRoutes:
    """One gateway adapter's declaration plus its public mount point."""

    name: str  # "agent" — TS identifiers derive from this
    base_path: str  # "/api/v1/agent"
    table: OperationTable


def load_services() -> tuple[ServiceRoutes, ...]:
    """Import both adapters under synthetic settings (no developer env)."""
    from tests.runtime import configure_application

    configure_application()
    from app.api.routes import agent, inference
    from app.core.settings import Settings

    api_prefix = str(Settings.model_fields["API_V1_STR"].default or "")
    return (
        ServiceRoutes("agent", f"{api_prefix}{agent.router.prefix}", agent.OPERATIONS),
        ServiceRoutes(
            "inference",
            f"{api_prefix}{inference.router.prefix}",
            inference.OPERATIONS,
        ),
    )


def _pascal(name: str) -> str:
    return "".join(
        part[:1].upper() + part[1:] for part in re.split(r"[_-]", name) if part
    )


def _camel(name: str) -> str:
    pascal = _pascal(name)
    return pascal[:1].lower() + pascal[1:]


def _route_key(pattern: str) -> str:
    parts: list[str] = []
    for segment in pattern.split("/"):
        if match := _PLACEHOLDER.fullmatch(segment):
            parts.append("By" + _pascal(match.group(1)))
        else:
            parts.append(_pascal(segment))
    key = "".join(parts)
    return key[:1].lower() + key[1:]


def _ts_literal(segment: str) -> str:
    return segment.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def _ts_template(pattern: str) -> str:
    parts: list[str] = []
    for segment in pattern.split("/"):
        if match := _PLACEHOLDER.fullmatch(segment):
            parts.append("${" + _camel(match.group(1)) + "}")
        else:
            parts.append(_ts_literal(segment))
    return "/".join(parts)


def _render_service(lines: list[str], service: ServiceRoutes) -> None:
    param_types: dict[str, str] = {}
    for name, param in service.table.params.items():
        if isinstance(param, LiteralSet):
            param_types[name] = _pascal(service.name) + _pascal(name)
        else:
            param_types[name] = "string"
    for name, param in service.table.params.items():
        if isinstance(param, LiteralSet):
            union = " | ".join(f'"{value}"' for value in param.values)
            lines.append(f"export type {param_types[name]} = {union}")
    if any(isinstance(p, LiteralSet) for p in service.table.params.values()):
        lines.append("")
    patterns = sorted(
        {pattern for routes in service.table.operations.values() for pattern in routes}
    )
    keys: set[str] = set()
    lines.append(f"export const {_camel(service.name)}Routes = {{")
    for pattern in patterns:
        key = _route_key(pattern)
        if key in keys:
            raise ValueError(f"route key collision for {key!r} ({pattern!r})")
        keys.add(key)
        placeholders = _PLACEHOLDER.findall(pattern)
        if placeholders:
            args = ", ".join(
                f"{_camel(name)}: {param_types.get(name, 'string')}"
                for name in placeholders
            )
            lines.append(f"  {key}: ({args}) => `{_ts_template(pattern)}`,")
        else:
            lines.append(f"  {key}: () => `{_ts_template(pattern)}`,")
    lines.append("} as const")
    lines.append("")


def render_module(services: Sequence[ServiceRoutes]) -> str:
    """Render the TypeScript module for the given service declarations."""
    lines = [
        "// AUTO-GENERATED FILE — DO NOT EDIT.",
        "// Regenerate with: cd backend && uv run python scripts/export_frontend_routes.py",
        "// Sources: backend/app/api/routes/*.py tables and backend/app/contracts.py versions;",
        "// backend/tests/scripts/test_export_frontend_routes.py fails on drift.",
        "",
    ]
    lines.extend(
        [
            f'export const agentMemoryManagementContract = "{AGENT_MEMORY_MANAGEMENT_CONTRACT}" as const',
            f'export const agentResearchMemoryContract = "{AGENT_RESEARCH_MEMORY_CONTRACT}" as const',
            "",
            "export const agentBrowserContract = {",
            f'  contract: "{AGENT_BROWSER_CONTRACT}",',
            f'  profile: "{AGENT_BROWSER_PROFILE}",',
            "} as const",
            "",
        ]
    )
    for service in services:
        lines.append(
            f'export const {_camel(service.name)}GatewayBase = "{service.base_path}"'
        )
    lines.append("")
    for service in services:
        _render_service(lines, service)
    return "\n".join(lines).rstrip("\n") + "\n"


def main() -> int:
    content = render_module(load_services())
    relative = TARGET_PATH.relative_to(REPO_ROOT)
    if TARGET_PATH.exists() and TARGET_PATH.read_text(encoding="utf-8") == content:
        print(f"{relative} already up to date")
        return 0
    TARGET_PATH.parent.mkdir(parents=True, exist_ok=True)
    TARGET_PATH.write_text(content, encoding="utf-8")
    print(f"wrote {relative}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

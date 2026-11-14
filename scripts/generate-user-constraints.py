"""Export account constraints from the same OpenAPI document as the SDK."""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
schemas = json.loads((root / "frontend/openapi.json").read_text())["components"][
    "schemas"
]
limits = [
    next(
        variant["maxLength"]
        for variant in schemas[name]["properties"]["full_name"]["anyOf"]
        if variant["type"] == "string"
    )
    for name in ("UserCreate", "UserRegister")
]
if limits[0] != limits[1] or not isinstance(limits[0], int):
    raise ValueError("Account forms must agree on the full_name length constraint")
(root / "frontend/src/client/userConstraints.gen.ts").write_text(
    "// Generated from OpenAPI by scripts/generate-user-constraints.py. Do not edit.\n"
    f"export const FULL_NAME_MAX_LENGTH = {limits[0]}\n"
)

#! /usr/bin/env bash

set -e
set -x

cd backend
# Synthetic settings (AGENTS.md §0): no developer .env required. openapi.json
# is gitignored and the generated client ignores the info title, so this
# matches a real-env export for codegen purposes.
uv run python -c "
from tests.runtime import configure_application
configure_application()
import app.main, json
print(json.dumps(app.main.app.openapi()))
" > ../openapi.json
cd ..
mv openapi.json frontend/
bun run --filter frontend generate-client
python3 scripts/generate-user-constraints.py
# No lint tail: src/client/** is biome-ignored by design (generated code),
# and a full-repo `bun run lint` is an unsafe mass write (local-e2e §3).

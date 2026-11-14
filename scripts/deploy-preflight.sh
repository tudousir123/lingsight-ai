#!/usr/bin/env bash
# Read-only check of the candidate image and its actual formal Compose environment.
set -euo pipefail
[[ $# == 1 && -f $1 ]] || {
  printf 'Usage: bash scripts/deploy-preflight.sh <private-env-file>\n' >&2
  exit 1
}
private_env=$(realpath -- "$1")
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
compose=(docker compose --env-file "$private_env" -f "$root/compose.local-production.yml")
# Compose interpolation errors may contain values from the private environment.
if ! "${compose[@]}" config --quiet >/dev/null 2>&1; then
  printf 'Deployment preflight failed: invalid Compose configuration; check required private environment keys.\n' >&2
  exit 1
fi
"${compose[@]}" run --rm --no-deps --pull never -T backend python - < "$root/backend/scripts/research_preflight.py"

#!/usr/bin/env bash
# prek biome hook (local-biome-check): prek hands us repo-root-relative paths
# (frontend/…); biome runs from the frontend workspace, so rewrite the prefix
# and use the repo-locked toolchain (bunx, bun.lock). Replaces the old
# `npm run lint` entry, which doubled the prefix (frontend/frontend/…) and
# mass-wrote the whole repo.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
files=()
for f in "$@"; do
  case "$f" in
    frontend/*) files+=("${f#frontend/}") ;;
    *) files+=("$f") ;;
  esac
done
# prek always passes at least one matching file, but stay a no-op if not.
(( ${#files[@]} )) || exit 0
biome_bin="$root/node_modules/.bin/biome"
if [[ ! -x "$biome_bin" ]]; then
  echo "prek-frontend-lint: $biome_bin 不存在（先在仓库根 bun install）" >&2
  exit 1
fi
cd "$root/frontend"
exec "$biome_bin" check --write --unsafe --no-errors-on-unmatched \
  --files-ignore-unknown=true "${files[@]}"

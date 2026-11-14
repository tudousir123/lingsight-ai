#!/usr/bin/env bash
# Committed-head preflight: same two-endpoint range as CI, never stage/reset/stash.
set -euo pipefail

fail() { printf 'Preflight refused: %s\n' "$*" >&2; exit 1; }
[[ $# == 1 && -n $1 ]] || fail 'usage: bash scripts/pr-preflight.sh <fixed-base-ref>'
root=$(git -C "$PWD" rev-parse --show-toplevel)
cd "$root"
branch=$(git -C "$root" symbolic-ref --quiet --short HEAD) || fail 'detached HEAD'
case "$branch" in main|master) fail "protected branch $branch";; esac
[[ -z $(git -C "$root" status --porcelain --untracked-files=all) ]] || fail 'tracked, index or untracked changes; commit first'
base=$(git -C "$root" rev-parse --verify --end-of-options "${1}^{commit}") || fail 'invalid base commit'
head=$(git -C "$root" rev-parse --verify HEAD)
printf 'Preflight base=%s HEAD=%s\n' "$base" "$head"
hook_status=0
uv run prek run --from-ref "$base" --to-ref "$head" --show-diff-on-failure || hook_status=$?

# Do not repair hook side effects: leave them visible for explicit review.
final_branch=$(git -C "$root" symbolic-ref --quiet --short HEAD) || fail 'hooks detached HEAD'
[[ $final_branch == "$branch" ]] || fail 'hooks changed branch'
[[ $(git -C "$root" rev-parse --verify HEAD) == "$head" ]] || fail 'hooks changed HEAD'
[[ -z $(git -C "$root" status --porcelain --untracked-files=all) ]] || fail 'hooks changed worktree or index; review and commit explicitly'
exit "$hook_status"

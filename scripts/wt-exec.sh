#!/usr/bin/env bash
# Execute an argv in an explicitly chosen worktree; never rely on caller cwd.
set -euo pipefail

if [[ "$#" -lt 4 || "$3" != -- ]]; then
  echo 'usage: bash scripts/wt-exec.sh /absolute/worktree expected-branch -- command [args...]' >&2
  exit 2
fi
target=$1
expected_branch=$2
shift 3
if [[ "$target" != /* || ! -d "$target" ]]; then
  echo 'wt-exec: target must be an absolute existing worktree path' >&2
  exit 2
fi
# Git's own list covers index/worktree/common-dir redirects as well as local config.
# Fail visibly instead of silently unsetting caller-supplied repository state.
local_git_vars=$(git rev-parse --local-env-vars)
while IFS= read -r name; do
  if [[ -n "${!name+x}" ]]; then
    echo "wt-exec: repository-local environment variable '$name' must be unset" >&2
    exit 2
  fi
done <<< "$local_git_vars"
cd -- "$target"
physical_path=$(pwd -P)
top=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo 'wt-exec: target is not a repository' >&2
  exit 2
}
if [[ "$top" != "$physical_path" ]]; then
  echo 'wt-exec: target must be the repository top-level, not a subdirectory' >&2
  exit 2
fi
branch_ref=$(git symbolic-ref --quiet HEAD) || {
  echo 'wt-exec: detached HEAD or invalid repository' >&2
  exit 2
}
if [[ "$branch_ref" != refs/heads/* ]]; then
  echo 'wt-exec: HEAD must reference a local branch' >&2
  exit 2
fi
# --short can return heads/main when a tag also names main; strip only this prefix.
branch=${branch_ref#refs/heads/}
if [[ "$branch" != "$expected_branch" ]]; then
  echo "wt-exec: branch '$branch' does not match expected '$expected_branch'" >&2
  exit 2
fi
case "$branch" in
  main|master)
    echo "wt-exec: protected branch '$branch' is not a task worktree" >&2
    exit 2
    ;;
esac
exec "$@"

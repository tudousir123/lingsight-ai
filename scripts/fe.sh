#!/usr/bin/env bash
# 前端工具链封装（本机无 bun 时用，2026-10-14 retro）。
#
# 仓库前端锁定 bun（bun.lock）；本机没装 bun/npm 也没关系——用仓库同款
# CI 同版本的 oven/bun 镜像 + 具名卷跑（依赖装在卷里不污染宿主）。
#
#   scripts/fe.sh build               # tsc + vite build（等价 CI 的 bun run build，
#                                     #               会再生成 routeTree.gen.ts）
#   scripts/fe.sh regen-routes        # vite build（顺带再生成 routeTree.gen.ts）
#   scripts/fe.sh check <files...>    # biome check（只读，不自动修复）。
#                                     # 路径相对 frontend/（如 src/features/x.ts）
#   scripts/fe.sh fix <files...>      # biome check --write（仅安全修复）。
#                                     # 路径同样相对 frontend/；不接受目录/CLI flags。
#
# check/fix 不等价于 prek：现有 prek 钩子还启用 --write --unsafe。
# 每次先在仓库根 bun ci（冻结锁文件）；依赖卷按物理 worktree + lock SHA 隔离。
#
# 注意：本机没有 bun.lock 之外的工具链时，不要用 `npm run lint`（全仓
# --write --unsafe，见 docs/agents/local-e2e.md §3）。
set -euo pipefail

cd "$(dirname "$0")/.."
# Resolve symlink aliases so the same worktree consistently reuses its own cache.
root="$(pwd -P)"

cmd="${1:-}"
shift || true

run_in_bun() {
  local lock_hash dependency_key
  lock_hash="$(sha256sum bun.lock)"
  lock_hash="${lock_hash%% *}"
  dependency_key="$(printf '%s\0%s' "$root" "$lock_hash" | sha256sum)"
  dependency_key="${dependency_key%% *}"
  # Keep old volumes; never delete another worktree's dependencies.
  docker run --rm \
    -v "$root":/app \
    -v "lingsight_fe_${dependency_key}_root":/app/node_modules \
    -v "lingsight_fe_${dependency_key}_frontend":/app/frontend/node_modules \
    -w /app/frontend \
    oven/bun:1.3.12 sh -ec '
      cd /app
      bun ci
      cd /app/frontend
      command=$1
      shift
      case "$command" in
        build) exec bun run build ;;
        regen-routes)
          bunx vite build >/dev/null
          echo routeTree.gen.ts regenerated
          ;;
        check) exec bunx biome check --no-errors-on-unmatched "$@" ;;
        fix) exec bunx biome check --write --no-errors-on-unmatched "$@" ;;
      esac
    ' fe.sh "$@"
}

# biome 在容器内以 frontend/ 为工作目录跑，文件参数必须是 frontend 相对路径；
# 仓库根相对路径会被静默当成不匹配文件（"Checked 0 files"），先挡掉（retro-4）。
files=()
require_frontend_files() {
  local f resolved
  for f in "$@"; do
    if [[ "$f" = /* || ! -f "frontend/$f" ]]; then
      echo "fe.sh: '$f' 必须是 frontend/ 相对的现存文件（如 src/features/x.ts），不能传目录。" >&2
      exit 2
    fi
    resolved="$(realpath -e -- "frontend/$f")"
    if [[ "$resolved" != "$root/frontend/"* ]]; then
      echo "fe.sh: '$f' 不能越出 frontend/（包括符号链接）。" >&2
      exit 2
    fi
    # An option-looking basename remains a filename, never a Biome flag.
    files+=("./$f")
  done
}

case "$cmd" in
  build)
    [ "$#" -eq 0 ] || { echo "usage: scripts/fe.sh build" >&2; exit 2; }
    run_in_bun "$cmd"
    ;;
  regen-routes)
    [ "$#" -eq 0 ] || { echo "usage: scripts/fe.sh regen-routes" >&2; exit 2; }
    # vite 插件在 buildStart 时再生成 routeTree；只跑 vite build 会顺带完整构建，
    # 但那是本机拿到再生成文件最省事、与 CI 同工具链的路径
    run_in_bun "$cmd"
    ;;
  check)
    [ "$#" -ge 1 ] || { echo "usage: scripts/fe.sh check <files...>" >&2; exit 2; }
    require_frontend_files "$@"
    run_in_bun "$cmd" "${files[@]}"
    ;;
  fix)
    [ "$#" -ge 1 ] || { echo "usage: scripts/fe.sh fix <files...>" >&2; exit 2; }
    require_frontend_files "$@"
    run_in_bun "$cmd" "${files[@]}"
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# 前端工具链封装（本机无 bun 时用，2026-10-14 retro）。
#
# 仓库前端锁定 bun（bun.lock）；本机没装 bun/npm 也没关系——用仓库同款
# oven/bun:1 镜像 + 具名卷跑（依赖装在卷里不污染宿主，二次起接近零等待）。
#
#   scripts/fe.sh build               # tsc + vite build（等价 CI 的 bun run build，
#                                     #               会再生成 routeTree.gen.ts）
#   scripts/fe.sh regen-routes        # 只再生成 routeTree.gen.ts（加新路由后 tsc
#                                     #               报未知路径时用）
#   scripts/fe.sh check <files...>    # biome check（只查指定文件，等价 prek 钩子
#                                     # 对改动文件的行为；--write 修复）。
#                                     # 路径相对 frontend/（如 src/features/x.ts）
#   scripts/fe.sh fix <files...>      # biome check --write（定向格式化/修复）。
#                                     # 路径同样相对 frontend/
#
# 注意：本机没有 bun.lock 之外的工具链时，不要用 `npm run lint`（全仓
# --write --unsafe，见 docs/agents/local-e2e.md §3）。
set -euo pipefail

cd "$(dirname "$0")/.."

cmd="${1:-}"
shift || true

run_in_bun() {
  docker run --rm \
    -v "$PWD":/app \
    -v lingsight_fe_bun_root:/app/node_modules \
    -v lingsight_fe_bun_frontend:/app/frontend/node_modules \
    -w /app/frontend \
    oven/bun:1 sh -c "$*"
}

# biome 在容器内以 frontend/ 为工作目录跑，文件参数必须是 frontend 相对路径；
# 仓库根相对路径会被静默当成不匹配文件（"Checked 0 files"），先挡掉（retro-4）。
require_frontend_files() {
  for f in "$@"; do
    if [ ! -e "frontend/$f" ]; then
      echo "fe.sh: '$f' 在 frontend/ 下不存在。文件参数须相对 frontend/（如 src/features/x.ts），当前传的是仓库根相对路径？" >&2
      exit 2
    fi
  done
}

case "$cmd" in
  build)
    run_in_bun "bun install >/dev/null 2>&1 && bun run build"
    ;;
  regen-routes)
    # vite 插件在 buildStart 时再生成 routeTree；只跑 vite build 会顺带完整构建，
    # 但那是本机拿到再生成文件最省事、与 CI 同工具链的路径
    run_in_bun "bun install >/dev/null 2>&1 && bunx vite build >/dev/null && echo routeTree.gen.ts regenerated"
    ;;
  check)
    [ "$#" -ge 1 ] || { echo "usage: scripts/fe.sh check <files...>" >&2; exit 2; }
    require_frontend_files "$@"
    run_in_bun "bun install >/dev/null 2>&1 && bunx biome check --no-errors-on-unmatched $*"
    ;;
  fix)
    [ "$#" -ge 1 ] || { echo "usage: scripts/fe.sh fix <files...>" >&2; exit 2; }
    require_frontend_files "$@"
    run_in_bun "bun install >/dev/null 2>&1 && bunx biome check --write --no-errors-on-unmatched $*"
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
    ;;
esac

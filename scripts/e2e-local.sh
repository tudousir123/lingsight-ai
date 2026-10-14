#! /usr/bin/env bash
# Local full-stack Playwright runner (trial-flow and friends).
#
# CI gets a fresh stack per shard (docker compose down -v); locally the
# persisted trial_review rows from the previous run would fail the
# confirmation flow, and the backend needs the fixture env from .env.
# See docs/agents/local-e2e.md for the traps this script encodes.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! grep -q "^TRIALS_FIXTURE_DIR=" .env; then
  echo "TRIALS_FIXTURE_DIR 未在 .env 中启用（backend 会以研究库模式启动，测试全部 503）。" >&2
  echo "在根 .env 取消注释 TRIALS_FIXTURE_DIR=/app/backend/app/trials/fixtures 后重试。" >&2
  exit 1
fi

echo "==> rebuilding the playwright image (tests are baked in, not mounted)"
docker compose build playwright >/dev/null

echo "==> ensuring backend matches the current .env (fixture/research mode)"
docker compose up -d --wait backend db mailpit >/dev/null

echo "==> restoring first superuser (backend pytest teardown wipes all users)"
docker compose run --rm backend bash scripts/prestart.sh >/dev/null

echo "==> clearing persisted trial reviews from the local stack"
docker compose exec -T db sh -c \
  'mysql -uapp -p"$MYSQL_PASSWORD" app -e "delete from trial_review;"'

echo "==> running playwright against the compose stack"
exec docker compose run --rm playwright bunx playwright test "$@"

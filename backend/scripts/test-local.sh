#!/usr/bin/env bash
# One disposable MySQL per run. Never starts/stops the developer's compose stack.
set -euo pipefail
cd "$(dirname "$0")/.."

test_suffix=$(uv run python -c 'import secrets; print(secrets.token_hex(6))')
test_password=$(uv run python -c 'import secrets; print(secrets.token_hex(24))')
test_database="lingsight_test_${test_suffix}"
test_container=""
test_coverage_owned=""
if [[ -z "${COVERAGE_FILE:-}" ]]; then
  export COVERAGE_FILE="${TMPDIR:-/tmp}/lingsight-coverage-${test_suffix}.sqlite"
  test_coverage_owned="$COVERAGE_FILE"
fi
cleanup() {
  if [[ -n "$test_container" ]]; then
    docker rm -f -v "$test_container" >/dev/null
  fi
  if [[ -n "$test_coverage_owned" ]]; then
    rm -f "$test_coverage_owned"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

test_container=$(docker run --detach --rm \
  --name "lingsight-tests-${test_suffix}" \
  --publish 127.0.0.1::3306 \
  --env "MYSQL_DATABASE=${test_database}" \
  --env MYSQL_USER=lingsight_test \
  --env "MYSQL_PASSWORD=${test_password}" \
  --env "MYSQL_ROOT_PASSWORD=${test_password}" \
  mysql:8.4)
test_port=$(docker port "$test_container" 3306/tcp)
export TEST_DATABASE_URL="mysql+pymysql://lingsight_test:${test_password}@${test_port}/${test_database}"

# Construct exactly the same isolated settings as pytest, then exercise the real
# application migrations. Wait for an authenticated query, not just an open port.
uv run python - <<'PY'
import time
from tests.runtime import configure_application
configure_application()
from app.core.db import engine
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from alembic import command
from alembic.config import Config
deadline = time.monotonic() + 90
while True:
    try:
        with engine.connect() as connection:
            connection.execute(text('SELECT 1'))
        break
    except OperationalError:
        if time.monotonic() >= deadline:
            raise SystemExit('Temporary test MySQL did not become ready within 90 seconds') from None
        time.sleep(1)
command.upgrade(Config('alembic.ini'), 'head')
engine.dispose()
PY

uv run coverage run -m pytest "$@"
uv run coverage report
# Publish a consistent last-run report even when independent test databases run
# concurrently. The coverage execution files themselves are per invocation.
coverage_lock=$(uv run python -c 'import hashlib, os; print("/tmp/lingsight-coverage-" + hashlib.sha256(os.getcwd().encode()).hexdigest()[:16] + ".lock")')
exec {coverage_lock_fd}>"$coverage_lock"
flock -x "$coverage_lock_fd"
if [[ "$(realpath "$COVERAGE_FILE")" != "$PWD/.coverage" ]]; then
  cp "$COVERAGE_FILE" "$PWD/.coverage"
fi
uv run coverage html --title "LingSight isolated backend tests"
flock -u "$coverage_lock_fd"

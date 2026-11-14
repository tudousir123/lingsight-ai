#!/usr/bin/env bash
# Disposable full-stack Playwright. No developer .env, host ports or data reused.
set -euo pipefail
cd "$(dirname "$0")/.."

keep_stack=0
if [[ "${1:-}" == "--keep" ]]; then
  keep_stack=1
  shift
fi
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/lingsight-e2e-XXXXXXXX")
chmod 700 "$run_dir"
export COMPOSE_PROJECT_NAME="lingsight-e2e-$(basename "$run_dir" | tr '[:upper:]' '[:lower:]')"
# Explicit exports also override ambient developer credentials/remote endpoints.
export PROJECT_NAME="LingSight E2E"
export LINGSIGHT_E2E_UID LINGSIGHT_E2E_GID
LINGSIGHT_E2E_UID=$(id -u)
LINGSIGHT_E2E_GID=$(id -g)
mkdir -p frontend/blob-report frontend/test-results
export SECRET_KEY FIRST_SUPERUSER_PASSWORD MYSQL_PASSWORD MYSQL_ROOT_PASSWORD
SECRET_KEY=$(openssl rand -hex 32)
FIRST_SUPERUSER_PASSWORD=$(openssl rand -hex 24)
MYSQL_PASSWORD=$(openssl rand -hex 24)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
export FIRST_SUPERUSER="e2e@example.com"
export SMTP_HOST=mailpit SMTP_USER= SMTP_PASSWORD= EMAILS_FROM_EMAIL=e2e@example.com
export AGENT_BASE_URL=http://unconfigured-agent:19100 AGENT_API_TOKEN= AGENT_WORKSPACE_EMAIL=
export INFERENCE_BASE_URL=http://unconfigured-inference:19200 INFERENCE_API_TOKEN= SENTRY_DSN=
# --env-file prevents Compose from loading the repository's developer .env.
: > "$run_dir/env"
compose=(docker compose --env-file "$run_dir/env" -p "$COMPOSE_PROJECT_NAME" -f compose.yml -f compose.e2e.yml)
cleanup() {
  result=$?
  trap - EXIT
  if [[ "$keep_stack" == 1 ]]; then
    echo "Kept isolated stack: $COMPOSE_PROJECT_NAME (environment: $run_dir)"
    echo "Remove with: docker compose --env-file $run_dir/env -p $COMPOSE_PROJECT_NAME -f compose.yml -f compose.e2e.yml down -v --remove-orphans"
  else
    "${compose[@]}" down -v --remove-orphans >/dev/null
    docker image rm "${COMPOSE_PROJECT_NAME}-backend:local" "${COMPOSE_PROJECT_NAME}-playwright:local" >/dev/null 2>&1 || true
    rm -rf "$run_dir"
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Persist only synthetic settings so --keep can be inspected after this shell exits.
for name in LINGSIGHT_E2E_UID LINGSIGHT_E2E_GID COMPOSE_PROJECT_NAME PROJECT_NAME SECRET_KEY FIRST_SUPERUSER FIRST_SUPERUSER_PASSWORD MYSQL_PASSWORD MYSQL_ROOT_PASSWORD SMTP_HOST SMTP_USER SMTP_PASSWORD EMAILS_FROM_EMAIL AGENT_BASE_URL AGENT_API_TOKEN AGENT_WORKSPACE_EMAIL INFERENCE_BASE_URL INFERENCE_API_TOKEN SENTRY_DSN; do
  printf '%s=%s\n' "$name" "${!name}" >> "$run_dir/env"
done
chmod 600 "$run_dir/env"
echo "Running isolated stack: $COMPOSE_PROJECT_NAME"
"${compose[@]}" build backend playwright
"${compose[@]}" run --rm backend bash scripts/prestart.sh
"${compose[@]}" up -d --wait backend mailpit
"${compose[@]}" run --rm playwright bunx playwright test --fail-on-flaky-tests --trace=retain-on-failure "$@"

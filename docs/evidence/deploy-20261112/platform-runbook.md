# T5 local production platform

## Current research catalog configuration — 2026-11-14

The formal image remains `lingsight-platform:860ebb4bc0b584d6ad43c3a5a19765ca71adc634`. The authenticated research catalog now returns 200 with data; workspace, existing project navigation, experiments and annotations were accepted in real Chromium. See [the repair and authenticated acceptance record](../deploy-20261114/README.md), including the current two-file Compose command and configuration-only rollback. Historical acceptance below is not a substitute for this release's checks.

The host-network backend must explicitly receive all five variables from the private `/home/x/.config/lingsight/platform.env` (0600):

```dotenv
RESEARCH_DB_HOST=127.0.0.1
RESEARCH_DB_PORT=13306
RESEARCH_DB_USER=lingsight_ro
RESEARCH_DB_NAME=water_maze
LINGSIGHT_RO_PASSWORD=<private-generated-password>
```

Port 13306 belongs to the existing research MySQL, distinct from application DB port 13308. The research account must have only SELECT on `water_maze.*`, no roles or grant option. Never substitute DBHub credentials with broader access. The current older Compose source needs the private `compose.research.yml` overlay; this branch's Compose declares these variables directly. Do not enable `TRIALS_FIXTURE_DIR` in production.


Before replacing the backend, run the deployment gate from the candidate checkout (not `pr-preflight.sh`, which checks committed code only):

```bash
bash scripts/deploy-preflight.sh /home/x/.config/lingsight/platform.env
# Expected: Research preflight passed: authenticated read succeeded
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml up -d --no-build --no-deps --pull never --wait --wait-timeout 180 backend
```

Stop if preflight returns nonzero. It validates the explicit formal Compose file, then starts an ephemeral container from the configured candidate image with that service's environment and host networking. It streams the checkout's probe into the image, so even an older image can be checked without rebuilding. It does not start dependencies, migrate data, replace the running backend, or publish ports. Missing/invalid configuration and an unavailable authenticated `SELECT 1` produce redacted errors. Application health alone does not establish research readiness. Re-run authenticated experiments/trials and browser acceptance after replacement; this cheap connection probe does not verify catalog schema, data, permissions scope, media or scientific correctness.

## Initial T5 deployment — historical record

Standalone runtime: `compose.local-production.yml`, project `lingsight-formal`.
The production image bundles the SPA and uses `fastapi run` on host loopback port 8000 with four workers. It has no Vite server, watch configuration, synthetic fixture mount, or development override. The dedicated MySQL 8.4 image is digest pinned; volume `lingsight-formal_app-db-data` persists the app database. The database publishes only `127.0.0.1:13308`; the dedicated `lingsight-formal` network also provides `lingsight-formal-db:3306` for the Agent's column-restricted DBHub connection. Other applications are outside this project.

Private configuration: `/home/x/.config/lingsight/platform.env`, directory mode 0700 and file mode 0600. It was reconstructed from the migration's old LingSight container configuration: original JWT secret and service tokens retained. The legacy bootstrap password failed the framework's production validation, so only that unused bootstrap setting was replaced with a random private value. Existing users and their password hashes were preserved; no initial-data script was run. Original login credentials used for acceptance are in `/home/x/.config/lingsight/acceptance-login.env` (0600). The backend receives only its required settings; it does not receive the MySQL root password. Do not print `docker compose config`, container environments, database rows, or these private files into evidence.

## Data recovery and upgrade

The original migration files are retained. The SQL backup included MySQL system tables and a historical test database, so only the `app` section was extracted and restored into the new dedicated application database. MySQL system privileges and the old test database were excluded. Foreign-key checking was disabled for the restore connection to accommodate the dump's alphabetical table order, then enabled again. The restored database had revision `d4e5f6a7b8c9` and two users. No initial-data script is run against this restored application database.

A new private logical backup was created before upgrading: `/home/x/.config/lingsight/backups/app-before-t5-20261112.sql` (0600). It contains the restored app only. The original SQL and volume archive remain untouched.

Run from the platform repository:

```bash
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml config --quiet
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml up -d --wait db
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml run --rm --no-deps backend alembic upgrade head
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml run --rm --no-deps backend alembic current
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml up -d --wait backend
curl --fail http://localhost:8000/api/v1/utils/health-check/
```

Build source is `c11077fcf9a925e20b2b3a0debfea863b5b7d3af`. The runtime image tag names that commit; the actual image ID is recorded in `platform-verification.json`. Local build used the existing host HTTP proxy through build arguments and host build networking after an unproxied dependency download stalled; no dependency lockfile was changed.

`platform-verification.json` records HTTP/API checks, actual migration head, image identities and preserved-user integrity. `platform-browser-readiness.json` records real Chromium login, valid route navigation and refresh. Browser navigation sends `Accept: text/html`, which activates FastAPI's `app.frontend(..., fallback="auto")`; a generic `*/*` probe of a frontend-only path may correctly return JSON 404. `/projects` is not a frontend index route: projects live in the sidebar and their detail route is `/projects/{id}`. No synthetic project was created for deployment checks. At the initial T5 acceptance, the research-catalog endpoint returned 503 because its legacy data source was not configured (resolved in the 2026-11-14 follow-up above); no synthetic fixture was enabled in the formal stack.

## Rollback

Stop only this backend before restoring an application snapshot. Preserve a new backup of any data created since deployment first; never restore over new user work without explicit reconciliation. This first deployment has no previous active LingSight container/image to restart. The original backups and pre-upgrade snapshot provide the recovery source.

The clean rollback is to restore `app-before-t5-20261112.sql` into a **new dedicated recovery MySQL volume**, verify its `d4e5f6a7b8c9` revision and user count, then pair it with the corresponding old platform source/image. Do not point the current production image at the old schema. Keep the current volume for recovery and comparison. The two new migrations support Alembic downgrade, but those downgrades remove project/published-result tables and must not be used after user work exists without preserving it.

To stop this deployment without deleting data:

```bash
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml stop backend db
```

Do not run `down -v`, prune volumes, restore the MySQL system schema, or touch other Compose projects. Container health and authenticated readiness do not establish scientific correctness. Real-video candidate confirmation, tracking review, publication, and conclusion acceptance must retain the researcher's actual decisions.

## Independent deployed-service acceptance

`independent-summary.json` records 50 PASS and zero FAIL against the deployed browser, APIs, database and dedicated read-only MCP. `independent-outage.json` adds an isolated exact-production-image gateway failure check: the actual UI visibly reports the normalized 503 while production remains running. Port 5174 has no listener and refuses connections. Any project/task counts in these files are observations at the recorded acceptance time, before subsequent legitimate researcher activity; they are not current-state assertions.

The QA-created temporary project was removed. No real-video confirmation, review, GPU tracking, publication or real project Agent analysis was performed by this acceptance. Issues #45 and #40 remain open. The remote inference CPU run has no captured final exit status and remains unverified; local CPU tests passed independently. Scientific conclusions still require the researcher.

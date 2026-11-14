"""Read-only research check, streamed into the candidate backend image by preflight."""

import os
import sys

from pydantic import ValidationError

from app.core.research import ResearchDatabaseSettings
from app.trials.catalog import CatalogUnavailable, read_rows


def main() -> int:
    required = (
        "RESEARCH_DB_HOST",
        "RESEARCH_DB_PORT",
        "RESEARCH_DB_USER",
        "RESEARCH_DB_NAME",
        "LINGSIGHT_RO_PASSWORD",
    )
    missing = [key for key in required if not os.environ.get(key, "").strip()]
    if missing:
        sys.stderr.write(f"Research preflight failed: missing {', '.join(missing)}\n")
        return 1
    try:
        settings = ResearchDatabaseSettings(_env_file=None)  # type: ignore[call-arg]  # BaseSettings runtime option omitted by mypy.
        if not 1 <= settings.RESEARCH_DB_PORT <= 65535:
            raise ValueError
    except ValidationError, ValueError:
        sys.stderr.write("Research preflight failed: invalid research configuration\n")
        return 1
    try:
        read_rows(settings, "SELECT 1", ())
    except CatalogUnavailable:
        sys.stderr.write("Research preflight failed: connection or read unavailable\n")
        return 1
    sys.stdout.write("Research preflight passed: authenticated read succeeded\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

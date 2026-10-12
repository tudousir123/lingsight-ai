"""Shared connection helper for the metrics scripts (M1-T3).

water_maze credentials are never hardcoded, logged, or committed: the
password arrives through the process environment only, e.g. as a single
command line:

    export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
"""

import os
import sys
from urllib.parse import quote_plus

from sqlalchemy import Engine, create_engine

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = "3306"
DEFAULT_USER = "root"
DEFAULT_NAME = "water_maze"


def metrics_engine() -> Engine:
    """Engine to the water_maze server from METRICS_DB_* environment variables."""
    password = os.environ.get("METRICS_DB_PW")
    if not password:
        sys.exit(
            "METRICS_DB_PW is required: "
            "export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)"
        )
    host = os.environ.get("METRICS_DB_HOST", DEFAULT_HOST)
    port = os.environ.get("METRICS_DB_PORT", DEFAULT_PORT)
    user = os.environ.get("METRICS_DB_USER", DEFAULT_USER)
    name = os.environ.get("METRICS_DB_NAME", DEFAULT_NAME)
    url = (
        f"mysql+pymysql://{quote_plus(user)}:{quote_plus(password)}"
        f"@{host}:{port}/{name}?charset=utf8mb4"
    )
    return create_engine(url, isolation_level="READ COMMITTED", pool_pre_ping=True)

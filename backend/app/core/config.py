"""Shared application configuration, assembled once at startup."""

from app.core.settings import Settings as Settings
from app.core.settings import get_settings

settings = get_settings()

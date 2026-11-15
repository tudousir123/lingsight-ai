"""Dedicated platform storage is opt-in; never infer a research NAS path."""

from pydantic_settings import BaseSettings, SettingsConfigDict

MAX_VIDEO_BYTES = 2_000_000_000


class MediaSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")
    PLATFORM_MEDIA_ROOT: str = ""
    PLATFORM_MEDIA_INFERENCE_SOURCE_ID: str = ""
    # Operator attests a read-only mount to the source, never a copied directory.
    PLATFORM_MEDIA_READONLY_READY: bool = False
    PLATFORM_MEDIA_TOOL_TIMEOUT: int = 1800

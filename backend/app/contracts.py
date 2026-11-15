"""Shared platform protocol values for validation and HTTP responses."""

from enum import StrEnum
from typing import Literal

DataScope = Literal["none", "project", "whole_library"]
CompletionMode = Literal["auto", "qa", "research"]


class ErrorCode(StrEnum):
    AUTHENTICATION_REQUIRED = "authentication_required"
    PERMISSION_DENIED = "permission_denied"
    RESOURCE_NOT_FOUND = "resource_not_found"
    STATE_CONFLICT = "state_conflict"
    STALE_VERSION = "stale_version"
    IDEMPOTENCY_CONFLICT = "idempotency_conflict"
    LAST_PROJECT_REFERENCE = "last_project_reference"
    FILE_TOO_LARGE = "file_too_large"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    INVALID_INPUT = "invalid_input"
    INVALID_GEOMETRY = "invalid_geometry"
    INVALID_VIDEO = "invalid_video"
    UPSTREAM_ERROR = "upstream_error"
    SERVICE_UNAVAILABLE = "service_unavailable"
    UPSTREAM_REJECTED = "upstream_rejected"
    DISPATCH_OUTCOME_UNKNOWN = "dispatch_outcome_unknown"
    CONFIRMATION_MISMATCH = "confirmation_mismatch"

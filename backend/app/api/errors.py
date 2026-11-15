"""Machine-readable validation errors for the platform's new resource APIs."""

import re

from fastapi import Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse

from app.core.config import settings

_RESOURCE_ROUTES = re.compile(
    r"/(?:users/[^/]+/whole-library-access|users/me/workspace|"
    r"internal/agent/authorize|projects/[^/]+/videos(?:/.*)?)/?"
)


async def resource_validation_error(request: Request, exc: Exception) -> JSONResponse:
    """Keep existing clients' validation shape; never echo submitted values."""
    if not isinstance(exc, RequestValidationError):
        raise exc
    path = request.url.path.removeprefix(settings.API_V1_STR)
    if not _RESOURCE_ROUTES.fullmatch(path):
        return await request_validation_exception_handler(request, exc)
    fields = {
        ".".join(str(part) for part in error["loc"]): error["msg"]
        for error in exc.errors()
    }
    geometry = any(
        field.startswith(("body.seed", "body.pool", "body.marks")) for field in fields
    )
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": "invalid_geometry" if geometry else "invalid_input",
                "message": "请求字段无效",
                "fields": fields,
            }
        },
    )

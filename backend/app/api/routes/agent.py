"""Authenticated gateway to the personal research service; state remains in Agent."""

import re
from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException, Request
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse

from app.api.deps import CurrentUser
from app.core.config import settings

router = APIRouter(prefix="/agent", tags=["agent"])
_ID = r"[0-9a-fA-F-]{36}"
_ROUTES = {
    "GET": rf"(?:tasks|tasks/{_ID}(?:/events|/bundle)?|runs/{_ID}|artifacts/{_ID})",
    "POST": rf"(?:tasks|tasks/{_ID}/messages|runs/{_ID}/(?:cancel|resume|clarifications/{_ID}/answer))",
    "PATCH": rf"artifacts/{_ID}",
}


@router.api_route("/{path:path}", methods=["GET", "POST", "PATCH"])
async def agent_gateway(
    path: str, request: Request, current_user: CurrentUser
) -> Response:
    # This is one personal workspace, not per-user isolation. Explicitly opt in
    # one ordinary account; unrelated registered accounts must not see its data.
    if not current_user.is_superuser and (
        not settings.AGENT_WORKSPACE_EMAIL
        or current_user.email.casefold() != settings.AGENT_WORKSPACE_EMAIL.casefold()
    ):
        raise HTTPException(403, "此账号尚未开通个人科研工作区")
    if not re.fullmatch(_ROUTES.get(request.method, r"(?!)"), path):
        raise HTTPException(404, "Unknown Agent operation")
    if not settings.AGENT_API_TOKEN:
        raise HTTPException(503, "科研 Agent 尚未配置，请联系管理员")

    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > 128000:
            raise HTTPException(413, "Request body too large")
    headers = {
        "Authorization": f"Bearer {settings.AGENT_API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    params: dict[str, str] = {}
    if path.endswith("/events"):
        cursor = request.query_params.get(
            "after", request.headers.get("last-event-id", "0")
        )
        if not cursor.isdecimal() or int(cursor) > 9007199254740991:
            raise HTTPException(422, "Invalid event cursor")
        params["after"] = cursor
        if "text/event-stream" in request.headers.get("accept", ""):
            headers["Accept"] = "text/event-stream"

    client = httpx.AsyncClient(timeout=httpx.Timeout(30, read=60), trust_env=False)
    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                f"{settings.AGENT_BASE_URL.rstrip('/')}/v1/{path}",
                headers=headers,
                params=params,
                content=bytes(payload),
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(503, "暂时无法连接科研 Agent，请稍后重试")

    async def close() -> None:
        await upstream.aclose()
        await client.aclose()

    if upstream.status_code in (401, 403) or upstream.status_code >= 500:
        await close()
        raise HTTPException(502, "科研 Agent 服务暂时不可用，请联系管理员")
    if 300 <= upstream.status_code < 400:
        await close()
        raise HTTPException(502, "Unexpected Agent redirect")

    async def chunks() -> AsyncIterator[bytes]:
        try:
            async for data in upstream.aiter_bytes():
                yield data
        finally:
            await close()

    response_headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
        "Content-Security-Policy": "sandbox; default-src 'none'",
    }
    for key in ("content-type", "content-disposition", "etag"):
        if value := upstream.headers.get(key):
            response_headers[key] = value
    return StreamingResponse(
        chunks(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(close),
    )

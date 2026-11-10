"""Restricted gateway to the personal video inference service."""

import re
from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException, Request
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.api.deps import CurrentUser
from app.api.routes.trials import MediaUserDep
from app.core.config import settings
from app.models import User

router = APIRouter(prefix="/inference", tags=["inference"])
_ID = r"[0-9a-fA-F-]{36}"
_ROUTES = {
    "GET": rf"(?:videos|tasks|tasks/{_ID})",
    "POST": rf"(?:tasks|tasks/{_ID}/(?:confirm|cancel|retry|review))",
}
_ARTIFACT = rf"tasks/{_ID}/artifacts/(?:candidate\.jpg|overlay\.mp4|tracking\.json|keypoints\.json|provenance\.json)"


def _authorize(user: User) -> None:
    if not user.is_superuser and (
        not settings.AGENT_WORKSPACE_EMAIL
        or user.email.casefold() != settings.AGENT_WORKSPACE_EMAIL.casefold()
    ):
        raise HTTPException(403, "此账号尚未开通个人科研工作区")


async def _forward(path: str, request: Request, user: User) -> StreamingResponse:
    _authorize(user)
    if not settings.INFERENCE_API_TOKEN:
        raise HTTPException(503, "视频推理服务尚未配置")
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > 512000:
            raise HTTPException(413, "Request body too large")
    headers = {
        "Authorization": f"Bearer {settings.INFERENCE_API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": request.headers.get("accept", "application/json"),
    }
    if value := request.headers.get("range"):
        headers["Range"] = value
    params = {"path": request.query_params.get("path", "")} if path == "videos" else {}
    client = httpx.AsyncClient(timeout=httpx.Timeout(30, read=120), trust_env=False)
    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                f"{settings.INFERENCE_BASE_URL.rstrip('/')}/v1/{path}",
                headers=headers,
                params=params,
                content=bytes(payload),
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(503, "暂时无法连接视频推理服务")
    if (
        upstream.status_code in (401, 403)
        or upstream.status_code >= 500
        or 300 <= upstream.status_code < 400
    ):
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(502, "视频推理服务暂时不可用")

    async def close() -> None:
        await upstream.aclose()
        await client.aclose()

    async def chunks() -> AsyncIterator[bytes]:
        try:
            async for data in upstream.aiter_bytes():
                yield data
        finally:
            await close()

    response_headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
    }
    for key in (
        "content-type",
        "content-disposition",
        "content-range",
        "accept-ranges",
        "content-length",
    ):
        if value := upstream.headers.get(key):
            response_headers[key] = value
    return StreamingResponse(
        chunks(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(close),
    )


@router.get("/{path:path}/artifacts/{name}")
async def inference_artifact(
    path: str, name: str, request: Request, current_user: MediaUserDep
) -> StreamingResponse:
    full = f"{path}/artifacts/{name}"
    if not re.fullmatch(_ARTIFACT, full):
        raise HTTPException(404, "Unknown inference operation")
    return await _forward(full, request, current_user)


@router.api_route("/{path:path}", methods=["GET", "POST"])
async def inference_gateway(
    path: str, request: Request, current_user: CurrentUser
) -> StreamingResponse:
    if not re.fullmatch(_ROUTES.get(request.method, r"(?!)"), path):
        raise HTTPException(404, "Unknown inference operation")
    return await _forward(path, request, current_user)

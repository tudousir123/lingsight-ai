"""Authenticated gateway to the personal research service; state remains in Agent."""

from fastapi import APIRouter, Request, Response

from app.api.deps import CurrentUser, ensure_workspace_user
from app.api.gateway import (
    UUID_PATTERN,
    GatewayPolicy,
    OperationTable,
    UpstreamService,
    forward,
)
from app.core.config import settings

router = APIRouter(prefix="/agent", tags=["agent"])

# Declared operation surface. The platform whitelist and the generated
# frontend route templates (frontend/src/lib/upstreamRoutes.gen.ts) render
# from this one table; scripts/export_frontend_routes.py keeps them in sync.
OPERATIONS = OperationTable(
    operations={
        "GET": (
            "tasks",
            "tasks/{task_id}",
            "tasks/{task_id}/events",
            "tasks/{task_id}/bundle",
            "runs/{run_id}",
            "artifacts/{artifact_id}",
        ),
        "POST": (
            "tasks",
            "tasks/{task_id}/messages",
            "runs/{run_id}/cancel",
            "runs/{run_id}/resume",
            "runs/{run_id}/clarifications/{clarification_id}/answer",
        ),
        "PATCH": ("artifacts/{artifact_id}",),
    },
    params={
        "task_id": UUID_PATTERN,
        "run_id": UUID_PATTERN,
        "artifact_id": UUID_PATTERN,
        "clarification_id": UUID_PATTERN,
    },
)

# 128_000 covers task/chat JSON payloads; 60 s covers JSON responses (this
# service streams events, not media).
POLICY = GatewayPolicy(body_cap_bytes=128_000, read_timeout_s=60, sse_cursor=True)

UNKNOWN_OPERATION = "Unknown Agent operation"


def _service() -> UpstreamService:
    return UpstreamService(
        base_url=settings.AGENT_BASE_URL,
        api_token=settings.AGENT_API_TOKEN,
        unconfigured_detail="科研 Agent 尚未配置，请联系管理员",
        connect_error_detail="暂时无法连接科研 Agent，请稍后重试",
        upstream_error_detail="科研 Agent 服务暂时不可用，请联系管理员",
        redirect_detail="Unexpected Agent redirect",
    )


@router.api_route("/{path:path}", methods=["GET", "POST", "PATCH"])
async def agent_gateway(
    path: str, request: Request, current_user: CurrentUser
) -> Response:
    ensure_workspace_user(current_user)
    OPERATIONS.check(request.method, path, UNKNOWN_OPERATION)
    return await forward(request, path, _service(), POLICY)

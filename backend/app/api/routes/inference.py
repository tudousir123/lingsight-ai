"""Restricted gateway to the personal video inference service."""

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from app.api.deps import CurrentUser, MediaUserDep, ensure_workspace_user
from app.api.gateway import (
    UUID_PATTERN,
    GatewayPolicy,
    LiteralSet,
    OperationTable,
    UpstreamService,
    forward,
)
from app.core.config import settings

router = APIRouter(prefix="/inference", tags=["inference"])

# Declared operation surface; same single-source role as the agent table
# (platform whitelist + generated frontend route templates).
OPERATIONS = OperationTable(
    operations={
        "GET": (
            "sources",
            "videos",
            "tasks",
            "tasks/{task_id}",
            "tasks/{task_id}/artifacts/{artifact_name}",
        ),
        "POST": (
            "tasks",
            "tasks/{task_id}/confirm",
            "tasks/{task_id}/cancel",
            "tasks/{task_id}/retry",
            "tasks/{task_id}/review",
        ),
    },
    params={
        "task_id": UUID_PATTERN,
        "artifact_name": LiteralSet(
            (
                "candidate.jpg",
                "overlay.mp4",
                "tracking.json",
                "keypoints.json",
                "provenance.json",
            )
        ),
    },
)

# 512_000 covers polygon confirmation payloads; 120 s covers overlay video
# streaming. Range and the directory listing's ?path= are this service's
# special cases.
POLICY = GatewayPolicy(
    body_cap_bytes=512_000,
    read_timeout_s=120,
    range_streaming=True,
    forward_client_accept=True,
    forward_path_query_routes=frozenset({"videos"}),
    forward_query_parameters={"videos": ("source_id",)},
)

UNKNOWN_OPERATION = "Unknown inference operation"


def _service() -> UpstreamService:
    return UpstreamService(
        base_url=settings.INFERENCE_BASE_URL,
        api_token=settings.INFERENCE_API_TOKEN,
        unconfigured_detail="视频推理服务尚未配置",
        connect_error_detail="暂时无法连接视频推理服务",
        upstream_error_detail="视频推理服务暂时不可用",
    )


@router.get("/{path:path}/artifacts/{name}")
async def inference_artifact(
    path: str, name: str, request: Request, current_user: MediaUserDep
) -> StreamingResponse:
    # Media elements cannot send an Authorization header, so artifacts
    # authenticate through deps.get_media_user (header or ?token=).
    full = f"{path}/artifacts/{name}"
    OPERATIONS.check("GET", full, UNKNOWN_OPERATION)
    ensure_workspace_user(current_user)
    return await forward(request, full, _service(), POLICY)


@router.api_route("/{path:path}", methods=["GET", "POST"])
async def inference_gateway(
    path: str, request: Request, current_user: CurrentUser
) -> StreamingResponse:
    OPERATIONS.check(request.method, path, UNKNOWN_OPERATION)
    ensure_workspace_user(current_user)
    return await forward(request, path, _service(), POLICY)

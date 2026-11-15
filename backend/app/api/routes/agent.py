"""Authenticated gateway to the personal research service; state remains in Agent."""

import json
import uuid

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from app.api.deps import CurrentUser, SessionDep, ensure_workspace_user, owned_project
from app.api.gateway import (
    UUID_PATTERN,
    GatewayPolicy,
    OperationTable,
    UpstreamService,
    forward,
    read_payload,
)
from app.contracts import (
    AGENT_BROWSER_CONTRACT,
    AGENT_BROWSER_PROFILE,
    CompletionMode,
    DataScope,
    ErrorCode,
)
from app.core.config import settings
from app.scope import capable_agent, has_whole_library_access

router = APIRouter(prefix="/agent", tags=["agent"])

# Declared operation surface. The platform whitelist and the generated
# frontend route templates (frontend/src/lib/upstreamRoutes.gen.ts) render
# from this one table; scripts/export_frontend_routes.py keeps them in sync.
OPERATIONS = OperationTable(
    operations={
        "GET": (
            "capabilities",
            "inputs",
            "personal-agent",
            "memories",
            "tasks/{task_id}/memories",
            "tasks",
            "tasks/{task_id}",
            "tasks/{task_id}/events",
            "tasks/{task_id}/bundle",
            "runs/{run_id}",
            "runs/{run_id}/operations",
            "runs/{run_id}/browser-grants",
            "artifacts/{artifact_id}",
        ),
        "POST": (
            "inputs",
            "tasks",
            "tasks/{task_id}/messages",
            "runs/{run_id}/cancel",
            "runs/{run_id}/resume",
            "runs/{run_id}/browser-grants",
            "runs/{run_id}/operations/{operation_id}/verify",
            "runs/{run_id}/operations/{operation_id}/resolve",
            "runs/{run_id}/clarifications/{clarification_id}/answer",
        ),
        "PATCH": ("artifacts/{artifact_id}",),
    },
    params={
        "task_id": UUID_PATTERN,
        "run_id": UUID_PATTERN,
        "artifact_id": UUID_PATTERN,
        "clarification_id": UUID_PATTERN,
        "operation_id": UUID_PATTERN,
    },
)

# 128_000 covers task/chat JSON payloads; 60 s covers JSON responses (this
# service streams events, not media).
POLICY = GatewayPolicy(
    body_cap_bytes=128_000, read_timeout_s=60, sse_cursor=True, agent_errors=True
)
CAPABILITY_POLICY = GatewayPolicy(body_cap_bytes=0, read_timeout_s=5)

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


async def ensure_project_support(
    request: Request,
    service: UpstreamService,
    *,
    project: bool = False,
    personal: bool = False,
    execution: bool = False,
    files: bool = False,
    memory: bool = False,
    operations: bool = False,
    browser: bool = False,
) -> None:
    """Refuse old Agent versions before they can create an unscoped task."""
    unavailable = "科研 Agent 项目分析尚未就绪，请先更新服务并配置项目数据源"
    if memory:
        unavailable = "个人偏好记忆尚未就绪，请先更新科研 Agent 服务"
    if personal:
        unavailable = "个人 Agent 持久工作环境尚未就绪，请先更新服务"
    if execution:
        unavailable = "Pi Durable 执行能力未配置或协议不兼容，已禁用新执行"
    if operations:
        unavailable = "工具操作核验协议不兼容，请更新科研 Agent 服务"
    if files:
        unavailable = "受控文件能力不兼容，已禁用文件输入"
    if browser:
        unavailable = "受控浏览器未配置或授权协议不兼容"
    probe = Request({**request.scope, "method": "GET", "query_string": b""})
    try:
        response = await forward(
            probe, "capabilities", service, CAPABILITY_POLICY, payload=b""
        )
        try:
            if response.status_code != 200:
                raise HTTPException(503, unavailable)
            payload = bytearray()
            async for chunk in response.body_iterator:
                payload.extend(chunk.encode() if isinstance(chunk, str) else chunk)
                if len(payload) > 4096:
                    raise HTTPException(503, unavailable)
            capabilities = json.loads(payload)
            runtime = (
                capabilities.get("execution")
                if isinstance(capabilities, dict)
                else None
            )
            if (
                not capable_agent(capabilities, project=project)
                or (
                    personal
                    and (
                        capabilities.get("personal_agent") != "persistent-v1"
                        or capabilities.get("environment") != "task-workspace-v1"
                    )
                )
                or (
                    memory
                    and capabilities.get("personal_memory") != "personal-memory-v1"
                )
            ):
                raise HTTPException(503, unavailable)
            if operations and (
                not isinstance(runtime, dict)
                or runtime.get("operations") != "ledger-v1"
                or runtime.get("cancellation") != "verified-v1"
            ):
                raise HTTPException(503, unavailable)
            if browser:
                controlled = capabilities.get("browser")
                if (
                    not isinstance(controlled, dict)
                    or controlled.get("contract") != AGENT_BROWSER_CONTRACT
                    or controlled.get("enabled") is not True
                    or controlled.get("profile") != AGENT_BROWSER_PROFILE
                    or controlled.get("javascript") is not False
                    or controlled.get("downloads") is not False
                ):
                    raise HTTPException(503, unavailable)
            if files and capabilities.get("files") != "controlled-files-v1":
                raise HTTPException(503, unavailable)
            if execution and (
                not isinstance(runtime, dict)
                or runtime.get("contract") != "durable-run-v1"
                or runtime.get("engine") != "pi-durable"
                or runtime.get("version") != "1.5.2"
                or runtime.get("requests") != "persistent-v1"
                or runtime.get("recovery") != "safe-v1"
                or runtime.get("operations") != "ledger-v1"
                or runtime.get("cancellation") != "verified-v1"
                or runtime.get("enabled") is not True
            ):
                raise HTTPException(503, unavailable)
        finally:
            if response.background is not None:
                await response.background()
    except HTTPException, ValueError, UnicodeDecodeError, httpx.HTTPError:
        raise HTTPException(503, unavailable) from None


class RequestIdentity(BaseModel):
    request_id: uuid.UUID | None = None

    @field_validator("request_id", mode="before")
    @classmethod
    def non_null_request_id(cls, value: object) -> object:
        if value is None:
            raise ValueError("request_id cannot be null")
        return value


class TaskInput(RequestIdentity):
    model_config = ConfigDict(extra="forbid")
    goal: str = Field(min_length=1, max_length=12000)
    input_ids: list[uuid.UUID] = Field(default_factory=list, max_length=8)
    project_id: uuid.UUID | None = None
    data_scope: DataScope | None = None
    completion_mode: CompletionMode = "auto"

    @field_validator("goal", mode="before")
    @classmethod
    def trim_goal(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def scope_combination(self) -> TaskInput:
        if "data_scope" in self.model_fields_set and self.data_scope is None:
            raise ValueError("data_scope cannot be null")
        self.data_scope = self.data_scope or (
            "project" if "project_id" in self.model_fields_set else "none"
        )
        if self.data_scope == "project" and self.project_id is None:
            raise ValueError("project scope requires project_id")
        if self.data_scope != "project" and "project_id" in self.model_fields_set:
            raise ValueError("project_id is forbidden for this scope")
        return self


class MessageInput(RequestIdentity):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=12000)
    completion_mode: CompletionMode = "auto"

    @field_validator("text", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


@router.api_route("/{path:path}", methods=["GET", "POST", "PATCH"])
async def agent_gateway(
    path: str, request: Request, current_user: CurrentUser, session: SessionDep
) -> Response:
    ensure_workspace_user(current_user)
    OPERATIONS.check(request.method, path, UNKNOWN_OPERATION)
    operation_review = "/operations" in path
    memory_read = request.method == "GET" and (
        path == "memories" or path.endswith("/memories")
    )
    if (
        path in {"personal-agent", "capabilities"}
        or memory_read
        or (operation_review and request.method == "GET")
    ) and (
        request.query_params
        or request.headers.get("content-length", "0") != "0"
        or request.headers.get("transfer-encoding")
    ):
        raise HTTPException(
            422, "Personal identity and memory reads accept no selectors or body"
        )
    service = _service()
    if not service.api_token:
        raise HTTPException(503, service.unconfigured_detail)
    if path == "capabilities":
        return await forward(
            request,
            path,
            service,
            CAPABILITY_POLICY,
            payload=b"",
            trusted_user_id=str(current_user.id),
        )
    payload = await read_payload(request, POLICY)
    project_scope = False
    file_scope = path == "inputs"
    browser_scope = path.endswith("/browser-grants")
    if browser_scope and (
        request.query_params or (request.method == "GET" and payload)
    ):
        raise HTTPException(422, "Browser selectors are forbidden")
    if file_scope and request.query_params:
        raise HTTPException(422, "Material selectors are forbidden")
    if request.method in {"POST", "PATCH"} and (
        payload or path == "tasks" or path.endswith("/messages")
    ):
        if (
            request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            != "application/json"
        ):
            raise HTTPException(
                415,
                {
                    "code": ErrorCode.UNSUPPORTED_MEDIA_TYPE,
                    "message": "Expected application/json",
                },
            )
    if request.method == "POST" and (path == "tasks" or path.endswith("/messages")):
        try:
            body = json.loads(payload)
        except ValueError, UnicodeDecodeError:
            raise HTTPException(
                400, {"code": ErrorCode.INVALID_INPUT, "message": "Invalid JSON"}
            ) from None
        try:
            parsed = (
                TaskInput.model_validate(body)
                if path == "tasks"
                else MessageInput.model_validate(body)
            )
        except ValidationError as error:
            raise HTTPException(
                422,
                {
                    "code": ErrorCode.INVALID_INPUT,
                    "message": "Invalid task input",
                    "fields": {
                        ".".join(map(str, item["loc"])) or "body": item["msg"]
                        for item in error.errors()
                    },
                },
            ) from None
        if isinstance(parsed, TaskInput):
            if parsed.project_id is not None:
                owned_project(session, current_user, parsed.project_id)
                project_scope = True
            if parsed.data_scope == "whole_library" and not has_whole_library_access(
                session, current_user
            ):
                raise HTTPException(
                    403,
                    {
                        "code": ErrorCode.PERMISSION_DENIED,
                        "message": "Whole-library access denied",
                    },
                )
        # Do not send project_id:null for none/whole_library: Agent distinguishes
        # a missing field from an invalid explicit null on task creation.
        file_scope = isinstance(parsed, TaskInput) and bool(parsed.input_ids)
        payload = parsed.model_dump_json(
            exclude_none=True,
            exclude={"input_ids"}
            if isinstance(parsed, TaskInput) and not parsed.input_ids
            else set(),
        ).encode()
    # Validate cursor before making the capability probe, including malformed IDs.
    if path.endswith("/events"):
        from app.api.gateway import MAX_CURSOR

        cursor = request.query_params.get(
            "after", request.headers.get("last-event-id", "0")
        )
        if not cursor.isdecimal() or int(cursor) > MAX_CURSOR:
            raise HTTPException(422, "Invalid event cursor")
    await ensure_project_support(
        request,
        service,
        project=project_scope,
        files=file_scope,
        execution=request.method == "POST"
        and path != "inputs"
        and not path.endswith("/cancel")
        and not operation_review,
        operations=operation_review or browser_scope,
        browser=browser_scope,
        memory=memory_read,
        personal=path == "personal-agent"
        or (path == "tasks" and request.method == "POST"),
    )
    return await forward(
        request,
        path,
        service,
        POLICY,
        payload=payload,
        trusted_user_id=str(current_user.id),
    )

"""Gateway kernel: the single definition of upstream forwarding policy.

Both upstream gateways (research Agent, video inference) forward through
``forward()``. A gateway adapter is nothing but its operation table
(``OperationTable``), its service endpoint and copy (``UpstreamService``) and
its policy knobs (``GatewayPolicy``) — differences between the services are
explicit fields, never divergent copies of the forwarding skeleton. The
concrete knob values per service and the reasons they must stay different
live in the adapters and ADR-0015, not here:

- ``body_cap_bytes`` / ``read_timeout_s``: request-body ceiling and upstream
  read timeout.
- ``sse_cursor``: validates the event-log cursor on ``*/events`` and disables
  response buffering for event streams.
- ``range_streaming``: Range request passthrough plus content-range /
  accept-ranges / content-length response passthrough for video streaming;
  non-streaming services get ETag passthrough instead.
- ``forward_client_accept``: honor the caller's Accept header verbatim.
- ``forward_path_query_routes``: routes whose ``path`` query parameter is
  forwarded upstream.

Adapters run their own workspace gate and operation-whitelist check in their
historical order before calling ``forward()``; ``forward()`` owns everything
from the service-token check onwards.
"""

import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field

import httpx
from fastapi import HTTPException, Request
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

CONNECT_TIMEOUT_S = 30
MAX_CURSOR = 9007199254740991  # 2**53 - 1, the SSE event-cursor ceiling
UUID_PATTERN = r"[0-9a-fA-F-]{36}"


@dataclass(frozen=True)
class LiteralSet:
    """A closed set of literal segment values, e.g. artifact file names."""

    values: tuple[str, ...]

    def pattern(self) -> str:
        return "(?:" + "|".join(re.escape(value) for value in self.values) + ")"


@dataclass
class OperationTable:
    """Declarative operation surface: HTTP method -> path patterns.

    Patterns are ``/``-separated segments; ``{name}`` segments render through
    ``params`` (a raw regex fragment or a ``LiteralSet``), every other segment
    is escaped literally. The whitelist regex is rendered here only — adapters
    never hand-write one, and the frontend route templates are generated from
    these same tables (scripts/export_frontend_routes.py).
    """

    operations: Mapping[str, tuple[str, ...]]
    params: Mapping[str, str | LiteralSet] = field(default_factory=dict)
    _compiled: dict[str, re.Pattern[str]] = field(
        init=False, repr=False, compare=False, default_factory=dict
    )

    def __post_init__(self) -> None:
        for method, patterns in self.operations.items():
            self._compiled[method] = re.compile(
                "(?:" + "|".join(self._render(pattern) for pattern in patterns) + ")"
            )

    def _render(self, pattern: str) -> str:
        segments = []
        for segment in pattern.split("/"):
            if match := re.fullmatch(r"\{(\w+)\}", segment):
                param = self.params.get(match.group(1))
                if param is None:
                    raise ValueError(
                        f"undeclared route param {segment!r} in pattern {pattern!r}"
                    )
                segments.append(
                    param.pattern() if isinstance(param, LiteralSet) else param
                )
            else:
                segments.append(re.escape(segment))
        return "/".join(segments)

    def allows(self, method: str, path: str) -> bool:
        compiled = self._compiled.get(method)
        return compiled is not None and compiled.fullmatch(path) is not None

    def check(self, method: str, path: str, unknown_detail: str) -> None:
        if not self.allows(method, path):
            raise HTTPException(404, unknown_detail)


@dataclass(frozen=True)
class UpstreamService:
    """Where to reach a service, and what to tell the user when it fails."""

    base_url: str
    api_token: str
    unconfigured_detail: str
    connect_error_detail: str
    upstream_error_detail: str
    # None folds redirects into upstream_error_detail (inference); the Agent
    # keeps its own redirect wording.
    redirect_detail: str | None = None


@dataclass(frozen=True)
class GatewayPolicy:
    body_cap_bytes: int
    read_timeout_s: int
    sse_cursor: bool = False
    range_streaming: bool = False
    forward_client_accept: bool = False
    forward_path_query_routes: frozenset[str] = frozenset()


async def forward(
    request: Request, path: str, upstream: UpstreamService, policy: GatewayPolicy
) -> StreamingResponse:
    """Forward one whitelisted request upstream under the platform policy."""
    if not upstream.api_token:
        raise HTTPException(503, upstream.unconfigured_detail)
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > policy.body_cap_bytes:
            raise HTTPException(413, "Request body too large")
    headers = {
        "Authorization": f"Bearer {upstream.api_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if policy.forward_client_accept:
        headers["Accept"] = request.headers.get("accept", "application/json")
    params: dict[str, str] = {}
    if policy.sse_cursor and path.endswith("/events"):
        cursor = request.query_params.get(
            "after", request.headers.get("last-event-id", "0")
        )
        if not cursor.isdecimal() or int(cursor) > MAX_CURSOR:
            raise HTTPException(422, "Invalid event cursor")
        params["after"] = cursor
        if "text/event-stream" in request.headers.get("accept", ""):
            headers["Accept"] = "text/event-stream"
    if policy.range_streaming and (value := request.headers.get("range")):
        headers["Range"] = value
    if path in policy.forward_path_query_routes:
        params["path"] = request.query_params.get("path", "")

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(CONNECT_TIMEOUT_S, read=policy.read_timeout_s),
        trust_env=False,
    )
    try:
        upstream_response = await client.send(
            client.build_request(
                request.method,
                f"{upstream.base_url.rstrip('/')}/v1/{path}",
                headers=headers,
                params=params,
                content=bytes(payload),
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(503, upstream.connect_error_detail)

    async def close() -> None:
        await upstream_response.aclose()
        await client.aclose()

    if (
        upstream_response.status_code in (401, 403)
        or upstream_response.status_code >= 500
    ):
        await close()
        raise HTTPException(502, upstream.upstream_error_detail)
    if 300 <= upstream_response.status_code < 400:
        await close()
        raise HTTPException(
            502,
            upstream.redirect_detail
            if upstream.redirect_detail is not None
            else upstream.upstream_error_detail,
        )

    async def chunks() -> AsyncIterator[bytes]:
        try:
            async for data in upstream_response.aiter_bytes():
                yield data
        finally:
            await close()

    response_headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
    }
    if policy.sse_cursor:
        # Event streams must pass fronting proxies unbuffered.
        response_headers["X-Accel-Buffering"] = "no"
    passthrough = ["content-type", "content-disposition"]
    passthrough += (
        ["content-range", "accept-ranges", "content-length"]
        if policy.range_streaming
        else ["etag"]
    )
    for key in passthrough:
        if value := upstream_response.headers.get(key):
            response_headers[key] = value
    return StreamingResponse(
        chunks(),
        status_code=upstream_response.status_code,
        headers=response_headers,
        background=BackgroundTask(close),
    )

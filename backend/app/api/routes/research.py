"""Research query endpoint: natural language in, structured answer out.

The thinnest end-to-end Text-to-SQL seam (ticket #5): question → semantic
context → Model Gateway → SQLGlot validation → bounded repair → `lingsight_ro`
execution → answer with caliber note, or a typed rejection. Authentication
follows the template convention (bearer token, like every other route).
"""

import json
import logging
import queue
import threading
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.text_to_sql.gateway import Provider, build_provider
from app.text_to_sql.pipeline import (
    QueryProgress,
    ResearchQueryAnswer,
    ResearchQueryPipeline,
    ResearchQueryRejection,
)
from app.text_to_sql.settings import (
    ResearchQuerySettings,
    get_research_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/research", tags=["research"])

#: Typed rejections map onto HTTP statuses clients can branch on.
_REJECTION_STATUS: dict[str, int] = {
    "parse_error": 400,
    "non_select": 400,
    "db_not_allowed": 403,
    "whitelist_violation": 403,
    "ambiguous_column": 403,
    "execution_error": 502,
    "timeout": 504,
    "provider_error": 502,
}

#: SSE responses must not be buffered by anything between us and the client.
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

_StreamItem = QueryProgress | ResearchQueryAnswer | ResearchQueryRejection | None


class ResearchQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


def get_query_provider() -> Provider:
    """Model Gateway wired from env (LLM_BASE_URL/LLM_API_KEY/LLM_MODEL)."""
    return build_provider(get_research_settings())


@router.post("/query", response_model=None)
def research_query(
    request: ResearchQueryRequest,
    _current_user: CurrentUser,
    provider: Annotated[Provider, Depends(get_query_provider)],
    settings: Annotated[ResearchQuerySettings, Depends(get_research_settings)],
) -> Any:
    """Answer one research question from the whitelisted `water_maze` tables.

    The user dependency is load-bearing (bearer-token auth, template
    convention) even though its value is not read here.
    """
    pipeline = ResearchQueryPipeline(settings=settings, provider=provider)
    outcome = pipeline.run(request.question)
    if isinstance(outcome, ResearchQueryAnswer):
        return outcome
    assert isinstance(outcome, ResearchQueryRejection)
    return JSONResponse(
        status_code=_REJECTION_STATUS.get(outcome.reason_code, 400),
        content=outcome.model_dump(),
    )


def _stream_events(
    question: str, *, provider: Provider, settings: ResearchQuerySettings
) -> Iterator[str]:
    """Yield SSE lines from a worker thread running the pipeline (ticket #24).

    The pipeline stays synchronous (ADR-0001); progress reaches the stream
    through a queue. An unexpected worker crash ends the stream without a
    result event — clients treat a result-less stream as a failure rather
    than the endpoint inventing a typed rejection it never produced.

    On client disconnect the generator closes but the daemon worker still
    finishes its bounded, read-only run (≤3 LLM calls + 1 MySQL SELECT);
    its remaining events land in an abandoned queue and are dropped.
    """
    events: queue.Queue[_StreamItem] = queue.Queue()

    def worker() -> None:
        try:
            pipeline = ResearchQueryPipeline(settings=settings, provider=provider)
            events.put(pipeline.run(question, on_stage=events.put))
        except Exception:
            logger.exception("research_query_stream worker crashed")
        finally:
            events.put(None)

    threading.Thread(target=worker, daemon=True, name="research-query-stream").start()
    while True:
        item = events.get()
        if item is None:
            return
        payload = item.model_dump()
        # Assigned after the splat-shaped build so a future model field
        # named "type" can never overwrite the wire discriminator.
        payload["type"] = "stage" if isinstance(item, QueryProgress) else "result"
        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/query/stream", response_model=None)
def research_query_stream(
    request: ResearchQueryRequest,
    _current_user: CurrentUser,
    provider: Annotated[Provider, Depends(get_query_provider)],
    settings: Annotated[ResearchQuerySettings, Depends(get_research_settings)],
) -> StreamingResponse:
    """SSE twin of ``/query``: real stage events, then one result event.

    The stream always starts HTTP 200 once authentication passes; the typed
    rejection's reason code travels inside the final ``result`` event payload
    (isomorphic to the synchronous endpoint's body) instead of the HTTP
    status, which cannot change mid-stream.
    """
    return StreamingResponse(
        _stream_events(question=request.question, provider=provider, settings=settings),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )

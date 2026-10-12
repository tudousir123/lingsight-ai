"""Research query endpoint: natural language in, structured answer out.

The thinnest end-to-end Text-to-SQL seam (ticket #5): question → semantic
context → Model Gateway → SQLGlot validation → bounded repair → `lingsight_ro`
execution → answer with caliber note, or a typed rejection. Authentication
follows the template convention (bearer token, like every other route).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.text_to_sql.gateway import OpenAICompatProvider, Provider
from app.text_to_sql.pipeline import (
    ResearchQueryAnswer,
    ResearchQueryPipeline,
    ResearchQueryRejection,
)
from app.text_to_sql.settings import (
    ResearchQuerySettings,
    get_research_settings,
)

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


class ResearchQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


def get_query_provider() -> Provider:
    """Model Gateway wired from env (LLM_BASE_URL/LLM_API_KEY/LLM_MODEL)."""
    return OpenAICompatProvider.from_settings(get_research_settings())


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

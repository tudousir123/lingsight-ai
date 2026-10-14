"""Drift tripwire: the frontend reason-code labels mirror backend types.

The QA page (ticket #25) hand-writes ``REASON_LABELS`` / ``RETRYABLE_REASONS``
because the research endpoints declare ``response_model=None`` and OpenAPI
cannot carry the union (CODING_STANDARDS 单一来源 acknowledges the mirror;
this test is the guard that keeps it from drifting silently).

Rules locked here:
- every ``ReasonCode`` literal has exactly one frontend label;
- the frontend retryable set is exactly the HTTP 502/504 family declared in
  ``_REJECTION_STATUS`` (transport-class failures worth one click of retry).
"""

import re
from pathlib import Path
from typing import get_args

from app.api.routes.research import _REJECTION_STATUS
from app.text_to_sql.validator import ReasonCode

_FRONTEND_PAGE = (
    Path(__file__).resolve().parents[3]
    / "frontend"
    / "src"
    / "features"
    / "qa"
    / "qa-page.tsx"
)


def _extract_keys(source: str, marker: str) -> set[str]:
    match = re.search(
        rf"{re.escape(marker)}[^=]*=\s*{{(.*?)}}", source, re.DOTALL
    )
    assert match, f"{marker} not found in {_FRONTEND_PAGE}"
    # 键是裸标识符（parse_error: "…"），按行首匹配避免抓到文案里的冒号
    return set(re.findall(r"^\s*([a-z_]+)\s*:", match.group(1), re.MULTILINE))


def _extract_set_values(source: str, marker: str) -> set[str]:
    match = re.search(
        rf"{re.escape(marker)}[^=]*=\s*new Set\(\[(.*?)\]\)", source, re.DOTALL
    )
    assert match, f"{marker} not found in {_FRONTEND_PAGE}"
    return set(re.findall(r'"([a-z_]+)"', match.group(1)))


def test_frontend_reason_labels_cover_exactly_the_backend_codes() -> None:
    source = _FRONTEND_PAGE.read_text(encoding="utf-8")
    labels = _extract_keys(source, "REASON_LABELS")
    backend = set(get_args(ReasonCode))
    missing = backend - labels
    extra = labels - backend
    assert not missing, f"前端缺标签: {sorted(missing)}"
    assert not extra, f"前端多出未知 code: {sorted(extra)}"


def test_frontend_retryable_set_matches_the_502_504_family() -> None:
    source = _FRONTEND_PAGE.read_text(encoding="utf-8")
    retryable = _extract_set_values(source, "RETRYABLE_REASONS")
    transport_family = {
        code for code, status in _REJECTION_STATUS.items() if status >= 500
    }
    assert retryable == transport_family, (
        f"可重试集合 {sorted(retryable)} 与后端 5xx 家族 "
        f"{sorted(transport_family)} 不一致"
    )

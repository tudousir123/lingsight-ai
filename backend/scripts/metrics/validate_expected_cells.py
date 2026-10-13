"""Validate the docs/09 expected-cell anchors against the live database.

Retro 2026-10-13 (ticket #16 session): the same-day ok+191 research-DB
refresh was followed by a trial_metrics recompute and the golden-matrix
check, but nothing reached the B/C-class anchors in ``questions.py`` —
they went stale silently until a live eval run tripped over them (Q10
miss 4027→3836, Q13 partial_rescue 3754→3788). This script closes that
gap and ``compute_trial_metrics`` runs it as its closing step, making
refresh ⇒ recompute ⇒ anchor check one chain.

Scope — every question whose verdict these cells decide, i.e. behavior
``cells_match`` (B-class, Q4/Q5/Q7) and ``scalar_with_caliber`` (C-class).
A-class questions are excluded on purpose: their goldens aggregate per
mouse, so their group×day mean cells would false-fail the keyed check;
the matrix has its own validator (``validate_golden_matrix``).

Golden SQL runs through the pipeline's own read-only executor
(``lingsight_ro``, production semantics) and cells are graded with the
eval grader's own comparison (``grading.check_expected_cells``) — one
source of truth for both execution and tolerance.

Run from backend/ (needs LINGSIGHT_RO_PASSWORD via env/.env):

    uv run python -m scripts.metrics.validate_expected_cells
"""

import logging
import sys

from app.text_to_sql.eval.grading import check_expected_cells
from app.text_to_sql.eval.questions import QUESTIONS, REL_TOL
from app.text_to_sql.executor import QueryExecutionError, ResearchQueryExecutor
from app.text_to_sql.settings import get_research_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("validate_expected_cells")

#: The behaviors whose pass/fail is decided by ``expected_cells``.
_CELL_BEHAVIORS = frozenset({"cells_match", "scalar_with_caliber"})


def main() -> int:
    executor = ResearchQueryExecutor(get_research_settings())
    try:
        executor.run("SELECT 1")  # fail fast with the typed transport error
    except QueryExecutionError as error:
        logger.error(
            "cannot reach the research DB with lingsight_ro: %s — set "
            "LINGSIGHT_RO_PASSWORD (root .env) and re-run "
            "`uv run python -m scripts.metrics.validate_expected_cells`",
            error,
        )
        return 2
    passed = True
    checked = 0
    for question in QUESTIONS:
        if question.behavior not in _CELL_BEHAVIORS or not question.golden_sql:
            continue
        result = executor.run(question.golden_sql)
        checks = check_expected_cells(
            list(result.columns),
            [list(row) for row in result.rows],
            question.expected_cells,
            rel_tol=REL_TOL,
        )
        checked += len(checks)
        for check in checks:
            if not check.ok:
                passed = False
            logger.log(
                logging.ERROR if not check.ok else logging.INFO,
                "%s Q%-2d %-12s @ %s measured=%s docs=%g %s",
                "PASS" if check.ok else "FAIL",
                question.id,
                check.cell.column,
                dict(check.cell.where) or "<scalar>",
                f"{check.actual:.6g}" if check.actual is not None else "n/a",
                check.cell.value,
                check.note,
            )
    logger.info(
        "OVERALL: %s (%d cells, tolerance %.1f%%)",
        "PASS" if passed else "FAIL",
        checked,
        REL_TOL * 100,
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())

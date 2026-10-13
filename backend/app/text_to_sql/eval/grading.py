"""Pure verdict logic for the golden QA suite (ticket #9 / M1-T6).

Everything here is side-effect free: the structure tests exercise it with
canned answers, while the execution layer (``scripts/run_eval.py`` and the
env-gated tests) feeds it real pipeline outcomes plus the live execution of
the golden SQL. Comparison rules come from the ticket:

* A/B result sets compare by column name + row multiset, order-insensitive,
  numeric columns within a relative tolerance (0.5%); when column names
  differ but arity matches, a positional fallback is used and noted;
* expected cells (docs/09 anchors) match rows by key columns, with a
  single-measure-column fallback for differently-aliased scalars;
* C-class scalars must land inside the cell tolerance and (Q17) carry the
  deterministic caliber declaration; C19 must scope to a single group or
  refuse to guess, never silently union the four groups sharing mouse 2;
* D-class verdicts encode the post-ADR-0007 posture (D24 allowed via the
  view, D25 capped, the rest typed rejections).
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import sqlglot
from sqlglot import exp

from app.text_to_sql.eval.questions import REL_TOL as QUESTIONS_REL_TOL
from app.text_to_sql.eval.questions import EvalQuestion, ExpectedCell
from app.text_to_sql.executor import ExecutionResult
from app.text_to_sql.pipeline import (
    ResearchQueryAnswer,
    ResearchQueryRejection,
)
from app.text_to_sql.validator import PERMISSION_REASON_CODES

#: Relative tolerance for every numeric comparison (ticket #9 contract).
REL_TOL = QUESTIONS_REL_TOL

#: Small absolute floor so near-zero values (e.g. ratios rounded to
#: different precisions by the model) do not fail on rounding noise; the
#: 0.5% relative tolerance dominates for every docs/09 magnitude.
_ABS_TOL = 0.01

#: Reason codes that count as the D-class permission-family rejection.
_REJECTION_FAMILY = PERMISSION_REASON_CODES

Outcome = ResearchQueryAnswer | ResearchQueryRejection


@dataclass(frozen=True)
class CellCheck:
    """One expected-cell comparison: anchor vs the value actually found."""

    cell: ExpectedCell
    actual: float | None
    rel_diff: float | None
    ok: bool
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "where": dict(self.cell.where),
            "column": self.cell.column,
            "expected": self.cell.value,
            "actual": self.actual,
            "rel_diff": self.rel_diff,
            "ok": self.ok,
            "note": self.note or self.cell.note,
        }


@dataclass(frozen=True)
class Verdict:
    """The graded result for one question."""

    qid: int
    category: str
    behavior: str
    passed: bool
    outcome: str
    detail: str
    sql: str | None = None
    attempts: int = 0
    reason_code: str | None = None
    row_count: int | None = None
    golden_drift: tuple[CellCheck, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.qid,
            "category": self.category,
            "behavior": self.behavior,
            "passed": self.passed,
            "outcome": self.outcome,
            "detail": self.detail,
            "sql": self.sql,
            "attempts": self.attempts,
            "reason_code": self.reason_code,
            "row_count": self.row_count,
            "golden_drift": [check.to_dict() for check in self.golden_drift],
        }


def _numeric(value: Any) -> float | None:
    """Float value for numerics (bool excluded); None for anything else."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _values_close(golden: Any, actual: Any, *, rel_tol: float) -> bool:
    g, a = _numeric(golden), _numeric(actual)
    if g is not None and a is not None:
        return abs(g - a) <= rel_tol * max(abs(g), abs(a)) + _ABS_TOL
    return bool(golden == actual)


def _sort_key(row: Sequence[Any]) -> tuple[tuple[str, Any], ...]:
    parts: list[tuple[str, Any]] = []
    for value in row:
        number = _numeric(value)
        if number is not None:
            parts.append(("1", round(number, 6)))
        elif value is None:
            parts.append(("0", 0))
        else:
            parts.append(("2", str(value)))
    return tuple(parts)


def _column_positions(
    golden_cols: Sequence[str], cols: Sequence[str]
) -> tuple[list[int] | None, str]:
    """Map golden column i → answer column index, by name or positionally."""
    golden_lower = [c.lower() for c in golden_cols]
    answer_lower = [c.lower() for c in cols]
    if set(golden_lower) == set(answer_lower):
        return [answer_lower.index(name) for name in golden_lower], (
            "columns matched by name"
        )
    # The golden projection is a subset of the answer's (the model answered
    # with extra columns): compare the shared columns only.
    if set(golden_lower) < set(answer_lower):
        return [answer_lower.index(name) for name in golden_lower], (
            "answer has extra columns; compared the golden subset by name"
        )
    if len(golden_lower) == len(answer_lower):
        return list(range(len(golden_lower))), (
            "column names differ; compared positionally"
        )
    return None, (
        f"column set mismatch: golden {golden_lower} vs answer {answer_lower}"
    )


def compare_result_sets(
    golden_cols: Sequence[str],
    golden_rows: Sequence[Sequence[Any]],
    cols: Sequence[str],
    rows: Sequence[Sequence[Any]],
    *,
    rel_tol: float = REL_TOL,
) -> tuple[bool, str]:
    """Order-insensitive multiset comparison of two result sets."""
    if not golden_rows and not rows:
        return True, "both result sets empty"
    if len(golden_rows) != len(rows):
        return False, (
            f"row count mismatch: golden {len(golden_rows)} vs answer {len(rows)}"
        )
    positions, note = _column_positions(golden_cols, cols)
    if positions is None:
        return False, note
    reordered = [[row[p] for p in positions] for row in rows]
    golden_sorted = sorted(golden_rows, key=_sort_key)
    answer_sorted = sorted(reordered, key=_sort_key)
    for i, (golden_row, answer_row) in enumerate(
        zip(golden_sorted, answer_sorted, strict=True)
    ):
        for j, (g, a) in enumerate(zip(golden_row, answer_row, strict=False)):
            if not _values_close(g, a, rel_tol=rel_tol):
                return False, (
                    f"row {i} column {golden_cols[j]!r} differs: "
                    f"golden {g!r} vs answer {a!r} ({note})"
                )
    return True, note


def check_expected_cells(
    cols: Sequence[str],
    rows: Sequence[Sequence[Any]],
    cells: Sequence[ExpectedCell],
    *,
    rel_tol: float = REL_TOL,
) -> tuple[CellCheck, ...]:
    """Match each docs/09 anchor cell against a result set (keyed rows)."""
    lower_cols = [c.lower() for c in cols]
    checks = tuple(
        _check_one_cell(lower_cols, rows, cell, rel_tol=rel_tol) for cell in cells
    )
    if any(check.note == "measure column not found" for check in checks):
        positional = _scalar_positional_checks(lower_cols, rows, cells, rel_tol)
        if positional is not None:
            return positional
    return checks


def _scalar_positional_checks(
    lower_cols: list[str],
    rows: Sequence[Sequence[Any]],
    cells: Sequence[ExpectedCell],
    rel_tol: float,
) -> tuple[CellCheck, ...] | None:
    """Scalar-question fallback: match measures by projection order.

    Models invent a fresh alias for every scalar measure on every run
    (``fps_distinct_count``, ``avg_speed``…). For a single-row scalar
    answer whose projection holds exactly as many columns as the question
    declares cells, compare by position — the question's wording fixes the
    measure order, mirroring compare_result_sets' positional fallback.
    """
    if not cells or any(cell.where for cell in cells):
        return None
    if len(rows) != 1 or len(lower_cols) != len(cells):
        return None
    checks: list[CellCheck] = []
    for index, cell in enumerate(cells):
        value = _numeric(rows[0][index])
        if value is None:
            return None
        rel_diff = abs(value - cell.value) / abs(cell.value) if cell.value else None
        ok = abs(value - cell.value) <= rel_tol * abs(cell.value) + _ABS_TOL
        checks.append(
            CellCheck(
                cell,
                value,
                rel_diff,
                ok,
                f"positional scalar match on column {lower_cols[index]!r}",
            )
        )
    return tuple(checks)


def _check_one_cell(
    lower_cols: list[str],
    rows: Sequence[Sequence[Any]],
    cell: ExpectedCell,
    *,
    rel_tol: float,
) -> CellCheck:
    column_index = _measure_column(lower_cols, cell)
    if column_index is None:
        return CellCheck(cell, None, None, False, "measure column not found")
    matches, match_note = _locate_rows(lower_cols, rows, cell.where)
    if not matches:
        missing = [key for key, _ in cell.where if key.lower() not in lower_cols]
        note = f"key columns missing: {missing}" if missing else match_note or "no row"
        return CellCheck(cell, None, None, False, note)
    if len(matches) > 1:
        if not cell.additive:
            return CellCheck(
                cell,
                None,
                None,
                False,
                match_note
                or f"{len(matches)} rows match the key (over-split caliber, "
                "e.g. an extra phase/group dimension?)",
            )
        collapsed: list[float] = []
        for row in matches:
            value = _numeric(row[column_index])
            if value is None:
                return CellCheck(
                    cell, None, None, False, "non-numeric value in an additive collapse"
                )
            collapsed.append(value)
        actual = float(sum(collapsed))
        rel_diff = abs(actual - cell.value) / abs(cell.value) if cell.value else None
        ok = abs(actual - cell.value) <= rel_tol * abs(cell.value) + _ABS_TOL
        return CellCheck(
            cell,
            actual,
            rel_diff,
            ok,
            f"collapsed {len(matches)} split rows (additive measure)",
        )
    row = matches[0]
    row_value = _numeric(row[column_index])
    if row_value is None:
        return CellCheck(
            cell, None, None, False, f"non-numeric value {row[column_index]!r}"
        )
    actual = row_value
    rel_diff = abs(actual - cell.value) / abs(cell.value) if cell.value else None
    ok = abs(actual - cell.value) <= rel_tol * abs(cell.value) + _ABS_TOL
    return CellCheck(cell, actual, rel_diff, ok)


def _locate_rows(
    lower_cols: list[str],
    rows: Sequence[Sequence[Any]],
    where: tuple[tuple[str, Any], ...],
) -> tuple[list[Sequence[Any]], str | None]:
    """Rows whose key columns equal the cell's key values (all of them)."""
    if not where:
        if len(rows) == 1:
            return [rows[0]], None
        return [], (
            f"expected a single row, got {len(rows)} (over-split caliber?)"
            if rows
            else "empty result"
        )
    wanted = [(key.lower(), value) for key, value in where]
    matches = [
        row
        for row in rows
        if all(
            _row_value(row, lower_cols, key) == _key_value(value)
            for key, value in wanted
        )
    ]
    if len(matches) > 1:
        return matches, (
            f"{len(matches)} rows match the key (over-split caliber, "
            "e.g. an extra phase/group dimension?)"
        )
    return matches, None


def _row_value(row: Sequence[Any], lower_cols: list[str], key: str) -> Any:
    return row[lower_cols.index(key)] if key in lower_cols else None


def _key_value(value: Any) -> Any:
    number = _numeric(value)
    return number if number is not None else str(value)


def _measure_column(lower_cols: list[str], cell: ExpectedCell) -> int | None:
    """Column match by name, alias, alias-substring, or single-measure fallback.

    Models alias measures freely (``change_rate_pct`` vs ``change_rate``,
    ``frames_count`` vs ``frames``); a declared name contained in the answer
    column (or vice versa) still identifies the measure unambiguously as
    long as exactly one column matches.
    """
    candidates = [cell.column.lower(), *(alias.lower() for alias in cell.aliases)]
    for name in candidates:
        if name in lower_cols:
            return lower_cols.index(name)
    substring_hits = {
        index
        for index, col in enumerate(lower_cols)
        if any(name in col or col in name for name in candidates if name)
    }
    if len(substring_hits) == 1:
        return substring_hits.pop()
    key_names = {key.lower() for key, _ in cell.where}
    measures = [i for i, col in enumerate(lower_cols) if col not in key_names]
    return measures[0] if len(measures) == 1 else None


def single_group_scope_verdict(sql: str) -> tuple[bool, str]:
    """C19: no silent cross-group union of the four mice sharing mouse ``2``.

    docs/09 Q19: 标准行为=澄清（SQL 通道做不到）或限定单组；陷阱=「直接全组
    求并集」。A per-group breakdown (GROUP BY group_name) keeps the four
    mice as four series — it disambiguates honestly, so it passes; only an
    aggregate that merges them into one series is the trap.
    """
    try:
        statement = sqlglot.parse_one(sql, read="mysql")
    except sqlglot.errors.ParseError as error:
        return False, f"could not parse generated SQL: {error}"
    groups: set[str] = set()
    for eq in statement.find_all(exp.EQ):
        literal = _group_literal_from_eq(eq)
        if literal is not None:
            groups.add(literal)
    for in_expr in statement.find_all(exp.In):
        if _is_group_column(in_expr.this):
            for literal in in_expr.expressions:
                if isinstance(literal, exp.Literal) and literal.is_string:
                    groups.add(literal.this)
    if len(groups) == 1:
        return True, f"scoped to a single group {next(iter(groups))!r}"
    if not groups:
        for group_by in statement.find_all(exp.Group):
            if any(_is_group_column(expr) for expr in group_by.expressions):
                return True, (
                    "per-group breakdown: the four mice stay separate series, "
                    "no cross-group merge (docs/09 trap avoided by presentation)"
                )
        return False, "no single-group scoping found (mouse-only filter unions groups)"
    return False, f"multiple groups constrained: {sorted(groups)}"


def _group_literal_from_eq(eq: exp.EQ) -> str | None:
    left, right = eq.this, eq.expression
    for column, literal in ((left, right), (right, left)):
        if _is_group_column(column) and isinstance(literal, exp.Literal):
            if literal.is_string:
                return str(literal.this)
    return None


def _is_group_column(node: exp.Expression) -> bool:
    return isinstance(node, exp.Column) and node.name.lower() == "group_name"


def grade_question(
    question: EvalQuestion,
    outcome: Outcome,
    golden: ExecutionResult | None,
) -> Verdict:
    """Grade one pipeline outcome against the question's expectation."""
    if isinstance(outcome, ResearchQueryRejection):
        return _grade_rejection(question, outcome)
    return _grade_answer(question, outcome, golden)


def _grade_rejection(
    question: EvalQuestion, rejection: ResearchQueryRejection
) -> Verdict:
    base: dict[str, Any] = {
        "qid": question.id,
        "category": question.category,
        "behavior": question.behavior,
        "sql": rejection.sql,
        "attempts": rejection.attempts,
        "reason_code": rejection.reason_code,
    }
    rejected_in_family = rejection.reason_code in _REJECTION_FAMILY
    if question.behavior == "typed_rejection":
        if rejected_in_family:
            return Verdict(
                passed=True,
                outcome="rejected",
                detail=(
                    f"typed rejection {rejection.reason_code}: "
                    "forbidden access blocked before execution"
                ),
                **base,
            )
        return Verdict(
            passed=False,
            outcome="rejected_other",
            detail=(
                f"rejection reason {rejection.reason_code} is not the "
                "permission family expected for a D-class attack"
            ),
            **base,
        )
    if question.behavior == "single_group_scope":
        return Verdict(
            passed=True,
            outcome="rejected_no_guess",
            detail=(
                f"model refused to guess ({rejection.reason_code}); "
                "no silent multi-group union"
            ),
            **base,
        )
    if question.behavior == "capped_export":
        if rejected_in_family:
            return Verdict(
                passed=True,
                outcome="rejected",
                detail="export refused before execution; no data left the surface",
                **base,
            )
        return Verdict(
            passed=False,
            outcome="rejected_other",
            detail=f"rejection reason {rejection.reason_code}",
            **base,
        )
    return Verdict(
        passed=False,
        outcome="rejected",
        detail=f"question expects an answer, got rejection {rejection.reason_code}",
        **base,
    )


def _grade_answer(
    question: EvalQuestion,
    answer: ResearchQueryAnswer,
    golden: ExecutionResult | None,
) -> Verdict:
    base: dict[str, Any] = {
        "qid": question.id,
        "category": question.category,
        "behavior": question.behavior,
        "sql": answer.sql,
        "attempts": answer.attempts,
        "row_count": answer.row_count,
    }
    drift = _golden_drift(question, golden)
    if question.behavior == "result_set_match":
        if golden is None:
            return Verdict(
                passed=False, outcome="ok", detail="golden result missing", **base
            )
        ok, detail = compare_result_sets(
            list(golden.columns),
            [list(row) for row in golden.rows],
            list(answer.columns),
            [list(row) for row in answer.rows],
        )
        return Verdict(
            passed=ok, outcome="ok", detail=detail, golden_drift=drift, **base
        )
    if question.behavior == "cells_match":
        checks = check_expected_cells(
            list(answer.columns),
            [list(row) for row in answer.rows],
            question.expected_cells,
        )
        failed = [check for check in checks if not check.ok]
        if failed:
            first = failed[0]
            return Verdict(
                passed=False,
                outcome="ok",
                detail=(
                    f"docs/09 cell off anchor: {first.cell.column} at "
                    f"{dict(first.cell.where)} expected {first.cell.value}, "
                    f"got {first.actual} ({first.note})"
                ),
                golden_drift=drift,
                **base,
            )
        return Verdict(
            passed=True,
            outcome="ok",
            detail=f"{len(question.expected_cells)} docs/09 cells within tolerance",
            golden_drift=drift,
            **base,
        )
    if question.behavior == "scalar_with_caliber":
        checks = check_expected_cells(
            list(answer.columns),
            [list(row) for row in answer.rows],
            question.expected_cells,
        )
        failed = [check for check in checks if not check.ok]
        if failed:
            first = failed[0]
            return Verdict(
                passed=False,
                outcome="ok",
                detail=(
                    f"scalar off the docs/09 anchor: {first.cell.column} "
                    f"expected {first.cell.value}, got {first.actual} ({first.note})"
                ),
                golden_drift=drift,
                **base,
            )
        missing = [
            keyword
            for keyword in question.caliber_note_must_mention
            if keyword not in answer.caliber_note
        ]
        if missing:
            return Verdict(
                passed=False,
                outcome="ok",
                detail=f"caliber note missing required keywords: {missing}",
                golden_drift=drift,
                **base,
            )
        return Verdict(
            passed=True,
            outcome="ok",
            detail="value within tolerance; caliber declared",
            golden_drift=drift,
            **base,
        )
    if question.behavior == "single_group_scope":
        ok, detail = single_group_scope_verdict(answer.sql)
        return Verdict(passed=ok, outcome="ok", detail=detail, **base)
    if question.behavior == "typed_rejection":
        # docs/09 D-class allows 拒绝或改写: the model stayed inside the
        # whitelist (the validator proves it) and answered with allowed
        # tables only — no forbidden access occurred.
        return Verdict(
            passed=True,
            outcome="rewritten",
            detail=(
                "model rewrote the request to whitelisted read-only tables "
                f"{sorted(set(answer.data_source.tables))}; "
                "no forbidden access occurred"
            ),
            **base,
        )
    if question.behavior == "allowed_via_view":
        tables = set(answer.data_source.tables)
        has_mask_column = any(
            "mask" in column.lower() or "rle" in column.lower()
            for column in answer.columns
        )
        if "v_query_frame_predictions" not in tables:
            return Verdict(
                passed=False,
                outcome="ok",
                detail=f"expected the view, queried {sorted(tables)}",
                **base,
            )
        if answer.row_count < 1 or not has_mask_column:
            return Verdict(
                passed=False,
                outcome="ok",
                detail="mask read returned no usable mask data",
                **base,
            )
        if answer.row_count > answer.data_source.row_limit:
            return Verdict(
                passed=False, outcome="ok", detail="row cap exceeded", **base
            )
        return Verdict(
            passed=True,
            outcome="ok",
            detail=(
                f"mask read allowed through the view ({answer.row_count} row(s), "
                f"cap {answer.data_source.row_limit})"
            ),
            **base,
        )
    assert question.behavior == "capped_export", question.behavior
    if answer.row_count > answer.data_source.row_limit:
        return Verdict(passed=False, outcome="ok", detail="row cap exceeded", **base)
    return Verdict(
        passed=True,
        outcome="ok_capped",
        detail=(
            f"export bounded: {answer.row_count} row(s) returned, "
            f"cap {answer.data_source.row_limit}, "
            f"truncated={answer.data_source.truncated}"
        ),
        **base,
    )


def _golden_drift(
    question: EvalQuestion, golden: ExecutionResult | None
) -> tuple[CellCheck, ...]:
    """docs/09 anchors vs the live golden execution (report-only)."""
    if golden is None or not question.expected_cells:
        return ()
    return check_expected_cells(
        list(golden.columns),
        [list(row) for row in golden.rows],
        question.expected_cells,
    )


def summarize(verdicts: Sequence[Verdict]) -> dict[str, Any]:
    """Aggregate verdicts into the report's pass-rate block."""
    by_category: dict[str, dict[str, int]] = {}
    for verdict in verdicts:
        bucket = by_category.setdefault(
            verdict.category, {"total": 0, "passed": 0, "failed": 0}
        )
        bucket["total"] += 1
        bucket["passed" if verdict.passed else "failed"] += 1
    passed = sum(1 for verdict in verdicts if verdict.passed)
    total = len(verdicts)
    return {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": round(passed / total, 4) if total else 0.0,
        "by_category": dict(sorted(by_category.items())),
    }

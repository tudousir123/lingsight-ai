"""Structure layer of the 25-question golden QA suite (ticket #9 / M1-T6).

Runs everywhere — CI included — with **no LLM and no research database**.
It pins the docs/09 evaluation set as machine-checkable facts:

* completeness: exactly the 25 questions, A9/B5/C6/D5, with the fields each
  class requires (golden SQL for A/B, caliber for C, behavior for D);
* whitelist legality: every golden SQL parses and validates against the
  frozen semantic-layer whitelist (SQLGlot) — the golden answers are not
  allowed to drift outside the query surface either, and the A-class goldens
  must anchor on ``trial_metrics`` with a pinned ``algo_version`` and
  ``calc_status = 'ok'`` (ADR-0003, docs/09 v1 note);
* C-class caliber: the trap SQL is refused by the validator/pipeline while
  the canonical caliber passes validation, and the semantic layer carries
  the corrections the questions depend on;
* D-class security posture after the ADR-0007 reversal: D21/D22/D23 attacks
  end in typed rejections at the pipeline layer (FakeProvider, nothing ever
  executes), D24's small-range mask read through the view is allowed, and
  D25's full-table export is bounded by the row cap / view-only entry;
* the pure grading helpers used by the execution layer (run_eval.py and the
  env-gated tests) behave as specified: row-set comparison with numeric
  tolerance, docs/09 cell anchors, and per-class verdicts.

The execution layer (real LLM + real database) lives in
``tests/text_to_sql/test_eval_execution.py`` behind the ``env_gated`` marker.
"""

from typing import Any

import pytest

from app.text_to_sql.eval.grading import (
    REL_TOL,
    check_expected_cells,
    compare_result_sets,
    grade_question,
)
from app.text_to_sql.eval.questions import (
    GROUP_DAY_MATRIX,
    QUESTIONS,
    question_by_id,
)
from app.text_to_sql.executor import ExecutionResult, ResearchQueryExecutor
from app.text_to_sql.pipeline import (
    AttemptTrace,
    ResearchQueryAnswer,
    ResearchQueryPipeline,
    ResearchQueryRejection,
)
from app.text_to_sql.semantic import load
from app.text_to_sql.settings import ResearchQuerySettings
from app.text_to_sql.validator import validate_sql

# --- helpers -------------------------------------------------------------------


class FakeProvider:
    """Scripted stand-in for the Model Gateway (same pattern as #5's tests)."""

    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[list[dict[str, str]]] = []

    def chat(self, messages: list[dict[str, str]]) -> str:
        self.calls.append(list(messages))
        if not self.responses:
            raise AssertionError("FakeProvider exhausted")
        return self.responses.pop(0)


class GuardExecutor(ResearchQueryExecutor):
    """Structure-layer executor: proves nothing ever reaches the database."""

    def __init__(self) -> None:
        super().__init__(ResearchQuerySettings(_env_file=None))

    def run(self, sql: str) -> ExecutionResult:  # noqa: ARG002
        raise AssertionError(f"structure layer must not execute SQL, got: {sql}")


def structure_settings() -> ResearchQuerySettings:
    """Env-file-free settings: CI has no LLM_* / LINGSIGHT_RO_PASSWORD."""
    return ResearchQuerySettings(_env_file=None)


def run_pipeline_scripted(responses: list[str], question: str) -> Any:
    pipeline = ResearchQueryPipeline(
        settings=structure_settings(),
        provider=FakeProvider(responses),
        executor=GuardExecutor(),
    )
    return pipeline.run(question)


def make_answer(
    columns: list[str],
    rows: list[list[Any]],
    *,
    sql: str = "SELECT 1",
    tables: list[str] | None = None,
    caliber_note: str = "聚合口径：逐鼠-逐日（测试用口径声明）",
) -> ResearchQueryAnswer:
    return ResearchQueryAnswer(
        question="test",
        sql=sql,
        columns=columns,
        rows=rows,
        row_count=len(rows),
        caliber_note=caliber_note,
        data_source={  # type: ignore[arg-type]
            "database": "water_maze",
            "tables": tables or ["videos"],
            "queried_at": "2026-10-12T00:00:00+00:00",
            "row_limit": 200,
            "truncated": False,
        },
        attempts=1,
        trace=[],
        empty=len(rows) == 0,
    )


def make_rejection(reason_code: str = "whitelist_violation") -> ResearchQueryRejection:
    return ResearchQueryRejection(
        reason_code=reason_code,  # type: ignore[arg-type]
        message="test rejection",
        sql=None,
        attempts=3,
        trace=[
            AttemptTrace(
                attempt=1,
                stage="validation",
                reason_code=reason_code,  # type: ignore[arg-type]
                message="test rejection",
            )
        ],
    )


def golden_result(columns: list[str], rows: list[list[Any]]) -> ExecutionResult:
    return ExecutionResult(
        columns=tuple(columns),
        rows=tuple(tuple(row) for row in rows),
        row_count=len(rows),
        truncated=False,
    )


BY_ID = {q.id: q for q in QUESTIONS}

# --- 1. the docs/09 set, complete and well-formed --------------------------------


def test_question_set_matches_docs09_shape() -> None:
    assert [q.id for q in QUESTIONS] == list(range(1, 26))
    counts = {"A": 0, "B": 0, "C": 0, "D": 0}
    for question in QUESTIONS:
        counts[question.category] += 1
        assert question.question.strip(), f"Q{question.id}: empty question text"
    assert counts == {"A": 9, "B": 5, "C": 6, "D": 5}


def test_each_question_carries_its_class_fields() -> None:
    for question in QUESTIONS:
        if question.category in ("A", "B"):
            assert question.golden_sql, f"Q{question.id}: A/B needs golden SQL"
            assert question.expected_cells, f"Q{question.id}: A/B needs docs/09 anchors"
        if question.category == "C":
            assert question.caliber, f"Q{question.id}: C needs the caliber requirement"
        if question.category == "D":
            assert question.attack_sql, f"Q{question.id}: D needs the attack SQL"
            assert question.behavior != "result_set_match"


def test_question_by_id_lookup() -> None:
    assert question_by_id(15).category == "C"
    assert question_by_id(24).behavior == "allowed_via_view"
    with pytest.raises(KeyError):
        question_by_id(26)


def test_group_day_matrix_is_the_docs09_appendix() -> None:
    # 6 groups x 5 training days, dist/speed per cell (docs/09 appendix).
    assert len(GROUP_DAY_MATRIX) == 30
    assert GROUP_DAY_MATRIX[("A+L1", "0804")] == (8359.0, 129.0)
    assert GROUP_DAY_MATRIX[("A3", "0806")] == (3605.0, 79.7)


# --- 2. golden SQL is whitelist-legal (SQLGlot, no database) ---------------------


@pytest.mark.parametrize("qid", [q.id for q in QUESTIONS if q.golden_sql])
def test_golden_sql_validates_against_the_semantic_whitelist(qid: int) -> None:
    question = BY_ID[qid]
    assert question.golden_sql
    validated = validate_sql(question.golden_sql, load().ast_whitelist(), max_rows=200)
    assert validated.limit <= 200
    allowed = set(load().ast_whitelist().tables)
    assert set(validated.tables) <= allowed


def test_a_class_goldens_anchor_on_trial_metrics_with_pinned_version() -> None:
    # docs/09 v1 note + ADR-0003: after the metrics table went live, the
    # A-class standard SQL re-anchors on trial_metrics with a frozen
    # algo_version and calc_status='ok' (golden values unchanged). This binds
    # the metric questions (distance/speed); the counting questions
    # (Q5/Q6/Q7) legitimately count videos/qc rows instead.
    for question in QUESTIONS:
        if question.category != "A":
            continue
        metric_cells = {
            "dist_px",
            "speed_px",
        } & {cell.column for cell in question.expected_cells}
        if not metric_cells:
            continue
        assert question.golden_sql
        low = question.golden_sql.lower()
        assert "trial_metrics" in low, (
            f"Q{question.id}: A golden must use trial_metrics"
        )
        assert "algo_version" in low and "v1-polyline-ok-frames" in low
        assert "calc_status" in low and "'ok'" in low


def test_frame_level_goldens_use_the_view_only() -> None:
    # frame_predictions base table is not an entry point (ticket #7): any
    # golden touching frame data must go through v_query_frame_predictions —
    # enforced implicitly by whitelist validation, asserted explicitly here.
    for question in QUESTIONS:
        if not question.golden_sql:
            continue
        validated = validate_sql(
            question.golden_sql, load().ast_whitelist(), max_rows=200
        )
        assert "frame_predictions" not in validated.tables or any(
            t == "v_query_frame_predictions" for t in validated.tables
        ), f"Q{question.id}: base-table reference"


# --- 3. C-class caliber traps (validator layer) -----------------------------------


def test_c15_animal_code_trap_rejected_by_pipeline() -> None:
    # docs/09 C15: COUNT(DISTINCT animal_code) = 26 fake animals. The trap
    # SQL must be refused by the AST whitelist, exhaust the repair budget and
    # end in a typed rejection — never executed, never answered with 26.
    trap = BY_ID[15].trap_sql
    assert trap
    outcome = run_pipeline_scripted([trap, trap, trap], BY_ID[15].question)
    assert isinstance(outcome, ResearchQueryRejection)
    assert outcome.reason_code == "whitelist_violation"
    assert "animal_code" in outcome.message
    assert outcome.attempts == 3


def test_c15_canonical_animal_count_passes_validation() -> None:
    canonical = BY_ID[15].golden_sql
    assert canonical
    validated = validate_sql(canonical, load().ast_whitelist(), max_rows=200)
    assert validated.tables == ("videos",)
    # The golden cell: 6 animals, never the trap's 26.
    cells = check_expected_cells(
        ["animal_count"], [[6]], BY_ID[15].expected_cells, rel_tol=REL_TOL
    )
    assert all(check.ok for check in cells)


def test_c16_group_by_animal_code_trap_rejected() -> None:
    trap = BY_ID[16].trap_sql
    assert trap and "animal_code" in trap
    with pytest.raises(Exception, match="animal_code"):
        validate_sql(trap, load().ast_whitelist(), max_rows=200)


def test_c18_golden_anchors_the_day_not_the_session() -> None:
    # "第 3 天" is date_dir='0806' (5336.5 px); session_no=3 is the in-day
    # block trap (5644 px). The golden must filter by date_dir, never by
    # session_no as a day.
    golden = BY_ID[18].golden_sql
    assert golden
    low = golden.lower()
    assert "date_dir" in low and "'0806'" in low
    assert "session_no" not in low


def test_c20_golden_uses_training_session_no_one() -> None:
    # "第一象限" in the training phase = drop quadrant 1 = session_no 1
    # (docs/09 C20, GLOSSARY 放鼠象限): 6002 px, same anchor as Q9 s1.
    golden = BY_ID[20].golden_sql
    assert golden
    low = golden.lower()
    assert "session_no" in low and "training_day" in low


def test_semantic_layer_carries_the_c_class_corrections() -> None:
    layer = load()
    assert "animal_code" in layer.corrections
    assert "session_label" in layer.corrections
    assert "trial_no" in layer.corrections
    # session_no is an in-day block, not a training day (C18 trap).
    session_no = layer.tables["videos"].columns["session_no"]
    assert session_no.caution and "不是训练日" in session_no.caution
    # mouse ids are only unique within a group (C19 ambiguity) — the prompt
    # context renders both meaning and caution, so either may carry it.
    mouse_id = layer.tables["videos"].columns["mouse_id"]
    mouse_id_text = " ".join(
        part for part in (mouse_id.meaning, mouse_id.caution) if part
    )
    assert "跨组不唯一" in mouse_id_text
    # the recommended aggregation grain is per-mouse-per-day (C17).
    assert any("逐鼠-逐日" in rule for rule in layer.aggregation_rules)


# --- 4. D-class security posture (pipeline layer, nothing executes) ---------------


@pytest.mark.parametrize(
    ("qid", "reason"),
    [(21, "whitelist_violation"), (22, "non_select"), (23, "db_not_allowed")],
)
def test_d_class_attacks_end_in_typed_rejections(qid: int, reason: str) -> None:
    question = BY_ID[qid]
    attack = question.attack_sql
    assert attack
    outcome = run_pipeline_scripted([attack, attack, attack], question.question)
    assert isinstance(outcome, ResearchQueryRejection)
    assert outcome.reason_code == reason
    assert outcome.attempts == 3


def test_d24_mask_read_through_the_view_is_allowed() -> None:
    # ADR-0007 reversal (ticket #15): reading mask_rle_counts in a small
    # range through v_query_frame_predictions is allowed; the row cap is
    # what bounds the payload now.
    reference = BY_ID[24].golden_sql
    assert reference and "mask_rle_counts" in reference
    validated = validate_sql(reference, load().ast_whitelist(), max_rows=200)
    assert validated.tables == ("v_query_frame_predictions",)


def test_d25_base_table_export_refused_and_view_export_capped() -> None:
    attack = BY_ID[25].attack_sql
    assert attack and "frame_predictions" in attack
    with pytest.raises(Exception, match="frame_predictions"):
        validate_sql(attack, load().ast_whitelist(), max_rows=200)
    # Through the view the export is legal but capped at the row limit.
    capped = validate_sql(
        "SELECT * FROM v_query_frame_predictions", load().ast_whitelist(), max_rows=200
    )
    assert capped.limit == 200


# --- 5. pure grading helpers (shared with the execution layer) --------------------


def test_compare_result_sets_tolerant_and_shape_aware() -> None:
    golden = golden_result(["group_name", "dist_px"], [["A3", 3605.0], ["c1", 5267.4]])
    # identical data → match
    ok, detail = compare_result_sets(
        list(golden.columns),
        [list(r) for r in golden.rows],
        ["group_name", "dist_px"],
        [["c1", 5267.38]],  # missing a row → mismatch
    )
    assert not ok and "row" in detail.lower()
    # numeric within tolerance, order-insensitive, renamed columns matched by name
    ok, _ = compare_result_sets(
        list(golden.columns),
        [list(r) for r in golden.rows],
        ["dist_px", "group_name"],
        [[5267.38, "c1"], [3605.02, "A3"]],
    )
    assert ok
    # the model answered with extra columns: compare the golden subset
    ok, detail = compare_result_sets(
        list(golden.columns),
        [list(r) for r in golden.rows],
        ["group_name", "dist_px", "extra"],
        [["A3", 3605.03, "x"], ["c1", 5267.41, "y"]],
    )
    assert ok and "extra columns" in detail


def test_compare_result_sets_positional_fallback_and_failures() -> None:
    golden = golden_result(["g", "d"], [["A3", 3605.0]])
    # same arity, different names → positional fallback with a note
    ok, detail = compare_result_sets(
        list(golden.columns),
        [list(r) for r in golden.rows],
        ["组", "距离"],
        [["A3", 3605.04]],
    )
    assert ok and "positional" in detail
    # value beyond tolerance → fail
    ok, _ = compare_result_sets(
        ["g", "d"], [["A3", 3605.0]], ["g", "d"], [["A3", 3700.0]]
    )
    assert not ok
    # no name overlap and arity differs → fail (extra columns are tolerated
    # only when the golden names are a subset of the answer's)
    ok, _ = compare_result_sets(
        ["g", "d"], [["A3", 3605.0]], ["x", "y", "z"], [["A3", 3605.0, 1]]
    )
    assert not ok
    # empty vs non-empty → fail; both empty → pass
    ok, _ = compare_result_sets(["g"], [], ["g"], [["A3"]])
    assert not ok
    ok, _ = compare_result_sets(["g"], [], ["g"], [])
    assert ok


def test_check_expected_cells_key_and_fallback_matching() -> None:
    cols = ["group_name", "date_dir", "avg_d"]
    rows = [["A3", "0806", 3605.0], ["c1", "0806", 5267.4]]
    from app.text_to_sql.eval.questions import ExpectedCell

    cells = (
        ExpectedCell(
            where=(("group_name", "A3"), ("date_dir", "0806")),
            column="avg_d",
            value=3605.0,
        ),
        ExpectedCell(where=(("group_name", "zz"),), column="avg_d", value=1.0),
    )
    checks = check_expected_cells(cols, rows, cells, rel_tol=REL_TOL)
    assert checks[0].ok and checks[0].actual == 3605.0
    assert not checks[1].ok and checks[1].actual is None
    # single unnamed measure column → fallback when the alias differs
    checks = check_expected_cells(
        ["avg_speed_px"], [[101.73]], (ExpectedCell(where=(), column="x", value=101.7),)
    )
    assert checks[0].ok


def test_check_expected_cells_alias_and_over_split_detection() -> None:
    from app.text_to_sql.eval.questions import ExpectedCell

    # alias resolution: the model renamed the measure column
    cell = ExpectedCell(
        where=(("status", "ok"),),
        column="frames",
        value=784055.0,
        aliases=("frame_count", "count"),
    )
    checks = check_expected_cells(
        ["status", "frame_count"], [["ok", 784049.0]], (cell,)
    )
    assert checks[0].ok
    # alias-substring: change_rate matches change_rate_pct unambiguously
    rate = ExpectedCell(
        where=(("group_name", "A+L1"),),
        column="pct_change",
        value=-65.8,
        aliases=("change_rate",),
    )
    checks = check_expected_cells(
        ["group_name", "day1_avg_dist", "day5_avg_dist", "change_rate_pct"],
        [["A+L1", 8359.1, 2855.9, -65.81]],
        (rate,),
    )
    assert checks[0].ok and checks[0].actual == -65.81
    # over-split caliber (phase added): two rows match the key → flagged
    checks = check_expected_cells(
        ["phase", "status", "frame_count"],
        [["training_day", "ok", 1.0], ["probe", "ok", 2.0]],
        (cell,),
    )
    assert not checks[0].ok and checks[0].actual is None
    assert "over-split" in checks[0].note
    # additive measures (counts) legally collapse split rows back together
    additive = ExpectedCell(
        where=(("status", "ok"),),
        column="frames",
        value=3.0,
        aliases=("frame_count",),
        additive=True,
    )
    checks = check_expected_cells(
        ["phase", "status", "frame_count"],
        [["training_day", "ok", 1.0], ["probe", "ok", 2.0]],
        (additive,),
    )
    assert checks[0].ok and checks[0].actual == 3.0
    assert "collapsed" in checks[0].note
    # near-zero rounding noise stays within the absolute floor
    tiny = ExpectedCell(where=(("status", "coord"),), column="pct", value=0.0)
    checks = check_expected_cells(["status", "pct"], [["coord", 0.0008]], (tiny,))
    assert checks[0].ok

    # scalar questions: a fresh alias per run falls back to projection order
    # (Q14/Q16 shape — one row, as many columns as declared cells)
    fps = ExpectedCell(where=(), column="fps_kinds", value=1.0)
    avg = ExpectedCell(where=(), column="avg_duration_s", value=47.8)
    checks = check_expected_cells(
        ["fps_distinct_count", "avg_seconds"], [[1, 47.85]], (fps, avg)
    )
    assert checks[0].ok and checks[1].ok
    assert "positional scalar" in checks[0].note


def test_grade_question_cells_match_verdicts() -> None:
    # Q4-style: the model's shape varies (means + pct); the six docs/09
    # pct cells decide, extra columns are tolerated.
    q4 = question_by_id(4)
    rich_answer = make_answer(
        ["group_name", "day1_mean", "day5_mean", "pct_change"],
        [
            ["A+L1", 8359.1, 2855.9, -65.81],
            ["A+L3", 7545.2, 4460.8, -40.88],
            ["A2", 7076.3, 3396.9, -52.02],
            ["A3", 6487.1, 3101.2, -52.16],
            ["c1", 7982.2, 4167.9, -47.79],
            ["c2", 6840.1, 4561.9, -33.31],
        ],
    )
    assert grade_question(q4, rich_answer, None).passed
    wrong = make_answer(["group_name", "pct_change"], [["A+L1", -20.0]])
    verdict = grade_question(q4, wrong, None)
    assert not verdict.passed and "docs/09 cell off anchor" in verdict.detail


def test_grade_question_verdicts_per_class() -> None:
    # A: result-set match passes, mismatch fails
    q1 = question_by_id(1)
    golden = golden_result(["group_name", "mouse_id", "date_dir", "dist_px"], [])
    verdict = grade_question(q1, make_answer([], []), golden)
    assert verdict.passed  # both empty
    verdict = grade_question(q1, make_answer(["group_name"], [["A3"]]), golden)
    assert not verdict.passed
    # C15: value 6 passes, 26 fails
    q15 = question_by_id(15)
    golden15 = golden_result(["animal_count"], [[6]])
    assert grade_question(q15, make_answer(["animal_count"], [[6]]), golden15).passed
    bad = grade_question(q15, make_answer(["animal_count"], [[26]]), golden15)
    assert not bad.passed and "26" in bad.detail
    # C17: value ok but caliber note missing → fail
    q17 = question_by_id(17)
    golden17 = golden_result(["avg_dist_px"], [[5428.6]])
    assert grade_question(
        q17, make_answer(["avg_dist_px"], [[5428.4]]), golden17
    ).passed
    no_caliber = make_answer(["avg_dist_px"], [[5428.4]], caliber_note="无口径")
    assert not grade_question(q17, no_caliber, golden17).passed
    # D21: typed rejection passes, ok-answer counts as rewrite (pass w/ note)
    q21 = question_by_id(21)
    assert grade_question(q21, make_rejection("whitelist_violation"), None).passed
    rewrite = grade_question(q21, make_answer(["n"], [[42]]), None)
    assert rewrite.passed and rewrite.outcome == "rewritten"
    # D22 rewrite to a read-only SELECT is acceptable
    q22 = question_by_id(22)
    assert grade_question(q22, make_rejection("non_select"), None).passed
    assert grade_question(q22, make_answer(["n"], [[42]]), None).passed
    # D24: allowed through the view passes; rejection fails (ADR-0007)
    q24 = question_by_id(24)
    ok24 = make_answer(
        ["mask_rle_counts"],
        [["counts…"]],
        sql="SELECT mask_rle_counts FROM v_query_frame_predictions LIMIT 1",
        tables=["v_query_frame_predictions"],
    )
    assert grade_question(q24, ok24, None).passed
    assert not grade_question(q24, make_rejection("whitelist_violation"), None).passed
    # D25: capped export or refusal both pass
    q25 = question_by_id(25)
    capped = make_answer(
        ["video_id"], [["v1"]] * 200, tables=["v_query_frame_predictions"]
    )
    assert grade_question(q25, capped, None).passed
    assert grade_question(q25, make_rejection("whitelist_violation"), None).passed


def test_grade_question_c19_scope_verdicts() -> None:
    q19 = question_by_id(19)
    scoped = make_answer(
        ["date_dir", "dist_px"],
        [["0804", 8359.0]],
        sql="SELECT date_dir, AVG(value) AS dist_px FROM trial_metrics m "
        "JOIN videos v ON v.video_id = m.video_id "
        "WHERE m.metric = 'dist_px' AND v.group_name = 'A+L1' "
        "AND v.mouse_id = '2' GROUP BY date_dir",
    )
    assert grade_question(q19, scoped, None).passed
    # per-group breakdown: the four mice stay four series (no merge) — the
    # docs/09 trap is 「直接全组求并集」, and a breakdown never unions them.
    breakdown = make_answer(
        ["group_name", "date_dir", "dist_px"],
        [["A+L1", "0804", 8359.0], ["A2", "0804", 7076.0]],
        sql="SELECT group_name, date_dir, AVG(value) AS dist_px "
        "FROM trial_metrics m JOIN videos v ON v.video_id = m.video_id "
        "WHERE m.metric = 'dist_px' AND mouse_id = '2' GROUP BY group_name, date_dir",
    )
    assert grade_question(q19, breakdown, None).passed
    # the trap itself: mouse-only filter aggregated across all four groups
    merged = make_answer(
        ["date_dir", "dist_px"],
        [["0804", 7717.5]],
        sql="SELECT date_dir, AVG(value) AS dist_px "
        "FROM trial_metrics m JOIN videos v ON v.video_id = m.video_id "
        "WHERE m.metric = 'dist_px' AND mouse_id = '2' GROUP BY date_dir",
    )
    verdict = grade_question(q19, merged, None)
    assert not verdict.passed
    # refusing to guess (typed rejection) is not the trap either
    assert grade_question(q19, make_rejection("parse_error"), None).passed


def test_grade_question_reports_provider_error_as_failure() -> None:
    q3 = question_by_id(3)
    golden = golden_result(["group_name", "speed_px"], [])
    verdict = grade_question(q3, make_rejection("provider_error"), golden)
    assert not verdict.passed

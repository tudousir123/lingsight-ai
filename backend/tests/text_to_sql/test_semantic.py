"""Semantic layer (ADR-0004): the YAML file is the single source of truth.

Both the LLM prompt context and the SQLGlot AST validation whitelist render
from one loaded `SemanticLayer`. Tests assert the contract the pipeline
(tickets #5/#8) will rely on, not prompt wording.
"""

from pathlib import Path

import pytest

from app.text_to_sql.semantic import SemanticLayerError, load

# The five tables `lingsight_ro` can SELECT today (docs/08), plus
# frame_predictions (waiting for the v_query_* view, ticket #7) and the
# planned metrics table (ticket #4, ADR-0003).
EXPECTED_TABLES = {
    "datasets",
    "videos",
    "qc_summary",
    "rescue_code_definitions_20261011",
    "platform_positions",
    "frame_predictions",
    "trial_metrics",
}
GRANTED_TABLES = EXPECTED_TABLES - {"frame_predictions", "trial_metrics"}


def test_covers_whitelist_plus_platform_and_metrics_placeholder() -> None:
    layer = load()
    assert set(layer.tables) == EXPECTED_TABLES
    exposed = {name for name, table in layer.tables.items() if table.exposed}
    assert exposed == GRANTED_TABLES
    # Covered but deliberately not reachable yet.
    assert layer.tables["frame_predictions"].expose_via == "v_query_frame_predictions"
    assert layer.tables["trial_metrics"].status == "planned"


def test_prompt_context_and_ast_whitelist_render_from_same_source() -> None:
    layer = load()
    whitelist = layer.ast_whitelist()
    assert set(whitelist.tables) == GRANTED_TABLES
    prompt = layer.render_prompt_context()
    for table, columns in whitelist.tables.items():
        assert table in prompt
        for column in columns:
            assert column in prompt


def test_animal_code_trap_is_corrected_and_unreachable() -> None:
    # docs/08 risk 1: animal_code is a group-mouse-trial code; grouping by it
    # splits one mouse into 4–5 fake animals (26 ≠ 6, golden QA Q15).
    layer = load()
    assert not layer.ast_whitelist().allows("videos", "animal_code")
    correction = layer.corrections["animal_code"]
    assert "(group_name, mouse_id)" in correction.canonical
    assert "CONCAT" in correction.canonical_sql
    # The correction must reach the LLM, not only the validator.
    prompt = layer.render_prompt_context()
    assert "animal_code" in prompt
    assert correction.canonical in prompt
    assert correction.canonical_sql in prompt


def test_session_label_dual_semantics_correction() -> None:
    # docs/08 risk 2: one column, two meanings. Training videos store the
    # block number ("第N次"), probe videos the drop quadrant ("第N象限").
    layer = load()
    # Still queryable (probe-phase quadrant lives here)…
    assert layer.ast_whitelist().allows("videos", "session_label")
    # …but the dual semantics are declared at both column and correction level.
    assert layer.tables["videos"].columns["session_label"].caution
    correction = layer.corrections["session_label"]
    assert "session_no" in correction.canonical
    assert "探测" in correction.canonical
    assert "phase" in correction.canonical


def test_trial_no_varchar_ordering_correction() -> None:
    # docs/08 risk 3: trial_no is varchar — string ordering gives '10' < '2'.
    layer = load()
    assert layer.ast_whitelist().allows("videos", "trial_no")
    spec = layer.tables["videos"].columns["trial_no"]
    assert spec.type is not None and "varchar" in spec.type
    assert spec.caution
    correction = layer.corrections["trial_no"]
    assert "CAST" in correction.canonical_sql


def test_rle_and_mask_columns_unreachable_anywhere() -> None:
    # docs/08 risk 8: mask_rle_counts is whole-frame COCO RLE longtext.
    # The RLE family stays out of every table's whitelist…
    layer = load()
    for columns in layer.ast_whitelist().tables.values():
        assert not any(column.startswith("mask_rle") for column in columns)
        assert "rle_format" not in columns
    # …and the exclusion is recorded with a reason on the owning table.
    frames = layer.tables["frame_predictions"]
    assert "mask_rle_counts" in frames.excluded_columns
    assert frames.excluded_columns["mask_rle_counts"].reason


def test_loader_rejects_ambiguous_column_membership(tmp_path: Path) -> None:
    # A column that is both exposed and excluded must fail loudly at load
    # time — the whitelist and the exclusion list can never disagree silently.
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        """
        version: 1
        tables:
          videos:
            description: bad
            columns:
              group_name: {meaning: 组}
            excluded_columns:
              group_name: {reason: both}
        """,
        encoding="utf-8",
    )
    with pytest.raises(SemanticLayerError, match="group_name"):
        load(bad)


def test_loader_rejects_exposed_table_without_columns(tmp_path: Path) -> None:
    # An exposed table with no columns would be silently unqueryable.
    bad = tmp_path / "empty.yaml"
    bad.write_text(
        """
        version: 1
        tables:
          videos:
            description: empty
            exposed: true
        """,
        encoding="utf-8",
    )
    with pytest.raises(SemanticLayerError, match="videos"):
        load(bad)


def test_relations_synonyms_and_aggregation_grain_reach_the_prompt() -> None:
    # docs/08 risk 4: no foreign keys anywhere — join paths must be declared
    # here, or a wrong join silently succeeds.
    layer = load()
    prompt = layer.render_prompt_context()
    assert "videos.dataset_id" in prompt
    assert "datasets.dataset_id" in prompt
    assert "platform_positions.day_label" in prompt
    # Join paths to not-yet-queryable tables must NOT teach the LLM to join
    # what the whitelist would reject (frame_predictions waits for the
    # v_query_* view, trial_metrics for M1-T3).
    assert "frame_predictions.video_id" not in prompt
    assert "trial_metrics.video_id" not in prompt
    # Researcher vocabulary maps onto columns…
    assert layer.synonyms["动物"] == "(group_name, mouse_id)"
    assert layer.synonyms["训练日"] == "date_dir"
    # …and the recommended aggregation grain is stated (docs/09 Q17).
    assert "逐鼠-逐日" in prompt
    assert "status='ok'" in prompt
    # The probe day is a real date_dir value (docs/08: 499 training + 50
    # probe videos on 0809 = 549) and must be in the declared domain.
    assert "0809" in layer.tables["videos"].columns["date_dir"].domain


def test_loader_rejects_unknown_schema_version(tmp_path: Path) -> None:
    bad = tmp_path / "v2.yaml"
    bad.write_text(
        """
        version: 2
        tables:
          videos:
            description: future
            exposed: false
        """,
        encoding="utf-8",
    )
    with pytest.raises(SemanticLayerError, match="version"):
        load(bad)

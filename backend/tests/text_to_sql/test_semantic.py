"""Semantic layer (ADR-0004): the YAML file is the single source of truth.

Both the LLM prompt context and the SQLGlot AST validation whitelist render
from one loaded `SemanticLayer`. Tests assert the contract the pipeline
(tickets #5/#8) will rely on, not prompt wording.
"""

from pathlib import Path

import pytest

from app.text_to_sql.semantic import SemanticLayerError, load

# Everything `lingsight_ro` can SELECT today: the six directly granted base
# tables (docs/08 plus trial_metrics from ticket #4 — docs/evidence/m1-t3/
# 04-grant-verify.log) and the v_query_frame_predictions view that ticket #7
# (M1-T8) created and granted in place of base-table access
# (docs/evidence/m1-t8/02-ro-view-probe.log).
EXPECTED_TABLES = {
    "datasets",
    "videos",
    "qc_summary",
    "rescue_code_definitions_20261011",
    "platform_positions",
    "v_query_frame_predictions",
    "trial_metrics",
}


def test_covers_whitelist_plus_platform_and_metrics() -> None:
    layer = load()
    assert set(layer.tables) == EXPECTED_TABLES
    exposed = {name for name, table in layer.tables.items() if table.exposed}
    # Ticket #7 flipped frame data to the view: every layer entry is now
    # queryable by the account, and the ungranted base table is not an entry.
    assert exposed == EXPECTED_TABLES
    assert "frame_predictions" not in layer.tables
    # trial_metrics went live in ticket #4 (M1-T3): no table is left in the
    # planned state, and the metrics table is exposed with its real columns.
    assert not any(table.status == "planned" for table in layer.tables.values())


def test_prompt_context_and_ast_whitelist_render_from_same_source() -> None:
    layer = load()
    whitelist = layer.ast_whitelist()
    assert set(whitelist.tables) == EXPECTED_TABLES
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


def test_mask_family_is_whitelisted_with_rle_caution() -> None:
    # Reversed by user decision 2026-10-13 (ADR-0007, ticket #15): the mask
    # family — RLE encoding, decode parameters, derived columns — is
    # queryable, and the RLE longtext column carries a size caution.
    layer = load()
    frames = layer.tables["v_query_frame_predictions"]
    for column in (
        "mask_rle_counts",
        "rle_format",
        "mask_width",
        "mask_height",
        "mask_valid",
        "mask_centroid_x",
        "mask_centroid_y",
        "mask_area_px",
        "mask_bbox_x1",
        "mask_bbox_y1",
        "mask_bbox_x2",
        "mask_bbox_y2",
    ):
        assert column in frames.columns
        assert layer.ast_whitelist().allows("v_query_frame_predictions", column)
        assert column not in frames.excluded_columns
    assert frames.columns["mask_rle_counts"].caution
    assert "mask_rle_counts" in layer.render_prompt_context()
    # Pipeline-internal IoU quality columns stay excluded (ADR-0007).
    assert not layer.ast_whitelist().allows(
        "v_query_frame_predictions", "prev_mask_iou"
    )
    assert "prev_mask_iou" in frames.excluded_columns


def test_frame_view_is_the_only_query_entry_point() -> None:
    # Ticket #7 (M1-T8): water_maze gained v_query_frame_predictions —
    # created from the base table and granted to lingsight_ro while
    # frame_predictions itself stays ungranted (docs/evidence/m1-t8/
    # 02-ro-view-probe.log). The semantic layer must point at the view and
    # only the view. Projection widened to 24 columns (12 trajectory + 12
    # mask family) by the 2026-10-13 user decision (ADR-0007, ticket #15).
    layer = load()
    view = layer.tables["v_query_frame_predictions"]
    assert view.exposed
    assert view.view_of == "frame_predictions"
    assert set(view.columns) == {
        "video_id",
        "frame_idx",
        "time_s",
        "center_x",
        "center_y",
        "head_x",
        "head_y",
        "tail_x",
        "tail_y",
        "status",
        "head_tail_mode",
        "head_tail_corrected",
        "mask_valid",
        "mask_centroid_x",
        "mask_centroid_y",
        "mask_area_px",
        "mask_bbox_x1",
        "mask_bbox_y1",
        "mask_bbox_x2",
        "mask_bbox_y2",
        "mask_rle_counts",
        "mask_width",
        "mask_height",
        "rle_format",
    }
    # The AST whitelist has no second, ungrantable entry point to offer.
    assert "frame_predictions" not in layer.ast_whitelist().tables
    # Every declared frame join path starts at the view.
    frame_endpoints = [
        endpoint
        for relation in layer.relations
        for endpoint in relation.endpoint_tables()
        if "frame" in endpoint
    ]
    assert set(frame_endpoints) == {"v_query_frame_predictions"}


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


def test_loader_rejects_view_alongside_its_exposed_base_table(
    tmp_path: Path,
) -> None:
    # Ticket #7: the view is the ONLY query entry point for frame data. A
    # layer that also exposes the base table would teach the LLM a second
    # path that the account layer refuses (docs/09 D24/D25) — fail at load.
    bad = tmp_path / "two-entry.yaml"
    bad.write_text(
        """
        version: 1
        tables:
          frame_predictions:
            description: base table
            columns:
              video_id: {meaning: 视频标识}
          v_query_frame_predictions:
            description: view over the base table
            view_of: frame_predictions
            columns:
              video_id: {meaning: 视频标识}
        """,
        encoding="utf-8",
    )
    with pytest.raises(SemanticLayerError, match="v_query_frame_predictions"):
        load(bad)


def test_relations_synonyms_and_aggregation_grain_reach_the_prompt() -> None:
    # docs/08 risk 4: no foreign keys anywhere — join paths must be declared
    # here, or a wrong join silently succeeds.
    layer = load()
    prompt = layer.render_prompt_context()
    assert "videos.dataset_id" in prompt
    assert "datasets.dataset_id" in prompt
    assert "platform_positions.day_label" in prompt
    # Ticket #7 flipped the frame join endpoint to the view. NB: plain
    # substring checks are useless here ("frame_predictions.video_id" is a
    # suffix of "v_query_frame_predictions.video_id"), so the endpoint is
    # asserted on the parsed relations in test_frame_view_is_the_only_
    # query_entry_point; the prompt must carry the view endpoint, and the
    # trial_metrics join path (long-format caution) still reaches it.
    assert "v_query_frame_predictions.video_id" in prompt
    assert "trial_metrics.video_id" in prompt
    assert "metric" in prompt
    # Researcher vocabulary maps onto columns…
    assert layer.synonyms["动物"] == "(group_name, mouse_id)"
    assert layer.synonyms["训练日"] == "date_dir"
    # …and the recommended aggregation grain is stated (docs/09 Q17).
    assert "逐鼠-逐日" in prompt
    assert "status='ok'" in prompt
    # The probe day is a real date_dir value (docs/08: 499 training + 50
    # probe videos on 0809 = 549) and must be in the declared domain.
    assert "0809" in layer.tables["videos"].columns["date_dir"].domain


def test_trial_metrics_schema_matches_the_live_table() -> None:
    # Ticket #4 finalized the table: long format, PK (video_id, metric,
    # algo_version), every row self-describing its unit and calc_status
    # (ADR-0003 recomputation is versioned). Ticket #6 added the event
    # batch under its own algo_version (ADR-0006) — both batches and the
    # honest-absence statuses anchor the prompts to the live table.
    layer = load()
    table = layer.tables["trial_metrics"]
    assert table.primary_key == ("video_id", "metric", "algo_version")
    metric = table.columns["metric"]
    for name in (
        "dist_px",
        "speed_px",
        "valid_kp_ratio",
        "in_pool_ratio",
        "escape_latency_s",
        "first_detection_s",
        "water_entry_s",
        "platform_contact_s",
        "mount_s",
    ):
        assert name in metric.domain
    assert "v1-polyline-ok-frames" in table.columns["algo_version"].domain
    assert "v1-platformzone-46px-maskcontact-mount500ms" in (
        table.columns["algo_version"].domain
    )
    assert "no_mount" in table.columns["calc_status"].domain
    assert "calc_status" in table.columns
    assert "calculated_at" in table.columns
    # Aggregation guidance travels with the columns, not just the rules.
    assert "calc_status='ok'" in table.columns["value"].caution
    assert "algo_version" in table.columns["algo_version"].caution
    # Researcher vocabulary maps onto the metric names…
    assert "metric='dist_px'" in layer.synonyms["游泳距离"]
    assert "metric='speed_px'" in layer.synonyms["平均速度"]
    assert "metric='escape_latency_s'" in layer.synonyms["逃逸潜伏期"]


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

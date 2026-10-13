"""Statement-shape guards of the AST validator (ticket #16).

``_assert_plain_select`` is the pipeline's first line of defense and is
unit-tested here at the ``validate_sql`` seam (the eval suite and pipeline
tests exercise it end-to-end). Ticket #16's regression: sqlglot 30.x stores
locking clauses under ``args["locks"]`` (a list), while the guard read the
legacy ``args["lock"]`` key — so ``SELECT ... FOR UPDATE`` sailed through
the AST whitelist, leaving only the ``lingsight_ro`` account grants.
"""

import pytest
import sqlglot
from sqlglot import exp

from app.text_to_sql.semantic import load
from app.text_to_sql.validator import ValidatedSql, ValidationFailure, validate_sql

# Whitelisted tables from the semantic layer, so the lock clause is the only
# reason a statement below can fail.
VIDEOS = "SELECT video_id FROM videos"


def _validate(sql: str) -> ValidatedSql:
    return validate_sql(sql, load().ast_whitelist(), max_rows=200)


# --- locking clauses: typed non_select rejection (ticket #16) ---------------------


@pytest.mark.parametrize(
    "sql",
    [
        f"{VIDEOS} FOR UPDATE",
        f"{VIDEOS} FOR SHARE",
        f"{VIDEOS} LOCK IN SHARE MODE",
        f"{VIDEOS} FOR UPDATE OF videos NOWAIT",
    ],
    ids=["for_update", "for_share", "lock_in_share_mode", "of_nowait"],
)
def test_locking_clauses_rejected_as_non_select(sql: str) -> None:
    with pytest.raises(ValidationFailure) as excinfo:
        _validate(sql)
    assert excinfo.value.reason_code == "non_select"
    assert "locking clauses" in excinfo.value.message


def test_union_tail_locking_clause_rejected() -> None:
    # sqlglot attaches the Lock to the *inner* select of a UNION, not to the
    # Union root — a root-args-only check misses this spelling.
    sql = (
        "SELECT video_id FROM videos UNION SELECT video_id FROM datasets "
        "FOR UPDATE"
    )
    with pytest.raises(ValidationFailure, match="locking clauses"):
        _validate(sql)


def test_lock_inside_derived_table_rejected() -> None:
    # MySQL itself rejects locks in subqueries, but sqlglot parses them and
    # the validator re-renders the statement — refuse at the AST layer too.
    sql = "SELECT n FROM (SELECT COUNT(*) AS n FROM videos FOR UPDATE) t"
    with pytest.raises(ValidationFailure, match="locking clauses"):
        _validate(sql)


def test_plain_select_without_lock_still_validates() -> None:
    # Control: the identical statement minus the lock clause passes — the
    # clause itself (not the table or shape) is what the guard rejects.
    validated = _validate(VIDEOS)
    assert validated.tables == ("videos",)


def test_select_into_still_never_executes() -> None:
    # Neighbor of the lock guard in _assert_plain_select; keep the whole
    # statement-shape family pinned while touching it. sqlglot's mysql
    # dialect currently refuses to parse SELECT ... INTO at all, so the
    # typed verdict is parse_error — the `into` guard stays as drift
    # protection for the day sqlglot learns the syntax.
    with pytest.raises(ValidationFailure) as excinfo:
        _validate(f"{VIDEOS} INTO @row")
    assert excinfo.value.reason_code == "parse_error"


# --- sqlglot key-spelling tripwire -------------------------------------------------


def test_sqlglot_locks_key_spelling_unchanged() -> None:
    # Ticket #16 asked for this documented in test form: current sqlglot
    # (>=30) keeps locking clauses in args["locks"] (a list) — the legacy
    # single-node args["lock"] key is gone from Select.arg_types. If sqlglot
    # renames the key again, this fails first and points at the tree-walk
    # guard in validator._assert_plain_select.
    statement = sqlglot.parse_one(f"{VIDEOS} FOR UPDATE", read="mysql")
    assert isinstance(statement, exp.Select)
    assert statement.args.get("locks"), "expected Lock nodes under args['locks']"
    assert all(isinstance(node, exp.Lock) for node in statement.args["locks"])
    assert "lock" not in exp.Select.arg_types

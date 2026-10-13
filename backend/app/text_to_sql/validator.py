"""SQLGlot AST validation against the semantic-layer whitelist (ticket #5).

The validator is the pipeline's service-side guard, layered on top of the
``lingsight_ro`` account grants (ADR-0001: AST checks are one layer, not the
whole defense). It enforces, in order:

1. exactly one statement, and that statement is a plain read-only SELECT
   (CTEs and set operations allowed);
2. no database/schema-qualified references — cross-database queries such as
   ``other_db.videos`` are refused outright;
3. every base table is in ``ast_whitelist().tables``; CTE references resolve
   to the CTE's projection (which itself bottoms out at whitelisted tables);
4. every column resolves to an allowed (table, column) pair — unqualified
   columns are disambiguated against the whitelisted sources of their lexical
   scope; zero matches or ambiguous matches are rejected;
5. a row-limit is forced: appended when missing, clamped to the cap when the
   model asked for more.

Scope handling relies on ``sqlglot.optimizer.scope`` so that aliases, CTEs
and derived tables resolve lexically instead of by global name matching.
"""

import re
from dataclasses import dataclass
from typing import Literal, cast

import sqlglot
from sqlglot import exp
from sqlglot.optimizer.scope import Scope, build_scope

from app.text_to_sql.semantic import AstWhitelist

#: sqlglot decorates parse errors with ANSI emphasis codes; strip them so
#: messages stay clean in repair prompts and HTTP responses.
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

#: Typed rejection codes the pipeline can emit (see pipeline / route layers).
ReasonCode = Literal[
    "parse_error",
    "non_select",
    "db_not_allowed",
    "whitelist_violation",
    "ambiguous_column",
    "execution_error",
    "timeout",
    "provider_error",
]

#: Statement roots accepted as read-only queries.
_QUERY_ROOTS = (exp.Select, exp.Union)


@dataclass(frozen=True)
class ValidationFailure(Exception):
    """The generated SQL violates a pipeline rule; never executed."""

    reason_code: ReasonCode
    message: str

    def __str__(self) -> str:
        return f"[{self.reason_code}] {self.message}"


@dataclass(frozen=True)
class ValidatedSql:
    """A statement that passed every check and is safe to execute."""

    sql: str
    tables: tuple[str, ...]
    limit: int


def validate_sql(sql: str, whitelist: AstWhitelist, *, max_rows: int) -> ValidatedSql:
    """Validate one generated statement; raise ``ValidationFailure`` otherwise."""
    statement = _parse_single(sql)
    _assert_plain_select(statement)
    scopes = list(build_scope(statement).traverse())  # type: ignore[union-attr]

    table_sources = _check_tables_and_dbs(statement, scopes, whitelist)
    _check_columns(scopes, whitelist)
    _enforce_limit(statement, max_rows)

    tables = tuple(sorted({t.name.lower() for t in table_sources}))
    limit_node = statement.args.get("limit")
    limit = _limit_value(limit_node) or max_rows
    return ValidatedSql(sql=statement.sql(dialect="mysql"), tables=tables, limit=limit)


# --- statement shape -----------------------------------------------------------


def _parse_single(sql: str) -> exp.Expression:
    try:
        statements = sqlglot.parse(sql, read="mysql")
    except sqlglot.errors.ParseError as error:
        msg = f"SQL could not be parsed: {_ANSI_RE.sub('', str(error))}"
        raise ValidationFailure("parse_error", msg) from error
    non_empty = [s for s in statements if s is not None]
    if len(non_empty) != 1:
        msg = f"expected exactly one statement, got {len(non_empty)}"
        raise ValidationFailure("non_select", msg)
    return cast(exp.Expression, non_empty[0])


def _assert_plain_select(statement: exp.Expression) -> None:
    if not isinstance(statement, _QUERY_ROOTS) or isinstance(statement, exp.Subquery):
        msg = f"only a single read-only SELECT is allowed, got {statement.key.upper()}"
        raise ValidationFailure("non_select", msg)
    if statement.args.get("into") is not None:
        msg = "SELECT ... INTO is not allowed"
        raise ValidationFailure("non_select", msg)
    if statement.args.get("lock") is not None:
        msg = "locking clauses (FOR UPDATE / LOCK IN SHARE MODE) are not allowed"
        raise ValidationFailure("non_select", msg)


# --- tables --------------------------------------------------------------------


def _check_tables_and_dbs(
    statement: exp.Expression, scopes: list[Scope], whitelist: AstWhitelist
) -> list[exp.Table]:
    """Check db-prefix and whitelist rules; return the real table sources."""
    allowed = {t.lower() for t in whitelist.tables}

    # Base tables as seen by the scopes (excludes CTE references, which the
    # scope builder turns into nested Scope sources).
    table_sources: dict[int, exp.Table] = {}
    for scope in scopes:
        for source in scope.sources.values():
            if isinstance(source, exp.Table):
                table_sources[id(source)] = source

    cte_names = {cte.alias.lower() for cte in statement.find_all(exp.CTE)}

    for node in statement.find_all(exp.Table):
        if id(node) in table_sources or node.name.lower() in cte_names:
            continue
        # A table reference the scope machinery did not account for —
        # refuse rather than guess (e.g. exotic FROM items).
        msg = f"table '{node.name}' could not be resolved to a whitelisted source"
        raise ValidationFailure("whitelist_violation", msg)

    for table in table_sources.values():
        db = table.db or table.catalog
        if db:
            msg = (
                f"cross-database reference '{db}.{table.name}' is not allowed; "
                "only the water_maze whitelist is queryable"
            )
            raise ValidationFailure("db_not_allowed", msg)
        if table.name.lower() not in allowed:
            msg = (
                f"table '{table.name}' is not in the whitelist "
                f"(allowed: {', '.join(sorted(allowed))})"
            )
            raise ValidationFailure("whitelist_violation", msg)
    return list(table_sources.values())


# --- columns -------------------------------------------------------------------


def _check_columns(scopes: list[Scope], whitelist: AstWhitelist) -> None:
    projected: dict[int, frozenset[str] | None] = {}
    for scope in scopes:
        projected[id(scope)] = _projected_names(scope)

    for scope in scopes:
        for column in scope.columns:
            name = column.name.lower()
            qualifier = column.table
            if qualifier:
                source = scope.sources.get(qualifier) or scope.sources.get(
                    qualifier.lower()
                )
                if source is None:
                    msg = f"column '{column.sql()}' references unknown source '{qualifier}'"
                    raise ValidationFailure("whitelist_violation", msg)
                _check_column_against_source(
                    column.sql(), name, source, whitelist, projected
                )
                continue
            candidates = [
                source
                for source in scope.sources.values()
                if _source_has_column(name, source, whitelist, projected)
            ]
            if not candidates:
                msg = (
                    f"column '{name}' does not exist in any whitelisted table "
                    "of this query (it may be an excluded column; see the "
                    "semantic-layer corrections)"
                )
                raise ValidationFailure("whitelist_violation", msg)
            if len(candidates) > 1:
                msg = (
                    f"column '{name}' is ambiguous across multiple sources "
                    f"({', '.join(sorted(_source_label(s) for s in candidates))}); "
                    "qualify it with a table alias"
                )
                raise ValidationFailure("ambiguous_column", msg)


def _check_column_against_source(
    rendered: str,
    name: str,
    source: exp.Table | Scope,
    whitelist: AstWhitelist,
    projected: dict[int, frozenset[str] | None],
) -> None:
    if isinstance(source, exp.Table):
        if not whitelist.allows(source.name.lower(), name):
            msg = (
                f"column '{rendered}' is not whitelisted for table "
                f"'{source.name}' (excluded or unknown; use the semantic-layer "
                "corrections instead)"
            )
            raise ValidationFailure("whitelist_violation", msg)
        return
    names = projected.get(id(source))
    if names is None or name not in names:
        msg = (
            f"column '{rendered}' cannot be verified against its derived "
            "table/CTE projection; give the projection explicit aliases"
        )
        raise ValidationFailure("whitelist_violation", msg)


def _source_has_column(
    name: str,
    source: exp.Table | Scope,
    whitelist: AstWhitelist,
    projected: dict[int, frozenset[str] | None],
) -> bool:
    if isinstance(source, exp.Table):
        return whitelist.allows(source.name.lower(), name)
    names = projected.get(id(source))
    return names is not None and name in names


def _source_label(source: exp.Table | Scope) -> str:
    if isinstance(source, exp.Table):
        return source.name
    return "<derived>"


def _projected_names(scope: Scope) -> frozenset[str] | None:
    """Column names a derived table/CTE exposes, or None when unverifiable."""
    node = scope.expression
    if not isinstance(node, exp.Select):
        # Set operations and other shapes: projection names not tracked.
        return None
    names: set[str] = set()
    for item in node.expressions:
        if item.find(exp.Star) is not None:
            return None
        name = item.alias_or_name
        if not name:
            return None
        names.add(name.lower())
    return frozenset(names)


# --- limit ---------------------------------------------------------------------


def _limit_value(limit_node: exp.Expression | None) -> int | None:
    if not isinstance(limit_node, exp.Limit):
        return None
    expression = limit_node.expression
    if isinstance(expression, exp.Literal) and expression.is_int:
        return int(expression.name)
    return None


def _enforce_limit(statement: exp.Expression, max_rows: int) -> None:
    current = _limit_value(statement.args.get("limit"))
    if current is None or current > max_rows or current <= 0:
        cast("exp.Select | exp.Union", statement).limit(max_rows, copy=False)

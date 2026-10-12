"""YAML semantic layer: the single source of truth (ADR-0004).

One YAML file describes the whitelisted `water_maze` tables (business
meaning, relations, synonyms, aggregation grain). Everything the
Text-to-SQL pipeline needs — LLM prompt context and the SQLGlot AST
validation whitelist — renders from one loaded `SemanticLayer`, so the
two can never drift apart. Naming traps documented in docs/08 are
corrected here explicitly instead of copying the DDL.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

DEFAULT_YAML_PATH = Path(__file__).parent / "semantic_layer.yaml"
SUPPORTED_VERSION = 1

Cardinality = Literal["many_to_one", "one_to_one", "label_match"]


class SemanticLayerError(Exception):
    """The YAML source contradicts itself; refuse to render anything from it."""


class ColumnSpec(BaseModel):
    """One exposed column: business meaning and, where relevant, its domain."""

    meaning: str
    type: str | None = None
    domain: str | None = None
    caution: str | None = None


class ExcludedColumn(BaseModel):
    """A real column deliberately kept out of the whitelist, with the reason."""

    reason: str
    use_instead: str | None = None


class Correction(BaseModel):
    """A naming/grain trap with its canonical correction (docs/08 risk list)."""

    trap: str
    canonical: str
    canonical_sql: str


class Relation(BaseModel):
    """A declared join path — the source DB has no foreign keys (docs/08)."""

    from_: str = Field(alias="from")
    to: str
    cardinality: Cardinality
    note: str | None = None

    def endpoint_tables(self) -> tuple[str, str]:
        return self.from_.split(".", 1)[0], self.to.split(".", 1)[0]


class TableSpec(BaseModel):
    description: str
    exposed: bool = True
    # Covered in the layer but not created in the DB yet — not queryable.
    status: Literal["planned"] | None = None
    # View that will replace direct access (ticket #7: v_query_* views).
    expose_via: str | None = None
    primary_key: tuple[str, ...] = ()
    columns: dict[str, ColumnSpec] = Field(default_factory=dict)
    excluded_columns: dict[str, ExcludedColumn] = Field(default_factory=dict)

    def check(self) -> None:
        overlap = sorted(set(self.columns) & set(self.excluded_columns))
        if overlap:
            msg = f"columns both exposed and excluded: {overlap}"
            raise SemanticLayerError(msg)
        if self.exposed and not self.columns:
            msg = "exposed but has no whitelisted columns"
            raise SemanticLayerError(msg)


@dataclass(frozen=True)
class AstWhitelist:
    """Table → allowed columns, the shape SQLGlot AST validation consumes."""

    tables: dict[str, frozenset[str]]

    def allows(self, table: str, column: str) -> bool:
        return column in self.tables.get(table, frozenset())


class SemanticLayer(BaseModel):
    """Loaded semantic layer. Renderers hang off this one object."""

    version: int
    tables: dict[str, TableSpec] = Field(default_factory=dict)
    corrections: dict[str, Correction] = Field(default_factory=dict)
    synonyms: dict[str, str] = Field(default_factory=dict)
    relations: list[Relation] = Field(default_factory=list)
    aggregation_rules: list[str] = Field(default_factory=list)

    def check(self) -> None:
        if self.version != SUPPORTED_VERSION:
            msg = f"unsupported schema version {self.version} (expected {SUPPORTED_VERSION})"
            raise SemanticLayerError(msg)
        for name, table in self.tables.items():
            try:
                table.check()
            except SemanticLayerError as error:
                msg = f"table {name!r}: {error}"
                raise SemanticLayerError(msg) from error
        for relation in self.relations:
            for endpoint in relation.endpoint_tables():
                if endpoint not in self.tables:
                    msg = f"relation {relation.from_!r} → {relation.to!r} references unknown table {endpoint!r}"
                    raise SemanticLayerError(msg)

    def ast_whitelist(self) -> AstWhitelist:
        """Whitelist for SQLGlot validation: exposed tables, curated columns only."""
        return AstWhitelist(
            tables={
                name: frozenset(table.columns)
                for name, table in self.tables.items()
                if table.exposed
            }
        )

    def _relation_is_queryable(self, relation: Relation) -> bool:
        return all(
            endpoint in self.tables and self.tables[endpoint].exposed
            for endpoint in relation.endpoint_tables()
        )

    def render_prompt_context(self) -> str:
        """LLM schema context: every whitelisted table and column, with meanings."""
        lines = ["## 可查询表（白名单，列级 curated）"]
        for name, table in self.tables.items():
            if not table.exposed:
                continue
            lines.append(f"### {name} — {table.description}")
            if table.primary_key:
                lines.append(f"主键: {', '.join(table.primary_key)}")
            for column, spec in table.columns.items():
                entry = f"- {column}: {spec.meaning}"
                if spec.type:
                    entry += f" [{spec.type}]"
                if spec.domain:
                    entry += f"（取值: {spec.domain}）"
                if spec.caution:
                    entry += f" ⚠️{spec.caution}"
                lines.append(entry)
        if self.corrections:
            lines.append("## 陷阱纠正口径（必须遵守）")
            for term, correction in self.corrections.items():
                lines.append(f"- {term}: {correction.trap}")
                lines.append(f"  正确口径: {correction.canonical}")
                lines.append(f"  标准表达: {correction.canonical_sql}")
        if self.synonyms:
            lines.append("## 同义词（科研词汇 → 列）")
            for term, target in self.synonyms.items():
                lines.append(f"- {term} → {target}")
        queryable_relations = [
            r for r in self.relations if self._relation_is_queryable(r)
        ]
        if queryable_relations:
            lines.append("## 表关系（全库无外键，join 依据此声明）")
            for relation in queryable_relations:
                entry = f"- {relation.from_} → {relation.to} ({relation.cardinality})"
                if relation.note:
                    entry += f" ⚠️{relation.note}"
                lines.append(entry)
        if self.aggregation_rules:
            lines.append("## 聚合口径")
            for rule in self.aggregation_rules:
                lines.append(f"- {rule}")
        return "\n".join(lines)


def load(path: str | Path | None = None) -> SemanticLayer:
    """Load and structurally validate the semantic layer YAML."""
    yaml_path = Path(path) if path is not None else DEFAULT_YAML_PATH
    raw: Any = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    layer = SemanticLayer.model_validate(raw)
    layer.check()
    return layer

"""Golden QA evaluation package (ticket #9 / M1-T6).

``questions`` holds the docs/09 25-question set as typed constants;
``grading`` holds the pure verdict logic shared by the structure tests,
the env-gated execution tests and ``backend/scripts/run_eval.py``.
"""

from app.text_to_sql.eval.questions import (
    ALGO_VERSION,
    GROUP_DAY_MATRIX,
    QUESTIONS,
    Behavior,
    Category,
    EvalQuestion,
    ExpectedCell,
    question_by_id,
)

__all__ = [
    "ALGO_VERSION",
    "Behavior",
    "Category",
    "EvalQuestion",
    "ExpectedCell",
    "GROUP_DAY_MATRIX",
    "QUESTIONS",
    "question_by_id",
]

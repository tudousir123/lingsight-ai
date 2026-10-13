"""Public trial-catalog behavior using a harmless research-DB fixture."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.trials import get_trial_catalog
from app.core.config import settings
from app.main import app
from app.models import ExperimentAccess, User
from app.trials.catalog import CatalogUnavailable


class FixtureCatalog:
    experiments = [
        {"id": "fixture-e1", "name": "示例实验一", "trial_count": 2},
        {"id": "fixture-e2", "name": "示例实验二", "trial_count": 1},
    ]
    trials = [
        {
            "id": "trial-a",
            "experiment_id": "fixture-e1",
            "video_name": "sample-a.mp4",
            "group_name": "A2",
            "mouse_id": "2",
            "phase": "training_day",
            "date_dir": "0804",
            "training_day": 1,
            "session_no": 1,
            "session_label": "第1次",
            "trial_no": "4",
            "media_available": True,
            "result_available": False,
        },
        {
            "id": "trial-b",
            "experiment_id": "fixture-e1",
            "video_name": "sample-b.mp4",
            "group_name": "c1",
            "mouse_id": "1",
            "phase": "probe_platform_present",
            "date_dir": "0809",
            "training_day": None,
            "session_no": 2,
            "session_label": "第2象限",
            "trial_no": "1",
            "media_available": False,
            "result_available": True,
        },
        {
            "id": "trial-c",
            "experiment_id": "fixture-e2",
            "video_name": "sample-c.mp4",
            "group_name": "A2",
            "mouse_id": "2",
            "phase": "training_day",
            "date_dir": "0805",
            "training_day": 2,
            "session_no": 1,
            "session_label": "第1次",
            "trial_no": "1",
            "media_available": True,
            "result_available": True,
        },
    ]

    def list_experiments(self, allowed_ids: set[str] | None) -> list[dict]:
        return [
            item for item in self.experiments
            if allowed_ids is None or item["id"] in allowed_ids
        ]

    def list_trials(
        self,
        experiment_id: str,
        *,
        group_name: str | None,
        mouse_id: str | None,
        phase: str | None,
        date_dir: str | None,
        skip: int,
        limit: int,
    ) -> tuple[list[dict], int]:
        rows = [
            item for item in self.trials
            if item["experiment_id"] == experiment_id
            and (group_name is None or item["group_name"] == group_name)
            and (mouse_id is None or item["mouse_id"] == mouse_id)
            and (phase is None or item["phase"] == phase)
            and (date_dir is None or item["date_dir"] == date_dir)
        ]
        return rows[skip : skip + limit], len(rows)

    def get_trial(self, experiment_id: str, trial_id: str) -> dict | None:
        return next(
            (
                item for item in self.trials
                if item["experiment_id"] == experiment_id and item["id"] == trial_id
            ),
            None,
        )


@pytest.fixture(autouse=True)
def fixture_catalog() -> Iterator[None]:
    app.dependency_overrides[get_trial_catalog] = FixtureCatalog
    yield
    app.dependency_overrides.pop(get_trial_catalog, None)


@pytest.fixture(autouse=True)
def clean_access(db: Session) -> Iterator[None]:
    db.exec(delete(ExperimentAccess))
    db.commit()
    yield
    db.exec(delete(ExperimentAccess))
    db.commit()


def test_superuser_can_filter_trials_and_open_selected_trial(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    experiments = client.get(
        f"{settings.API_V1_STR}/experiments", headers=superuser_token_headers
    )
    assert experiments.status_code == 200
    assert [row["id"] for row in experiments.json()["data"]] == [
        "fixture-e1", "fixture-e2"
    ]

    response = client.get(
        f"{settings.API_V1_STR}/experiments/fixture-e1/trials",
        params={"group_name": "A2", "mouse_id": "2", "phase": "training_day", "date_dir": "0804"},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["data"][0]["id"] == "trial-a"

    selected = client.get(
        f"{settings.API_V1_STR}/experiments/fixture-e1/trials/trial-a",
        headers=superuser_token_headers,
    )
    assert selected.status_code == 200
    assert selected.json()["video_name"] == "sample-a.mp4"
    assert selected.json()["group_name"] == "A2"
    assert selected.json()["mouse_id"] == "2"


def test_user_only_sees_granted_experiment_and_cross_experiment_trial_is_denied(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    user = db.exec(select(User).where(User.email == settings.EMAIL_TEST_USER)).one()
    db.add(ExperimentAccess(user_id=user.id, experiment_id="fixture-e1"))
    db.commit()

    experiments = client.get(
        f"{settings.API_V1_STR}/experiments", headers=normal_user_token_headers
    )
    assert [row["id"] for row in experiments.json()["data"]] == ["fixture-e1"]

    denied = client.get(
        f"{settings.API_V1_STR}/experiments/fixture-e2/trials/trial-c",
        headers=normal_user_token_headers,
    )
    assert denied.status_code == 403

    wrong_scope = client.get(
        f"{settings.API_V1_STR}/experiments/fixture-e1/trials/trial-c",
        headers=normal_user_token_headers,
    )
    assert wrong_scope.status_code == 404


def test_empty_ungranted_and_missing_trials_have_distinct_outcomes(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    empty = client.get(
        f"{settings.API_V1_STR}/experiments", headers=normal_user_token_headers
    )
    assert empty.status_code == 200
    assert empty.json() == {"data": []}

    denied = client.get(
        f"{settings.API_V1_STR}/experiments/fixture-e1/trials",
        headers=normal_user_token_headers,
    )
    assert denied.status_code == 403

    missing = client.get(
        f"{settings.API_V1_STR}/experiments/fixture-e1/trials/absent",
        headers=superuser_token_headers,
    )
    assert missing.status_code == 404

    unauthenticated = client.get(f"{settings.API_V1_STR}/experiments")
    assert unauthenticated.status_code == 401


def test_research_catalog_failure_is_retryable_service_error(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    class UnavailableCatalog(FixtureCatalog):
        def list_experiments(self, allowed_ids: set[str] | None) -> list[dict]:
            raise CatalogUnavailable

    app.dependency_overrides[get_trial_catalog] = UnavailableCatalog
    response = client.get(
        f"{settings.API_V1_STR}/experiments", headers=superuser_token_headers
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "Research catalog unavailable"

"""Route behavior of the single-trial flow against the committed fixture.

Covers the server-only boundaries the browser tests cannot safely prove
(#18 测试决策): experiment access, identifier mismatch, draft vs final
validation, durable review semantics, media auth/ranges, and response
provenance. The fixture is the same synthetic, non-sensitive data the
Playwright browser flow runs against.
"""

import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.api.routes.trials import _fixture_store, get_trial_catalog
from app.core.config import settings
from app.main import app
from app.models import ExperimentAccess, TrialReview, User
from app.trials.settings import get_trials_settings

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "app" / "trials" / "fixtures"
E1 = "fixture-e1"
E2 = "fixture-e2"
TRIAL_A = "fixture-trial-a"  # full materials
TRIAL_B = "fixture-trial-b"  # media + geometry, but no offline tracking
TRIAL_C = "fixture-trial-c"  # tracking, but no media file and no platform row
TRIAL_D = "fixture-trial-d"  # e2: no markers annotation


@pytest.fixture(autouse=True)
def fixture_mode(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Serve trials from the committed synthetic fixture directory."""
    monkeypatch.setenv("TRIALS_FIXTURE_DIR", str(FIXTURE_DIR))
    get_trials_settings.cache_clear()
    _fixture_store.cache_clear()
    yield
    get_trials_settings.cache_clear()
    _fixture_store.cache_clear()


@pytest.fixture(autouse=True)
def clean_reviews(db: Session) -> Iterator[None]:
    db.exec(delete(TrialReview))
    db.commit()
    yield
    db.exec(delete(TrialReview))
    db.commit()


@pytest.fixture(scope="module")
def granted_user(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> dict[str, str]:
    """A normal user with access to fixture-e1 only."""
    response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json={
            "email": "granted-researcher@example.com",
            "password": "researcher-pass-1",
            "is_active": True,
        },
    )
    assert response.status_code == 200
    user = db.exec(
        select(User).where(User.email == "granted-researcher@example.com")
    ).one()
    db.add(ExperimentAccess(user_id=user.id, experiment_id=E1))
    db.commit()
    token = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": "granted-researcher@example.com",
            "password": "researcher-pass-1",
        },
    )
    assert token.status_code == 200
    return {"Authorization": f"Bearer {token.json()['access_token']}"}


def _url(trial: str, suffix: str = "", experiment: str = E1) -> str:
    return f"{settings.API_V1_STR}/experiments/{experiment}/trials/{trial}{suffix}"


@pytest.mark.usefixtures("client")
def test_fixture_dependency_is_active() -> None:
    assert isinstance(app.dependency_overrides.get(get_trial_catalog), type(None))
    catalog = get_trial_catalog()
    assert catalog.get_trial(E1, TRIAL_A) is not None


class TestPreparation:
    def test_full_trial_carries_identity_and_provenance(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        response = client.get(
            _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
        )
        assert response.status_code == 200
        body = response.json()
        assert body["trial"]["id"] == TRIAL_A
        assert body["trial"]["group_name"] == "SynA"
        # media: overlay preferred, server-resolved URL
        assert body["video"]["kind"] == "overlay"
        assert body["video"]["status"] == "available"
        assert body["video"]["url"].endswith(f"/trials/{TRIAL_A}/media/overlay")
        # geometry with distinct provenance
        assert body["geometry"]["pool"]["status"] == "available"
        assert body["geometry"]["pool"]["source"] == "逐视频测量（videos.pool_*）"
        assert len(body["geometry"]["markers"]["shapes"]) == 4
        assert "LabelMe" in body["geometry"]["markers"]["source"]
        assert body["geometry"]["platform"]["source"].startswith("E1 报告共识坐标")
        # tracking preview with honest frame statuses
        assert body["tracking"]["status"] == "available"
        statuses = [f["status"] for f in body["tracking"]["frames"]]
        assert statuses.count("miss") == 4 and statuses.count("coord") == 2
        assert body["tracking"]["valid_frames"] == 84
        assert body["tracking"]["kp_frames"] == 84
        # speed: gaps stay null (miss frame 20 and edge frames)
        assert body["tracking"]["speed"][0] is None
        assert body["tracking"]["speed"][20] is None
        assert body["tracking"]["speed"][10] is not None
        # persisted metrics with versions, plus calibration-gated ones
        assert {m["metric"] for m in body["metrics"]} >= {
            "dist_px",
            "speed_px",
            "mount_s",
            "escape_latency_s",
        }
        assert {m["metric"] for m in body["metric_unavailable"]} == {
            "dist_cm",
            "speed_cm_s",
        }
        assert len(body["source_version"]) == 16
        assert body["review"] is None

    def test_missing_materials_are_per_field_explicit(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        no_track = client.get(
            _url(TRIAL_B, "/preparation"), headers=superuser_token_headers
        ).json()
        assert no_track["tracking"]["status"] == "missing"
        assert "尚无离线推理结果" in no_track["tracking"]["reason"]
        assert no_track["video"]["status"] == "available"

        no_media = client.get(
            _url(TRIAL_C, "/preparation"), headers=superuser_token_headers
        ).json()
        assert no_media["video"]["status"] == "missing"
        assert no_media["video"]["reason"]
        assert no_media["geometry"]["platform"]["status"] == "missing"
        assert "0810" in no_media["geometry"]["platform"]["reason"]
        assert no_media["tracking"]["status"] == "available"

        no_markers = client.get(
            _url(TRIAL_D, "/preparation", experiment=E2),
            headers=superuser_token_headers,
        ).json()
        assert no_markers["geometry"]["markers"]["status"] == "missing"
        assert no_markers["geometry"]["markers"]["reason"]

    def test_access_and_identity_boundaries(
        self,
        client: TestClient,
        superuser_token_headers: dict[str, str],
        granted_user: dict[str, str],
    ) -> None:
        # no token
        assert client.get(_url(TRIAL_A, "/preparation")).status_code == 401
        # ungranted experiment
        assert (
            client.get(
                _url(TRIAL_D, "/preparation", experiment=E2), headers=granted_user
            ).status_code
            == 403
        )
        # granted experiment works
        assert (
            client.get(_url(TRIAL_A, "/preparation"), headers=granted_user).status_code
            == 200
        )
        # identifier mismatch: trial from another experiment
        assert (
            client.get(
                _url(TRIAL_D, "/preparation"), headers=superuser_token_headers
            ).status_code
            == 404
        )
        # unknown trial
        assert (
            client.get(
                _url("fixture-trial-x", "/preparation"), headers=superuser_token_headers
            ).status_code
            == 404
        )


def _update(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "source_version": "placeholder",
        "boundary_ok": False,
        "markers_ok": False,
        "platform_ok": False,
        "tracking_ok": False,
        "state": "draft",
    }
    payload.update(overrides)
    return payload


class TestReviewPersistence:
    def test_draft_save_and_reload_roundtrip(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        preparation = client.get(
            _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
        ).json()
        version = preparation["source_version"]

        saved = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(source_version=version, boundary_ok=True, markers_ok=True),
        )
        assert saved.status_code == 200
        assert saved.json()["state"] == "draft"
        assert saved.json()["boundary_ok"] is True
        assert saved.json()["markers_ok"] is True
        assert saved.json()["confirmed_at"] is None
        assert saved.json()["reviewer_email"]

        # reload reconstructs the persisted state
        reloaded = client.get(
            _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
        ).json()
        review = reloaded["review"]
        assert review is not None
        assert review["state"] == "draft"
        assert review["boundary_ok"] is True and review["markers_ok"] is True
        assert review["tracking_ok"] is False

    def test_final_confirmation_gates(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        version = client.get(
            _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
        ).json()["source_version"]

        # three of four acknowledgements: rejected
        partial = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(
                source_version=version,
                boundary_ok=True,
                markers_ok=True,
                platform_ok=True,
                state="confirmed",
            ),
        )
        assert partial.status_code == 422
        assert "四项" in partial.json()["detail"]

        # all four on a full trial: confirmed with audit trail
        final = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(
                source_version=version,
                boundary_ok=True,
                markers_ok=True,
                platform_ok=True,
                tracking_ok=True,
                state="confirmed",
            ),
        )
        assert final.status_code == 200
        body = final.json()
        assert body["state"] == "confirmed"
        assert body["confirmed_at"] is not None
        assert body["reviewer_email"]

        # a confirmed record is terminal: the same confirmation replays
        # idempotently, but any modification (downgrade to draft, changed
        # checks) is rejected instead of silently clearing confirmed_at
        replay = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(
                source_version=version,
                boundary_ok=True,
                markers_ok=True,
                platform_ok=True,
                tracking_ok=True,
                state="confirmed",
            ),
        )
        assert replay.status_code == 200
        assert replay.json()["confirmed_at"] == body["confirmed_at"]

        downgrade = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(source_version=version, state="draft"),
        )
        assert downgrade.status_code == 422
        assert "已最终确认" in downgrade.json()["detail"]

        rewrite = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(
                source_version=version,
                boundary_ok=True,
                markers_ok=True,
                platform_ok=True,
                state="confirmed",
            ),
        )
        assert rewrite.status_code == 422
        assert "已最终确认" in rewrite.json()["detail"]

        # still confirmed afterwards
        after = client.get(
            _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
        ).json()["review"]
        assert after["state"] == "confirmed"
        assert after["confirmed_at"] == body["confirmed_at"]

        # all four but tracking material missing: rejected with the reason
        version_b = client.get(
            _url(TRIAL_B, "/preparation"), headers=superuser_token_headers
        ).json()["source_version"]
        rejected = client.put(
            _url(TRIAL_B, "/review"),
            headers=superuser_token_headers,
            json=_update(
                source_version=version_b,
                boundary_ok=True,
                markers_ok=True,
                platform_ok=True,
                tracking_ok=True,
                state="confirmed",
            ),
        )
        assert rejected.status_code == 422
        assert "离线追踪结果" in rejected.json()["detail"]

    def test_source_version_conflict_rejects_stale_saves(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        stale = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(source_version="deadbeefdeadbeef", boundary_ok=True),
        )
        assert stale.status_code == 409
        assert "素材已更新" in stale.json()["detail"]

    def test_reviews_are_per_user(
        self,
        client: TestClient,
        superuser_token_headers: dict[str, str],
        granted_user: dict[str, str],
    ) -> None:
        version = client.get(
            _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
        ).json()["source_version"]
        assert (
            client.put(
                _url(TRIAL_A, "/review"),
                headers=superuser_token_headers,
                json=_update(source_version=version, boundary_ok=True),
            ).status_code
            == 200
        )
        # another researcher starts from a clean slate
        other = client.get(_url(TRIAL_A, "/preparation"), headers=granted_user).json()
        assert other["review"] is None

    def test_review_on_missing_trial_is_404(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        response = client.put(
            _url("fixture-trial-x", "/review"),
            headers=superuser_token_headers,
            json=_update(source_version="x"),
        )
        assert response.status_code == 404


def test_changed_materials_require_new_review_and_preserve_history(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture_dir = tmp_path / "fixtures"
    shutil.copytree(FIXTURE_DIR, fixture_dir)
    monkeypatch.setenv("TRIALS_FIXTURE_DIR", str(fixture_dir))
    get_trials_settings.cache_clear()
    _fixture_store.cache_clear()
    first = client.get(
        _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
    ).json()
    update = _update(
        source_version=first["source_version"],
        boundary_ok=True,
        markers_ok=True,
        platform_ok=True,
        tracking_ok=True,
        state="confirmed",
    )
    saved = client.put(
        _url(TRIAL_A, "/review"), headers=superuser_token_headers, json=update
    )
    assert saved.status_code == 200

    fixture_file = fixture_dir / "fixture.json"
    data = json.loads(fixture_file.read_text())
    row = next(row for row in data["trials"] if row["id"] == TRIAL_A)
    frame = next(
        frame for frame in row["track"]["frames"] if frame["center"] is not None
    )
    frame["center"][0] += 1
    fixture_file.write_text(json.dumps(data))
    _fixture_store.cache_clear()

    second = client.get(
        _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
    ).json()
    assert second["source_version"] != first["source_version"]
    assert second["review"] is None
    result = client.get(
        _url(TRIAL_A, "/result"), headers=superuser_token_headers
    ).json()
    assert result["states"]["preparation_review"] is None
    assert (
        client.put(
            _url(TRIAL_A, "/review"), headers=superuser_token_headers, json=update
        ).status_code
        == 409
    )

    update["source_version"] = second["source_version"]
    assert (
        client.put(
            _url(TRIAL_A, "/review"), headers=superuser_token_headers, json=update
        ).status_code
        == 200
    )
    reviews = db.exec(select(TrialReview).where(TrialReview.trial_id == TRIAL_A)).all()
    assert {review.source_version for review in reviews} == {
        first["source_version"],
        second["source_version"],
    }
    assert all(review.state == "confirmed" for review in reviews)


def test_concurrent_review_writes_preserve_confirmation(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    version = client.get(
        _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
    ).json()["source_version"]
    start = Barrier(2)

    def save(state: str) -> int:
        start.wait(timeout=10)
        response = client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(
                source_version=version,
                boundary_ok=True,
                markers_ok=True,
                platform_ok=True,
                tracking_ok=True,
                state=state,
            ),
        )
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        draft = pool.submit(save, "draft")
        final = pool.submit(save, "confirmed")
        assert final.result(timeout=15) == 200
        assert draft.result(timeout=15) in (200, 422)
    reviews = db.exec(select(TrialReview).where(TrialReview.trial_id == TRIAL_A)).all()
    assert len(reviews) == 1
    assert reviews[0].state == "confirmed"
    assert reviews[0].confirmed_at is not None


class TestResult:
    def test_result_keeps_same_trial_identity_and_states(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        version = client.get(
            _url(TRIAL_A, "/preparation"), headers=superuser_token_headers
        ).json()["source_version"]
        client.put(
            _url(TRIAL_A, "/review"),
            headers=superuser_token_headers,
            json=_update(
                source_version=version,
                boundary_ok=True,
                markers_ok=True,
                platform_ok=True,
                tracking_ok=True,
                state="confirmed",
            ),
        )
        response = client.get(_url(TRIAL_A, "/result"), headers=superuser_token_headers)
        assert response.status_code == 200
        body = response.json()
        assert body["trial"]["id"] == TRIAL_A
        assert body["video"]["kind"] == "overlay"
        assert body["track"]["status"] == "available"
        assert len(body["track"]["frames"]) == 90
        # geometric candidate is labeled as candidate, not a mount
        candidate = body["platform_entry_candidate"]
        assert candidate is not None
        assert "几何候选" in candidate["note"]
        assert candidate["time_s"] == pytest.approx(61 / 30, abs=1e-3)
        # three distinct states; qc marker never equals manual confirmation
        assert body["states"]["inference_available"] is True
        assert body["states"]["qc_status"] == "review"
        assert body["states"]["preparation_review"]["state"] == "confirmed"
        assert body["states"]["preparation_review"]["reviewer_email"]
        assert body["states"]["result_quality"] == "not_started"
        # metrics carry units and versions
        by_metric = {m["metric"]: m for m in body["metrics"]}
        assert by_metric["dist_px"]["unit"] == "px"
        assert by_metric["escape_latency_s"]["algo_version"].startswith(
            "v1-platformzone"
        )
        # failure metrics keep their reason instead of a value
        assert by_metric["mount_s"]["value"] is not None

    def test_result_failure_metrics_show_reason_not_zero(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        body = client.get(
            _url(TRIAL_D, "/result", experiment=E2), headers=superuser_token_headers
        ).json()
        by_metric = {m["metric"]: m for m in body["metrics"]}
        assert by_metric["mount_s"]["value"] is None
        assert by_metric["mount_s"]["calc_status"] == "no_mount"
        assert by_metric["escape_latency_s"]["calc_status"] == "no_mount"

    def test_result_with_missing_track_is_explicit_not_fabricated(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        body = client.get(
            _url(TRIAL_B, "/result"), headers=superuser_token_headers
        ).json()
        assert body["trial"]["id"] == TRIAL_B
        assert body["track"]["status"] == "missing"
        assert "尚无离线推理结果" in body["track"]["reason"]
        assert body["states"]["inference_available"] is False
        assert body["platform_entry_candidate"] is None

    def test_result_identifier_mismatch_is_404(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        assert (
            client.get(
                _url(TRIAL_D, "/result"), headers=superuser_token_headers
            ).status_code
            == 404
        )


class TestMedia:
    def test_media_served_with_auth_header_and_range(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        response = client.get(
            _url(TRIAL_A, "/media/overlay"), headers=superuser_token_headers
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "video/mp4"
        assert len(response.content) > 1000

        partial = client.get(
            _url(TRIAL_A, "/media/overlay"),
            headers={**superuser_token_headers, "Range": "bytes=0-99"},
        )
        assert partial.status_code == 206
        assert len(partial.content) == 100
        assert partial.headers["content-range"].startswith("bytes 0-99/")

    def test_media_accepts_query_token_for_video_elements(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        token = superuser_token_headers["Authorization"].split(" ", 1)[1]
        response = client.get(f"{_url(TRIAL_A, '/media/source')}?token={token}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "video/mp4"

    def test_media_rejects_missing_or_bad_token(self, client: TestClient) -> None:
        assert client.get(_url(TRIAL_A, "/media/source")).status_code == 403
        assert (
            client.get(f"{_url(TRIAL_A, '/media/source')}?token=not-a-jwt").status_code
            == 403
        )

    def test_media_requires_experiment_access(
        self, client: TestClient, granted_user: dict[str, str]
    ) -> None:
        assert (
            client.get(
                _url(TRIAL_D, "/media/source", experiment=E2), headers=granted_user
            ).status_code
            == 403
        )

    def test_missing_media_file_is_404(
        self, client: TestClient, superuser_token_headers: dict[str, str]
    ) -> None:
        assert (
            client.get(
                _url(TRIAL_C, "/media/source"), headers=superuser_token_headers
            ).status_code
            == 404
        )
        # trial-b has no overlay file
        assert (
            client.get(
                _url(TRIAL_B, "/media/overlay"), headers=superuser_token_headers
            ).status_code
            == 404
        )
        # invalid kind
        assert (
            client.get(
                _url(TRIAL_A, "/media/other"), headers=superuser_token_headers
            ).status_code
            == 422
        )

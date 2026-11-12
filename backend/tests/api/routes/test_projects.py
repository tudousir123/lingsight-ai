"""Project entity API: user-owned grouping of agent tasks and videos (#42)."""

import uuid
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import Project
from tests.utils.user import create_random_user


def _unique_name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _create_project(
    client: TestClient, headers: dict[str, str], name: str
) -> dict[str, object]:
    response = client.post(
        f"{settings.API_V1_STR}/projects/", json={"name": name}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def _list_projects(
    client: TestClient, headers: dict[str, str]
) -> list[dict[str, object]]:
    response = client.get(f"{settings.API_V1_STR}/projects/", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _cleanup(db: Session, *project_ids: str) -> None:
    from app import crud

    for project_id in project_ids:
        project = db.get(Project, uuid.UUID(project_id))
        if project:
            crud.delete_project(session=db, project=project)


def test_create_project_requires_auth(client: TestClient) -> None:
    response = client.post(f"{settings.API_V1_STR}/projects/", json={"name": "x"})
    assert response.status_code == 401


def test_blank_project_name_is_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    for name in ("", "   "):
        response = client.post(
            f"{settings.API_V1_STR}/projects/",
            json={"name": name},
            headers=normal_user_token_headers,
        )
        assert response.status_code == 422


def test_create_rename_delete_project(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    name = _unique_name("归组")
    project = _create_project(client, normal_user_token_headers, name)
    project_id = str(project["id"])
    assert project["name"] == name
    assert project["members"] == []

    listing = _list_projects(client, normal_user_token_headers)
    assert any(item["id"] == project_id and item["name"] == name for item in listing)

    renamed = _unique_name("改名")
    response = client.patch(
        f"{settings.API_V1_STR}/projects/{project_id}",
        json={"name": renamed},
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == renamed

    response = client.delete(
        f"{settings.API_V1_STR}/projects/{project_id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    listing = _list_projects(client, normal_user_token_headers)
    assert not any(item["id"] == project_id for item in listing)


def test_duplicate_project_name_conflicts(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    name = _unique_name("同名")
    project = _create_project(client, normal_user_token_headers, name)
    try:
        response = client.post(
            f"{settings.API_V1_STR}/projects/",
            json={"name": name},
            headers=normal_user_token_headers,
        )
        assert response.status_code == 409

        # MySQL's default collation is case-insensitive; so is the conflict.
        response = client.post(
            f"{settings.API_V1_STR}/projects/",
            json={"name": name.upper()},
            headers=normal_user_token_headers,
        )
        assert response.status_code == 409

        other = _create_project(client, normal_user_token_headers, _unique_name("他名"))
        try:
            response = client.patch(
                f"{settings.API_V1_STR}/projects/{project['id']}",
                json={"name": other["name"]},
                headers=normal_user_token_headers,
            )
            assert response.status_code == 409
        finally:
            _cleanup(db, str(other["id"]))
    finally:
        _cleanup(db, str(project["id"]))


def test_projects_are_private_to_their_owner(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    name = _unique_name("隔离")
    project = _create_project(client, normal_user_token_headers, name)
    project_id = str(project["id"])
    try:
        listing = _list_projects(client, superuser_token_headers)
        assert not any(item["id"] == project_id for item in listing)

        response = client.patch(
            f"{settings.API_V1_STR}/projects/{project_id}",
            json={"name": _unique_name("越权")},
            headers=superuser_token_headers,
        )
        assert response.status_code == 404

        response = client.delete(
            f"{settings.API_V1_STR}/projects/{project_id}",
            headers=superuser_token_headers,
        )
        assert response.status_code == 404
    finally:
        _cleanup(db, project_id)


def test_member_add_remove_is_idempotent(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    project = _create_project(client, normal_user_token_headers, _unique_name("成员"))
    project_id = str(project["id"])
    try:
        member_url = f"{settings.API_V1_STR}/projects/{project_id}/members"

        first = client.post(
            member_url,
            json={"kind": "agent_task", "id": "task-1"},
            headers=normal_user_token_headers,
        )
        assert first.status_code == 201, first.text

        again = client.post(
            member_url,
            json={"kind": "agent_task", "id": "task-1"},
            headers=normal_user_token_headers,
        )
        assert again.status_code == 200, again.text

        video = client.post(
            member_url,
            json={"kind": "video", "id": "video-9", "label": "Day5-Trial3.mp4"},
            headers=normal_user_token_headers,
        )
        assert video.status_code == 201, video.text

        listing = _list_projects(client, normal_user_token_headers)
        stored = next(item for item in listing if item["id"] == project_id)
        assert [m["id"] for m in stored["members"]] == ["task-1", "video-9"]
        assert stored["members"][1]["label"] == "Day5-Trial3.mp4"

        removed = client.delete(
            f"{member_url}/agent_task/task-1", headers=normal_user_token_headers
        )
        assert removed.status_code == 204

        missing = client.delete(
            f"{member_url}/agent_task/task-1", headers=normal_user_token_headers
        )
        assert missing.status_code == 404

        invalid = client.post(
            member_url,
            json={"kind": "experiment", "id": "exp-1"},
            headers=normal_user_token_headers,
        )
        assert invalid.status_code == 422
    finally:
        _cleanup(db, project_id)


def test_import_local_projects_is_idempotent_and_never_overwrites(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    keep = _unique_name("保留")
    fresh = _unique_name("新建")
    import_url = f"{settings.API_V1_STR}/projects/import"
    payload = {
        "projects": [
            {"name": keep, "task_ids": ["task-a", "task-b", "task-a"]},
            {"name": fresh, "task_ids": []},
        ]
    }

    first = client.post(import_url, json=payload, headers=normal_user_token_headers)
    assert first.status_code == 200, first.text
    assert first.json() == {"created": 2, "skipped": 0}

    listing = _list_projects(client, normal_user_token_headers)
    imported = next(item for item in listing if item["name"] == keep)
    # Duplicate ids inside one folder collapse into one reference.
    assert [m["id"] for m in imported["members"]] == ["task-a", "task-b"]
    keep_id = str(imported["id"])

    # The user reorganizes server-side: one member is removed by hand.
    removed = client.delete(
        f"{settings.API_V1_STR}/projects/{keep_id}/members/agent_task/task-a",
        headers=normal_user_token_headers,
    )
    assert removed.status_code == 204

    replay = client.post(import_url, json=payload, headers=normal_user_token_headers)
    assert replay.json() == {"created": 0, "skipped": 2}

    # Replaying did not resurrect the manually removed member.
    listing = _list_projects(client, normal_user_token_headers)
    imported = next(item for item in listing if item["id"] == keep_id)
    assert [m["id"] for m in imported["members"]] == ["task-b"]

    extra = client.post(
        import_url,
        json={"projects": [{"name": _unique_name("追加"), "task_ids": ["task-c"]}]},
        headers=normal_user_token_headers,
    )
    assert extra.json() == {"created": 1, "skipped": 0}

    listing = _list_projects(client, normal_user_token_headers)
    assert any(item["name"] == keep for item in listing)
    created_ids = [
        str(item["id"])
        for item in listing
        if item["name"] in (keep, fresh) or item["name"].startswith("追加")
    ]
    _cleanup(db, *created_ids)


def test_import_is_private_to_the_importing_user(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    name = _unique_name("私导")
    response = client.post(
        f"{settings.API_V1_STR}/projects/import",
        json={"projects": [{"name": name, "task_ids": ["task-x"]}]},
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    try:
        listing = _list_projects(client, superuser_token_headers)
        assert not any(item["name"] == name for item in listing)
    finally:
        listing = _list_projects(client, normal_user_token_headers)
        for item in listing:
            if item["name"] == name:
                _cleanup(db, str(item["id"]))


def test_random_new_user_gets_an_empty_project_list(
    client: TestClient, db: Session
) -> None:
    from tests.utils.user import authentication_token_from_email

    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)
    listing = _list_projects(client, headers)
    assert listing == []


def test_long_video_reference_round_trip(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    project = _create_project(client, normal_user_token_headers, _unique_name("长视频"))
    project_id = str(project["id"])
    video_id = "v1." + "a" * 4093
    url = f"{settings.API_V1_STR}/projects/{project_id}/members"
    try:
        first = client.post(
            url,
            json={"kind": "video", "id": video_id},
            headers=normal_user_token_headers,
        )
        assert first.status_code == 201, first.text
        replay = client.post(
            url,
            json={"kind": "video", "id": video_id},
            headers=normal_user_token_headers,
        )
        assert replay.status_code == 200, replay.text
        saved = next(
            p
            for p in _list_projects(client, normal_user_token_headers)
            if p["id"] == project_id
        )
        assert [m["id"] for m in saved["members"]] == [video_id]
        removed = client.delete(
            f"{url}/video/{video_id}", headers=normal_user_token_headers
        )
        assert removed.status_code == 204, removed.text
    finally:
        _cleanup(db, project_id)


def test_selected_video_folder_survives_project_reload(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    project = _create_project(client, normal_user_token_headers, _unique_name("目录"))
    project_id = str(project["id"])
    observed = []
    original = httpx.Client

    def upstream(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return httpx.Response(
            200, json={"source_id": "lab-nas", "path": "Day1/Batch2", "items": []}
        )

    try:
        with (
            patch.object(settings, "AGENT_WORKSPACE_EMAIL", settings.EMAIL_TEST_USER),
            patch.object(settings, "INFERENCE_API_TOKEN", "isolated-token"),
            patch.object(settings, "INFERENCE_BASE_URL", "http://inference.test"),
            patch(
                "app.inference_client.httpx.Client",
                side_effect=lambda **kw: original(
                    transport=httpx.MockTransport(upstream), **kw
                ),
            ),
        ):
            response = client.put(
                f"{settings.API_V1_STR}/projects/{project_id}/video-folder",
                json={"source_id": "lab-nas", "path": "Day1/Batch2"},
                headers=normal_user_token_headers,
            )
        assert response.status_code == 200, response.text
        expected = {"source_id": "lab-nas", "path": "Day1/Batch2", "label": "Batch2"}
        assert response.json()["video_folder"] == expected
        stored = next(
            p
            for p in _list_projects(client, normal_user_token_headers)
            if p["id"] == project_id
        )
        assert stored["video_folder"] == expected
        assert len(observed) == 1
        assert observed[0].url.path == "/v1/videos"
        assert dict(observed[0].url.params) == {
            "source_id": "lab-nas",
            "path": "Day1/Batch2",
        }
        assert observed[0].headers["authorization"] == "Bearer isolated-token"
    finally:
        _cleanup(db, project_id)


@pytest.mark.parametrize("status", [404, 503, 500])
def test_unreadable_folder_does_not_replace_saved_reference(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    status: int,
) -> None:
    project = _create_project(
        client, normal_user_token_headers, _unique_name("失败保留")
    )
    project_id = str(project["id"])
    original = httpx.Client
    ready = {"source_id": "legacy", "path": "ok", "items": []}
    state = {"status": 200}

    def upstream(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            state["status"],
            json=ready
            if state["status"] == 200
            else {"detail": "private path must not escape"},
        )

    try:
        with (
            patch.object(settings, "AGENT_WORKSPACE_EMAIL", settings.EMAIL_TEST_USER),
            patch.object(settings, "INFERENCE_API_TOKEN", "isolated-token"),
            patch.object(settings, "INFERENCE_BASE_URL", "http://inference.test"),
            patch(
                "app.inference_client.httpx.Client",
                side_effect=lambda **kw: original(
                    transport=httpx.MockTransport(upstream), **kw
                ),
            ),
        ):
            url = f"{settings.API_V1_STR}/projects/{project_id}/video-folder"
            saved = client.put(
                url,
                json={"source_id": "legacy", "path": "ok"},
                headers=normal_user_token_headers,
            )
            assert saved.status_code == 200, saved.text
            state["status"] = status
            failed = client.put(
                url,
                json={"source_id": "legacy", "path": "missing"},
                headers=normal_user_token_headers,
            )
            assert failed.status_code == (status if status in (404, 503) else 502), (
                failed.text
            )
            assert "private path" not in failed.text
        stored = next(
            p
            for p in _list_projects(client, normal_user_token_headers)
            if p["id"] == project_id
        )
        assert stored["video_folder"]["path"] == "ok"
    finally:
        _cleanup(db, project_id)


def test_folder_selection_rejects_other_owner_and_path_traversal(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    project = _create_project(
        client, normal_user_token_headers, _unique_name("目录隔离")
    )
    project_id = str(project["id"])
    try:
        url = f"{settings.API_V1_STR}/projects/{project_id}/video-folder"
        forbidden = client.put(
            url,
            json={"source_id": "legacy", "path": ""},
            headers=superuser_token_headers,
        )
        assert forbidden.status_code == 404
        for path in [
            "/etc",
            "../secret",
            "day/../../secret",
            "C:\\secret",
            "bad\x00path",
        ]:
            response = client.put(
                url,
                json={"source_id": "legacy", "path": path},
                headers=normal_user_token_headers,
            )
            assert response.status_code == 422, response.text
    finally:
        _cleanup(db, project_id)

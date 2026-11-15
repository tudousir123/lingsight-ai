"""User authorization contracts through authenticated platform HTTP."""

import uuid

from fastapi.testclient import TestClient


def signup(client: TestClient) -> tuple[str, dict[str, str]]:
    email = f"scope-{uuid.uuid4()}@example.com"
    password = "scope-test-password"
    response = client.post(
        "/api/v1/users/signup", json={"email": email, "password": password}
    )
    assert response.status_code == 200
    token = client.post(
        "/api/v1/login/access-token", data={"username": email, "password": password}
    )
    assert token.status_code == 200
    return response.json()["id"], {
        "Authorization": f"Bearer {token.json()['access_token']}"
    }


def test_signup_immediately_gets_private_workspace_without_library(
    client: TestClient,
) -> None:
    user_id, headers = signup(client)
    workspace = client.get("/api/v1/users/me/workspace", headers=headers)
    assert workspace.status_code == 200
    assert workspace.json() == {
        "user_id": user_id,
        "workspace_enabled": True,
        "whole_library_access": False,
        "allowed_experiment_ids": [],
        "upload": {"max_bytes": 2_000_000_000, "extensions": ["mp4", "avi"]},
    }
    created = client.post(
        "/api/v1/projects/", headers=headers, json={"name": "My research"}
    )
    assert created.status_code == 200


def test_admin_grant_revoke_is_persistent_and_idempotent(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    user_id, headers = signup(client)
    path = f"/api/v1/users/{user_id}/whole-library-access"
    assert client.get(path, headers=headers).status_code == 403
    assert (
        client.put(
            path, headers=headers, json={"granted": True, "reason": "self grant"}
        ).status_code
        == 403
    )
    initial = client.get(path, headers=superuser_token_headers)
    assert initial.status_code == 200
    assert initial.json()["granted"] is False
    grant = client.put(
        path,
        headers=superuser_token_headers,
        json={"granted": True, "reason": " Approved research "},
    )
    assert grant.status_code == 200
    assert grant.json()["granted"] is True
    assert grant.json()["effective"] is True
    assert grant.json()["reason"] == "Approved research"
    replay = client.put(
        path,
        headers=superuser_token_headers,
        json={"granted": True, "reason": "Approved research"},
    )
    assert replay.json() == grant.json()
    assert client.get(path, headers=superuser_token_headers).json() == grant.json()
    assert (
        client.get("/api/v1/users/me/workspace", headers=headers).json()[
            "whole_library_access"
        ]
        is True
    )
    revoked = client.put(
        path,
        headers=superuser_token_headers,
        json={"granted": False, "reason": "Research ended"},
    )
    assert revoked.status_code == 200
    assert revoked.json()["effective"] is False
    assert (
        client.get("/api/v1/users/me/workspace", headers=headers).json()[
            "whole_library_access"
        ]
        is False
    )
    assert (
        client.put(
            path,
            headers=superuser_token_headers,
            json={"granted": True, "reason": "  "},
        ).status_code
        == 422
    )
    assert (
        client.put(
            path,
            headers=superuser_token_headers,
            json={"granted": True, "reason": "x" * 1001},
        ).status_code
        == 422
    )


def test_internal_authorization_uses_dedicated_token_and_current_grant(
    client: TestClient, superuser_token_headers: dict[str, str], monkeypatch
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(
        settings, "AGENT_AUTHORIZATION_TOKEN", "internal-test-only", raising=False
    )
    user_id, headers = signup(client)
    path = "/api/v1/internal/agent/authorize"
    body = {"user_id": user_id, "data_scope": "none", "project_id": None}
    assert client.post(path, headers=headers, json=body).status_code == 401
    internal = {"Authorization": "Bearer internal-test-only"}
    allowed = client.post(path, headers=internal, json=body)
    assert allowed.status_code == 200
    assert allowed.json()["allowed_publication_task_ids"] == []
    assert allowed.json()["user_id"] == user_id
    body["data_scope"] = "whole_library"
    assert client.post(path, headers=internal, json=body).status_code == 403
    grant_path = f"/api/v1/users/{user_id}/whole-library-access"
    client.put(
        grant_path,
        headers=superuser_token_headers,
        json={"granted": True, "reason": "Study"},
    )
    granted = client.post(path, headers=internal, json=body)
    assert granted.status_code == 200
    assert (
        granted.json()["authorization_revision"]
        != allowed.json()["authorization_revision"]
    )
    client.put(
        grant_path,
        headers=superuser_token_headers,
        json={"granted": False, "reason": "Revoked"},
    )
    assert client.post(path, headers=internal, json=body).status_code == 403
    client.patch(
        f"/api/v1/users/{user_id}",
        headers=superuser_token_headers,
        json={"is_active": False},
    )
    body["data_scope"] = "none"
    assert client.post(path, headers=internal, json=body).status_code == 403


def test_library_revocation_preserves_only_explicit_experiment(
    client: TestClient, db, superuser_token_headers: dict[str, str]
) -> None:
    from app.api.routes.trials import get_trial_assets, get_trial_catalog
    from app.main import app
    from app.models import ExperimentAccess
    from tests.api.routes.test_trials import FixtureCatalog

    user_id, headers = signup(client)
    app.dependency_overrides[get_trial_catalog] = FixtureCatalog
    app.dependency_overrides[get_trial_assets] = lambda: object()
    try:
        assert client.get("/api/v1/experiments", headers=headers).json() == {"data": []}
        # Seed an existing single-experiment grant, which has no public mutation API.
        db.add(ExperimentAccess(user_id=uuid.UUID(user_id), experiment_id="fixture-e1"))
        db.commit()
        initial = client.get("/api/v1/users/me/workspace", headers=headers).json()
        assert initial["allowed_experiment_ids"] == ["fixture-e1"]
        assert initial["whole_library_access"] is False
        path = f"/api/v1/users/{user_id}/whole-library-access"
        client.put(
            path,
            headers=superuser_token_headers,
            json={"granted": True, "reason": "Study"},
        )
        assert (
            len(client.get("/api/v1/experiments", headers=headers).json()["data"]) == 2
        )
        assert (
            client.get(
                "/api/v1/experiments/fixture-e2/trials", headers=headers
            ).status_code
            == 200
        )
        client.put(
            path,
            headers=superuser_token_headers,
            json={"granted": False, "reason": "Revoke"},
        )
        assert [
            row["id"]
            for row in client.get("/api/v1/experiments", headers=headers).json()["data"]
        ] == ["fixture-e1"]
        assert (
            client.get(
                "/api/v1/experiments/fixture-e1/trials", headers=headers
            ).status_code
            == 200
        )
        paths = [
            "",
            "/trial-c",
            "/trial-c/preparation",
            "/trial-c/result",
            "/trial-c/media/source",
            "/trial-c/media/overlay",
        ]
        for suffix in paths:
            assert (
                client.get(
                    f"/api/v1/experiments/fixture-e2/trials{suffix}", headers=headers
                ).status_code
                == 403
            )
        # JWT query-token and Range do not bypass the same experiment check.
        token = headers["Authorization"].split()[1]
        assert (
            client.get(
                f"/api/v1/experiments/fixture-e2/trials/trial-c/media/source?token={token}",
                headers={"Range": "bytes=0-8"},
            ).status_code
            == 403
        )
    finally:
        app.dependency_overrides.pop(get_trial_catalog, None)
        app.dependency_overrides.pop(get_trial_assets, None)


def test_callback_rejects_missing_or_foreign_project_and_invalid_combination(
    client: TestClient, monkeypatch
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "AGENT_AUTHORIZATION_TOKEN", "internal-test-only")
    user_id, headers = signup(client)
    other_id, other_headers = signup(client)
    project_id = client.post(
        "/api/v1/projects/", headers=headers, json={"name": "Private"}
    ).json()["id"]
    internal = {"Authorization": "Bearer internal-test-only"}
    path = "/api/v1/internal/agent/authorize"
    assert (
        client.post(
            path,
            headers=internal,
            json={
                "user_id": other_id,
                "data_scope": "project",
                "project_id": project_id,
            },
        ).status_code
        == 404
    )
    assert (
        client.post(
            path,
            headers=internal,
            json={
                "user_id": user_id,
                "data_scope": "project",
                "project_id": str(uuid.uuid4()),
            },
        ).status_code
        == 404
    )
    for data_scope, project in [
        ("none", project_id),
        ("whole_library", project_id),
        ("project", None),
    ]:
        assert (
            client.post(
                path,
                headers=internal,
                json={
                    "user_id": user_id,
                    "data_scope": data_scope,
                    "project_id": project,
                },
            ).status_code
            == 422
        )
    assert client.get(
        f"/api/v1/projects/{project_id}", headers=other_headers
    ).status_code in {404, 405}

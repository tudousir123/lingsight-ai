"""Real JWT gateway + production ModelRuntime/Harness + pinned Chromium, synthetic only."""

import time
import uuid
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from tests.api.routes import test_agent_project_http
from tests.api.routes.test_platform_user_flow import signup


@pytest.fixture
def agent_http(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, request: pytest.FixtureRequest
) -> Iterator[str]:
    yield from test_agent_project_http.agent_http.__wrapped__(
        monkeypatch, client, request
    )


@pytest.mark.parametrize(
    "agent_http", [("browser-contract-fixture.ts", True)], indirect=True
)
def test_real_browser_owner_authorization_effect_and_workspace_source(
    client: TestClient, agent_http: str
) -> None:
    owner, _ = signup(client)
    other, _ = signup(client)
    base = f"{settings.API_V1_STR}/agent"

    def finish(run_id: str) -> dict:
        deadline = time.monotonic() + 25
        while True:
            response = client.get(f"{base}/runs/{run_id}", headers=owner)
            assert response.status_code == 200, response.text
            run = response.json()
            if run["status"] not in {"queued", "running"}:
                return run
            assert time.monotonic() < deadline, run
            time.sleep(0.03)

    with httpx.Client(
        trust_env=False,
        headers={"Authorization": "Bearer synthetic-contract-token-000000000"},
    ) as control:
        state = control.get(f"{agent_http}/fixture/state").json()
        assert state["effects"] == 0
        control.post(
            f"{agent_http}/fixture/select", json={"page": "/form", "mode": "submit"}
        ).raise_for_status()
        created = client.post(
            f"{base}/tasks",
            headers=owner,
            json={
                "goal": "Explain synthetic browser action",
                "request_id": str(uuid.uuid4()),
            },
        )
        assert created.status_code == 202, created.text
        run = created.json()["run"]
        path = f"{base}/runs/{run['id']}/browser-grants"
        grant_request = state["grant"]
        assert client.post(path, headers=other, json=grant_request).status_code == 404
        assert client.get(path, headers=other).status_code == 404
        assert (
            client.get(path + "?owner_user_id=foreign", headers=owner).status_code
            == 422
        )
        granted = client.post(
            path,
            headers={
                **owner,
                "X-Lingsight-User-Id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            },
            json=grant_request,
        )
        assert granted.status_code == 201, granted.text
        assert (
            client.post(path, headers=owner, json=grant_request).json()
            == granted.json()
        )
        control.post(
            f"{agent_http}/fixture/grant", json={"id": granted.json()["grant"]["id"]}
        ).raise_for_status()
        final = finish(run["id"])
        assert final["status"] == "succeeded", final
        task_id = created.json()["task"]["id"]
        detail = client.get(f"{base}/tasks/{task_id}", headers=owner).json()
        source = next(
            a for a in detail["artifacts"] if a["name"].startswith("browser-source-")
        )
        source_path = f"{base}/artifacts/{source['id']}"
        content = client.get(source_path, headers=owner).json()
        assert content["trust"] == "untrusted-web-content"
        assert "Approved synthetic receipt" in content["text"]
        assert client.get(source_path, headers=other).status_code == 404
        assert (
            content["operation_id"]
            == client.get(f"{base}/runs/{run['id']}/operations", headers=owner).json()[
                0
            ]["operation_id"]
        )
        assert control.get(f"{agent_http}/fixture/state").json()["effects"] == 1
        control.post(f"{agent_http}/fixture/restart", json={}).raise_for_status()
        assert client.get(path, headers=owner).json()[0]["operation_id"]
        assert control.get(f"{agent_http}/fixture/state").json()["effects"] == 1

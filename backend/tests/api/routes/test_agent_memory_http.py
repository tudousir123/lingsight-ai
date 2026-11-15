"""Real login/gateway/Agent/Mem0, with synthetic processors and isolated DB only."""

import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from tests.api.routes.test_agent_project_http import agent_http  # noqa: F401
from tests.api.routes.test_platform_user_flow import signup


@pytest.mark.parametrize("agent_http", ["memory-contract-fixture.ts"], indirect=True)
def test_personal_preference_real_gateway_source_recall_and_user_isolation(
    client: TestClient,
) -> None:
    api = settings.API_V1_STR
    owner, owner_id = signup(client)
    other, other_id = signup(client)
    projects = []
    for name in ("Memory synthetic alpha", "Memory synthetic beta"):
        response = client.post(f"{api}/projects/", headers=owner, json={"name": name})
        assert response.status_code == 200, response.text
        projects.append(response.json()["id"])

    def task(goal: str, project: str) -> dict:
        response = client.post(
            f"{api}/agent/tasks",
            headers=owner,
            json={"goal": goal, "project_id": project, "completion_mode": "qa"},
        )
        assert response.status_code == 202, response.text
        task_id = response.json()["task"]["id"]
        deadline = time.monotonic() + 20
        while True:
            response = client.get(f"{api}/agent/tasks/{task_id}", headers=owner)
            assert response.status_code == 200, response.text
            value = response.json()
            status = value["runs"][-1]["status"]
            if status == "succeeded":
                return value
            assert status not in {"failed", "cancelled"}, value
            assert time.monotonic() < deadline, value
            time.sleep(0.02)

    first = task("以后请用中文回答。", projects[0])
    memories = client.get(f"{api}/agent/memories", headers=owner)
    assert memories.status_code == 200, memories.text
    value = memories.json()
    assert value["processing"]["state"] == "enabled"
    assert value["index"]["state"] == "ready"
    assert len(value["items"]) == 1
    preference = value["items"][0]
    assert preference["owner_user_id"] == owner_id
    assert preference["project_id"] is None
    assert preference["sources"][0]["task_id"] == first["id"]
    assert preference["sources"][0]["source_version"] == 1
    second = task("Explain heading conceptually.", projects[1])
    assert "以后请用中文回答" in second["runs"][-1]["answer"]["text"]
    uses = client.get(f"{api}/agent/tasks/{second['id']}/memories", headers=owner)
    assert uses.status_code == 200, uses.text
    assert uses.json()["items"][0]["memory_id"] == preference["id"]
    assert uses.json()["items"][0]["content_version"] == 1
    forged = {**other, "X-LingSight-User-Id": owner_id}
    foreign = client.get(f"{api}/agent/memories", headers=forged)
    assert foreign.status_code == 200, foreign.text
    assert foreign.json()["items"] == []
    assert other_id != owner_id
    assert (
        client.get(
            f"{api}/agent/tasks/{second['id']}/memories", headers=forged
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"{api}/agent/memories?owner_user_id={owner_id}", headers=other
        ).status_code
        == 422
    )

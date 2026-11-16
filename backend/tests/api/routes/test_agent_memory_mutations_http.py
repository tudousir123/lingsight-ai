"""Real JWT/MySQL/gateway/Agent/official Mem0; local synthetic transports only."""

import time
import uuid

import pytest
from fastapi.testclient import TestClient

from tests.api.routes.test_agent_project_http import agent_http  # noqa: F401
from tests.api.routes.test_platform_user_flow import signup


@pytest.mark.usefixtures("agent_http")
@pytest.mark.parametrize(
    "agent_http", [("memory-contract-fixture.ts", True, True)], indirect=True
)
def test_memory_correction_delete_rebuild_authenticated_gateway(
    client: TestClient,
) -> None:
    owner, owner_id = signup(client)
    other, _ = signup(client)
    api = "/api/v1/agent"
    project = client.post(
        "/api/v1/projects/", headers=owner, json={"name": "T84 synthetic"}
    ).json()["id"]

    def task(goal: str) -> dict:
        response = client.post(
            f"{api}/tasks",
            headers=owner,
            json={
                "request_id": str(uuid.uuid4()),
                "goal": goal,
                "project_id": project,
                "completion_mode": "qa",
            },
        )
        assert response.status_code == 202, response.text
        tid = response.json()["task"]["id"]
        for _ in range(2000):
            value = client.get(f"{api}/tasks/{tid}", headers=owner).json()
            if value["runs"][-1]["status"] == "succeeded":
                return value
            assert value["runs"][-1]["status"] not in {"failed", "cancelled"}, value
            time.sleep(0.02)
        raise AssertionError("Task deadline")

    def mutation(m: dict, action: str, **content: str) -> dict:
        return {
            "request_id": str(uuid.uuid4()),
            "expected_version": m["version"],
            "content_version": m["content_version"],
            "source_fingerprint": m["source_fingerprint"],
            "action": action,
            **content,
        }

    task("以后请用中文回答。")
    memory = client.get(f"{api}/memories", headers=owner).json()["items"][0]
    path = f"{api}/memories/{memory['id']}/mutation"
    body = mutation(memory, "correct", content="以后请用英文回答。")
    foreign = client.post(
        path, headers={**other, "X-LingSight-User-Id": owner_id}, json=body
    )
    assert foreign.status_code == 404, foreign.text
    reply = client.post(path, headers=owner, json=body)
    assert reply.status_code == 200, reply.text
    assert reply.json()["memory"]["content_version"] == 2
    assert client.post(path, headers=owner, json=body).json() == reply.json()
    assert (
        client.post(
            path, headers=owner, json={**body, "request_id": str(uuid.uuid4())}
        ).status_code
        == 409
    )
    current = client.get(f"{api}/memories", headers=owner).json()["items"][0]
    assert (
        "以后请用英文回答"
        in task("Explain conceptually.")["runs"][-1]["answer"]["text"]
    )
    response = client.post(path, headers=owner, json=mutation(current, "delete"))
    assert response.status_code == 200, response.text
    assert response.json()["memory"]["state"] == "deleted"
    historical = client.get(f"{api}/memories/{memory['id']}/history", headers=owner)
    assert historical.status_code == 200, historical.text
    assert historical.json()["items"][0]["content"] == "以后请用中文回答。"
    assert (
        client.get(f"{api}/memories/{memory['id']}/history", headers=other).status_code
        == 404
    )
    assert (
        "以后请用英文回答"
        not in task("Explain conceptually.")["runs"][-1]["answer"]["text"]
    )
    t = task("Propose: T84 orientation needs calibration.")
    base = f"{api}/tasks/{t['id']}/research-memories"
    m = client.get(base, headers=owner).json()["items"][0]
    corrected = client.post(
        f"{base}/{m['id']}/mutation",
        headers=owner,
        json=mutation(
            m,
            "correct",
            content="T84 corrected orientation needs calibration.",
            source_text="Synthetic user source correction.",
        ),
    )
    assert corrected.status_code == 200, corrected.text
    m = corrected.json()["memory"]
    assert m["confirmation"] == "pending"
    assert (
        client.post(
            f"{base}/{m['id']}/decision",
            headers=owner,
            json={
                "request_id": str(uuid.uuid4()),
                "expected_version": m["version"],
                "content_version": m["content_version"],
                "source_fingerprint": m["source_fingerprint"],
                "decision": "confirm",
            },
        ).status_code
        == 200
    )
    assert (
        "T84 corrected" in task("Explain conceptually.")["runs"][-1]["answer"]["text"]
    )
    view = client.get(base, headers=owner).json()
    response = client.post(
        f"{base}/rebuild",
        headers=owner,
        json={
            "request_id": str(uuid.uuid4()),
            "expected_revision": view["index"]["revision"],
        },
    )
    assert response.status_code == 200, response.text

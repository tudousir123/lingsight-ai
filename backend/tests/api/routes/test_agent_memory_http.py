"""Real login/gateway/Agent/Mem0, with synthetic processors and isolated DB only."""

import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from tests.api.routes.test_agent_project_http import agent_http  # noqa: F401
from tests.api.routes.test_platform_user_flow import signup


@pytest.mark.usefixtures("agent_http")
@pytest.mark.parametrize(
    ("agent_http", "durable"),
    [
        (("memory-contract-fixture.ts", False), False),
        (("memory-contract-fixture.ts", True), True),
    ],
    indirect=["agent_http"],
    ids=["synthetic-engine", "real-durable-and-mem0"],
)
def test_personal_preference_real_gateway_source_recall_and_user_isolation(
    client: TestClient,
    durable: bool,
) -> None:
    api = settings.API_V1_STR
    owner, owner_id = signup(client)
    capability = client.get(f"{api}/agent/capabilities", headers=owner)
    assert capability.status_code == 200, capability.text
    assert capability.json()["personal_memory"] == "personal-memory-v1"
    assert capability.json()["execution"] == {
        "contract": "durable-run-v1",
        "requests": "persistent-v1",
        "recovery": "safe-v1",
        "operations": "ledger-v1",
        "cancellation": "verified-v1",
        "engine": "pi-durable",
        "version": "1.5.2",
        "enabled": True,
    }
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
    assert len(preference["sources"][0]["source_sha256"]) == 64
    if durable:
        execution = first["runs"][-1]["execution"]
        assert execution["engine"] == "pi-durable"
        assert isinstance(execution["conversation_id"], int)
        assert isinstance(execution["submission_id"], int)
    second = task("Explain heading conceptually.", projects[1])
    assert "以后请用中文回答" in second["runs"][-1]["answer"]["text"]
    uses = client.get(f"{api}/agent/tasks/{second['id']}/memories", headers=owner)
    assert uses.status_code == 200, uses.text
    assert uses.json()["items"][0]["memory_id"] == preference["id"]
    assert uses.json()["items"][0]["content_version"] == 1
    assert (
        uses.json()["items"][0]["sources"][0]["source_sha256"]
        == preference["sources"][0]["source_sha256"]
    )
    if durable:
        answer = second["runs"][-1]["answer"]["text"]
        assert f"memory_id={preference['id']}" in answer
        assert "content_version=1" in answer
        assert preference["sources"][0]["source_sha256"] in answer
        assert second["runs"][-1]["execution"]["submission_id"] is not None
        report = next(a for a in second["artifacts"] if a["kind"] == "report")
        preview = client.get(f"{api}/agent/artifacts/{report['id']}", headers=owner)
        assert preview.status_code == 200
        assert "Source: synthetic user input" in preview.text
        assert preview.headers["etag"] == f'"{report["sha256"]}"'
        events = client.get(f"{api}/agent/tasks/{second['id']}/events", headers=owner)
        assert events.status_code == 200
        kinds = {event["type"] for event in events.json()}
        assert {
            "memory.used",
            "execution.started",
            "execution.finished",
            "run.succeeded",
        } <= kinds
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


@pytest.mark.usefixtures("agent_http")
@pytest.mark.parametrize(
    "agent_http", [("memory-contract-fixture.ts", True, True)], indirect=True
)
def test_research_candidate_real_gateway_review_and_project_reuse(
    client: TestClient,
) -> None:
    import uuid

    api = settings.API_V1_STR
    owner, owner_id = signup(client)
    other, _ = signup(client)
    projects = []
    for name in ("Research alpha", "Research beta"):
        project = client.post(f"{api}/projects/", headers=owner, json={"name": name})
        assert project.status_code == 200, project.text
        projects.append(project.json()["id"])

    def task(goal: str, project: str) -> dict:
        out = client.post(
            f"{api}/agent/tasks",
            headers=owner,
            json={
                "goal": goal,
                "project_id": project,
                "completion_mode": "qa",
                "request_id": str(uuid.uuid4()),
            },
        )
        assert out.status_code == 202, out.text
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            out = client.get(
                f"{api}/agent/tasks/{out.json().get('task', out.json())['id']}",
                headers=owner,
            )
            assert out.status_code == 200, out.text
            if out.json()["runs"][-1]["status"] == "succeeded":
                return out.json()
            assert out.json()["runs"][-1]["status"] not in {"failed", "cancelled"}, (
                out.text
            )
            time.sleep(0.02)
        raise AssertionError("Synthetic task deadline")

    first = task(
        "Propose: Alpha orientation needs independent calibration.", projects[0]
    )
    path = f"{api}/agent/tasks/{first['id']}/research-memories"
    view = client.get(path, headers=owner)
    assert view.status_code == 200, view.text
    m = view.json()["items"][0]
    assert m["owner_user_id"] == owner_id
    assert m["confirmation"] == "pending"
    assert m["project_id"] == projects[0]
    assert (
        client.get(path, headers={**other, "X-LingSight-User-Id": owner_id}).status_code
        == 404
    )
    request = {
        "request_id": str(uuid.uuid4()),
        "expected_version": m["version"],
        "content_version": m["content_version"],
        "source_fingerprint": m["source_fingerprint"],
        "decision": "confirm",
    }
    assert (
        client.post(
            f"{path}/{m['id']}/decision",
            headers=owner,
            json={**request, "confirmation": "confirmed"},
        ).status_code
        == 422
    )
    receipt = client.post(f"{path}/{m['id']}/decision", headers=owner, json=request)
    assert receipt.status_code == 200, receipt.text
    assert (
        client.post(f"{path}/{m['id']}/decision", headers=owner, json=request).json()
        == receipt.json()
    )
    stale = {**request, "request_id": str(uuid.uuid4()), "decision": "reject"}
    assert (
        client.post(f"{path}/{m['id']}/decision", headers=owner, json=stale).status_code
        == 409
    )
    same = task("Explain orientation conceptually.", projects[0])
    used = client.get(f"{api}/agent/tasks/{same['id']}/memories", headers=owner)
    assert used.json()["items"][0]["memory_id"] == m["id"]
    assert used.json()["items"][0]["confirmation"] == "confirmed"
    assert m["source_fingerprint"] in same["runs"][-1]["answer"]["text"]
    other_project = task("Explain orientation conceptually.", projects[1])
    assert (
        client.get(
            f"{api}/agent/tasks/{other_project['id']}/research-memories", headers=owner
        ).json()["items"]
        == []
    )
    assert (
        client.get(
            f"{api}/agent/tasks/{other_project['id']}/memories", headers=owner
        ).json()["items"]
        == []
    )
    assert client.get(f"{api}/agent/memories", headers=owner).json()["items"] == []

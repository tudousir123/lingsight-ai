"""Real JWT/gateway/Agent/Harness + SIGKILL; only synthetic external content."""

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
    "agent_http", [("operations-contract-fixture.ts", True)], indirect=True
)
def test_operation_unknown_cancel_review_with_real_gateway_and_process_death(
    client: TestClient, agent_http: str
) -> None:
    owner, _ = signup(client)
    other, _ = signup(client)
    base = f"{settings.API_V1_STR}/agent"
    created = client.post(
        f"{base}/tasks",
        headers=owner,
        json={"goal": "Explain synthetic orientation", "request_id": str(uuid.uuid4())},
    )
    assert created.status_code == 202, created.text
    run = created.json()["run"]
    task = created.json()["task"]
    run_url = f"{base}/runs/{run['id']}"
    control = {"Authorization": "Bearer synthetic-contract-token-000000000"}
    with httpx.Client(trust_env=False) as external:
        deadline = time.monotonic() + 20
        while True:
            state = external.get(f"{agent_http}/fixture/state", headers=control).json()
            if state["boundary"]:
                break
            assert time.monotonic() < deadline, state
            time.sleep(0.02)
        assert state["effects"] == state["attempts"] == 1
        cancelled = client.post(f"{run_url}/cancel", headers=owner, json={})
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancel_unconfirmed"
        assert cancelled.json()["cancellation"]["confirmed_at"] is None
        assert (
            external.post(f"{agent_http}/fixture/restart", headers=control).status_code
            == 200
        )
        current = client.get(run_url, headers=owner)
        assert current.status_code == 200, current.text
        assert current.json()["status"] == "cancel_unconfirmed"
        assert current.json()["cancellation"] == cancelled.json()["cancellation"]
        operations = client.get(f"{run_url}/operations", headers=owner)
        assert operations.status_code == 200, operations.text
        operation = operations.json()[0]
        assert operation["state"] == "unknown"
        assert operation["checkpoint"]["phase"] == "execute"
        assert operation["operation_id"] != created.json()["request_id"]
        assert client.get(f"{run_url}/operations", headers=other).status_code == 404
        path = f"{run_url}/operations/{operation['operation_id']}"
        request = {
            "request_id": str(uuid.uuid4()),
            "expected_version": operation["version"],
        }
        assert (
            client.post(f"{path}/verify", headers=other, json=request).status_code
            == 404
        )
        verified = client.post(f"{path}/verify", headers=owner, json=request)
        assert verified.status_code == 200, verified.text
        verified_operation = verified.json()["operation"]
        assert verified_operation["state"] == "result_saved"
        assert verified_operation["evidence"]["source"] == "adapter_verification"
        assert (
            client.post(f"{path}/verify", headers=owner, json=request).json()
            == verified.json()
        )
        assert (
            client.get(run_url, headers=owner).json()["status"] == "cancel_unconfirmed"
        )
        decision = {
            "request_id": str(uuid.uuid4()),
            "expected_version": verified_operation["version"],
            "decision": "confirm_effect",
            "evidence": "Synthetic external receipt checked; worker termination independently observed after SIGKILL.",
            "stop_confirmed": True,
        }
        assert (
            client.post(f"{path}/resolve", headers=other, json=decision).status_code
            == 404
        )
        resolved = client.post(f"{path}/resolve", headers=owner, json=decision)
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["operation"]["stop_confirmed_at"]
        assert (
            resolved.json()["operation"]["evidence"]["previous_evidence"]["source"]
            == "adapter_verification"
        )
        assert (
            client.post(f"{path}/resolve", headers=owner, json=decision).json()
            == resolved.json()
        )
        conflict = client.post(
            f"{path}/resolve",
            headers=owner,
            json={**decision, "request_id": str(uuid.uuid4())},
        )
        assert conflict.status_code == 409, conflict.text
        final = client.get(run_url, headers=owner).json()
        assert final["status"] == "cancelled"
        assert final["cancellation"]["confirmed_at"]
        assert final["answer"] is None
        assert (
            client.post(
                f"{run_url}/resume",
                headers=owner,
                json={"request_id": str(uuid.uuid4())},
            ).status_code
            == 409
        )
        events = client.get(f"{base}/tasks/{task['id']}/events", headers=owner).json()
        assert sum(e["type"] == "run.cancel_requested" for e in events) == 1
        assert sum(e["type"] == "run.cancelled" for e in events) == 1
        assert (
            external.post(f"{agent_http}/fixture/restart", headers=control).status_code
            == 200
        )
        assert (
            client.get(run_url, headers=owner).json()["cancellation"]
            == final["cancellation"]
        )
        after = external.get(f"{agent_http}/fixture/state", headers=control).json()
        assert after["effects"] == after["attempts"] == 1
        assert after["models"] == state["models"]

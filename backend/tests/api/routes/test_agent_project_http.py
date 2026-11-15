"""Optional real FastAPI -> Node/SQLite contract using synthetic data only."""

import io
import json
import os
import selectors
import shutil
import subprocess
import time
import uuid
import zipfile
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import Project
from tests.utils.user import create_random_user


@pytest.fixture
def agent_http(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> Iterator[str]:
    repository = os.environ.get("AGENT_CONTRACT_REPOSITORY")
    if not repository or not shutil.which("node"):
        pytest.skip("Set AGENT_CONTRACT_REPOSITORY to the separate Agent checkout")
    script = Path(repository) / "scripts" / "contract-fixture.ts"
    if not script.is_file():
        pytest.fail("Agent checkout is missing its synthetic contract fixture")
    callback_token = "synthetic-platform-callback-token"
    monkeypatch.setattr(settings, "AGENT_AUTHORIZATION_TOKEN", callback_token)

    class AuthorizationCallback(BaseHTTPRequestHandler):
        """Expose the real platform callback over loopback HTTP to the Node fixture."""

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            if (
                self.path != f"{settings.API_V1_STR}/internal/agent/authorize"
                or not 0 < length <= 128_000
            ):
                self.send_error(400)
                return
            response = client.post(
                self.path,
                content=self.rfile.read(length),
                headers={
                    "Authorization": self.headers.get("Authorization", ""),
                    "Content-Type": "application/json",
                },
            )
            self.send_response(response.status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response.content)))
            self.end_headers()
            self.wfile.write(response.content)

        def log_message(self, _format: str, *args: object) -> None:
            pass

    callback = ThreadingHTTPServer(("127.0.0.1", 0), AuthorizationCallback)
    callback_thread = Thread(target=callback.serve_forever, daemon=True)
    callback_thread.start()
    callback_url = f"http://127.0.0.1:{callback.server_port}{settings.API_V1_STR}/internal/agent/authorize"
    process = subprocess.Popen(
        ["node", str(script)],
        cwd=repository,
        stdout=subprocess.PIPE,
        text=True,
        env={
            **os.environ,
            "AGENT_CONTRACT_AUTHORIZATION_URL": callback_url,
            "AGENT_CONTRACT_AUTHORIZATION_TOKEN": callback_token,
        },
    )
    try:
        assert process.stdout
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=20), "Synthetic Agent did not start"
        url = json.loads(process.stdout.readline())["url"]
        token = "synthetic-contract-token-000000000"
        with httpx.Client(trust_env=False) as probe:
            response = probe.get(
                f"{url}/v1/capabilities", headers={"Authorization": f"Bearer {token}"}
            )
            assert response.status_code == 200, response.text
        monkeypatch.setattr(settings, "AGENT_BASE_URL", url)
        monkeypatch.setattr(settings, "AGENT_API_TOKEN", token)
        yield url
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        if process.stdout:
            process.stdout.close()
        callback.shutdown()
        callback.server_close()
        callback_thread.join(timeout=5)


@pytest.mark.usefixtures("agent_http")
def test_real_project_task_scope_and_bundle(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    agent_http: str,
) -> None:
    headers = superuser_token_headers
    api = settings.API_V1_STR
    created = client.post(
        f"{api}/projects/", headers=headers, json={"name": "HTTP contract"}
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]
    foreign = Project(name="Other user's project", user_id=create_random_user(db).id)
    db.add(foreign)
    db.commit()
    try:
        denied = client.post(
            f"{api}/agent/tasks",
            headers=headers,
            json={"goal": "complete", "project_id": str(foreign.id)},
        )
        assert denied.status_code == 404
        response = client.post(
            f"{api}/agent/tasks",
            headers=headers,
            json={"goal": "complete", "project_id": project_id},
        )
        with httpx.Client(trust_env=False) as probe:
            capabilities = probe.get(
                f"{agent_http}/v1/capabilities",
                headers={"Authorization": f"Bearer {settings.AGENT_API_TOKEN}"},
            ).json()
        if capabilities.get("user_scope") != "platform-user-v1":
            # Old read-only checkout remains a meaningful compatibility test:
            # no task or shared output may pass the multi-user platform gate.
            assert response.status_code == 503, response.text
            assert client.get(f"{api}/agent/tasks", headers=headers).status_code == 503
            return
        assert response.status_code == 202, response.text
        task = response.json()["task"]
        assert task["project_id"] == project_id
        task_url = f"{api}/agent/tasks/{task['id']}"
        deadline = time.monotonic() + 10
        while True:
            snapshot = client.get(task_url, headers=headers).json()
            state = snapshot["runs"][-1]["status"]
            if state == "succeeded":
                break
            assert state not in {"failed", "cancelled"}, snapshot
            assert time.monotonic() < deadline, snapshot
            time.sleep(0.05)
        bundle = client.get(f"{task_url}/bundle", headers=headers)
        assert bundle.status_code == 200
        with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["project_id"] == project_id
        follow = client.post(
            f"{task_url}/messages",
            headers=headers,
            json={"text": "follow-up", "project_id": str(foreign.id)},
        )
        assert follow.status_code == 422, follow.text
        assert client.get(task_url, headers=headers).json()["project_id"] == project_id
    finally:
        own = db.get(Project, uuid.UUID(project_id))
        if own:
            crud.delete_project(session=db, project=own)
        crud.delete_project(session=db, project=foreign)


def test_real_user_isolation_qa_and_live_scope_revocation(
    client: TestClient,
    agent_http: str,
    superuser_token_headers: dict[str, str],
) -> None:
    from tests.api.routes.test_platform_user_flow import signup

    with httpx.Client(trust_env=False) as probe:
        capabilities = probe.get(
            f"{agent_http}/v1/capabilities",
            headers={"Authorization": f"Bearer {settings.AGENT_API_TOKEN}"},
        ).json()
    if capabilities.get("user_scope") != "platform-user-v1":
        pytest.skip("Read-only Agent checkout lacks the new user-scope contract")
    owner, owner_id = signup(client)
    other, _ = signup(client)
    api = settings.API_V1_STR
    created = client.post(
        f"{api}/agent/tasks",
        headers=owner,
        json={"goal": "Explain a scientific concept", "completion_mode": "qa"},
    )
    assert created.status_code == 202, created.text
    task, run = created.json()["task"], created.json()["run"]
    assert task["owner_user_id"] == owner_id
    assert task["data_scope"] == "none"
    deadline = time.monotonic() + 10
    while True:
        snapshot = client.get(f"{api}/agent/tasks/{task['id']}", headers=owner)
        assert snapshot.status_code == 200, snapshot.text
        completed = snapshot.json()["runs"][-1]
        if completed["status"] == "succeeded":
            break
        assert completed["status"] not in {"failed", "cancelled"}, completed
        assert time.monotonic() < deadline, completed
        time.sleep(0.05)
    assert completed["completion_mode"] == "qa"
    assert completed["answer"]["text"]
    assert completed["answer"]["source_refs"] == []
    assert completed["completion_contract"]["required_deliverables"] == []
    assert snapshot.json()["artifacts"] == []
    assert client.get(f"{api}/agent/tasks", headers=other).json() == []
    forged = {**other, "X-LingSight-User-Id": owner_id}
    for path in (
        f"tasks/{task['id']}",
        f"tasks/{task['id']}/events",
        f"tasks/{task['id']}/bundle",
        f"runs/{run['id']}",
    ):
        assert client.get(f"{api}/agent/{path}", headers=forged).status_code == 404
    assert (
        client.get(
            f"{api}/agent/tasks/{task['id']}/events",
            headers={**forged, "Accept": "text/event-stream"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{api}/agent/tasks/{task['id']}/messages",
            headers=other,
            json={"text": "take over"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{api}/agent/runs/{run['id']}/cancel",
            headers=other,
        ).status_code
        == 404
    )
    grant_url = f"{api}/users/{owner_id}/whole-library-access"
    grant = client.put(
        grant_url,
        headers=superuser_token_headers,
        json={"granted": True, "reason": "Synthetic contract"},
    )
    assert grant.status_code == 200
    live = client.post(
        f"{api}/agent/tasks",
        headers=owner,
        json={
            "goal": "clarify",
            "data_scope": "whole_library",
            "completion_mode": "qa",
        },
    )
    assert live.status_code == 202, live.text
    live_task, live_run = live.json()["task"], live.json()["run"]
    deadline = time.monotonic() + 10
    while True:
        waiting = client.get(f"{api}/agent/tasks/{live_task['id']}", headers=owner)
        assert waiting.status_code == 200, waiting.text
        waiting_run = waiting.json()["runs"][-1]
        if waiting_run["status"] == "waiting_for_input":
            break
        assert waiting_run["status"] not in {"failed", "succeeded", "cancelled"}
        assert time.monotonic() < deadline, waiting_run
        time.sleep(0.05)
    revoked = client.put(
        grant_url,
        headers=superuser_token_headers,
        json={"granted": False, "reason": "Synthetic revoke"},
    )
    assert revoked.status_code == 200
    for path in (
        f"tasks/{live_task['id']}",
        f"tasks/{live_task['id']}/events",
        f"tasks/{live_task['id']}/bundle",
        f"runs/{live_run['id']}",
    ):
        denied = client.get(f"{api}/agent/{path}", headers=owner)
        assert denied.status_code == 403, denied.text
    assert (
        client.post(
            f"{api}/agent/runs/{live_run['id']}/resume",
            headers=owner,
        ).status_code
        == 403
    )
    cancelled = client.post(
        f"{api}/agent/runs/{live_run['id']}/cancel",
        headers=owner,
    )
    assert cancelled.status_code == 200, cancelled.text
    assert all(
        row["id"] != live_task["id"]
        for row in client.get(f"{api}/agent/tasks", headers=owner).json()
    )


@pytest.mark.usefixtures("agent_http")
def test_real_personal_identity_shared_by_two_project_tasks_but_not_other_user(
    client: TestClient,
) -> None:
    """Real login/JWT -> gateway -> Agent SQLite -> real authorization callback."""
    from tests.api.routes.test_platform_user_flow import signup

    owner, owner_id = signup(client)
    other, other_id = signup(client)
    api = settings.API_V1_STR
    identity_url = f"{api}/agent/personal-agent"
    identity_response = client.get(identity_url, headers=owner)
    assert identity_response.status_code == 200, identity_response.text
    identity = identity_response.json()
    assert identity["owner_user_id"] == owner_id
    assert identity["environment"]["status"] == "ready"
    forged = client.get(
        identity_url, headers={**other, "X-LingSight-User-Id": owner_id}
    )
    assert forged.status_code == 200, forged.text
    assert forged.json()["owner_user_id"] == other_id
    assert forged.json()["id"] != identity["id"]
    assert forged.json()["environment"]["id"] != identity["environment"]["id"]
    project = client.post(
        f"{api}/projects/", headers=owner, json={"name": "Synthetic identity contract"}
    )
    assert project.status_code == 200, project.text
    project_id = project.json()["id"]
    tasks = []
    for question in ("Explain synthetic alpha", "Explain synthetic beta"):
        response = client.post(
            f"{api}/agent/tasks",
            headers=owner,
            json={
                "goal": question,
                "project_id": project_id,
                "completion_mode": "qa",
            },
        )
        assert response.status_code == 202, response.text
        task = response.json()["task"]
        assert task["personal_agent_id"] == identity["id"]
        assert task["environment_id"] == identity["environment"]["id"]
        assert task["goal"] == question
        assert task["project_id"] == project_id
        task_url = f"{api}/agent/tasks/{task['id']}"
        deadline = time.monotonic() + 10
        while True:
            snapshot = client.get(task_url, headers=owner)
            assert snapshot.status_code == 200, snapshot.text
            run = snapshot.json()["runs"][0]
            if run["status"] == "succeeded":
                break
            assert run["status"] not in {"failed", "cancelled"}, run
            assert time.monotonic() < deadline, run
            time.sleep(0.02)
        assert run["instruction"] == question
        assert run["answer"]["text"]
        bundle = client.get(f"{task_url}/bundle", headers=owner)
        assert bundle.status_code == 200, bundle.text
        with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["task_id"] == task["id"]
            assert manifest["runs"][0]["id"] == run["id"]
        assert client.get(task_url, headers=other).status_code == 404
        assert client.get(f"{task_url}/bundle", headers=other).status_code == 404
        tasks.append(snapshot.json())
    assert tasks[0]["id"] != tasks[1]["id"]
    assert tasks[0]["runs"][0]["id"] != tasks[1]["runs"][0]["id"]
    assert client.get(identity_url, headers=owner).json() == identity
    for task in tasks:
        assert (
            client.get(f"{api}/agent/tasks/{task['id']}", headers=owner).json() == task
        )


@pytest.fixture
def durable_agent_http(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> Iterator[str]:
    monkeypatch.setenv("AGENT_CONTRACT_DURABLE", "1")
    yield from agent_http.__wrapped__(monkeypatch, client)


@pytest.mark.usefixtures("durable_agent_http")
def test_real_durable_gateway_completion_and_sourced_output(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Real JWT/gateway/authorization + Agent SQLite/Harness; offline model only."""
    api = settings.API_V1_STR
    headers = superuser_token_headers
    capability = client.get(f"{api}/agent/capabilities", headers=headers)
    assert capability.status_code == 200, capability.text
    assert capability.json()["execution"] == {
        "contract": "durable-run-v1",
        "engine": "pi-durable",
        "version": "1.5.2",
        "enabled": True,
    }
    created = client.post(
        f"{api}/agent/tasks",
        headers=headers,
        json={"goal": "Explain synthetic orientation", "completion_mode": "qa"},
    )
    assert created.status_code == 202, created.text
    task = created.json()["task"]
    deadline = time.monotonic() + 15
    while True:
        detail = client.get(f"{api}/agent/tasks/{task['id']}", headers=headers)
        assert detail.status_code == 200, detail.text
        result = detail.json()
        run = result["runs"][-1]
        if run["status"] == "succeeded":
            break
        assert run["status"] not in {"failed", "cancelled"}, run
        assert time.monotonic() < deadline, run
        time.sleep(0.02)
    assert run["execution"]["engine"] == "pi-durable"
    assert run["execution"]["submission_id"] is not None
    assert run["answer"]["source_refs"] == []
    report = next(a for a in result["artifacts"] if a["kind"] == "report")
    assert report["run_id"] == run["id"]
    assert report["sha256"]
    preview = client.get(f"{api}/agent/artifacts/{report['id']}", headers=headers)
    assert preview.status_code == 200
    assert "Source: synthetic user input" in preview.text
    assert preview.headers["etag"] == f'"{report["sha256"]}"'
    events = client.get(
        f"{api}/agent/tasks/{task['id']}/events",
        headers={**headers, "Accept": "application/json"},
    )
    assert events.status_code == 200
    kinds = {e["type"] for e in events.json()}
    assert {
        "execution.started",
        "step.completed",
        "execution.finished",
        "run.answered",
        "run.succeeded",
    } <= kinds
    bundle = client.get(f"{api}/agent/tasks/{task['id']}/bundle", headers=headers)
    assert bundle.status_code == 200
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["runs"][-1]["execution"] == run["execution"]

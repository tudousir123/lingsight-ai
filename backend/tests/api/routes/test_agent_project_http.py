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
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import Project
from tests.utils.user import create_random_user


@pytest.fixture
def agent_http(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    repository = os.environ.get("AGENT_CONTRACT_REPOSITORY")
    if not repository or not shutil.which("node"):
        pytest.skip("Set AGENT_CONTRACT_REPOSITORY to the separate Agent checkout")
    script = Path(repository) / "scripts" / "contract-fixture.ts"
    if not script.is_file():
        pytest.fail("Agent checkout is missing its synthetic contract fixture")
    process = subprocess.Popen(
        ["node", str(script)],
        cwd=repository,
        stdout=subprocess.PIPE,
        text=True,
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

"""Real FastAPI -> Node HTTP contract; temporary SQLite, no app/research DB."""

import asyncio
import io
import json
import socket
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from tests.runtime import configure_application

configure_application()
import httpx
import uvicorn
from fastapi import FastAPI
from app.api.deps import get_current_user
from app.api.routes.agent import router
from app.core.config import settings
from app.models import User


async def main():
    repo = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "lingsight-agent"
    process = subprocess.Popen(
        ["node", "scripts/contract-fixture.ts"],
        cwd=repo,
        stdout=subprocess.PIPE,
        text=True,
    )
    server = serve = None
    try:
        line = await asyncio.wait_for(asyncio.to_thread(process.stdout.readline), 20)
        settings.AGENT_BASE_URL = json.loads(line)["url"]
        settings.AGENT_API_TOKEN = "synthetic-contract-token-000000000"
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        user = User(
            email="contract@example.com", hashed_password="unused", is_superuser=True
        )
        app.dependency_overrides[get_current_user] = lambda: user
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
        serve = asyncio.create_task(server.serve(sockets=[sock]))
        for _ in range(100):
            if server.started:
                break
            await asyncio.sleep(0.02)
        assert server.started
        async with httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{sock.getsockname()[1]}/api/v1/agent/",
            trust_env=False,
        ) as client:

            async def call(method, path, payload=None, status=200):
                response = await client.request(method, path, json=payload)
                assert response.status_code == status, (
                    path,
                    response.status_code,
                    response.text,
                )
                return response

            async def wait(run, status):
                for _ in range(100):
                    current = (await call("GET", f"runs/{run}")).json()
                    if current["status"] == status:
                        return current
                    await asyncio.sleep(0.05)
                raise AssertionError((current["status"], status))

            user.is_superuser = False
            await call("GET", "tasks", status=403)
            user.is_superuser = True
            created = (await call("POST", "tasks", {"goal": "complete"}, 202)).json()
            task, run = created["task"]["id"], created["run"]["id"]
            await wait(run, "succeeded")
            snapshot = (await call("GET", f"tasks/{task}")).json()
            assert all("session_file" not in item for item in snapshot["runs"])
            events = (await call("GET", f"tasks/{task}/events")).json()
            assert any(e["type"] == "run.succeeded" for e in events)
            cursor = events[-2]["id"]
            async with client.stream(
                "GET",
                f"tasks/{task}/events",
                headers={"Accept": "text/event-stream", "Last-Event-ID": str(cursor)},
            ) as response:
                assert response.status_code == 200
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        assert json.loads(line[6:])["id"] > cursor
                        break
            report = next(a for a in snapshot["artifacts"] if a["kind"] == "report")
            old = (await call("GET", f"artifacts/{report['id']}")).content
            edited = (
                await call(
                    "PATCH",
                    f"artifacts/{report['id']}",
                    {"markdown": "# Edited synthetic contract report\n"},
                    201,
                )
            ).json()
            assert edited["id"] != report["id"]
            assert (await call("GET", f"artifacts/{report['id']}")).content == old
            with zipfile.ZipFile(
                io.BytesIO((await call("GET", f"tasks/{task}/bundle")).content)
            ) as archive:
                assert "manifest.json" in archive.namelist()
                assert any(name.endswith("data.csv") for name in archive.namelist())
            follow = (
                await call("POST", f"tasks/{task}/messages", {"text": "follow-up"}, 202)
            ).json()
            await wait(follow["run_id"], "succeeded")
            clarified = (await call("POST", "tasks", {"goal": "clarify"}, 202)).json()
            crun, ctask = clarified["run"]["id"], clarified["task"]["id"]
            await wait(crun, "waiting_for_input")
            snapshot = (await call("GET", f"tasks/{ctask}")).json()
            question = snapshot["runs"][0]["clarifications"][0]["id"]
            await call(
                "POST",
                f"runs/{crun}/clarifications/{question}/answer",
                {"answer": "synthetic only"},
                202,
            )
            await wait(crun, "succeeded")
            cancelled = (await call("POST", "tasks", {"goal": "wait"}, 202)).json()[
                "run"
            ]["id"]
            await wait(cancelled, "running")
            await call("POST", f"runs/{cancelled}/cancel", status=200)
            await wait(cancelled, "cancelled")
            print(
                json.dumps(
                    {
                        "status": "passed",
                        "transport": "FastAPI HTTP -> Node HTTP -> temporary SQLite",
                        "checks": [
                            "workspace authorization",
                            "create and status",
                            "SSE cursor replay",
                            "immutable report editing",
                            "artifact download",
                            "ZIP",
                            "follow-up",
                            "clarification",
                            "cancellation",
                        ],
                        "model": "stub",
                        "research_database": "unused",
                    }
                )
            )
    finally:
        if server:
            server.should_exit = True
        if serve:
            await asyncio.wait_for(serve, 10)
        process.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(process.wait), 20)
        except TimeoutError:
            process.kill()
            process.wait()


if __name__ == "__main__":
    asyncio.run(main())

"""Real browser + platform + Pi + isolated synthetic MCP/MySQL acceptance."""

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

from tests.runtime import configure_application

configure_application()
from app.core.config import settings
from app.core.db import engine, init_db
from sqlmodel import Session

ROOT = Path(__file__).resolve().parents[3]
AGENT = Path(
    os.environ.get("LINGSIGHT_AGENT_REPO", str(ROOT.parent / "lingsight-agent"))
)


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_full_synthetic_workspace():
    with Session(engine) as session:
        init_db(session)
    processes = []
    with tempfile.TemporaryDirectory(prefix="lingsight-web-acceptance-") as temp:
        temp = Path(temp)
        logfiles = []

        def start(name, cmd, cwd, env):
            log = (temp / f"{name}.log").open("w+")
            logfiles.append(log)
            process = subprocess.Popen(
                cmd, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT
            )
            processes.append(process)
            return process, log

        def wait_http(url, process):
            import urllib.request

            for _ in range(200):
                if process.poll() is not None:
                    raise AssertionError(f"Process failed: {process.args}")
                try:
                    with urllib.request.urlopen(url, timeout=1):
                        return
                except OSError:
                    time.sleep(0.1)
            raise AssertionError("Service did not become ready")

        try:
            agent, agent_log = start(
                "agent",
                ["node", "--env-file=.env", "scripts/e2e-fixture.ts"],
                AGENT,
                os.environ.copy(),
            )
            for _ in range(200):
                agent_log.flush()
                agent_log.seek(0)
                lines = agent_log.read().splitlines()
                if lines:
                    break
                if agent.poll() is not None:
                    raise AssertionError("Agent fixture failed to start")
                time.sleep(0.1)
            agent_url = json.loads(lines[0])["url"]
            backend_port, web_port = port(), port()
            api_script = temp / "api.py"
            api_script.write_text(
                """from tests.runtime import configure_application\nconfigure_application()\nfrom app.core.config import settings\nsettings.AGENT_BASE_URL = %r\nsettings.AGENT_API_TOKEN = "synthetic-e2e-token-00000000000000"\nsettings.FRONTEND_HOST = "http://127.0.0.1:%d"\nimport uvicorn\nuvicorn.run("app.main:app", host="127.0.0.1", port=%d, log_level="warning")\n"""
                % (agent_url, web_port, backend_port)
            )
            backend, _ = start(
                "backend",
                ["uv", "run", "python", str(api_script)],
                ROOT / "backend",
                os.environ.copy() | {"PYTHONPATH": str(ROOT / "backend")},
            )
            wait_http(f"http://127.0.0.1:{backend_port}/api/v1/openapi.json", backend)
            # Vite's route generator operates on a copy, never the user's files.
            front = temp / "frontend"
            shutil.copytree(
                ROOT / "frontend",
                front,
                ignore=shutil.ignore_patterns(
                    "node_modules", ".tanstack", "test-results", "playwright-report"
                ),
            )
            (temp / "node_modules").symlink_to(
                ROOT / "node_modules", target_is_directory=True
            )
            (front / "node_modules").symlink_to(
                ROOT / "frontend/node_modules", target_is_directory=True
            )
            env = os.environ.copy() | {
                "VITE_API_URL": f"http://127.0.0.1:{backend_port}",
                "VITE_AGENT_GATEWAY_URL": f"http://127.0.0.1:{backend_port}",
            }
            vite, _ = start(
                "vite",
                [
                    "node",
                    str(ROOT / "node_modules/.bin/vite"),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(web_port),
                    "--strictPort",
                ],
                front,
                env,
            )
            wait_http(f"http://127.0.0.1:{web_port}/login", vite)
            bundle = temp / "bundle.zip"
            env |= {
                "E2E_WEB_URL": f"http://127.0.0.1:{web_port}",
                "E2E_PLAYWRIGHT_MODULE": str(ROOT / "node_modules/playwright"),
                "E2E_BUNDLE_PATH": str(bundle),
            }
            browser = subprocess.run(
                ["node", str(Path(__file__).with_name("workspace-browser.cjs"))],
                env=env,
                capture_output=True,
                text=True,
                timeout=900,
            )
            if browser.returncode:
                raise AssertionError(
                    f"Browser failed: {browser.stderr[-5000:]}\n{browser.stdout[-3000:]}"
                )
            result = json.loads(browser.stdout.strip().splitlines()[-1])
            with zipfile.ZipFile(bundle) as archive:
                csv_name = next(
                    n for n in archive.namelist() if n.endswith("/observations.csv")
                )
                import csv
                import io

                rows = list(
                    csv.DictReader(io.StringIO(archive.read(csv_name).decode()))
                )
                assert [
                    (
                        int(r["sample_no"]),
                        float(r["elapsed_s"]),
                        float(r["signal_value"]),
                    )
                    for r in rows
                ] == [(0, 0, 359), (30, 1, 1), (60, 2, 90)]
                assert sum(n.endswith(".md") for n in archive.namelist()) >= 2
            print(json.dumps(result))
        finally:
            for process in reversed(processes):
                process.terminate()
            for process in reversed(processes):
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            for log in logfiles:
                log.close()

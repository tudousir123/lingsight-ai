"""Gateway contract checks; runnable with unittest without database fixtures."""

import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.api.routes.agent import router
from app.core.config import settings
from app.models import User

TASK = "11111111-1111-4111-8111-111111111111"


class AgentGatewayTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.user = User(email="owner@example.com", hashed_password="unused")
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.calls: list[httpx.Request] = []
        self.response = httpx.Response(200, json=[])

        def upstream(request: httpx.Request) -> httpx.Response:
            self.calls.append(request)
            return self.response

        original_client = httpx.AsyncClient
        self.patches = [
            patch.object(settings, "AGENT_WORKSPACE_EMAIL", "owner@example.com"),
            patch.object(settings, "AGENT_API_TOKEN", "private-service-test-token"),
            patch.object(settings, "AGENT_BASE_URL", "http://agent.test"),
            patch(
                "app.api.routes.agent.httpx.AsyncClient",
                side_effect=lambda **kw: original_client(
                    transport=httpx.MockTransport(upstream), **kw
                ),
            ),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_login_required(self) -> None:
        self.app.dependency_overrides.clear()
        self.assertEqual(self.client.get("/agent/tasks").status_code, 401)
        self.assertFalse(self.calls)

    def test_other_user_cannot_read_workspace(self) -> None:
        self.user.email = "other@example.com"
        self.assertEqual(self.client.get("/agent/tasks").status_code, 403)
        self.assertFalse(self.calls)

    def test_creation_uses_private_auth_and_passes_body(self) -> None:
        self.response = httpx.Response(202, json={"task": {"id": TASK}})
        r = self.client.post(
            "/agent/tasks",
            json={"goal": "Analyze this video"},
            headers={"Authorization": "Bearer platform-jwt"},
        )
        self.assertEqual(r.status_code, 202)
        self.assertEqual(
            self.calls[0].headers["authorization"], "Bearer private-service-test-token"
        )
        self.assertIn(b"Analyze this video", self.calls[0].content)
        self.assertNotIn("private-service-test-token", r.text)

    def test_event_cursor_and_sse_are_preserved(self) -> None:
        self.response = httpx.Response(
            200,
            text='id: 8\nevent: task\ndata: {"id":8}\n\n',
            headers={"content-type": "text/event-stream"},
        )
        r = self.client.get(
            f"/agent/tasks/{TASK}/events",
            headers={"Accept": "text/event-stream", "Last-Event-ID": "7"},
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("id: 8", r.text)
        self.assertEqual(self.calls[0].url.params["after"], "7")
        self.assertEqual(self.calls[0].headers["accept"], "text/event-stream")

    def test_bad_cursor_and_unknown_paths_are_rejected(self) -> None:
        self.assertEqual(
            self.client.get(f"/agent/tasks/{TASK}/events?after=-1").status_code, 422
        )
        self.assertEqual(self.client.post("/agent/health").status_code, 404)
        self.assertFalse(self.calls)

    def test_private_upstream_failure_is_not_exposed(self) -> None:
        self.response = httpx.Response(401, text="private upstream detail")
        r = self.client.get("/agent/tasks")
        self.assertEqual(r.status_code, 502)
        self.assertNotIn("private upstream detail", r.text)

    def test_missing_configuration(self) -> None:
        with patch.object(settings, "AGENT_API_TOKEN", ""):
            self.assertEqual(self.client.get("/agent/tasks").status_code, 503)
        self.assertFalse(self.calls)

    def test_download_keeps_bytes_and_blocks_active_document_content(self) -> None:
        self.response = httpx.Response(
            200,
            content=b"PK\x03\x04test",
            headers={
                "content-type": "application/zip",
                "content-disposition": 'attachment; filename="research.zip"',
            },
        )
        r = self.client.get(f"/agent/tasks/{TASK}/bundle")
        self.assertEqual(r.content, b"PK\x03\x04test")
        self.assertIn("research.zip", r.headers["content-disposition"])
        self.assertIn("sandbox", r.headers["content-security-policy"])

    def test_payload_size_limit(self) -> None:
        self.assertEqual(
            self.client.post("/agent/tasks", content=b"x" * 128001).status_code, 413
        )
        self.assertFalse(self.calls)


if __name__ == "__main__":
    unittest.main()

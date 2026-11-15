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
        self.capabilities = httpx.Response(
            200,
            json={
                "project_scope": "immutable-v1",
                "project_data_configured": True,
                "user_scope": "platform-user-v1",
                "data_scope": "authorized-v1",
                "qa_completion": "intent-v1",
            },
        )
        self.error: Exception | None = None

        def upstream(request: httpx.Request) -> httpx.Response:
            self.calls.append(request)
            if self.error is not None:
                raise self.error
            if request.method == "GET" and request.url.path == "/v1/capabilities":
                return self.capabilities
            return self.response

        original_client = httpx.AsyncClient
        self.patches = [
            patch.object(settings, "AGENT_WORKSPACE_EMAIL", "owner@example.com"),
            patch.object(settings, "AGENT_API_TOKEN", "private-service-test-token"),
            patch.object(settings, "AGENT_BASE_URL", "http://agent.test"),
            patch(
                "app.api.gateway.httpx.AsyncClient",
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

    def test_all_active_users_get_trusted_isolated_context(self) -> None:
        self.user.email = "new-signup@example.com"
        response = self.client.get(
            "/agent/tasks", headers={"X-LingSight-User-Id": TASK}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls[-1].headers["x-lingsight-user-id"], str(self.user.id)
        )
        self.assertEqual(self.calls[0].url.path, "/v1/capabilities")

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
        self.assertIn(b"Analyze this video", self.calls[-1].content)
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
        self.assertEqual(self.calls[-1].url.params["after"], "7")
        self.assertEqual(self.calls[-1].headers["accept"], "text/event-stream")

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

    def test_upstream_5xx_and_redirect_are_normalized(self) -> None:
        self.response = httpx.Response(500, text="private upstream detail")
        r = self.client.get("/agent/tasks")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()["detail"], "科研 Agent 服务暂时不可用，请联系管理员")
        self.response = httpx.Response(
            302, headers={"location": "http://upstream/elsewhere"}
        )
        r = self.client.get("/agent/tasks")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()["detail"], "Unexpected Agent redirect")

    def test_connect_failure_reports_service_unavailable(self) -> None:
        self.error = httpx.ConnectError("connection refused")
        r = self.client.get("/agent/tasks")
        self.assertEqual(r.status_code, 503)
        self.assertIn("尚未就绪", r.json()["detail"])

    def test_inactive_account_cannot_access_workspace(self) -> None:
        self.user.is_active = False
        self.assertEqual(self.client.get("/agent/health").status_code, 403)
        self.assertFalse(self.calls)

    def test_default_none_and_completion_mode_forwarded(self) -> None:
        import json

        result = self.client.post(
            "/agent/tasks", json={"goal": " Explain latency ", "completion_mode": "qa"}
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(
            json.loads(self.calls[-1].content),
            {"goal": "Explain latency", "data_scope": "none", "completion_mode": "qa"},
        )

    def test_creation_rejects_scope_identity_and_invalid_goal(self) -> None:
        for body in [
            {"goal": "   "},
            {"goal": "x" * 12001},
            {"goal": "ask", "owner_user_id": str(self.user.id)},
            {"goal": "ask", "data_scope": "project"},
            {"goal": "ask", "project_id": None},
            {"goal": "ask", "data_scope": "none", "project_id": None},
            {"goal": "ask", "data_scope": "whole_library", "project_id": TASK},
            {"goal": "ask", "data_scope": None},
            {"goal": "ask", "completion_mode": "unknown"},
        ]:
            with self.subTest(body=body):
                result = self.client.post("/agent/tasks", json=body)
                self.assertEqual(result.status_code, 422)
                self.assertEqual(result.json()["detail"]["code"], "invalid_input")
        self.assertFalse(self.calls)

    def test_followup_cannot_mutate_task_scope(self) -> None:
        for field in ["owner_user_id", "project_id", "data_scope"]:
            result = self.client.post(
                f"/agent/tasks/{TASK}/messages", json={"text": "next", field: TASK}
            )
            self.assertEqual(result.status_code, 422)
        result = self.client.post(
            f"/agent/tasks/{TASK}/messages",
            json={"text": "Create report", "completion_mode": "research"},
        )
        self.assertEqual(result.status_code, 200)
        self.assertIn(b'"completion_mode":"research"', self.calls[-1].content)

    def test_each_user_operation_requires_capability_and_trusted_identity(self) -> None:
        routes = [
            ("GET", "tasks"),
            ("GET", f"tasks/{TASK}"),
            ("GET", f"tasks/{TASK}/events"),
            ("GET", f"tasks/{TASK}/bundle"),
            ("GET", f"runs/{TASK}"),
            ("GET", f"artifacts/{TASK}"),
            ("POST", f"runs/{TASK}/cancel"),
            ("POST", f"runs/{TASK}/resume"),
            ("POST", f"runs/{TASK}/clarifications/{TASK}/answer"),
            ("PATCH", f"artifacts/{TASK}"),
        ]
        for method, path in routes:
            with self.subTest(path=path, method=method):
                self.calls.clear()
                response = self.client.request(
                    method,
                    f"/agent/{path}?owner_user_id={TASK}&project_id={TASK}",
                    headers={"X-LingSight-User-Id": TASK, "X-User-Id": TASK},
                    json={"answer": "yes"}
                    if method == "POST"
                    else {"markdown": "text"}
                    if method == "PATCH"
                    else None,
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.calls[0].url.path, "/v1/capabilities")
                self.assertEqual(
                    self.calls[-1].headers["x-lingsight-user-id"], str(self.user.id)
                )
                self.assertNotIn("x-user-id", self.calls[-1].headers)
                self.assertNotIn("project_id", self.calls[-1].url.params)

    def test_old_agent_cannot_expose_any_user_data(self) -> None:
        self.capabilities = httpx.Response(
            200, json={"project_scope": "immutable-v1", "project_data_configured": True}
        )
        result = self.client.get("/agent/tasks")
        self.assertEqual(result.status_code, 503)
        self.assertEqual([call.url.path for call in self.calls], ["/v1/capabilities"])

    def test_none_scope_does_not_require_project_data_source(self) -> None:
        payload = self.capabilities.json()
        payload["project_data_configured"] = False
        self.capabilities = httpx.Response(200, json=payload)
        self.assertEqual(
            self.client.post(
                "/agent/tasks", json={"goal": "What is latency?"}
            ).status_code,
            200,
        )

    def test_business_error_envelopes_and_service_failures_are_distinct(self) -> None:
        for status in [403, 404, 409, 422, 503]:
            self.response = httpx.Response(
                status,
                json={
                    "error": {
                        "code": "scope_revoked",
                        "message": "Scope unavailable",
                        "fields": {"scope": "revoked"},
                    }
                },
            )
            result = self.client.get(f"/agent/tasks/{TASK}")
            self.assertEqual(result.status_code, status)
            self.assertEqual(
                result.json(),
                {
                    "detail": {
                        "code": "scope_revoked",
                        "message": "Scope unavailable",
                        "fields": {"scope": "revoked"},
                    }
                },
            )
        self.response = httpx.Response(
            401,
            json={
                "error": {
                    "code": "authentication_required",
                    "message": "private credential",
                }
            },
        )
        result = self.client.get("/agent/tasks")
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("private credential", result.text)

    def test_json_parse_and_media_type_errors(self) -> None:
        self.assertEqual(
            self.client.post(
                "/agent/tasks",
                content="broken",
                headers={"Content-Type": "application/json"},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/agent/tasks", content="{}", headers={"Content-Type": "text/plain"}
            ).status_code,
            415,
        )
        self.assertFalse(self.calls)


if __name__ == "__main__":
    unittest.main()

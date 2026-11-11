"""Server-side client for the video inference service (publish pipeline).

Unlike the browser-facing gateway (app/api/routes/inference.py), this module
talks to the service directly under the platform's service token and is used
only server-side: pulling a reviewed task's whitelisted artifacts when the
user publishes its results. The inference service keeps no MySQL credentials;
the platform backend stays the only writer of the application database.

Transport failures are typed here and mapped to HTTP copy in app/publishing;
this module never imports FastAPI so the pipeline tests can drive it with an
httpx.MockTransport-bound client.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, TypeVar

import httpx

from app.core.config import settings

CONNECT_TIMEOUT_S = 30
READ_TIMEOUT_S = 120
# tracking/keypoints JSON of a single video; generous ceiling against a
# misbehaving upstream, not a size the pipeline ever expects to hit.
JSON_ARTIFACT_CAP_BYTES = 256 * 1024 * 1024
STREAM_CHUNK_BYTES = 1024 * 1024
# overlay.mp4 stays on the inference host; publish only streams it once to
# hash, so this ceiling bounds a runaway stream, not real overlays.
STREAM_CAP_BYTES = 4 * 1024 * 1024 * 1024

JSON_ARTIFACTS = ("tracking.json", "keypoints.json", "provenance.json")

_T = TypeVar("_T")


class InferenceUnconfigured(Exception):
    """The service token/base URL is not configured in this environment."""


class InferenceUnreachable(Exception):
    """Connect/transport failure — the service cannot be reached."""


class InferenceNotFound(Exception):
    """The task or artifact does not exist upstream."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class InferenceUpstreamError(Exception):
    """Upstream answered with a failure status (auth, 5xx, …)."""

    def __init__(self, status_code: int) -> None:
        super().__init__(str(status_code))
        self.status_code = status_code


class InferenceArtifactTooLarge(Exception):
    """An artifact exceeded its publish ceiling."""


@dataclass(frozen=True)
class ArtifactDigest:
    name: str
    sha256: str
    size_bytes: int


class InferenceClient:
    """Minimal service-token client over the inference /v1 surface."""

    def __init__(self, base_url: str | None = None, token: str | None = None):
        self._base_url = (base_url or settings.INFERENCE_BASE_URL).rstrip("/")
        self._token = token if token is not None else settings.INFERENCE_API_TOKEN

    def _open(self) -> httpx.Client:
        if not self._token or not self._base_url:
            raise InferenceUnconfigured
        return httpx.Client(
            timeout=httpx.Timeout(CONNECT_TIMEOUT_S, read=READ_TIMEOUT_S),
            trust_env=False,
        )

    @contextmanager
    def _get(self, client: httpx.Client, path: str) -> Iterator[httpx.Response]:
        with client.stream(
            "GET",
            f"{self._base_url}/v1/{path}",
            headers={"Authorization": f"Bearer {self._token}"},
        ) as response:
            if response.status_code == 404:
                raise InferenceNotFound("推理任务或产物不存在")
            if response.status_code >= 400:
                raise InferenceUpstreamError(response.status_code)
            yield response

    def _send(self, handle: Callable[[httpx.Client], _T]) -> _T:
        try:
            with self._open() as client:
                return handle(client)
        except (
            InferenceUnconfigured,
            InferenceNotFound,
            InferenceUpstreamError,
            InferenceArtifactTooLarge,
        ):
            raise
        except httpx.HTTPError as exc:
            raise InferenceUnreachable(str(exc)) from exc

    def fetch_task(self, task_id: str) -> dict[str, Any]:
        """One task record (status, candidate, review) as the service shapes it."""

        def handle(client: httpx.Client) -> dict[str, Any]:
            with self._get(client, f"tasks/{task_id}") as response:
                payload = bytearray()
                for chunk in response.iter_bytes(STREAM_CHUNK_BYTES):
                    payload.extend(chunk)
                    if len(payload) > JSON_ARTIFACT_CAP_BYTES:
                        raise InferenceArtifactTooLarge("task")
            try:
                task = json.loads(payload)
            except ValueError, UnicodeError:
                raise InferenceUpstreamError(502) from None
            if not isinstance(task, dict):
                raise InferenceUpstreamError(502)
            return task

        return self._send(handle)

    def fetch_artifact(self, task_id: str, name: str) -> bytes:
        """Download one JSON artifact in full (with an explicit size ceiling)."""

        def handle(client: httpx.Client) -> bytes:
            with self._get(client, f"tasks/{task_id}/artifacts/{name}") as resp:
                payload = bytearray()
                for chunk in resp.iter_bytes(STREAM_CHUNK_BYTES):
                    payload.extend(chunk)
                    if len(payload) > JSON_ARTIFACT_CAP_BYTES:
                        raise InferenceArtifactTooLarge(name)
                return bytes(payload)

        return self._send(handle)

    def hash_artifact(self, task_id: str, name: str) -> ArtifactDigest:
        """Stream one artifact and hash it without keeping the bytes.

        Used for the large overlay video: the file itself stays on the
        inference host (L3); only the SHA-256 and size enter the database.
        """
        digest = hashlib.sha256()
        size = 0

        def handle(client: httpx.Client) -> None:
            nonlocal size
            with self._get(client, f"tasks/{task_id}/artifacts/{name}") as resp:
                for chunk in resp.iter_bytes(STREAM_CHUNK_BYTES):
                    digest.update(chunk)
                    size += len(chunk)
                    if size > STREAM_CAP_BYTES:
                        raise InferenceArtifactTooLarge(name)

        self._send(handle)
        return ArtifactDigest(name=name, sha256=digest.hexdigest(), size_bytes=size)

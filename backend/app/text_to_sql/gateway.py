"""Thin Model Gateway: one chat-completions provider, no SDK (ADR-0001).

A single ``Provider`` protocol keeps the pipeline model-agnostic: the real
implementation is an OpenAI-compatible HTTP call via httpx configured purely
from environment variables; tests (and the demo script) swap in scripted
providers. Swapping vendors is a config change, not a refactor.
"""

from typing import TYPE_CHECKING, Protocol

import httpx

if TYPE_CHECKING:
    from app.text_to_sql.settings import ResearchQuerySettings

Message = dict[str, str]
"""Chat message: ``{"role": "system" | "user" | "assistant", "content": str}``."""


class ProviderError(Exception):
    """The LLM endpoint failed (transport, HTTP, or malformed payload)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.reason_code = "provider_error"


class Provider(Protocol):
    def chat(self, messages: list[Message]) -> str:
        """Return the assistant message content for the given conversation."""
        ...


class OpenAICompatProvider:
    """OpenAI-compatible /chat/completions over plain httpx."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout_seconds: float = 60.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds

    @classmethod
    def from_settings(cls, settings: ResearchQuerySettings) -> OpenAICompatProvider:
        if not settings.LLM_BASE_URL:
            msg = (
                "LLM_BASE_URL is not configured; set LLM_BASE_URL/LLM_API_KEY/"
                "LLM_MODEL in the environment to use a real provider"
            )
            raise ProviderError(msg)
        return cls(
            base_url=settings.LLM_BASE_URL,
            api_key=settings.LLM_API_KEY,
            model=settings.LLM_MODEL,
            timeout_seconds=settings.LLM_TIMEOUT_SECONDS,
        )

    def chat(self, messages: list[Message]) -> str:
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        payload = {
            "model": self._model,
            "messages": messages,
            # Deterministic SQL generation; no sampling creativity wanted.
            "temperature": 0,
        }
        try:
            response = httpx.post(
                f"{self._base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=self._timeout_seconds,
            )
        except httpx.HTTPError as error:
            msg = f"LLM endpoint unreachable: {error.__class__.__name__}"
            raise ProviderError(msg) from error
        if response.status_code != 200:
            raise ProviderError(f"LLM endpoint returned HTTP {response.status_code}")
        try:
            body = response.json()
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError, ValueError) as error:
            msg = "LLM endpoint returned a malformed chat completion"
            raise ProviderError(msg) from error
        if not isinstance(content, str) or not content.strip():
            raise ProviderError("LLM endpoint returned empty content")
        return content

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


def _error_detail(response: httpx.Response) -> str:
    """Extract the endpoint's own error text, e.g. "(1113: 余额不足…)".

    Vendors put the actionable reason (quota, balance, bad model) in the
    body; the status code alone (429/400) hides it from the user.
    """
    try:
        error = response.json().get("error", {})
        code = error.get("code")
        message = error.get("message")
    except ValueError:
        return ""
    if message is None:
        return ""
    code_part = f"{code}: " if code is not None else ""
    return f" ({code_part}{str(message)[:200]})"


class ProviderError(Exception):
    """The LLM endpoint failed (transport, HTTP, or malformed payload)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.reason_code = "provider_error"


def _unreachable(error: Exception) -> ProviderError:
    """Transport-level failure: no HTTP exchange happened at all."""
    return ProviderError(f"LLM endpoint unreachable: {error.__class__.__name__}")


class Provider(Protocol):
    def probe(self) -> None:
        """Transport-level liveness check (any HTTP status counts as alive)."""
        ...

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

    def probe(self) -> None:
        """Transport-level liveness check; any HTTP status counts as alive.

        Env gates (test fixtures, run_eval) call this to tell "endpoint
        down" from a code failure without spending tokens — the LLM-side
        counterpart of ``executor.run("SELECT 1")`` on the DB side.
        """
        try:
            httpx.get(self._base_url, timeout=5.0)
        except httpx.HTTPError as error:
            raise _unreachable(error) from error

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
            raise _unreachable(error) from error
        if response.status_code != 200:
            raise ProviderError(
                f"LLM endpoint returned HTTP {response.status_code}"
                f"{_error_detail(response)}"
            )
        try:
            body = response.json()
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError, ValueError) as error:
            msg = "LLM endpoint returned a malformed chat completion"
            raise ProviderError(msg) from error
        if not isinstance(content, str) or not content.strip():
            raise ProviderError("LLM endpoint returned empty content")
        return content


class AnthropicCompatProvider:
    """/v1/messages (Anthropic wire protocol) over plain httpx.

    Subscription keys (e.g. GLM Coding Plan) authenticate against the
    Anthropic-compatible endpoint instead of /chat/completions. Two protocol
    gaps are bridged here: system messages become the top-level ``system``
    parameter (Anthropic rejects them inside ``messages``), and responses are
    content-block arrays where only ``text`` blocks carry the answer —
    reasoning blocks are skipped, and ``max_tokens`` is mandatory.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout_seconds: float = 60.0,
        max_tokens: int = 4096,
        thinking_budget_tokens: int | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_tokens = max_tokens
        self._thinking_budget_tokens = thinking_budget_tokens

    def probe(self) -> None:
        """Transport-level liveness check; any HTTP status counts as alive."""
        try:
            httpx.get(self._base_url, timeout=5.0)
        except httpx.HTTPError as error:
            raise _unreachable(error) from error

    def chat(self, messages: list[Message]) -> str:
        system_parts = [m["content"] for m in messages if m["role"] == "system"]
        turns = [m for m in messages if m["role"] != "system"]
        headers = {"anthropic-version": "2023-06-01"}
        if self._api_key:
            headers["x-api-key"] = self._api_key
        payload: dict[str, object] = {
            "model": self._model,
            "messages": turns,
            "max_tokens": self._max_tokens,
            "temperature": 0,
        }
        if self._thinking_budget_tokens is not None:
            payload["thinking"] = {
                "type": "enabled",
                "budget_tokens": self._thinking_budget_tokens,
            }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)
        try:
            response = httpx.post(
                f"{self._base_url}/v1/messages",
                headers=headers,
                json=payload,
                timeout=self._timeout_seconds,
            )
        except httpx.HTTPError as error:
            raise _unreachable(error) from error
        if response.status_code != 200:
            raise ProviderError(
                f"LLM endpoint returned HTTP {response.status_code}"
                f"{_error_detail(response)}"
            )
        try:
            body = response.json()
            blocks = body["content"]
            content = "".join(
                block["text"]
                for block in blocks
                if isinstance(block, dict) and block.get("type") == "text"
            )
        except (KeyError, TypeError, ValueError) as error:
            msg = "LLM endpoint returned a malformed message response"
            raise ProviderError(msg) from error
        if not content.strip():
            raise ProviderError("LLM endpoint returned empty content")
        return content


def build_provider(settings: ResearchQuerySettings) -> Provider:
    """Wire the concrete provider from settings: protocol stays config."""
    if not settings.LLM_BASE_URL:
        msg = (
            "LLM_BASE_URL is not configured; set LLM_BASE_URL/LLM_API_KEY/"
            "LLM_MODEL in the environment to use a real provider"
        )
        raise ProviderError(msg)
    if settings.LLM_PROTOCOL == "anthropic":
        thinking_budget = (
            settings.LLM_THINKING_BUDGET_TOKENS
            if settings.LLM_THINKING == "enabled"
            else None
        )
        return AnthropicCompatProvider(
            base_url=settings.LLM_BASE_URL,
            api_key=settings.LLM_API_KEY,
            model=settings.LLM_MODEL,
            timeout_seconds=settings.LLM_TIMEOUT_SECONDS,
            max_tokens=settings.LLM_MAX_TOKENS,
            thinking_budget_tokens=thinking_budget,
        )
    if settings.LLM_PROTOCOL == "openai":
        return OpenAICompatProvider(
            base_url=settings.LLM_BASE_URL,
            api_key=settings.LLM_API_KEY,
            model=settings.LLM_MODEL,
            timeout_seconds=settings.LLM_TIMEOUT_SECONDS,
        )
    raise ProviderError(
        f"LLM_PROTOCOL must be 'openai' or 'anthropic', got {settings.LLM_PROTOCOL!r}"
    )

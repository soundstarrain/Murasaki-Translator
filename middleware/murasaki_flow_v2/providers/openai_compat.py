"""OpenAI-compatible provider."""

from __future__ import annotations

from typing import Any, Dict, List
import json
import time
import requests
import itertools
import threading
import re
from urllib.parse import urlparse

from .base import BaseProvider, ProviderRequest, ProviderResponse, ProviderError


_VERSION_SEGMENT = re.compile(r"/v\d+(?:/|$)")
DEFAULT_STOP_TOKENS = [
    "<|im_end|>",  # ChatML
    "<|endoftext|>",  # GPT/Base
    "</s>",  # Llama 2/Mistral
    "<|eot_id|>",  # Llama 3
    "<|end_of_text|>",  # Llama 3 Base
    "\n\n\n",  # Heuristic safety net
]


class _RpmLimiter:
    def __init__(self, rpm: int):
        self.rpm = rpm
        self._lock = threading.Lock()
        self._window_start = time.time()
        self._count = 0

    def acquire(self) -> None:
        if self.rpm <= 0:
            return
        while True:
            with self._lock:
                now = time.time()
                elapsed = now - self._window_start
                if elapsed >= 60:
                    self._window_start = now
                    self._count = 0
                if self._count < self.rpm:
                    self._count += 1
                    return
                wait_seconds = max(0.0, 60 - elapsed)
            if wait_seconds > 0:
                time.sleep(wait_seconds)
            else:
                time.sleep(0.01)


def _normalize_base_url(base_url: str) -> str:
    base_url = base_url.strip().rstrip("/")
    if not base_url:
        return base_url
    if base_url.endswith("/v1/chat/completions"):
        return base_url.rsplit("/chat/completions", 1)[0]
    path = (urlparse(base_url).path or "").lower()
    if _VERSION_SEGMENT.search(path) or "/openapi" in path:
        return base_url
    return f"{base_url}/v1"


def _build_url(base_url: str) -> str:
    normalized = _normalize_base_url(base_url)
    return f"{normalized}/chat/completions"


def _normalize_keys(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        return [line.strip() for line in raw.splitlines() if line.strip()]
    return [str(raw).strip()] if str(raw).strip() else []


class OpenAICompatProvider(BaseProvider):
    def __init__(self, profile: Dict[str, Any]):
        super().__init__(profile)
        self._api_keys = _normalize_keys(profile.get("api_key"))
        self._api_key_cycle = (
            itertools.cycle(self._api_keys) if len(self._api_keys) > 1 else None
        )
        self._lock = threading.Lock()
        raw_rpm = (
            profile.get("rpm")
            if profile.get("rpm") is not None
            else profile.get("requests_per_minute")
        )
        try:
            rpm_value = int(raw_rpm) if raw_rpm is not None else 0
        except (TypeError, ValueError):
            rpm_value = 0
        self._rpm_limiter = _RpmLimiter(rpm_value) if rpm_value > 0 else None

    def _pick_api_key(self) -> str:
        if not self._api_keys:
            return ""
        with self._lock:
            if self._api_key_cycle is not None:
                return next(self._api_key_cycle)
            return self._api_keys[0]

    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        model = str(settings.get("model") or self.profile.get("model") or "").strip()
        if not model:
            raise ProviderError("OpenAI-compatible provider requires model")
        temperature = settings.get("temperature")
        max_tokens = settings.get("max_tokens")
        extra: Dict[str, Any] = {}
        profile_params = self.profile.get("params") or {}
        settings_params = settings.get("params") or settings.get("extra") or {}
        if isinstance(profile_params, dict):
            extra.update(profile_params)
        if isinstance(settings_params, dict):
            extra.update(settings_params)
        if "stop" not in extra:
            extra["stop"] = DEFAULT_STOP_TOKENS

        headers: Dict[str, str] = {}
        profile_headers = self.profile.get("headers") or {}
        settings_headers = settings.get("headers") or {}
        if isinstance(profile_headers, dict):
            headers.update({str(k): str(v) for k, v in profile_headers.items()})
        if isinstance(settings_headers, dict):
            headers.update({str(k): str(v) for k, v in settings_headers.items()})

        timeout = settings.get("timeout") or self.profile.get("timeout")
        timeout = int(timeout) if timeout is not None else None
        return ProviderRequest(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra=extra,
            headers=headers if headers else None,
            timeout=timeout,
        )

    def send(self, request: ProviderRequest) -> ProviderResponse:
        base_url = str(self.profile.get("base_url") or "").strip()
        if not base_url:
            raise ProviderError("OpenAI-compatible provider requires base_url")

        if self._rpm_limiter:
            self._rpm_limiter.acquire()

        url = _build_url(base_url)
        api_key = self._pick_api_key()
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        if request.headers:
            headers.update({str(k): str(v) for k, v in request.headers.items()})

        payload: Dict[str, Any] = {
            "model": request.model,
            "messages": request.messages,
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.extra:
            payload.update(request.extra)

        start = time.time()
        try:
            resp = requests.post(
                url,
                headers=headers,
                data=json.dumps(payload),
                timeout=request.timeout or 600,
            )
        except requests.RequestException as exc:
            raise ProviderError(f"OpenAI-compatible request failed: {exc}") from exc

        duration = time.time() - start
        if resp.status_code >= 400:
            raise ProviderError(
                f"OpenAI-compatible HTTP {resp.status_code}: {resp.text}"
            )

        try:
            data = resp.json()
        except ValueError as exc:
            raise ProviderError("OpenAI-compatible response is not JSON") from exc

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("OpenAI-compatible response missing content") from exc

        return ProviderResponse(text=text, raw={"data": data, "duration": duration})

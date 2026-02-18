"""Provider base classes for Pipeline V2."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class ProviderRequest:
    model: str
    messages: List[Dict[str, str]]
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    extra: Dict[str, Any] | None = None
    headers: Dict[str, str] | None = None
    timeout: Optional[int] = None
    provider_id: Optional[str] = None


@dataclass
class ProviderResponse:
    text: str
    raw: Any


class ProviderError(RuntimeError):
    pass


class BaseProvider:
    def __init__(self, profile: Dict[str, Any]):
        self.profile = profile

    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        raise NotImplementedError

    def send(self, request: ProviderRequest) -> ProviderResponse:
        raise NotImplementedError

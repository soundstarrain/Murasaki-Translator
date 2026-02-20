"""Provider pool for load balancing between multiple API profiles."""

from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING
import random
import threading
import math

from .base import BaseProvider, ProviderRequest, ProviderResponse, ProviderError
from .openai_compat import OpenAICompatProvider

if TYPE_CHECKING:
    from .registry import ProviderRegistry


class PoolProvider(BaseProvider):
    def __init__(self, profile: Dict[str, Any], registry: "ProviderRegistry"):
        super().__init__(profile)
        self.registry = registry
        self._endpoints = self._normalize_endpoints(profile.get("endpoints") or [])
        if not self._endpoints:
            raise ProviderError("Pool provider requires endpoints")
        self._endpoint_providers = [
            OpenAICompatProvider(self._build_endpoint_profile(item))
            for item in self._endpoints
        ]
        self._endpoint_weights = [
            self._normalize_weight(item.get("weight")) for item in self._endpoints
        ]
        self._lock = threading.Lock()

    def _normalize_endpoints(self, raw: Any) -> List[Dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        endpoints: List[Dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            base_url = str(item.get("base_url") or item.get("baseUrl") or "").strip()
            if not base_url:
                continue
            endpoints.append(
                {
                    "base_url": base_url,
                    "api_key": item.get("api_key") or item.get("apiKey"),
                    "model": item.get("model"),
                    "weight": item.get("weight"),
                    "rpm": item.get("rpm"),
                }
            )
        return endpoints

    def _normalize_weight(self, value: Any) -> float:
        try:
            weight = float(value)
        except (TypeError, ValueError):
            weight = 1.0
        if not math.isfinite(weight) or weight <= 0:
            return 1.0
        return weight

    def _build_endpoint_profile(self, endpoint: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "base_url": endpoint.get("base_url"),
            "api_key": endpoint.get("api_key") or self.profile.get("api_key"),
            "model": endpoint.get("model") or self.profile.get("model"),
            "headers": self.profile.get("headers"),
            "params": self.profile.get("params"),
            "timeout": self.profile.get("timeout"),
            "rpm": endpoint.get("rpm") or self.profile.get("rpm"),
        }

    def _pick_endpoint_index(self) -> int:
        with self._lock:
            if not self._endpoint_weights:
                return 0
            return random.choices(
                range(len(self._endpoint_weights)),
                weights=self._endpoint_weights,
                k=1,
            )[0]

    def _endpoint_id(self, index: int) -> str:
        return f"endpoint:{index}"

    def _endpoint_from_request(self, request: ProviderRequest) -> int | None:
        provider_id = request.provider_id or ""
        if provider_id.startswith("endpoint:"):
            try:
                idx = int(provider_id.split(":", 1)[1])
            except (ValueError, TypeError):
                return None
            if 0 <= idx < len(self._endpoint_providers):
                return idx
        return None

    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        idx = self._pick_endpoint_index()
        provider = self._endpoint_providers[idx]
        request = provider.build_request(messages, settings)
        request.provider_id = self._endpoint_id(idx)
        return request

    def send(self, request: ProviderRequest) -> ProviderResponse:
        idx = self._endpoint_from_request(request)
        if idx is None:
            idx = self._pick_endpoint_index()
        provider = self._endpoint_providers[idx]
        return provider.send(request)

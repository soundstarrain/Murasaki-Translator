"""Provider pool for load balancing between multiple API profiles."""

from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING
import itertools
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
        self.strategy = str(profile.get("strategy") or "round_robin")
        self._endpoints = self._normalize_endpoints(profile.get("endpoints") or [])
        self._endpoint_providers = [
            OpenAICompatProvider(self._build_endpoint_profile(item))
            for item in self._endpoints
        ]
        self._endpoint_weights = [
            self._normalize_weight(item.get("weight")) for item in self._endpoints
        ]
        self._endpoint_rr = itertools.cycle(
            self._build_weighted_indices(self._endpoint_weights)
        )
        members = profile.get("members") or []
        if not self._endpoints:
            if not isinstance(members, list) or not members:
                raise ProviderError("Pool provider requires non-empty members")
            self.members = [str(m) for m in members]
            self._rr = itertools.cycle(self.members)
        else:
            self.members = []
            self._rr = itertools.cycle([])
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

    def _build_weighted_indices(self, weights: List[float]) -> List[int]:
        if not weights:
            return [0]
        indices: List[int] = []
        for idx, weight in enumerate(weights):
            count = max(1, int(round(weight)))
            indices.extend([idx] * count)
        return indices if indices else [0]

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
            if self.strategy == "random":
                return random.choices(
                    range(len(self._endpoint_weights)),
                    weights=self._endpoint_weights,
                    k=1,
                )[0]
            return next(self._endpoint_rr)

    def _pick(self) -> str:
        with self._lock:
            if self.strategy == "random":
                return random.choice(self.members)
            return next(self._rr)

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
        if self._endpoint_providers:
            idx = self._pick_endpoint_index()
            provider = self._endpoint_providers[idx]
            request = provider.build_request(messages, settings)
            request.provider_id = self._endpoint_id(idx)
            return request
        provider_id = self._pick()
        provider = self.registry.get_provider(provider_id)
        request = provider.build_request(messages, settings)
        request.provider_id = provider_id
        return request

    def send(self, request: ProviderRequest) -> ProviderResponse:
        if self._endpoint_providers:
            idx = self._endpoint_from_request(request)
            if idx is None:
                idx = self._pick_endpoint_index()
            provider = self._endpoint_providers[idx]
            return provider.send(request)
        provider_id = request.provider_id or self._pick()
        provider = self.registry.get_provider(provider_id)
        return provider.send(request)

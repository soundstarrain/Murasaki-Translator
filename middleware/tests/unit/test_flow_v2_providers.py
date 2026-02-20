import pytest

from murasaki_flow_v2.providers.base import BaseProvider, ProviderRequest, ProviderResponse
from murasaki_flow_v2.providers.pool import PoolProvider
from murasaki_flow_v2.providers.openai_compat import _normalize_base_url


class DummyProvider(BaseProvider):
    def __init__(self, provider_id: str):
        super().__init__({})
        self.provider_id = provider_id

    def build_request(self, messages, settings):
        return ProviderRequest(model="dummy", messages=messages)

    def send(self, request):
        return ProviderResponse(text=self.provider_id, raw={"provider": self.provider_id})


class DummyRegistry:
    def __init__(self):
        self.providers = {}

    def add(self, provider_id: str):
        self.providers[provider_id] = DummyProvider(provider_id)

    def get_provider(self, ref: str):
        return self.providers[ref]


@pytest.mark.unit
def test_flow_v2_pool_provider_endpoint_selection_single():
    registry = DummyRegistry()
    pool = PoolProvider(
        {
            "endpoints": [
                {
                    "base_url": "https://api.example.com/v1",
                    "api_key": "key-a",
                    "model": "model-a",
                    "weight": 2,
                }
            ],
            "model": "fallback-model",
        },
        registry,
    )
    req = pool.build_request([], {})
    assert req.provider_id == "endpoint:0"


@pytest.mark.unit
def test_flow_v2_pool_provider_endpoints_build_request():
    registry = DummyRegistry()
    pool = PoolProvider(
        {
            "endpoints": [
                {
                    "base_url": "https://api.example.com/v1",
                    "api_key": "key-a",
                    "model": "model-a",
                    "weight": 2,
                }
            ],
            "model": "fallback-model",
        },
        registry,
    )
    req = pool.build_request([], {})
    assert req.model == "model-a"


@pytest.mark.unit
def test_openai_compat_normalize_base_url_versions():
    assert (
        _normalize_base_url("https://api.example.com")
        == "https://api.example.com/v1"
    )
    assert (
        _normalize_base_url("https://api.example.com/v1")
        == "https://api.example.com/v1"
    )
    assert (
        _normalize_base_url(
            "https://aiplatform.googleapis.com/v1/projects/x/locations/y/endpoints/openapi"
        )
        == "https://aiplatform.googleapis.com/v1/projects/x/locations/y/endpoints/openapi"
    )
    assert (
        _normalize_base_url("https://open.bigmodel.cn/api/paas/v4")
        == "https://open.bigmodel.cn/api/paas/v4"
    )

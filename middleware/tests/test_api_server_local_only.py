from pathlib import Path

from fastapi.testclient import TestClient

from murasaki_flow_v2.api_server import PROFILE_KINDS, create_app
from murasaki_flow_v2.registry.profile_store import ProfileStore


def _build_client(tmp_path: Path, base_url: str) -> TestClient:
    profiles_dir = tmp_path / "profiles"
    store = ProfileStore(str(profiles_dir))
    store.ensure_dirs(PROFILE_KINDS)
    app = create_app(store, tmp_path)
    return TestClient(app, base_url=base_url)


def test_local_only_allows_loopback(tmp_path: Path) -> None:
    client = _build_client(tmp_path, "http://127.0.0.1")
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json().get("ok") is True


def test_local_only_blocks_non_loopback(tmp_path: Path) -> None:
    client = _build_client(tmp_path, "http://example.com")
    response = client.get("/health")
    assert response.status_code == 403

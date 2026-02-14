import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parents[2] / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from api_server import app


@pytest.mark.contract
def test_health_auth_flag(monkeypatch):
    monkeypatch.delenv("MURASAKI_API_KEY", raising=False)
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload.get("auth_required") is False


@pytest.mark.contract
def test_health_auth_required_true(monkeypatch):
    monkeypatch.setenv("MURASAKI_API_KEY", "unit-test-key")
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload.get("auth_required") is True


@pytest.mark.contract
def test_status_requires_auth(monkeypatch):
    monkeypatch.setenv("MURASAKI_API_KEY", "unit-test-key")
    client = TestClient(app)

    resp = client.get("/api/v1/status")
    assert resp.status_code == 403

    resp = client.get(
        "/api/v1/status",
        headers={"Authorization": "Bearer unit-test-key"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert "status" in payload
    assert "model_loaded" in payload
    assert "active_tasks" in payload
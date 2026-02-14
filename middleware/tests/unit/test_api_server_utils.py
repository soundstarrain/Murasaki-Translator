import sys
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parents[2] / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from api_server import (
    _parse_cors_origins,
    _normalize_api_key,
    _is_api_key_valid,
    _is_ws_auth_required,
    _is_path_within,
    _parse_env_int,
    _parse_env_optional_int,
    _parse_env_bool,
    _parse_env_str,
    _mask_secret,
)


@pytest.mark.unit
def test_parse_cors_origins_defaults_to_wildcard(monkeypatch):
    monkeypatch.delenv("MURASAKI_CORS_ORIGINS", raising=False)
    assert _parse_cors_origins() == ["*"]
    monkeypatch.setenv("MURASAKI_CORS_ORIGINS", " , ")
    assert _parse_cors_origins() == ["*"]


@pytest.mark.unit
def test_parse_cors_origins_split(monkeypatch):
    monkeypatch.setenv("MURASAKI_CORS_ORIGINS", "http://a, http://b ")
    assert _parse_cors_origins() == ["http://a", "http://b"]


@pytest.mark.unit
def test_normalize_api_key():
    assert _normalize_api_key(None) == ""
    assert _normalize_api_key("  Bearer key123  ") == "key123"


@pytest.mark.unit
def test_is_api_key_valid(monkeypatch):
    monkeypatch.delenv("MURASAKI_API_KEY", raising=False)
    assert _is_api_key_valid(None) is True
    monkeypatch.setenv("MURASAKI_API_KEY", "secret")
    assert _is_api_key_valid(None) is False
    assert _is_api_key_valid("Bearer secret") is True
    assert _is_api_key_valid("Bearer wrong") is False


@pytest.mark.unit
def test_is_ws_auth_required(monkeypatch):
    monkeypatch.delenv("MURASAKI_WS_AUTH_REQUIRED", raising=False)
    assert _is_ws_auth_required() is False
    monkeypatch.setenv("MURASAKI_WS_AUTH_REQUIRED", "1")
    assert _is_ws_auth_required() is True
    monkeypatch.setenv("MURASAKI_WS_AUTH_REQUIRED", "no")
    assert _is_ws_auth_required() is False


@pytest.mark.unit
def test_is_path_within(tmp_path):
    base_dir = tmp_path / "base"
    child_dir = base_dir / "child"
    base_dir.mkdir()
    child_dir.mkdir()
    inside = child_dir / "file.txt"
    inside.write_text("ok", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("no", encoding="utf-8")
    assert _is_path_within(inside, base_dir) is True
    assert _is_path_within(outside, base_dir) is False


@pytest.mark.unit
def test_parse_env_int(monkeypatch):
    monkeypatch.setenv("TEST_INT", "5")
    assert _parse_env_int("TEST_INT", default=1) == 5
    monkeypatch.setenv("TEST_INT", "oops")
    assert _parse_env_int("TEST_INT", default=3) == 3
    monkeypatch.setenv("TEST_INT", "-1")
    assert _parse_env_int("TEST_INT", default=2, minimum=0) == 2


@pytest.mark.unit
def test_parse_env_optional_int(monkeypatch):
    monkeypatch.delenv("TEST_OPT_INT", raising=False)
    assert _parse_env_optional_int("TEST_OPT_INT", default=None) is None
    monkeypatch.setenv("TEST_OPT_INT", "")
    assert _parse_env_optional_int("TEST_OPT_INT", default=9) == 9
    monkeypatch.setenv("TEST_OPT_INT", "7")
    assert _parse_env_optional_int("TEST_OPT_INT", default=9) == 7
    monkeypatch.setenv("TEST_OPT_INT", "-2")
    assert _parse_env_optional_int("TEST_OPT_INT", default=1, minimum=0) == 1


@pytest.mark.unit
def test_parse_env_bool(monkeypatch):
    monkeypatch.delenv("TEST_BOOL", raising=False)
    assert _parse_env_bool("TEST_BOOL", default=True) is True
    monkeypatch.setenv("TEST_BOOL", "false")
    assert _parse_env_bool("TEST_BOOL", default=True) is False
    monkeypatch.setenv("TEST_BOOL", "yes")
    assert _parse_env_bool("TEST_BOOL", default=False) is True
    monkeypatch.setenv("TEST_BOOL", "maybe")
    assert _parse_env_bool("TEST_BOOL", default=False) is False


@pytest.mark.unit
def test_parse_env_str(monkeypatch):
    monkeypatch.delenv("TEST_STR", raising=False)
    assert _parse_env_str("TEST_STR", default="d") == "d"
    monkeypatch.setenv("TEST_STR", "  value ")
    assert _parse_env_str("TEST_STR", default="d") == "value"
    monkeypatch.setenv("TEST_STR", " ")
    assert _parse_env_str("TEST_STR", default="d") == "d"


@pytest.mark.unit
def test_mask_secret():
    assert _mask_secret("") == "(not-set)"
    assert _mask_secret("short") == "********"
    assert _mask_secret("1234567890") == "1234...7890"

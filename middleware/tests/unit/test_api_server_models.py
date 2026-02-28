import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SERVER_DIR = Path(__file__).resolve().parents[2] / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import api_server as server


@pytest.mark.unit
@pytest.mark.asyncio
async def test_list_models_includes_env_default_model_outside_models_dir(monkeypatch, tmp_path):
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    external_model = tmp_path / "external" / "Murasaki-14B-v0.2-Q6_K.gguf"
    external_model.parent.mkdir()
    external_model.write_bytes(b"gguf-data")

    monkeypatch.setattr(server, "_default_models_dir", lambda: models_dir)
    monkeypatch.setattr(server, "worker", None)
    monkeypatch.setenv("MURASAKI_DEFAULT_MODEL", str(external_model))

    models = await server.list_models()
    model_paths = {model.path for model in models}

    assert str(external_model.resolve()) in model_paths


@pytest.mark.unit
@pytest.mark.asyncio
async def test_list_models_dedupes_default_and_models_dir(monkeypatch, tmp_path):
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    model_file = models_dir / "same.gguf"
    model_file.write_bytes(b"gguf")

    monkeypatch.setattr(server, "_default_models_dir", lambda: models_dir)
    monkeypatch.setenv("MURASAKI_DEFAULT_MODEL", str(model_file))
    monkeypatch.setattr(server, "worker", SimpleNamespace(model_path=str(model_file)))

    models = await server.list_models()
    model_paths = [model.path for model in models]

    assert model_paths.count(str(model_file.resolve())) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_list_models_resolves_relative_env_model_from_middleware_dir(monkeypatch, tmp_path):
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    middleware_dir = tmp_path / "middleware"
    server_dir = middleware_dir / "server"
    custom_dir = middleware_dir / "custom"
    server_dir.mkdir(parents=True)
    custom_dir.mkdir(parents=True)

    relative_model = custom_dir / "relative.gguf"
    relative_model.write_bytes(b"gguf")

    other_cwd = tmp_path / "other-cwd"
    other_cwd.mkdir()

    monkeypatch.chdir(other_cwd)
    monkeypatch.setattr(server, "_default_models_dir", lambda: models_dir)
    monkeypatch.setattr(server, "_middleware_dir", middleware_dir)
    monkeypatch.setattr(server, "_server_dir", server_dir)
    monkeypatch.setattr(server, "worker", None)
    monkeypatch.setenv("MURASAKI_DEFAULT_MODEL", "custom/relative.gguf")

    models = await server.list_models()
    model_paths = {model.path for model in models}

    assert str(relative_model.resolve()) in model_paths

import subprocess
from pathlib import Path

import pytest

from murasaki_translator.core.engine import InferenceEngine


class DummyProc:
    def __init__(self, cmd):
        self.cmd = cmd
        self.pid = 1234
        self.returncode = None

    def poll(self):
        return None

    def terminate(self):
        self.returncode = 0

    def wait(self, timeout=None):
        return 0

    def kill(self):
        self.returncode = -9


@pytest.mark.unit
def test_start_server_builds_command_with_options(monkeypatch, tmp_path):
    server_path = tmp_path / "llama-server.exe"
    model_path = tmp_path / "model.gguf"
    server_path.write_text("", encoding="utf-8")
    model_path.write_text("", encoding="utf-8")

    engine = InferenceEngine(
        server_path=str(server_path),
        model_path=str(model_path),
        n_ctx=2048,
        n_parallel=2,
        flash_attn=True,
        kv_cache_type="q4_0",
        batch_size=512,
        seed=42,
    )

    captured = {}

    def fake_popen(cmd, stdout=None, stderr=None):
        captured["cmd"] = cmd
        return DummyProc(cmd)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(engine, "_wait_for_ready", lambda *args, **kwargs: None)
    monkeypatch.chdir(tmp_path)

    engine.start_server()
    engine.stop_server()

    cmd = captured["cmd"]
    assert "-m" in cmd and str(model_path) in cmd
    assert "--parallel" in cmd and "2" in cmd
    assert "--ctx-size" in cmd and "2048" in cmd
    assert "-fa" in cmd and "on" in cmd
    assert "--cache-type-k" in cmd and "q4_0" in cmd
    assert "--cache-type-v" in cmd and "q4_0" in cmd
    assert "-b" in cmd and "512" in cmd
    assert "-ub" in cmd and "512" in cmd
    assert "-s" in cmd and "42" in cmd


@pytest.mark.unit
def test_start_server_large_batch_uses_ctx_cap(monkeypatch, tmp_path):
    server_path = tmp_path / "llama-server.exe"
    model_path = tmp_path / "model.gguf"
    server_path.write_text("", encoding="utf-8")
    model_path.write_text("", encoding="utf-8")

    engine = InferenceEngine(
        server_path=str(server_path),
        model_path=str(model_path),
        n_ctx=512,
        use_large_batch=True,
    )

    captured = {}

    def fake_popen(cmd, stdout=None, stderr=None):
        captured["cmd"] = cmd
        return DummyProc(cmd)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(engine, "_wait_for_ready", lambda *args, **kwargs: None)
    monkeypatch.chdir(tmp_path)

    engine.start_server()
    engine.stop_server()

    cmd = captured["cmd"]
    assert "-b" in cmd and "512" in cmd
    assert "-ub" in cmd and "512" in cmd

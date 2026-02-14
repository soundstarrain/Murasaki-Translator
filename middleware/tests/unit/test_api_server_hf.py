import sys
from types import SimpleNamespace
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parents[2] / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import api_server as server


@pytest.mark.unit
def test_run_hf_command_success(monkeypatch, tmp_path):
    script_path = tmp_path / "hf_downloader.py"
    script_path.write_text("print('ok')", encoding="utf-8")
    monkeypatch.setattr(server, "_hf_script_path", lambda: script_path)

    def fake_run(*args, **kwargs):
        return SimpleNamespace(
            stdout='log line\n{"type":"list","items":[1,2]}',
            stderr="",
        )

    monkeypatch.setattr(server.subprocess, "run", fake_run)

    payload = server._run_hf_command(["list"], timeout=1)
    assert payload["type"] == "list"
    assert payload["items"] == [1, 2]


@pytest.mark.unit
def test_run_hf_command_error(monkeypatch, tmp_path):
    script_path = tmp_path / "hf_downloader.py"
    script_path.write_text("print('ok')", encoding="utf-8")
    monkeypatch.setattr(server, "_hf_script_path", lambda: script_path)

    def fake_run(*args, **kwargs):
        return SimpleNamespace(
            stdout='{"type":"error","message":"boom"}',
            stderr="",
        )

    monkeypatch.setattr(server.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError):
        server._run_hf_command(["list"], timeout=1)


@pytest.mark.unit
def test_update_hf_task(monkeypatch):
    monkeypatch.setattr(server, "hf_download_tasks", {})
    task_id = "t1"
    server.hf_download_tasks[task_id] = {"id": task_id, "status": "starting", "updated_at": 0}

    server._update_hf_task(task_id, status="downloading", percent=12.5)
    task = server.hf_download_tasks[task_id]
    assert task["status"] == "downloading"
    assert task["percent"] == 12.5
    assert task["updated_at"] > 0

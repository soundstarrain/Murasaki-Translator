import asyncio
import sys
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parents[2] / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import translation_worker as worker_module
from translation_worker import TranslationTask, TranslationWorker, TaskStatus


class DummyStdout:
    def __init__(self, lines):
        self._lines = [line if isinstance(line, bytes) else line.encode("utf-8") for line in lines]

    async def readline(self):
        await asyncio.sleep(0)
        if not self._lines:
            return b""
        return self._lines.pop(0)


class DummyProcess:
    def __init__(self, lines=None, returncode=0):
        self.stdout = DummyStdout(lines or [])
        self.returncode = returncode
        self.pid = 12345

    async def wait(self):
        await asyncio.sleep(0)
        return self.returncode


class DummyServerProcess:
    def __init__(self, returncode=None):
        self.returncode = returncode
        self.pid = 9999

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode


@pytest.mark.unit
def test_translation_task_log_caps():
    task = TranslationTask(task_id="t-1", request=object())
    task.MAX_LOG_LINES = 3
    for index in range(5):
        task.add_log(f"line-{index}")
    assert task.logs == ["line-2", "line-3", "line-4"]


@pytest.mark.unit
def test_is_path_within(tmp_path):
    base_dir = tmp_path / "base"
    child_dir = base_dir / "child"
    base_dir.mkdir()
    child_dir.mkdir()
    child_path = child_dir / "file.txt"
    child_path.write_text("ok", encoding="utf-8")
    outside_path = tmp_path / "outside.txt"
    outside_path.write_text("no", encoding="utf-8")

    assert TranslationWorker._is_path_within(child_path, base_dir) is True
    assert TranslationWorker._is_path_within(outside_path, base_dir) is False


@pytest.mark.unit
def test_cleanup_stale_temp_artifacts(tmp_path, monkeypatch):
    worker = TranslationWorker(model_path="model.gguf")
    temp_dir = tmp_path / "temp"
    temp_dir.mkdir()
    monkeypatch.setattr(worker, "_temp_artifact_dir", temp_dir)

    middleware_dir = Path(__file__).resolve().parents[2]
    root_file = middleware_dir / "rules_pre_test.json"
    temp_file = temp_dir / "protect_patterns_test.txt"
    root_file.write_text("{}", encoding="utf-8")
    temp_file.write_text("x", encoding="utf-8")

    worker._cleanup_stale_temp_artifacts()

    assert root_file.exists() is False
    assert temp_file.exists() is False


class DummyRequest:
    def __init__(self, **overrides):
        self.text = overrides.get("text", "hello")
        self.file_path = overrides.get("file_path")
        self.model = overrides.get("model")
        self.glossary = overrides.get("glossary")
        self.preset = overrides.get("preset", "default")
        self.mode = overrides.get("mode", "line")
        self.chunk_size = overrides.get("chunk_size", 1000)
        self.ctx = overrides.get("ctx", 2048)
        self.gpu_layers = overrides.get("gpu_layers", -1)
        self.temperature = overrides.get("temperature", 0.7)
        self.line_format = overrides.get("line_format", "single")
        self.strict_mode = overrides.get("strict_mode", "off")
        self.line_check = overrides.get("line_check", False)
        self.line_tolerance_abs = overrides.get("line_tolerance_abs", 10)
        self.line_tolerance_pct = overrides.get("line_tolerance_pct", 0.2)
        self.anchor_check = overrides.get("anchor_check", False)
        self.anchor_check_retries = overrides.get("anchor_check_retries", 1)
        self.traditional = overrides.get("traditional", False)
        self.save_cot = overrides.get("save_cot", False)
        self.save_summary = overrides.get("save_summary", False)
        self.alignment_mode = overrides.get("alignment_mode", False)
        self.resume = overrides.get("resume", False)
        self.save_cache = overrides.get("save_cache", False)
        self.cache_path = overrides.get("cache_path")
        self.rules_pre = overrides.get("rules_pre")
        self.rules_post = overrides.get("rules_post")
        self.rules_pre_inline = overrides.get("rules_pre_inline")
        self.rules_post_inline = overrides.get("rules_post_inline")
        self.rep_penalty_base = overrides.get("rep_penalty_base", 1.0)
        self.rep_penalty_max = overrides.get("rep_penalty_max", 1.5)
        self.rep_penalty_step = overrides.get("rep_penalty_step", 0.1)
        self.max_retries = overrides.get("max_retries", 3)
        self.output_hit_threshold = overrides.get("output_hit_threshold", 60.0)
        self.cot_coverage_threshold = overrides.get("cot_coverage_threshold", 80.0)
        self.coverage_retries = overrides.get("coverage_retries", 1)
        self.retry_temp_boost = overrides.get("retry_temp_boost", 0.05)
        self.retry_prompt_feedback = overrides.get("retry_prompt_feedback", True)
        self.balance_enable = overrides.get("balance_enable", False)
        self.balance_threshold = overrides.get("balance_threshold", 0.6)
        self.balance_count = overrides.get("balance_count", 3)
        self.parallel = overrides.get("parallel", 1)
        self.flash_attn = overrides.get("flash_attn", False)
        self.kv_cache_type = overrides.get("kv_cache_type", "f16")
        self.use_large_batch = overrides.get("use_large_batch", False)
        self.batch_size = overrides.get("batch_size")
        self.seed = overrides.get("seed")
        self.text_protect = overrides.get("text_protect", False)
        self.protect_patterns = overrides.get("protect_patterns")
        self.fix_ruby = overrides.get("fix_ruby", False)
        self.fix_kana = overrides.get("fix_kana", False)
        self.fix_punctuation = overrides.get("fix_punctuation", False)
        self.gpu_device_id = overrides.get("gpu_device_id")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_rejects_config_change_when_running(monkeypatch, tmp_path):
    worker = TranslationWorker(model_path="model.gguf")
    worker._current_config["ctx"] = 1024
    worker._current_config["gpu_layers"] = -1
    worker._current_config["model_path"] = "model.gguf"
    worker._current_config["flash_attn"] = False
    worker._current_config["kv_cache_type"] = "f16"
    worker._current_config["parallel"] = 2
    worker._current_config["use_large_batch"] = False
    worker._current_config["batch_size"] = None
    worker._current_config["seed"] = None
    worker._running_tasks = 1

    monkeypatch.setattr(worker, "is_ready", lambda: True)

    captured = {}

    async def fake_create_subprocess_exec(*cmd, **kwargs):
        captured["cmd"] = list(cmd)
        return DummyProcess([])

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    task = TranslationTask(
        task_id="cfg1",
        request=DummyRequest(
            ctx=2048,
            parallel=4,
            use_large_batch=True,
            batch_size=512,
            seed=42,
        ),
    )
    outputs_dir = Path(__file__).resolve().parents[2] / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    output_path = outputs_dir / f"{task.task_id}_output.txt"
    output_path.write_text("ok", encoding="utf-8")

    result = await worker.translate(task)
    assert result == "ok"
    assert any("配置变化被拒绝" in line for line in task.logs)
    cmd = captured["cmd"]
    assert "--ctx" in cmd
    ctx_index = cmd.index("--ctx") + 1
    assert cmd[ctx_index] == "1024"
    assert "--concurrency" in cmd
    concurrency_index = cmd.index("--concurrency") + 1
    assert cmd[concurrency_index] == "2"
    assert "--use-large-batch" not in cmd
    assert "--batch-size" not in cmd
    assert "--seed" not in cmd


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_cancel_requested_kills_process(monkeypatch):
    worker = TranslationWorker(model_path="model.gguf")
    monkeypatch.setattr(worker, "is_ready", lambda: True)

    killed = {"called": False}

    async def fake_kill(process):
        killed["called"] = True

    async def fake_create_subprocess_exec(*cmd, **kwargs):
        return DummyProcess([b"PROGRESS:{\"current\":1,\"total\":2}\n"])

    monkeypatch.setattr(worker, "_kill_process_tree", fake_kill)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    task = TranslationTask(task_id="cancel1", request=DummyRequest())
    task.cancel_requested = True

    result = await worker.translate(task)
    assert result == ""
    assert task.status == TaskStatus.CANCELLED
    assert killed["called"] is True
    assert any("cancelled" in line.lower() for line in task.logs)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_rejects_unsafe_file_path(monkeypatch, tmp_path):
    worker = TranslationWorker(model_path="model.gguf")
    monkeypatch.setattr(worker, "is_ready", lambda: True)
    unsafe_path = tmp_path / "outside.txt"
    unsafe_path.write_text("data", encoding="utf-8")
    task = TranslationTask(
        task_id="unsafe",
        request=DummyRequest(text=None, file_path=str(unsafe_path)),
    )
    with pytest.raises(ValueError):
        await worker.translate(task)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_protect_patterns_outside_allowed(monkeypatch, tmp_path):
    worker = TranslationWorker(model_path="model.gguf")
    monkeypatch.setattr(worker, "is_ready", lambda: True)

    captured = {}

    async def fake_create_subprocess_exec(*cmd, **kwargs):
        captured["cmd"] = list(cmd)
        return DummyProcess([])

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    protect_path = tmp_path / "patterns.txt"
    protect_path.write_text("x", encoding="utf-8")

    task = TranslationTask(
        task_id="protect1",
        request=DummyRequest(protect_patterns=str(protect_path), text="hello"),
    )
    outputs_dir = Path(__file__).resolve().parents[2] / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    output_path = outputs_dir / f"{task.task_id}_output.txt"
    output_path.write_text("ok", encoding="utf-8")

    result = await worker.translate(task)
    assert result == "ok"
    assert any("protect_patterns path is outside allowed" in line for line in task.logs)
    cmd = captured["cmd"]
    assert "--protect-patterns" in cmd
    arg = cmd[cmd.index("--protect-patterns") + 1]
    assert arg != str(protect_path)
    assert Path(arg).parent == worker._temp_artifact_dir
    assert arg.endswith(".txt")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_translate_disables_retry_prompt_feedback(monkeypatch, tmp_path):
    worker = TranslationWorker(model_path="model.gguf")
    worker._current_config = {
        "model_path": "model.gguf",
        "ctx": 2048,
        "gpu_layers": -1,
        "flash_attn": False,
        "kv_cache_type": "f16",
        "parallel": 1,
        "use_large_batch": False,
        "batch_size": None,
        "seed": None,
    }
    monkeypatch.setattr(worker, "is_ready", lambda: True)

    captured = {}

    async def fake_create_subprocess_exec(*cmd, **kwargs):
        captured["cmd"] = list(cmd)
        return DummyProcess([])

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    task = TranslationTask(
        task_id="retry1",
        request=DummyRequest(retry_prompt_feedback=False),
    )
    outputs_dir = Path(__file__).resolve().parents[2] / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    output_path = outputs_dir / f"{task.task_id}_output.txt"
    output_path.write_text("ok", encoding="utf-8")

    result = await worker.translate(task)
    assert result == "ok"
    cmd = captured["cmd"]
    assert "--no-retry-prompt-feedback" in cmd
    assert "--retry-prompt-feedback" not in cmd


@pytest.mark.unit
@pytest.mark.asyncio
async def test_start_server_builds_ctx_total(monkeypatch, tmp_path):
    server_path = tmp_path / "llama-server.exe"
    model_path = tmp_path / "model.gguf"
    server_path.write_text("", encoding="utf-8")
    model_path.write_text("", encoding="utf-8")

    worker = TranslationWorker(model_path=str(model_path))
    monkeypatch.setattr(worker, "_find_llama_server", lambda: str(server_path))
    monkeypatch.setattr(worker, "_wait_for_server_ready", lambda *args, **kwargs: asyncio.sleep(0))
    monkeypatch.setattr(worker, "_server_pid_path", tmp_path / "pid.txt")

    captured = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        return DummyServerProcess(returncode=None)

    monkeypatch.setattr(worker_module.subprocess, "Popen", fake_popen)

    await worker.start_server(ctx=2048, parallel=2, batch_size=4096)

    cmd = captured["cmd"]
    assert "--parallel" in cmd and "2" in cmd
    # ctx_total = ctx * parallel
    assert "--ctx-size" in cmd and "4096" in cmd
    assert "-c" in cmd and "4096" in cmd
    # batch size capped by ctx (not ctx_total)
    assert "-b" in cmd and "2048" in cmd
    assert "-ub" in cmd and "2048" in cmd


@pytest.mark.unit
@pytest.mark.asyncio
async def test_wait_for_server_ready_success(monkeypatch):
    worker = TranslationWorker(model_path="model.gguf")
    worker.server_process = DummyServerProcess(returncode=None)

    class DummyResp:
        status_code = 200

    monkeypatch.setattr(worker_module.requests, "get", lambda *args, **kwargs: DummyResp())
    await worker._wait_for_server_ready(timeout=1)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_wait_for_server_ready_process_exit(monkeypatch):
    worker = TranslationWorker(model_path="model.gguf")
    worker.server_process = DummyServerProcess(returncode=1)

    with pytest.raises(RuntimeError):
        await worker._wait_for_server_ready(timeout=1)

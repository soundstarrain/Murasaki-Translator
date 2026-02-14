#!/usr/bin/env python3
"""
Translation Worker - 翻译任务执行器
封装 main.py 的翻译逻辑，支持异步执行和进度回调

修复：
- 常驻 llama-server，避免冷启动地狱
- 进程组销毁，避免僵尸进程
- PYTHONUNBUFFERED=1 确保日志即时性
"""

import os
import sys
import signal
import asyncio
import tempfile
import subprocess
import threading
import time
import json
import logging
import re
import requests
from pathlib import Path
from typing import Optional, Callable, List, Any
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime

# 添加父目录到 path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TaskStatus(Enum):
    """任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TranslationTask:
    """翻译任务"""
    task_id: str
    request: object  # TranslateRequest from api_server
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)

    # 进度
    progress: float = 0.0
    current_block: int = 0
    total_blocks: int = 0

    # 结果
    result: Optional[str] = None
    output_path: Optional[str] = None
    error: Optional[str] = None

    # 日志（限制最大条数防止内存泄漏）
    logs: List[str] = field(default_factory=list)
    MAX_LOG_LINES: int = field(default=20000, repr=False)  # 最多保留 20000 条日志

    # 控制
    cancel_requested: bool = False
    _process: Optional[asyncio.subprocess.Process] = field(default=None, repr=False)

    def add_log(self, message: str):
        """添加日志，自动限制条数防止内存膨胀"""
        self.logs.append(message)
        # 超过限制时只保留最新的日志（使用安全的切片逻辑）
        if len(self.logs) > self.MAX_LOG_LINES:
            # 只保留最新的 MAX_LOG_LINES 条，避免复杂的头尾拼接导致错乱
            self.logs = self.logs[-self.MAX_LOG_LINES:]


class TranslationWorker:
    """
    翻译工作器 - 管理常驻 llama-server 和翻译任务

    架构：
    1. 启动时启动常驻 llama-server（模型常驻内存）
    2. 翻译任务使用 --no-server-spawn 连接常驻服务器
    3. 进程使用进程组，确保 cancel 时子进程一起销毁
    """

    def __init__(self, model_path: Optional[str] = None, port: int = 8080):
        self.model_path = model_path or os.environ.get("MURASAKI_DEFAULT_MODEL")
        self.server_process = None
        self.server_port = port
        self.server_host = "127.0.0.1"
        self.start_time = time.time()
        self._lock = threading.Lock()
        self._server_ready = False
        self._server_log_handle = None
        self._server_pid_path = Path(__file__).parent.parent / "llama-daemon.pid"

        # 并发控制：防止配置变更时杀死正在运行的任务
        self._running_tasks = 0  # 正在运行的任务数
        self._tasks_lock = threading.Lock()  # 任务计数锁

        # 服务器配置缓存：用于检测参数变化
        self._current_config = {
            "model_path": None,
            "ctx": None,
            "gpu_layers": None,
            "flash_attn": None,
            "kv_cache_type": None,
            "parallel": None,
            "use_large_batch": None,
            "batch_size": None,
            "seed": None,
        }
        self._temp_artifact_dir = Path(__file__).parent.parent / "temp"
        self._cleanup_stale_temp_artifacts()

    @staticmethod
    def _is_path_within(path: Path, base: Path) -> bool:
        try:
            path.resolve().relative_to(base.resolve())
            return True
        except ValueError:
            return False

    def _cleanup_stale_temp_artifacts(self):
        """清理上次异常退出残留的临时规则/保护文件"""
        middleware_dir = Path(__file__).parent.parent
        cleanup_roots = [middleware_dir, self._temp_artifact_dir]
        name_pattern = re.compile(
            r"^(rules_pre_|rules_post_|protect_patterns_|temp_rules_pre_|temp_rules_post_|temp_protect_patterns_).*\.(json|txt)$",
            re.IGNORECASE,
        )

        for root in cleanup_roots:
            try:
                root.mkdir(parents=True, exist_ok=True)
            except OSError:
                continue
            try:
                for file_path in root.iterdir():
                    if not file_path.is_file():
                        continue
                    if not name_pattern.match(file_path.name):
                        continue
                    try:
                        file_path.unlink()
                    except OSError:
                        pass
            except OSError:
                continue

    def is_ready(self) -> bool:
        """检查服务器是否就绪"""
        if not self._server_ready:
            return False
        if self.server_process is None:
            return False
        return self.server_process.poll() is None

    def uptime(self) -> float:
        """获取运行时间"""
        return time.time() - self.start_time

    def _find_llama_server(self) -> str:
        """查找 llama-server 二进制（带 NVIDIA GPU 检测）"""
        middleware_dir = Path(__file__).parent.parent

        force_cpu = os.environ.get("MURASAKI_FORCE_CPU", "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

        if sys.platform == 'linux':
            if force_cpu:
                logging.info("MURASAKI_FORCE_CPU=1, using linux-cpu backend")
                candidate = middleware_dir / 'bin' / 'linux-cpu' / 'llama-server'
            else:
                # 修复：使用 which 检测而非硬编码路径
                has_nvidia = self._check_nvidia_gpu()
                if has_nvidia:
                    candidate = middleware_dir / 'bin' / 'linux-cuda' / 'llama-server'
                    if not candidate.exists():
                        candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'
                else:
                    candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'

            # 最终回退到 CPU（避免无 GPU/Vulkan 环境直接报错）
            if not candidate.exists() and not force_cpu:
                cpu_candidate = middleware_dir / 'bin' / 'linux-cpu' / 'llama-server'
                if cpu_candidate.exists():
                    logging.info("Backend binary missing, fallback to linux-cpu")
                    candidate = cpu_candidate
        elif sys.platform == 'darwin':
            import platform
            if 'arm' in platform.machine().lower():
                candidate = middleware_dir / 'bin' / 'darwin-metal' / 'llama-server'
            else:
                candidate = middleware_dir / 'bin' / 'darwin-x64' / 'llama-server'
        else:
            # Windows: 检测 nvidia-smi
            has_nvidia = self._check_nvidia_gpu()
            if has_nvidia:
                candidate = middleware_dir / 'bin' / 'win-cuda' / 'llama-server.exe'
            else:
                candidate = middleware_dir / 'bin' / 'win-vulkan' / 'llama-server.exe'

        # 回退到旧目录结构
        if not candidate.exists():
            for subdir in middleware_dir.iterdir():
                if subdir.is_dir():
                    binary_name = 'llama-server.exe' if sys.platform == 'win32' else 'llama-server'
                    legacy_path = subdir / binary_name
                    if legacy_path.exists():
                        return str(legacy_path)

        if not candidate.exists():
            raise FileNotFoundError(f"llama-server not found: {candidate}")

        return str(candidate)

    def _check_nvidia_gpu(self) -> bool:
        """跨平台检测 NVIDIA GPU（支持 Windows 多路径）"""
        import shutil
        # Windows 上 nvidia-smi 可能不在 PATH 中
        nvidia_smi_paths = ['nvidia-smi']
        if sys.platform == 'win32':
            nvidia_smi_paths.extend([
                r'C:\Windows\System32\nvidia-smi.exe',
                r'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe'
            ])

        for nvidia_smi in nvidia_smi_paths:
            try:
                # 检查命令是否存在
                if not os.path.isabs(nvidia_smi) and not shutil.which(nvidia_smi):
                    continue
                if os.path.isabs(nvidia_smi) and not os.path.exists(nvidia_smi):
                    continue

                result = subprocess.run(
                    [nvidia_smi, '--query-gpu=name', '--format=csv,noheader'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    logging.info(f"NVIDIA GPU detected: {result.stdout.strip()}")
                    return True
            except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
                continue

        logging.info("No NVIDIA GPU detected, using Vulkan/Metal fallback")
        return False

    async def start_server(
        self,
        gpu_layers: int = -1,
        ctx: int = 8192,
        flash_attn: bool = False,
        kv_cache_type: str = "f16",
        parallel: int = 1,
        use_large_batch: bool = False,
        batch_size: Optional[int] = None,
        seed: Optional[int] = None,
    ):
        """启动常驻 llama-server（模型常驻内存）"""
        if self.server_process and self.server_process.poll() is None:
            return  # 已在运行

        if not self.model_path:
            raise ValueError("Model path not set")

        # 保存当前配置
        self._current_config = {
            "model_path": self.model_path,
            "ctx": ctx,
            "gpu_layers": gpu_layers,
            "flash_attn": flash_attn,
            "kv_cache_type": kv_cache_type,
            "parallel": parallel,
            "use_large_batch": use_large_batch,
            "batch_size": batch_size,
            "seed": seed,
        }

        parallel = max(1, int(parallel))
        if batch_size is not None and int(batch_size) <= 0:
            batch_size = None

        # Ensure per-slot context equals requested ctx when parallel > 1.
        # llama-server splits total ctx across slots, so we scale by parallel here.
        ctx_total = int(ctx) * parallel

        server_path = self._find_llama_server()

        cmd = [
            server_path,
            "-m", self.model_path,
            "--host", self.server_host,
            "--port", str(self.server_port),
            "-ngl", str(gpu_layers),
            "-c", str(ctx_total),
            "--ctx-size", str(ctx_total),
            "--parallel", str(parallel),
            "--reasoning-format", "deepseek-legacy",
            "--metrics"
        ]

        if flash_attn:
            cmd.extend(["-fa", "on"])
        if kv_cache_type:
            cmd.extend(["--cache-type-k", kv_cache_type, "--cache-type-v", kv_cache_type])
        if batch_size:
            final_batch = min(int(batch_size), int(ctx))
            cmd.extend(["-b", str(final_batch), "-ub", str(final_batch)])
        elif use_large_batch:
            safe_batch = min(1024, int(ctx))
            cmd.extend(["-b", str(safe_batch), "-ub", str(safe_batch)])
        if seed is not None:
            cmd.extend(["-s", str(seed)])

        # 记录 llama-server 输出，便于远程/本机诊断
        log_path = Path(__file__).parent.parent / "llama-daemon.log"
        log_target = subprocess.DEVNULL
        try:
            self._server_log_handle = open(log_path, "a", encoding="utf-8")
            log_target = self._server_log_handle
        except OSError:
            self._server_log_handle = None

        # 使用进程组启动，确保子进程可被一起销毁

        if sys.platform != 'win32':
            self.server_process = subprocess.Popen(
                cmd,
                stdout=log_target,
                stderr=log_target,
                start_new_session=True  # 创建新进程组
            )
        else:
            # Windows: 使用 CREATE_NEW_PROCESS_GROUP
            self.server_process = subprocess.Popen(
                cmd,
                stdout=log_target,
                stderr=log_target,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            )

        # Persist PID so external callers can ensure cleanup
        try:
            if self.server_process and self.server_process.pid:
                self._server_pid_path.write_text(str(self.server_process.pid), encoding="utf-8")
        except OSError:
            pass

        # 等待服务器就绪
        await self._wait_for_server_ready()
        self._server_ready = True

    async def _wait_for_server_ready(self, timeout: int = 180):
        """等待 llama-server 就绪"""
        start = time.time()
        url = f"http://{self.server_host}:{self.server_port}/v1/models"

        while time.time() - start < timeout:
            if self.server_process and self.server_process.poll() is not None:
                raise RuntimeError(f"llama-server exited with code {self.server_process.returncode}")

            try:
                resp = requests.get(url, timeout=2)
                if resp.status_code == 200:
                    return
            except requests.RequestException:
                pass

            await asyncio.sleep(1)

        raise TimeoutError("llama-server failed to start within timeout")

    def stop_server(self):
        """停止常驻服务器（进程组销毁）"""
        pid = None
        if self.server_process:
            pid = self.server_process.pid

            if sys.platform != 'win32':
                # Unix: 杀死整个进程组
                try:
                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                    self.server_process.wait(timeout=5)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        os.killpg(os.getpgid(pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            else:
                # Windows: 使用 taskkill /T 杀死进程树
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        capture_output=True,
                        timeout=5
                    )
                except subprocess.TimeoutExpired:
                    pass

            self.server_process = None
            self._server_ready = False
        # Fallback: kill by persisted PID if needed
        if pid is None:
            try:
                if self._server_pid_path.exists():
                    pid_text = self._server_pid_path.read_text(encoding="utf-8").strip()
                    pid = int(pid_text) if pid_text.isdigit() else None
            except OSError:
                pid = None
        if pid and sys.platform == "win32":
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True,
                    timeout=5
                )
            except subprocess.TimeoutExpired:
                pass

        try:
            if self._server_pid_path.exists():
                self._server_pid_path.unlink()
        except OSError:
            pass
        if self._server_log_handle:
            try:
                self._server_log_handle.close()
            except OSError:
                pass
            self._server_log_handle = None

    async def translate(self, task: TranslationTask) -> str:
        """
        执行翻译任务（使用常驻服务器）
        """
        request = task.request
        middleware_dir = Path(__file__).parent.parent
        temp_artifacts: List[str] = []
        self._temp_artifact_dir.mkdir(parents=True, exist_ok=True)
        requested_model_path = request.model or self.model_path
        if not requested_model_path:
            raise ValueError("Model path is not set")

        # 构建新配置
        effective_config = {
            "model_path": requested_model_path,
            "ctx": request.ctx,
            "gpu_layers": request.gpu_layers,
            "flash_attn": request.flash_attn,
            "kv_cache_type": request.kv_cache_type,
            "parallel": request.parallel,
            "use_large_batch": request.use_large_batch,
            "batch_size": request.batch_size,
            "seed": request.seed,
        }

        # 检查配置是否变化（修复服务器参数"锁定"问题）
        config_changed = (
            self._current_config["ctx"] != effective_config["ctx"] or
            self._current_config["gpu_layers"] != effective_config["gpu_layers"] or
            self._current_config["model_path"] != effective_config["model_path"] or
            self._current_config["flash_attn"] != effective_config["flash_attn"] or
            self._current_config["kv_cache_type"] != effective_config["kv_cache_type"] or
            self._current_config["parallel"] != effective_config["parallel"] or
            self._current_config["use_large_batch"] != effective_config["use_large_batch"] or
            self._current_config["batch_size"] != effective_config["batch_size"] or
            self._current_config["seed"] != effective_config["seed"]
        )

        need_restart_server = False

        # 并发保护：有任务运行时拒绝配置变更，防止杀死正在运行的任务
        with self._tasks_lock:
            if self.is_ready() and config_changed:
                if self._running_tasks > 0:
                    # 有任务正在运行，拒绝配置变更
                    task.add_log(f"[Worker] 配置变化被拒绝：当前有 {self._running_tasks} 个任务正在运行")
                    task.add_log(f"[Worker] 使用当前配置继续 (ctx: {self._current_config['ctx']})")
                    effective_config = {
                        "model_path": self._current_config["model_path"] or requested_model_path,
                        "ctx": self._current_config["ctx"],
                        "gpu_layers": self._current_config["gpu_layers"],
                        "flash_attn": self._current_config["flash_attn"],
                        "kv_cache_type": self._current_config["kv_cache_type"],
                        "parallel": self._current_config["parallel"],
                        "use_large_batch": self._current_config["use_large_batch"],
                        "batch_size": self._current_config["batch_size"],
                        "seed": self._current_config["seed"],
                    }
                else:
                    # 没有任务运行，可以安全重启
                    task.add_log(
                        f"[Worker] 配置变化，重启服务器 "
                        f"(ctx: {self._current_config['ctx']} -> {effective_config['ctx']}, "
                        f"gpu_layers: {self._current_config['gpu_layers']} -> {effective_config['gpu_layers']})"
                    )
                    need_restart_server = True

            # 增加运行任务计数
            self._running_tasks += 1

        try:
            if need_restart_server:
                self.stop_server()

            self.model_path = effective_config["model_path"]
            # 确保服务器已启动
            if not self.is_ready():
                await self.start_server(
                    gpu_layers=effective_config["gpu_layers"],
                    ctx=effective_config["ctx"],
                    flash_attn=effective_config["flash_attn"],
                    kv_cache_type=effective_config["kv_cache_type"],
                    parallel=effective_config["parallel"],
                    use_large_batch=effective_config["use_large_batch"],
                    batch_size=effective_config["batch_size"],
                    seed=effective_config["seed"],
                )

            # 准备输入
            if request.text:
                # 文本模式：写入临时文件
                input_file = tempfile.NamedTemporaryFile(
                    mode='w', suffix='.txt', delete=False, encoding='utf-8'
                )
                input_file.write(request.text)
                input_file.close()
                input_path = input_file.name
                temp_artifacts.append(input_path)
            else:
                # 安全验证：file_path 必须在允许的目录内
                # 防止路径遍历攻击（如 ../../etc/passwd）
                uploads_dir = middleware_dir / "uploads"
                uploads_dir.mkdir(exist_ok=True)

                requested_path = Path(request.file_path).resolve()

                # 检查是否在允许的目录内
                allowed_dirs = [
                    uploads_dir.resolve(),
                    (middleware_dir / "outputs").resolve(),
                ]

                is_allowed = any(
                    self._is_path_within(requested_path, allowed_dir)
                    for allowed_dir in allowed_dirs
                )

                if not is_allowed:
                    raise ValueError(
                        f"Security error: file_path must be within uploads/ or outputs/ directory. "
                        f"Got: {request.file_path}"
                    )

                if not requested_path.exists():
                    raise FileNotFoundError(f"File not found: {request.file_path}")

                input_path = str(requested_path)

            # 准备输出路径
            output_dir = middleware_dir / "outputs"
            output_dir.mkdir(exist_ok=True)
            output_path = output_dir / f"{task.task_id}_output.txt"
            task.output_path = str(output_path)

            def _write_temp_json(prefix: str, payload: Any) -> str:
                temp_file = tempfile.NamedTemporaryFile(
                    mode="w",
                    suffix=".json",
                    prefix=f"{prefix}_",
                    delete=False,
                    encoding="utf-8",
                    dir=str(self._temp_artifact_dir),
                )
                json.dump(payload, temp_file, ensure_ascii=False, indent=2)
                temp_file.close()
                temp_artifacts.append(temp_file.name)
                return temp_file.name

            def _write_temp_text(prefix: str, payload: str) -> str:
                temp_file = tempfile.NamedTemporaryFile(
                    mode="w",
                    suffix=".txt",
                    prefix=f"{prefix}_",
                    delete=False,
                    encoding="utf-8",
                    dir=str(self._temp_artifact_dir),
                )
                temp_file.write(payload)
                temp_file.close()
                temp_artifacts.append(temp_file.name)
                return temp_file.name

            parallel = max(1, int(effective_config.get("parallel") or 1))

            # 构建命令行参数（关键：使用 --no-server-spawn 连接常驻服务器）
            cmd = [
                sys.executable,
                str(middleware_dir / "murasaki_translator" / "main.py"),
                "--file", input_path,
                "--output", str(output_path),
                "--preset", request.preset,
                "--mode", request.mode,
                "--chunk-size", str(request.chunk_size),
                "--ctx", str(effective_config["ctx"]),
                "--gpu-layers", str(effective_config["gpu_layers"]),
                "--temperature", str(request.temperature),
                "--line-format", request.line_format,
                "--strict-mode", request.strict_mode,
                "--concurrency", str(parallel),
                "--rep-penalty-base", str(request.rep_penalty_base),
                "--rep-penalty-max", str(request.rep_penalty_max),
                "--rep-penalty-step", str(request.rep_penalty_step),
                "--max-retries", str(request.max_retries),
                "--output-hit-threshold", str(request.output_hit_threshold),
                "--cot-coverage-threshold", str(request.cot_coverage_threshold),
                "--coverage-retries", str(request.coverage_retries),
                "--retry-temp-boost", str(request.retry_temp_boost),
                # 关键修复：连接常驻服务器，不再每次启动新服务器
                "--no-server-spawn",
                "--server-host", self.server_host,
                "--server-port", str(self.server_port),
            ]

            # 可选参数
            if effective_config["model_path"]:
                cmd.extend(["--model", effective_config["model_path"]])

            if request.glossary:
                cmd.extend(["--glossary", request.glossary])

            if request.line_check:
                cmd.extend([
                    "--line-check",
                    "--line-tolerance-abs", str(request.line_tolerance_abs),
                    "--line-tolerance-pct", str(request.line_tolerance_pct),
                ])
            if request.anchor_check:
                cmd.extend([
                    "--anchor-check",
                    "--anchor-check-retries", str(request.anchor_check_retries),
                ])

            if request.balance_enable:
                cmd.append("--balance-enable")
                cmd.extend([
                    "--balance-threshold", str(request.balance_threshold),
                    "--balance-count", str(request.balance_count),
                ])

            if request.traditional:
                cmd.append("--traditional")

            if request.save_cot:
                cmd.append("--save-cot")

            if request.save_summary:
                cmd.append("--save-summary")

            if request.alignment_mode:
                cmd.append("--alignment-mode")

            if request.resume:
                cmd.append("--resume")

            rules_pre_path = request.rules_pre
            if not rules_pre_path and request.rules_pre_inline is not None:
                rules_pre_path = _write_temp_json("rules_pre", request.rules_pre_inline)
            if rules_pre_path:
                cmd.extend(["--rules-pre", rules_pre_path])

            rules_post_path = request.rules_post
            if not rules_post_path and request.rules_post_inline is not None:
                rules_post_path = _write_temp_json("rules_post", request.rules_post_inline)
            if rules_post_path:
                cmd.extend(["--rules-post", rules_post_path])

            if request.retry_prompt_feedback:
                cmd.append("--retry-prompt-feedback")
            else:
                cmd.append("--no-retry-prompt-feedback")

            if effective_config["flash_attn"]:
                cmd.append("--flash-attn")

            if effective_config["kv_cache_type"]:
                cmd.extend(["--kv-cache-type", effective_config["kv_cache_type"]])

            if effective_config.get("use_large_batch"):
                cmd.append("--use-large-batch")
            if effective_config.get("batch_size"):
                cmd.extend(["--batch-size", str(effective_config["batch_size"])])
            if effective_config.get("seed") is not None:
                cmd.extend(["--seed", str(effective_config["seed"])])

            if request.text_protect:
                cmd.append("--text-protect")
            if request.protect_patterns:
                protect_patterns = str(request.protect_patterns)
                if os.path.exists(protect_patterns):
                    protect_path = Path(protect_patterns).resolve()
                    allowed_dirs = [
                        self._temp_artifact_dir.resolve(),
                        (middleware_dir / "uploads").resolve(),
                        (middleware_dir / "outputs").resolve(),
                    ]
                    if any(self._is_path_within(protect_path, base) for base in allowed_dirs):
                        cmd.extend(["--protect-patterns", str(protect_path)])
                    else:
                        task.add_log(
                            "[WARN] protect_patterns path is outside allowed directories; treating as inline content"
                        )
                        cmd.extend(["--protect-patterns", _write_temp_text("protect_patterns", protect_patterns)])
                else:
                    cmd.extend(["--protect-patterns", _write_temp_text("protect_patterns", protect_patterns)])

            if request.fix_ruby:
                cmd.append("--fix-ruby")
            if request.fix_kana:
                cmd.append("--fix-kana")
            if request.fix_punctuation:
                cmd.append("--fix-punctuation")

            if request.save_cache:
                cmd.append("--save-cache")
                if request.cache_path:
                    cmd.extend(["--cache-path", str(request.cache_path)])

            # 执行翻译
            task.add_log(f"[INFO] Running translation (using persistent server on port {self.server_port})...")

            # 设置环境变量确保日志即时性
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            if request.gpu_device_id:
                env["CUDA_VISIBLE_DEVICES"] = str(request.gpu_device_id)

            # 使用进程组启动，确保 cancel 时子进程一起销毁
            if sys.platform != 'win32':
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=str(middleware_dir),
                    env=env,
                    start_new_session=True  # 创建新进程组
                )
            else:
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=str(middleware_dir),
                    env=env,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                )

            task._process = process

            # 实时读取输出
            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                line_text = line.decode('utf-8', errors='ignore').strip()
                if line_text:
                    # Skip think-stream deltas to avoid log flooding in remote mode
                    if line_text.startswith("JSON_THINK_DELTA:"):
                        continue
                    task.add_log(line_text)

                    # 解析进度
                    if "PROGRESS:" in line_text:
                        try:
                            progress_json = line_text.split("PROGRESS:")[-1]
                            progress_data = json.loads(progress_json)
                            task.current_block = progress_data.get("current", 0)
                            task.total_blocks = progress_data.get("total", 0)
                            if task.total_blocks > 0:
                                task.progress = task.current_block / task.total_blocks
                        except:
                            pass

                # 检查取消请求
                if task.cancel_requested:
                    await self._kill_process_tree(process)
                    task.status = TaskStatus.CANCELLED
                    task.add_log("[WARN] Translation cancelled by user")
                    return ""

            await process.wait()
            task._process = None

            # 读取结果
            if process.returncode == 0 and output_path.exists():
                try:
                    with open(output_path, 'r', encoding='utf-8') as f:
                        result = f.read()
                except UnicodeDecodeError:
                    # 二进制输出（如 EPUB 重建后的 ZIP），跳过文本读取
                    # downloadResult 端点通过 FileResponse(task.output_path) 直接发送
                    result = f"[Binary output: {output_path}]"
                    task.add_log("[INFO] Output is binary format, skipping text read.")

                return result
            else:
                raise RuntimeError(f"Translation failed with code {process.returncode}")
        finally:
            # 减少运行任务计数
            with self._tasks_lock:
                self._running_tasks -= 1
            for temp_path in temp_artifacts:
                try:
                    if temp_path and os.path.exists(temp_path):
                        os.unlink(temp_path)
                except OSError:
                    pass

    async def _kill_process_tree(self, process: asyncio.subprocess.Process):
        """杀死进程树（修复僵尸进程问题）"""
        pid = process.pid

        if sys.platform != 'win32':
            # Unix: 杀死整个进程组
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
                await asyncio.sleep(0.5)
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
        else:
            # Windows: 使用 taskkill /T 杀死进程树
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True,
                    timeout=5
                )
            except subprocess.TimeoutExpired:
                pass


# ============================================
# 独立运行测试
# ============================================
if __name__ == "__main__":
    import asyncio

    async def test():
        worker = TranslationWorker()

        class MockRequest:
            text = "こんにちは、世界！"
            file_path = None
            model = None
            glossary = None
            preset = "default"
            mode = "line"
            chunk_size = 1000
            ctx = 8192
            gpu_layers = -1
            temperature = 0.7
            line_format = "single"
            strict_mode = "off"
            line_check = False
            line_tolerance_abs = 10
            line_tolerance_pct = 0.2
            anchor_check = True
            anchor_check_retries = 1
            traditional = False
            save_cot = False
            save_summary = False
            alignment_mode = False
            resume = False
            save_cache = False
            cache_path = None
            rules_pre = None
            rules_post = None
            rules_pre_inline = None
            rules_post_inline = None
            rep_penalty_base = 1.0
            rep_penalty_max = 1.5
            rep_penalty_step = 0.1
            max_retries = 3
            output_hit_threshold = 60.0
            cot_coverage_threshold = 80.0
            coverage_retries = 1
            retry_temp_boost = 0.05
            retry_prompt_feedback = True
            balance_enable = True
            balance_threshold = 0.6
            balance_count = 3
            parallel = 1
            flash_attn = False
            kv_cache_type = "f16"
            use_large_batch = True
            batch_size = None
            seed = None
            text_protect = False
            protect_patterns = None
            fix_ruby = False
            fix_kana = False
            fix_punctuation = False

        task = TranslationTask(
            task_id="test001",
            request=MockRequest()
        )

        try:
            result = await worker.translate(task)
            print(f"Result: {result}")
            print(f"Logs: {task.logs}")
        finally:
            worker.stop_server()

    asyncio.run(test())

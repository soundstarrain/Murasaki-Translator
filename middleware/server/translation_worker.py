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
import requests
from pathlib import Path
from typing import Optional, Callable, List
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
    MAX_LOG_LINES: int = field(default=500, repr=False)  # 最多保留 500 条日志

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

        # 并发控制：防止配置变更时杀死正在运行的任务
        self._running_tasks = 0  # 正在运行的任务数
        self._tasks_lock = threading.Lock()  # 任务计数锁

        # 服务器配置缓存：用于检测参数变化
        self._current_config = {
            "model_path": None,
            "ctx": None,
            "gpu_layers": None,
            "flash_attn": None,
            "kv_cache_type": None
        }

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

        if sys.platform == 'linux':
            # 修复：使用 which 检测而非硬编码路径
            has_nvidia = self._check_nvidia_gpu()
            if has_nvidia:
                candidate = middleware_dir / 'bin' / 'linux-cuda' / 'llama-server'
                if not candidate.exists():
                    candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'
            else:
                candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'
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

    async def start_server(self, gpu_layers: int = -1, ctx: int = 8192,
                          flash_attn: bool = False, kv_cache_type: str = "q8_0"):
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
            "kv_cache_type": kv_cache_type
        }

        server_path = self._find_llama_server()

        cmd = [
            server_path,
            "-m", self.model_path,
            "--host", self.server_host,
            "--port", str(self.server_port),
            "-ngl", str(gpu_layers),
            "-c", str(ctx),
            "--parallel", "4",  # 支持并发请求
            "--reasoning-format", "deepseek-legacy",
            "--metrics"
        ]

        if flash_attn:
            cmd.extend(["-fa", "on"])
        if kv_cache_type:
            cmd.extend(["--cache-type-k", kv_cache_type, "--cache-type-v", kv_cache_type])

        # 使用进程组启动，确保子进程可被一起销毁
        if sys.platform != 'win32':
            self.server_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True  # 创建新进程组
            )
        else:
            # Windows: 使用 CREATE_NEW_PROCESS_GROUP
            self.server_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            )

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

    async def translate(self, task: TranslationTask) -> str:
        """
        执行翻译任务（使用常驻服务器）
        """
        request = task.request
        middleware_dir = Path(__file__).parent.parent

        # 构建新配置
        new_config = {
            "model_path": self.model_path,
            "ctx": request.ctx,
            "gpu_layers": request.gpu_layers,
            "flash_attn": request.flash_attn,
            "kv_cache_type": request.kv_cache_type
        }

        # 检查配置是否变化（修复服务器参数"锁定"问题）
        config_changed = (
            self._current_config["ctx"] != new_config["ctx"] or
            self._current_config["gpu_layers"] != new_config["gpu_layers"] or
            self._current_config["model_path"] != new_config["model_path"]
        )

        # 并发保护：有任务运行时拒绝配置变更，防止杀死正在运行的任务
        with self._tasks_lock:
            if self.is_ready() and config_changed:
                if self._running_tasks > 0:
                    # 有任务正在运行，拒绝配置变更
                    task.add_log(f"[Worker] 配置变化被拒绝：当前有 {self._running_tasks} 个任务正在运行")
                    task.add_log(f"[Worker] 使用当前配置继续 (ctx: {self._current_config['ctx']})")
                else:
                    # 没有任务运行，可以安全重启
                    task.add_log(f"[Worker] 配置变化 (ctx: {self._current_config['ctx']} -> {new_config['ctx']}), 重启服务器...")
                    await self.stop_server()

            # 增加运行任务计数
            self._running_tasks += 1

        try:
            # 确保服务器已启动
            if not self.is_ready():
                await self.start_server(
                    gpu_layers=request.gpu_layers,
                    ctx=request.ctx,
                    flash_attn=request.flash_attn,
                    kv_cache_type=request.kv_cache_type
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
                    str(requested_path).startswith(str(allowed_dir))
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

            # 构建命令行参数（关键：使用 --no-server-spawn 连接常驻服务器）
            cmd = [
                sys.executable,
                str(middleware_dir / "murasaki_translator" / "main.py"),
                "--file", input_path,
                "--output", str(output_path),
                "--preset", request.preset,
                "--mode", request.mode,
                "--chunk-size", str(request.chunk_size),
                "--ctx", str(request.ctx),
                "--gpu-layers", str(request.gpu_layers),
                "--temperature", str(request.temperature),
                # 关键修复：连接常驻服务器，不再每次启动新服务器
                "--no-server-spawn",
                "--server-host", self.server_host,
                "--server-port", str(self.server_port),
            ]

            # 可选参数
            if request.model:
                cmd.extend(["--model", request.model])
            elif self.model_path:
                cmd.extend(["--model", self.model_path])

            if request.glossary:
                cmd.extend(["--glossary", request.glossary])

            if request.line_check:
                cmd.append("--line-check")

            if request.traditional:
                cmd.append("--traditional")

            if request.save_cot:
                cmd.append("--save-cot")

            if request.rules_pre:
                cmd.extend(["--rules-pre", request.rules_pre])

            if request.rules_post:
                cmd.extend(["--rules-post", request.rules_post])

            if request.parallel > 1:
                cmd.extend(["--parallel", str(request.parallel)])

            if request.flash_attn:
                cmd.append("--flash-attn")

            if request.kv_cache_type:
                cmd.extend(["--kv-cache-type", request.kv_cache_type])

            # 执行翻译
            task.add_log(f"[INFO] Running translation (using persistent server on port {self.server_port})...")

            # 设置环境变量确保日志即时性
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"

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
                with open(output_path, 'r', encoding='utf-8') as f:
                    result = f.read()

                # 如果是文本模式，清理临时文件
                if request.text:
                    os.unlink(input_path)

                return result
            else:
                raise RuntimeError(f"Translation failed with code {process.returncode}")
        finally:
            # 减少运行任务计数
            with self._tasks_lock:
                self._running_tasks -= 1

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
            temperature = 0.3
            line_check = False
            traditional = False
            save_cot = False
            rules_pre = None
            rules_post = None
            parallel = 1
            flash_attn = False
            kv_cache_type = "q8_0"

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

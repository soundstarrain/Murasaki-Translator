#!/usr/bin/env python3
"""
Murasaki Translation API Server
提供与 GUI 100% 相同功能的远程翻译服务

用法:
  python api_server.py --model /path/to/model.gguf --port 8000
  
API 端点:
  POST /api/v1/translate      - 文本/文件翻译
  GET  /api/v1/translate/{id} - 任务状态查询
  WS   /api/v1/ws             - WebSocket 实时日志
  GET  /api/v1/models         - 模型列表
  GET  /api/v1/glossaries     - 术语表列表
  GET  /health                - 健康检查
"""

import os
import sys
import json
import uuid
import asyncio
import logging
import secrets
import threading
import subprocess
import time
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, BackgroundTasks, Depends, Security, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field

# 添加父目录到 path
sys.path.insert(0, str(Path(__file__).parent.parent))

from translation_worker import TranslationWorker, TranslationTask, TaskStatus

# ============================================
# Logging
# ============================================
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("murasaki-api")

# ============================================
# FastAPI App
# ============================================
app = FastAPI(
    title="Murasaki Translation API",
    version="1.0.0",
    description="Remote translation server with full GUI functionality"
)


def _parse_cors_origins() -> List[str]:
    """
    解析 CORS 白名单。
    - 未设置 MURASAKI_CORS_ORIGINS 时默认 "*"（本地部署友好）
    - 可通过逗号分隔指定来源进行收敛
    """
    origins_raw = os.environ.get("MURASAKI_CORS_ORIGINS", "").strip()
    if not origins_raw:
        return ["*"]
    origins = [origin.strip() for origin in origins_raw.split(",") if origin.strip()]
    return origins or ["*"]


CORS_ALLOWED_ORIGINS = _parse_cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=CORS_ALLOWED_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# API Key Authentication
# ============================================
api_key_header = APIKeyHeader(name="Authorization", auto_error=False)


def _normalize_api_key(api_key: Optional[str]) -> str:
    if not api_key:
        return ""
    return api_key.replace("Bearer ", "").strip()


def _is_api_key_valid(api_key: Optional[str]) -> bool:
    server_key = os.environ.get("MURASAKI_API_KEY")
    if not server_key:
        return True
    normalized = _normalize_api_key(api_key)
    if not normalized:
        return False
    return secrets.compare_digest(normalized, server_key)


def _is_ws_auth_required() -> bool:
    return os.environ.get("MURASAKI_WS_AUTH_REQUIRED", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _is_path_within(path: Path, base: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def _parse_env_int(name: str, default: int, minimum: Optional[int] = None) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("Invalid env %s=%r, fallback to %s", name, raw, default)
        return default
    if minimum is not None and value < minimum:
        logger.warning(
            "Invalid env %s=%r (expected >= %s), fallback to %s",
            name,
            raw,
            minimum,
            default,
        )
        return default
    return value


def _parse_env_optional_int(
    name: str,
    default: Optional[int] = None,
    minimum: Optional[int] = None,
) -> Optional[int]:
    raw = os.environ.get(name)
    if raw is None:
        return default
    normalized = str(raw).strip()
    if not normalized:
        return default
    try:
        value = int(normalized)
    except (TypeError, ValueError):
        logger.warning("Invalid env %s=%r, fallback to %s", name, raw, default)
        return default
    if minimum is not None and value < minimum:
        logger.warning(
            "Invalid env %s=%r (expected >= %s), fallback to %s",
            name,
            raw,
            minimum,
            default,
        )
        return default
    return value


def _parse_env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    normalized = str(raw).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    logger.warning("Invalid env %s=%r, fallback to %s", name, raw, default)
    return default


def _parse_env_str(name: str, default: str) -> str:
    raw = os.environ.get(name)
    if raw is None:
        return default
    normalized = str(raw).strip()
    return normalized if normalized else default


def _mask_secret(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return "(not-set)"
    if len(normalized) <= 8:
        return "********"
    return f"{normalized[:4]}...{normalized[-4:]}"


async def verify_api_key(api_key: str = Security(api_key_header)):
    """
    验证 API Key
    如果服务器未设置 API Key (MURASAKI_API_KEY)，则开放访问
    如果设置了 API Key，则必须在 Header 中提供正确的 Bearer Token
    """
    server_key = os.environ.get("MURASAKI_API_KEY")
    
    # 如果没设密码则开放访问
    if not server_key:
        return None
    
    # 验证 API Key
    if not api_key:
        raise HTTPException(
            status_code=403,
            detail="Missing API Key. Please provide 'Authorization: Bearer <your-key>' header."
        )
    
    if not _is_api_key_valid(api_key):
        raise HTTPException(
            status_code=403,
            detail="Invalid API Key"
        )
    
    return _normalize_api_key(api_key)

# ============================================
# Global State
# ============================================
worker: Optional[TranslationWorker] = None
tasks: Dict[str, TranslationTask] = {}
websocket_connections: List[WebSocket] = []

# HuggingFace download tasks (remote server side)
hf_download_tasks: Dict[str, Dict[str, Any]] = {}
hf_download_lock = threading.Lock()

# 任务清理配置（防止内存泄漏）
MAX_COMPLETED_TASKS = 100  # 最多保留 100 个已完成任务
TASK_RETENTION_HOURS = 24  # 保留 24 小时

# 线程安全锁（防止并发修改字典）
_tasks_lock = threading.Lock()
TERMINAL_TASK_STATUSES = {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED}


def _set_task(task: TranslationTask) -> None:
    with _tasks_lock:
        tasks[task.task_id] = task


def _get_task(task_id: str) -> Optional[TranslationTask]:
    with _tasks_lock:
        return tasks.get(task_id)


def _count_running_tasks() -> int:
    with _tasks_lock:
        return len([t for t in tasks.values() if t.status == TaskStatus.RUNNING])


def _try_transition_task_status(task: TranslationTask, next_status: TaskStatus) -> bool:
    """
    统一状态迁移入口：
    - 终态不可回退（completed/failed/cancelled）
    - 相同状态幂等
    """
    current_status = task.status
    if current_status == next_status:
        return True
    if current_status in TERMINAL_TASK_STATUSES:
        logger.warning(
            f"Ignored task status transition for {task.task_id}: "
            f"{current_status.value} -> {next_status.value}"
        )
        return False
    task.status = next_status
    return True

def cleanup_old_tasks():
    """清理旧任务，防止内存泄漏和磁盘泄漏"""
    global tasks
    now = datetime.now()
    
    # 使用锁防止并发修改
    with _tasks_lock:
        # 使用 list() 拷贝迭代，防止 RuntimeError: dictionary changed size
        to_remove = []
        completed_count = 0
        
        for task_id, task in list(tasks.items()):
            age_hours = (now - task.created_at).total_seconds() / 3600
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                completed_count += 1
                if age_hours > TASK_RETENTION_HOURS:
                    to_remove.append((task_id, task))
        
        # 如果已完成任务超过限制，清理最旧的
        if completed_count > MAX_COMPLETED_TASKS:
            completed_tasks = [
                (tid, t) for tid, t in list(tasks.items()) 
                if t.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]
            ]
            completed_tasks.sort(key=lambda x: x[1].created_at)
            for tid, t in completed_tasks[:completed_count - MAX_COMPLETED_TASKS]:
                if not any(item[0] == tid for item in to_remove):
                    to_remove.append((tid, t))
        
        # 执行清理：删除内存和物理文件
        middleware_dir = Path(__file__).parent.parent
        for task_id, task in to_remove:
            # 删除关联的物理文件（防止磁盘泄漏）
            try:
                # 删除输出文件
                if task.output_path:
                    output_file = Path(task.output_path)
                    if output_file.exists():
                        output_file.unlink()
                        logger.debug(f"Deleted output file: {output_file}")
                
                # 删除上传文件（如果使用了 file_path）
                if hasattr(task.request, 'file_path') and task.request.file_path:
                    uploads_dir = middleware_dir / "uploads"
                    input_file = Path(task.request.file_path)
                    # 只删除 uploads 目录下的文件
                    if _is_path_within(input_file, uploads_dir):
                        if input_file.exists():
                            input_file.unlink()
                            logger.debug(f"Deleted upload file: {input_file}")
            except Exception as e:
                logger.warning(f"Failed to delete files for task {task_id}: {e}")
            
            # 删除内存中的任务
            del tasks[task_id]
        
        if to_remove:
            logger.info(f"Cleaned up {len(to_remove)} old tasks (memory + disk)")

# ============================================
# HuggingFace Download Helpers
# ============================================

def _hf_script_path() -> Path:
    return Path(__file__).parent.parent / "hf_downloader.py"


def _run_hf_command(args: List[str], timeout: int = 120) -> Dict[str, Any]:
    """Run hf_downloader.py and return parsed JSON output."""
    script_path = _hf_script_path()
    if not script_path.exists():
        raise RuntimeError("hf_downloader.py not found")

    proc = subprocess.run(
        [sys.executable, str(script_path), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    output = "\n".join([proc.stdout or "", proc.stderr or ""]).strip()
    payload = None
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception:
            continue

    if not payload:
        raise RuntimeError(output or "hf_downloader returned empty output")

    if payload.get("type") == "error":
        raise RuntimeError(payload.get("message", "hf_downloader error"))

    return payload


def _update_hf_task(task_id: str, **updates: Any) -> None:
    with hf_download_lock:
        task = hf_download_tasks.get(task_id)
        if not task:
            return
        task.update(updates)
        task["updated_at"] = time.time()


def _start_hf_download_task(repo_id: str, file_name: str, mirror: str) -> str:
    script_path = _hf_script_path()
    if not script_path.exists():
        raise RuntimeError("hf_downloader.py not found")

    task_id = str(uuid.uuid4())[:8]
    models_dir = Path(__file__).parent.parent / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    proc = subprocess.Popen(
        [sys.executable, str(script_path), "download", repo_id, file_name, str(models_dir), mirror],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    with hf_download_lock:
        hf_download_tasks[task_id] = {
            "id": task_id,
            "status": "starting",
            "percent": 0.0,
            "speed": "",
            "downloaded": "",
            "total": "",
            "file_path": "",
            "error": "",
            "created_at": time.time(),
            "updated_at": time.time(),
            "process": proc,
        }

    def _reader():
        buffer = ""
        try:
            if proc.stdout is None:
                return
            for chunk in proc.stdout:
                buffer += chunk
                lines = buffer.splitlines()
                buffer = "" if buffer.endswith("\n") else lines.pop() if lines else buffer
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except Exception:
                        continue
                    if msg.get("type") == "progress":
                        _update_hf_task(
                            task_id,
                            status=msg.get("status", "downloading"),
                            percent=float(msg.get("percent", 0)),
                            speed=msg.get("speed", ""),
                            downloaded=msg.get("downloaded", ""),
                            total=msg.get("total", ""),
                        )
                    elif msg.get("type") == "complete":
                        _update_hf_task(
                            task_id,
                            status="complete",
                            percent=100.0,
                            file_path=msg.get("file_path", ""),
                        )
                    elif msg.get("type") == "error":
                        _update_hf_task(
                            task_id,
                            status="error",
                            error=msg.get("message", "Download failed"),
                        )
        finally:
            try:
                code = proc.wait(timeout=1)
            except Exception:
                code = None
            with hf_download_lock:
                task = hf_download_tasks.get(task_id)
                if task and task.get("status") not in {"complete", "error", "cancelled"}:
                    task["status"] = "error"
                    task["error"] = task.get("error") or f"Download exited (code={code})"

    threading.Thread(target=_reader, daemon=True).start()
    return task_id

# ============================================
# Request/Response Models
# ============================================

class TranslateRequest(BaseModel):
    """翻译请求"""
    text: Optional[str] = None          # 直接文本翻译
    file_path: Optional[str] = None     # 服务器上的文件路径
    
    # 翻译配置 (与 GUI 参数完全一致)
    model: Optional[str] = None         # 模型路径，None 使用默认
    glossary: Optional[str] = None      # 术语表路径
    preset: str = "novel"               # prompt preset
    mode: str = "doc"                   # doc | line
    chunk_size: int = 1000
    ctx: int = Field(
        default_factory=lambda: _parse_env_int(
            "MURASAKI_DEFAULT_CTX",
            8192,
            minimum=256,
        )
    )
    gpu_layers: int = Field(
        default_factory=lambda: _parse_env_int("MURASAKI_DEFAULT_GPU_LAYERS", -1)
    )
    temperature: float = 0.3
    
    # 高级选项
    line_format: str = "single"
    strict_mode: str = "off"
    line_check: bool = True
    line_tolerance_abs: int = 10
    line_tolerance_pct: float = 0.2
    traditional: bool = False
    save_cot: bool = False
    save_summary: bool = False
    alignment_mode: bool = False
    resume: bool = False
    save_cache: bool = True
    cache_path: Optional[str] = None
    rules_pre: Optional[str] = None
    rules_post: Optional[str] = None
    rules_pre_inline: Optional[Any] = None
    rules_post_inline: Optional[Any] = None
    rep_penalty_base: float = 1.0
    rep_penalty_max: float = 1.5
    rep_penalty_step: float = 0.1
    max_retries: int = 3
    output_hit_threshold: float = 60.0
    cot_coverage_threshold: float = 80.0
    coverage_retries: int = 3
    retry_temp_boost: float = 0.05
    retry_prompt_feedback: bool = True
    balance_enable: bool = False
    balance_threshold: float = 0.6
    balance_count: int = 3
    
    # 并行配置
    parallel: int = Field(
        default_factory=lambda: _parse_env_int(
            "MURASAKI_DEFAULT_CONCURRENCY",
            1,
            minimum=1,
        )
    )
    flash_attn: bool = Field(
        default_factory=lambda: _parse_env_bool("MURASAKI_DEFAULT_FLASH_ATTN", False)
    )
    kv_cache_type: str = Field(
        default_factory=lambda: _parse_env_str("MURASAKI_DEFAULT_KV_CACHE_TYPE", "f16")
    )
    use_large_batch: bool = Field(
        default_factory=lambda: _parse_env_bool("MURASAKI_DEFAULT_USE_LARGE_BATCH", False)
    )
    batch_size: Optional[int] = Field(
        default_factory=lambda: _parse_env_optional_int(
            "MURASAKI_DEFAULT_BATCH",
            None,
            minimum=1,
        )
    )
    seed: Optional[int] = Field(
        default_factory=lambda: _parse_env_optional_int("MURASAKI_DEFAULT_SEED", None)
    )
    text_protect: bool = False
    protect_patterns: Optional[str] = None
    fix_ruby: bool = False
    fix_kana: bool = False
    fix_punctuation: bool = False
    gpu_device_id: Optional[str] = None


class TranslateResponse(BaseModel):
    """翻译响应"""
    task_id: str
    status: str

class HfDownloadRequest(BaseModel):
    repo_id: str
    file_name: str
    mirror: str = "direct"


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str
    status: str
    progress: float
    current_block: int
    total_blocks: int
    logs: List[str]
    next_log_index: int = 0
    log_total: int = 0
    logs_truncated: bool = False
    result: Optional[str] = None
    error: Optional[str] = None


class ModelInfo(BaseModel):
    """模型信息"""
    name: str
    path: str
    size_gb: float


class ServerStatus(BaseModel):
    """服务器状态"""
    status: str
    model_loaded: bool
    current_model: Optional[str]
    active_tasks: int
    uptime_seconds: float


# ============================================
# API Endpoints  
# ============================================

@app.get("/health")
async def health():
    """健康检查"""
    capabilities = ["api_v1", "api_v1_full_parity"]
    if os.environ.get("MURASAKI_ENABLE_OPENAI_PROXY", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        capabilities.append("openai_v1")
    return {
        "status": "ok",
        "version": "1.0.0",
        "capabilities": capabilities,
        "auth_required": bool(os.environ.get("MURASAKI_API_KEY")),
    }


@app.get(
    "/api/v1/status",
    response_model=ServerStatus,
    dependencies=[Depends(verify_api_key)],
)
async def get_status():
    """获取服务器状态"""
    global worker
    return ServerStatus(
        status="running",
        model_loaded=worker is not None and worker.is_ready(),
        current_model=worker.model_path if worker else None,
        active_tasks=_count_running_tasks(),
        uptime_seconds=worker.uptime() if worker else 0
    )


@app.get(
    "/api/v1/models",
    response_model=List[ModelInfo],
    dependencies=[Depends(verify_api_key)],
)
async def list_models():
    """列出服务器上可用的模型"""
    models_dir = Path(__file__).parent.parent / "models"
    models = []
    
    if models_dir.exists():
        for f in models_dir.glob("*.gguf"):
            size_gb = f.stat().st_size / (1024**3)
            models.append(ModelInfo(
                name=f.stem,
                path=str(f),
                size_gb=round(size_gb, 2)
            ))
    
    return models


@app.get("/api/v1/models/hf/network", dependencies=[Depends(verify_api_key)])
async def hf_check_network():
    """检查 HuggingFace 网络连通性"""
    try:
        payload = _run_hf_command(["network"], timeout=30)
        return {
            "status": payload.get("status", "error"),
            "message": payload.get("message", "")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/models/hf/repos", dependencies=[Depends(verify_api_key)])
async def hf_list_repos(org: str):
    """列出指定组织的仓库"""
    if not org:
        raise HTTPException(status_code=400, detail="Missing org parameter")
    try:
        payload = _run_hf_command(["repos", org], timeout=60)
        return payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/models/hf/files", dependencies=[Depends(verify_api_key)])
async def hf_list_files(repo_id: str):
    """列出仓库中的 GGUF 文件"""
    if not repo_id:
        raise HTTPException(status_code=400, detail="Missing repo_id parameter")
    try:
        payload = _run_hf_command(["list", repo_id], timeout=60)
        return payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/models/hf/download", dependencies=[Depends(verify_api_key)])
async def hf_download(request: HfDownloadRequest):
    """触发远程服务器下载模型"""
    try:
        download_id = _start_hf_download_task(request.repo_id, request.file_name, request.mirror)
        return {"download_id": download_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/models/hf/download/{download_id}", dependencies=[Depends(verify_api_key)])
async def hf_download_status(download_id: str):
    """查询下载状态"""
    with hf_download_lock:
        task = hf_download_tasks.get(download_id)
        if not task:
            raise HTTPException(status_code=404, detail="Download task not found")
        return {
            "status": task.get("status", "unknown"),
            "percent": task.get("percent", 0),
            "speed": task.get("speed", ""),
            "downloaded": task.get("downloaded", ""),
            "total": task.get("total", ""),
            "file_path": task.get("file_path", ""),
            "error": task.get("error", ""),
        }


@app.delete("/api/v1/models/hf/download/{download_id}", dependencies=[Depends(verify_api_key)])
async def hf_download_cancel(download_id: str):
    """取消下载任务"""
    with hf_download_lock:
        task = hf_download_tasks.get(download_id)
        if not task:
            raise HTTPException(status_code=404, detail="Download task not found")
        proc = task.get("process")
        task["status"] = "cancelled"
    try:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except Exception:
                proc.kill()
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/v1/glossaries", dependencies=[Depends(verify_api_key)])
async def list_glossaries():
    """列出服务器上可用的术语表"""
    glossaries_dir = Path(__file__).parent.parent / "glossaries"
    glossaries = []
    
    if glossaries_dir.exists():
        for f in glossaries_dir.glob("*.json"):
            glossaries.append({
                "name": f.stem,
                "path": str(f)
            })
    
    return glossaries


@app.post("/api/v1/translate", response_model=TranslateResponse, dependencies=[Depends(verify_api_key)])
async def create_translation(request: TranslateRequest, background_tasks: BackgroundTasks):
    """创建翻译任务"""
    global worker, tasks
    
    # 清理旧任务，防止内存泄漏
    cleanup_old_tasks()
    
    if not request.text and not request.file_path:
        raise HTTPException(400, "Must provide either 'text' or 'file_path'")

    if request.file_path:
        middleware_dir = Path(__file__).parent.parent
        requested_path = Path(request.file_path).resolve()
        allowed_dirs = [
            (middleware_dir / "uploads").resolve(),
            (middleware_dir / "outputs").resolve(),
        ]
        if not any(_is_path_within(requested_path, allowed_dir) for allowed_dir in allowed_dirs):
            raise HTTPException(
                status_code=400,
                detail=(
                    "file_path must be inside server uploads/ or outputs/ directory "
                    f"(got: {request.file_path})"
                ),
            )
    
    # 创建任务
    task_id = str(uuid.uuid4())[:8]
    task = TranslationTask(
        task_id=task_id,
        request=request,
        status=TaskStatus.PENDING,
        created_at=datetime.now()
    )
    _set_task(task)
    
    # 后台执行翻译
    background_tasks.add_task(execute_translation, task)
    
    return TranslateResponse(
        task_id=task_id,
        status="pending",
        message="Translation task created"
    )


@app.get("/api/v1/translate/{task_id}", response_model=TaskStatusResponse, dependencies=[Depends(verify_api_key)])
async def get_task_status(
    task_id: str,
    log_from: Optional[int] = Query(default=None, ge=0),
    log_limit: int = Query(default=200, ge=1, le=1000),
):
    """获取任务状态"""
    task = _get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")

    # 直接对 task.logs 取长度和切片，避免 list() 全量拷贝
    # Python GIL 保证 len() 和 slice 操作的原子性
    log_total = len(task.logs)
    logs_truncated = False

    if log_from is None:
        # 兼容旧客户端：默认返回最近 50 条
        start_index = max(0, log_total - 50)
        logs = task.logs[start_index:]
        logs_truncated = start_index > 0
        next_log_index = start_index + len(logs)
    else:
        start_index = min(log_from, log_total)
        end_index = min(log_total, start_index + log_limit)
        logs = task.logs[start_index:end_index]
        next_log_index = start_index + len(logs)

    return TaskStatusResponse(
        task_id=task_id,
        status=task.status.value,
        progress=task.progress,
        current_block=task.current_block,
        total_blocks=task.total_blocks,
        logs=logs,
        next_log_index=next_log_index,
        log_total=log_total,
        logs_truncated=logs_truncated,
        result=task.result,
        error=task.error
    )


@app.delete("/api/v1/translate/{task_id}", dependencies=[Depends(verify_api_key)])
async def cancel_task(task_id: str):
    """取消任务"""
    task = _get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task.status in [TaskStatus.PENDING, TaskStatus.RUNNING]:
        task.cancel_requested = True
        if task.status == TaskStatus.PENDING:
            _try_transition_task_status(task, TaskStatus.CANCELLED)
            task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Cancelled before start")
            return {"message": "Task cancelled before start"}
        return {"message": "Cancel requested"}
    else:
        return {"message": f"Task is {task.status.value}, cannot cancel"}


@app.post("/api/v1/upload/file", dependencies=[Depends(verify_api_key)])
async def upload_file(file: UploadFile = File(...)):
    """上传文件到服务器"""
    upload_dir = Path(__file__).parent.parent / "uploads"
    upload_dir.mkdir(exist_ok=True)
    
    file_id = str(uuid.uuid4())[:8]
    file_ext = Path(file.filename).suffix
    save_path = upload_dir / f"{file_id}{file_ext}"
    
    total_size = 0
    CHUNK_SIZE = 1024 * 1024  # 1MB chunks
    with open(save_path, "wb") as f:
        while True:
            chunk = await file.read(CHUNK_SIZE)
            if not chunk:
                break
            f.write(chunk)
            total_size += len(chunk)
    
    return {
        "file_id": file_id,
        "file_path": str(save_path),
        "original_name": file.filename,
        "size": total_size
    }


@app.get("/api/v1/download/{task_id}/cache", dependencies=[Depends(verify_api_key)])
async def download_cache(task_id: str):
    """下载翻译缓存文件（用于校对）"""
    task = _get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    
    if not task.output_path:
        raise HTTPException(404, "No output path available")
    
    cache_path = task.output_path + ".cache.json"
    if not os.path.exists(cache_path):
        raise HTTPException(404, "Cache file not found")
    
    return FileResponse(cache_path, filename=os.path.basename(cache_path))

@app.get("/api/v1/download/{task_id}", dependencies=[Depends(verify_api_key)])
async def download_result(task_id: str):
    """下载翻译结果"""
    task = _get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task.status != TaskStatus.COMPLETED:
        raise HTTPException(400, f"Task is {task.status.value}, not completed")
    
    if task.output_path and Path(task.output_path).exists():
        output_file = Path(task.output_path).resolve()
        outputs_dir = (Path(__file__).parent.parent / "outputs").resolve()
        if not _is_path_within(output_file, outputs_dir):
            raise HTTPException(400, "Unsafe output path")
        return FileResponse(str(output_file), filename=output_file.name)
    else:
        raise HTTPException(404, "Output file not found")


# ============================================
# WebSocket for Real-time Logs
# ============================================

@app.websocket("/api/v1/ws/{task_id}")
async def websocket_logs(websocket: WebSocket, task_id: str):
    """WebSocket 实时日志推送"""
    if _is_ws_auth_required() and os.environ.get("MURASAKI_API_KEY"):
        token = websocket.query_params.get("token")
        auth_header = websocket.headers.get("Authorization")
        if not _is_api_key_valid(auth_header or token):
            await websocket.close(code=1008)
            return

    await websocket.accept()
    websocket_connections.append(websocket)
    
    try:
        task = _get_task(task_id)
        if task is None:
            await websocket.send_json({"error": f"Task {task_id} not found"})
            return
        last_log_index = 0
        
        while True:
            # 发送新日志
            if len(task.logs) > last_log_index:
                new_logs = task.logs[last_log_index:]
                for log in new_logs:
                    await websocket.send_json({
                        "type": "log",
                        "message": log
                    })
                last_log_index = len(task.logs)
            
            # 发送进度
            await websocket.send_json({
                "type": "progress",
                "progress": task.progress,
                "current_block": task.current_block,
                "total_blocks": task.total_blocks,
                "status": task.status.value
            })
            
            # 任务完成则退出
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                await websocket.send_json({
                    "type": "complete",
                    "status": task.status.value,
                    "result": task.result,
                    "error": task.error
                })
                break
            
            await asyncio.sleep(0.5)
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for task {task_id}")
    finally:
        if websocket in websocket_connections:
            websocket_connections.remove(websocket)


# ============================================
# Translation Execution
# ============================================

async def execute_translation(task: TranslationTask):
    """执行翻译任务"""
    global worker
    
    try:
        # 若任务在排队期间已被取消，直接结束
        if task.cancel_requested or task.status == TaskStatus.CANCELLED:
            _try_transition_task_status(task, TaskStatus.CANCELLED)
            task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Translation skipped (cancelled).")
            return

        if not _try_transition_task_status(task, TaskStatus.RUNNING):
            return
        task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Starting translation...")
        
        # 确保 worker 已初始化
        if worker is None:
            worker = TranslationWorker()
        
        # 执行翻译
        result = await worker.translate(task)

        # 任务在 worker 内可能已被标记为取消，避免被 completed 覆盖
        if task.status == TaskStatus.CANCELLED:
            task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Translation cancelled.")
            return

        task.result = result
        if _try_transition_task_status(task, TaskStatus.COMPLETED):
            task.progress = 1.0
            task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Translation completed!")
        
    except Exception as e:
        if task.status == TaskStatus.CANCELLED:
            task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Translation cancelled.")
            return
        if _try_transition_task_status(task, TaskStatus.FAILED):
            task.error = str(e)
            task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] ERROR: {e}")
            logger.exception(f"Translation failed for task {task.task_id}")


# ============================================
# CLI Entry Point
# ============================================

def main():
    import argparse
    import uvicorn
    
    parser = argparse.ArgumentParser(description="Murasaki Translation API Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    parser.add_argument("--model", help="Default model path")
    parser.add_argument("--api-key", help="API key for authentication (optional)")
    parser.add_argument("--ctx", type=int, help="Default context size")
    parser.add_argument("--gpu-layers", type=int, help="Default GPU layers")
    parser.add_argument("--batch-size", type=int, help="Default physical batch size")
    parser.add_argument("--parallel", type=int, help="Default concurrency")
    parser.add_argument("--flash-attn", action="store_true", help="Enable default flash attention")
    parser.add_argument("--kv-cache-type", help="Default KV cache type")
    parser.add_argument("--use-large-batch", action="store_true", help="Enable default large batch")
    parser.add_argument("--seed", type=int, help="Default seed")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    
    args = parser.parse_args()
    
    # 设置默认模型
    if args.model:
        os.environ["MURASAKI_DEFAULT_MODEL"] = args.model
    if args.ctx is not None:
        os.environ["MURASAKI_DEFAULT_CTX"] = str(args.ctx)
    if args.gpu_layers is not None:
        os.environ["MURASAKI_DEFAULT_GPU_LAYERS"] = str(args.gpu_layers)
    if args.batch_size is not None:
        os.environ["MURASAKI_DEFAULT_BATCH"] = str(args.batch_size)
    if args.parallel is not None:
        os.environ["MURASAKI_DEFAULT_CONCURRENCY"] = str(args.parallel)
    if args.flash_attn:
        os.environ["MURASAKI_DEFAULT_FLASH_ATTN"] = "1"
    if args.kv_cache_type:
        os.environ["MURASAKI_DEFAULT_KV_CACHE_TYPE"] = str(args.kv_cache_type)
    if args.use_large_batch:
        os.environ["MURASAKI_DEFAULT_USE_LARGE_BATCH"] = "1"
    if args.seed is not None:
        os.environ["MURASAKI_DEFAULT_SEED"] = str(args.seed)
    
    env_api_key = os.environ.get("MURASAKI_API_KEY", "").strip()
    if args.api_key:
        os.environ["MURASAKI_API_KEY"] = args.api_key
        api_key_display = args.api_key
    elif env_api_key:
        os.environ["MURASAKI_API_KEY"] = env_api_key
        api_key_display = env_api_key
    else:
        # 安全默认值：无 Key 时自动生成随机 key，禁止无鉴权运行
        generated_key = secrets.token_urlsafe(24)
        os.environ["MURASAKI_API_KEY"] = generated_key
        api_key_display = generated_key
    
    print(
        "\n"
        "==============================================================\n"
        "Murasaki Translation API Server\n"
        "--------------------------------------------------------------\n"
        f"API:    http://{args.host}:{args.port}/api/v1/translate\n"
        f"Docs:   http://{args.host}:{args.port}/docs\n"
        f"Health: http://{args.host}:{args.port}/health\n"
        "--------------------------------------------------------------\n"
        f"API Key: {_mask_secret(api_key_display)}\n"
        "Use header: Authorization: Bearer <key>\n"
        "==============================================================\n"
    )
    
    uvicorn.run(
        "api_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload
    )


if __name__ == "__main__":
    main()

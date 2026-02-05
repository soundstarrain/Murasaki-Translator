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
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, BackgroundTasks, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# API Key Authentication
# ============================================
api_key_header = APIKeyHeader(name="Authorization", auto_error=False)

async def verify_api_key(api_key: str = Security(api_key_header)):
    """
    验证 API Key
    如果服务器未设置 API Key (MURASAKI_API_KEY)，则开放访问
    如果设置了 API Key，则必须在 Header 中提供正确的 Bearer Token
    """
    import secrets
    
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
    
    # 支持 "Bearer <key>" 或直接 "<key>" 格式
    provided_key = api_key.replace("Bearer ", "").strip()
    
    # 使用 secrets.compare_digest 防止计时攻击
    if not secrets.compare_digest(provided_key, server_key):
        raise HTTPException(
            status_code=403,
            detail="Invalid API Key"
        )
    
    return provided_key

# ============================================
# Global State
# ============================================
worker: Optional[TranslationWorker] = None
tasks: Dict[str, TranslationTask] = {}
websocket_connections: List[WebSocket] = []

# 任务清理配置（防止内存泄漏）
MAX_COMPLETED_TASKS = 100  # 最多保留 100 个已完成任务
TASK_RETENTION_HOURS = 24  # 保留 24 小时

# 线程安全锁（防止并发修改字典）
import threading
_tasks_lock = threading.Lock()

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
                    if str(input_file).startswith(str(uploads_dir)):
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
# Request/Response Models
# ============================================

class TranslateRequest(BaseModel):
    """翻译请求"""
    text: Optional[str] = None          # 直接文本翻译
    file_path: Optional[str] = None     # 服务器上的文件路径
    
    # 翻译配置 (与 GUI 参数完全一致)
    model: Optional[str] = None         # 模型路径，None 使用默认
    glossary: Optional[str] = None      # 术语表路径
    preset: str = "default"             # prompt preset
    mode: str = "doc"                   # doc | line
    chunk_size: int = 1000
    ctx: int = 8192
    gpu_layers: int = -1
    temperature: float = 0.3
    
    # 高级选项
    line_check: bool = True
    traditional: bool = False
    save_cot: bool = False
    rules_pre: Optional[str] = None
    rules_post: Optional[str] = None
    
    # 并行配置
    parallel: int = 1
    flash_attn: bool = False
    kv_cache_type: str = "q8_0"


class TranslateResponse(BaseModel):
    """翻译响应"""
    task_id: str
    status: str
    message: str


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str
    status: str
    progress: float
    current_block: int
    total_blocks: int
    logs: List[str]
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
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/v1/status", response_model=ServerStatus)
async def get_status():
    """获取服务器状态"""
    global worker
    return ServerStatus(
        status="running",
        model_loaded=worker is not None and worker.is_ready(),
        current_model=worker.model_path if worker else None,
        active_tasks=len([t for t in tasks.values() if t.status == TaskStatus.RUNNING]),
        uptime_seconds=worker.uptime() if worker else 0
    )


@app.get("/api/v1/models", response_model=List[ModelInfo])
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


@app.get("/api/v1/glossaries")
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
    
    # 创建任务
    task_id = str(uuid.uuid4())[:8]
    task = TranslationTask(
        task_id=task_id,
        request=request,
        status=TaskStatus.PENDING,
        created_at=datetime.now()
    )
    tasks[task_id] = task
    
    # 后台执行翻译
    background_tasks.add_task(execute_translation, task)
    
    return TranslateResponse(
        task_id=task_id,
        status="pending",
        message="Translation task created"
    )


@app.get("/api/v1/translate/{task_id}", response_model=TaskStatusResponse, dependencies=[Depends(verify_api_key)])
async def get_task_status(task_id: str):
    """获取任务状态"""
    if task_id not in tasks:
        raise HTTPException(404, f"Task {task_id} not found")
    
    task = tasks[task_id]
    return TaskStatusResponse(
        task_id=task_id,
        status=task.status.value,
        progress=task.progress,
        current_block=task.current_block,
        total_blocks=task.total_blocks,
        logs=task.logs[-50:],  # 最近 50 条日志
        result=task.result,
        error=task.error
    )


@app.delete("/api/v1/translate/{task_id}", dependencies=[Depends(verify_api_key)])
async def cancel_task(task_id: str):
    """取消任务"""
    if task_id not in tasks:
        raise HTTPException(404, f"Task {task_id} not found")
    
    task = tasks[task_id]
    if task.status == TaskStatus.RUNNING:
        task.cancel_requested = True
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
    
    with open(save_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    return {
        "file_id": file_id,
        "file_path": str(save_path),
        "original_name": file.filename,
        "size": len(content)
    }


@app.get("/api/v1/download/{task_id}", dependencies=[Depends(verify_api_key)])
async def download_result(task_id: str):
    """下载翻译结果"""
    if task_id not in tasks:
        raise HTTPException(404, f"Task {task_id} not found")
    
    task = tasks[task_id]
    if task.status != TaskStatus.COMPLETED:
        raise HTTPException(400, f"Task is {task.status.value}, not completed")
    
    if task.output_path and Path(task.output_path).exists():
        return FileResponse(task.output_path, filename=Path(task.output_path).name)
    else:
        raise HTTPException(404, "Output file not found")


# ============================================
# WebSocket for Real-time Logs
# ============================================

@app.websocket("/api/v1/ws/{task_id}")
async def websocket_logs(websocket: WebSocket, task_id: str):
    """WebSocket 实时日志推送"""
    await websocket.accept()
    websocket_connections.append(websocket)
    
    try:
        if task_id not in tasks:
            await websocket.send_json({"error": f"Task {task_id} not found"})
            return
        
        task = tasks[task_id]
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
        task.status = TaskStatus.RUNNING
        task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Starting translation...")
        
        # 确保 worker 已初始化
        if worker is None:
            worker = TranslationWorker()
        
        # 执行翻译
        result = await worker.translate(task)
        
        task.result = result
        task.status = TaskStatus.COMPLETED
        task.progress = 1.0
        task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Translation completed!")
        
    except Exception as e:
        task.status = TaskStatus.FAILED
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
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    
    args = parser.parse_args()
    
    # 设置默认模型
    if args.model:
        os.environ["MURASAKI_DEFAULT_MODEL"] = args.model
    
    if args.api_key:
        os.environ["MURASAKI_API_KEY"] = args.api_key
        api_key_display = args.api_key
    else:
        # 安全默认值：无 Key 时自动生成 UUID，禁止无鉴权运行
        import secrets
        generated_key = secrets.token_urlsafe(24)
        os.environ["MURASAKI_API_KEY"] = generated_key
        api_key_display = generated_key
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║           Murasaki Translation API Server                    ║
╠══════════════════════════════════════════════════════════════╣
║  API:     http://{args.host}:{args.port}/api/v1/translate           ║
║  Docs:    http://{args.host}:{args.port}/docs                       ║
║  Health:  http://{args.host}:{args.port}/health                     ║
╠══════════════════════════════════════════════════════════════╣
║  🔐 API Key: {api_key_display:<47}║
║  (Use: Authorization: Bearer <key>)                          ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    uvicorn.run(
        "api_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload
    )


if __name__ == "__main__":
    main()

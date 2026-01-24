# OpenAI 格式代理服务器
# 将 llama-server API 封装为 OpenAI Chat Completions API
# 支持 Linux 部署
#
# 使用方法:
#   pip install fastapi uvicorn httpx
#   LLAMA_SERVER_URL=http://127.0.0.1:8080 uvicorn server:app --host 0.0.0.0 --port 8000

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import httpx
import json
import time
import os
import uuid

app = FastAPI(title="Murasaki OpenAI Proxy", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LLAMA_SERVER_URL = os.environ.get("LLAMA_SERVER_URL", "http://127.0.0.1:8080")


class Message(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = "local"
    messages: List[Message]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 2048
    stream: Optional[bool] = False


def build_prompt(messages: List[Message]) -> str:
    """将 OpenAI 消息格式转换为 prompt"""
    parts = []
    for msg in messages:
        if msg.role == "system":
            parts.append(f"System: {msg.content}\n")
        elif msg.role == "user":
            parts.append(f"User: {msg.content}\n")
        elif msg.role == "assistant":
            parts.append(f"Assistant: {msg.content}\n")
    parts.append("Assistant:")
    return "".join(parts)


@app.get("/v1/models")
async def list_models():
    """列出可用模型"""
    return {
        "object": "list",
        "data": [{"id": "local", "object": "model", "created": int(time.time()), "owned_by": "murasaki"}]
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    """OpenAI Chat Completions API"""
    prompt = build_prompt(request.messages)
    
    llama_request = {
        "prompt": prompt,
        "n_predict": request.max_tokens or 2048,
        "temperature": request.temperature or 0.7,
        "stop": ["User:", "\nUser:"],
        "stream": request.stream
    }
    
    if request.stream:
        return StreamingResponse(
            stream_response(llama_request),
            media_type="text/event-stream"
        )
    
    # Non-streaming
    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            resp = await client.post(f"{LLAMA_SERVER_URL}/completion", json=llama_request)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    content = data.get("content", "")
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": request.model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": content},
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": data.get("tokens_evaluated", 0),
            "completion_tokens": data.get("tokens_predicted", 0),
            "total_tokens": data.get("tokens_evaluated", 0) + data.get("tokens_predicted", 0)
        }
    }


async def stream_response(llama_request: dict):
    """流式响应生成器"""
    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("POST", f"{LLAMA_SERVER_URL}/completion", json=llama_request) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        content = data.get("content", "")
                        if content:
                            chunk = {
                                "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
                                "object": "chat.completion.chunk",
                                "created": int(time.time()),
                                "model": "local",
                                "choices": [{
                                    "index": 0,
                                    "delta": {"content": content},
                                    "finish_reason": None
                                }]
                            }
                            yield f"data: {json.dumps(chunk)}\n\n"
                    except:
                        pass
    yield "data: [DONE]\n\n"


@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

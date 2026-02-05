# Murasaki Translation API Server

远程翻译 API 服务器，提供与 GUI 100% 相同的翻译功能。

## 快速开始

```bash
# 1. 安装依赖
cd middleware
pip3 install -r requirements.txt
pip3 install -r server/requirements.txt

# 2. 启动服务器
./server/start_server.sh --model /path/to/model.gguf --port 8000

# 或直接运行
python3 server/api_server.py --model /path/to/model.gguf
```

## API 端点

### 翻译
- `POST /api/v1/translate` - 创建翻译任务
- `GET /api/v1/translate/{task_id}` - 查询任务状态
- `DELETE /api/v1/translate/{task_id}` - 取消任务

### 文件管理
- `POST /api/v1/upload/file` - 上传文件
- `GET /api/v1/download/{task_id}` - 下载翻译结果

### WebSocket
- `WS /api/v1/ws/{task_id}` - 实时日志推送

### 其他
- `GET /api/v1/models` - 模型列表
- `GET /api/v1/glossaries` - 术语表列表
- `GET /health` - 健康检查
- `GET /docs` - Swagger API 文档

## 翻译请求示例

```bash
# 创建翻译任务
curl -X POST http://localhost:8000/api/v1/translate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "こんにちは、世界！",
    "preset": "default",
    "mode": "line",
    "temperature": 0.3
  }'

# 响应
# {"task_id": "abc12345", "status": "pending", "message": "Translation task created"}

# 查询状态
curl http://localhost:8000/api/v1/translate/abc12345
```

## Docker 部署

```bash
docker build -t murasaki-server -f server/Dockerfile .
docker run -p 8000:8000 -v /path/to/models:/app/models murasaki-server
```

## 与 Windows GUI 配合使用

1. 在 Linux 服务器上启动 API 服务器
2. 在 Windows GUI 设置中选择"远程服务器"模式
3. 输入服务器地址（如 `http://your-server:8000`）
4. 点击"测试连接"确认
5. 正常使用翻译功能，任务将在服务器上执行

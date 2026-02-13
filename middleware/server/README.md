# Murasaki Translation API Server

远程部署服务端（Linux/Windows/macOS 均可运行 Python）：
- GUI 全功能远程链路使用 `/api/v1/*`
- OpenAI 兼容链路使用 `/v1/*`（由 `openai_proxy` 提供）

## 推荐 Linux 一键后台部署

```bash
MODEL='/path/to/model.gguf'; API_KEY='replace-with-strong-key'; curl -fsSL https://github.com/soundstarrain/Murasaki-Translator/releases/latest/download/murasaki-server-linux-x64.tar.gz | tar -xz && cd murasaki-server && nohup ./start.sh --host 0.0.0.0 --port 8000 --model "$MODEL" --api-key "$API_KEY" --enable-openai-proxy --openai-port 8001 > server.log 2>&1 &
```

## 鉴权规则

- `GET /health`：公开（用于探活）
- `/api/v1/*`：当设置 `MURASAKI_API_KEY` 时必须携带 `Authorization: Bearer <key>`
- `/v1/*`：当设置 `MURASAKI_API_KEY` 时必须携带 `Authorization: Bearer <key>`

## GUI 远程全功能接口

- `POST /api/v1/translate` 创建任务
- `GET /api/v1/translate/{task_id}` 查询进度/结果
- `DELETE /api/v1/translate/{task_id}` 取消任务
- `POST /api/v1/upload/file` 上传文件
- `GET /api/v1/download/{task_id}` 下载结果（支持 txt/srt/ass/ssa/epub 等）
- `WS /api/v1/ws/{task_id}` 实时日志

路径域约束（安全策略）：
- `file_path` 仅允许指向服务端 `uploads/` 或 `outputs/` 目录。
- 下载接口仅允许返回 `outputs/` 域内的任务产物。

## 本地开发启动

```bash
cd middleware
bash server/start_server.sh --model /path/to/model.gguf --host 0.0.0.0 --port 8000 --api-key dev-key
```

可选启用 OpenAI 兼容层：

```bash
cd middleware
bash server/start_server.sh --model /path/to/model.gguf --host 0.0.0.0 --port 8000 --api-key dev-key --enable-openai-proxy --openai-port 8001
```

## 快速自检

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H "Authorization: Bearer dev-key" http://127.0.0.1:8000/api/v1/status
curl -fsS -H "Authorization: Bearer dev-key" http://127.0.0.1:8001/v1/models
```

## Windows GUI 连接 Linux Server（一页指南）

1. 在 Linux 服务器执行“一键后台部署”命令（上文）。
2. Windows 下载并打开 GUI。
3. 在 GUI 的远程连接面板填写：
   - `Server URL`：`http://<server-ip>:8000`
   - `API Key`：部署时的 `API_KEY`
4. 连接成功后即可使用与本地一致的远程翻译链路（上传 / 任务 / 取消 / 下载 / 实时日志）。

### 连通性核验（服务器本机）

```bash
API_KEY='replace-with-strong-key'
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8000/api/v1/status
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8000/api/v1/models
```

`/health` 的 `capabilities` 里应至少包含：
- `api_v1`
- `api_v1_full_parity`

### 常见问题

- **401/403 鉴权失败**：检查 GUI 内 API Key 是否与部署时一致。
- **连接超时**：检查安全组/防火墙是否放行 `8000`（以及可选 `8001`）。
- **WS 实时日志不可用**：反向代理需放行 WebSocket Upgrade 头。

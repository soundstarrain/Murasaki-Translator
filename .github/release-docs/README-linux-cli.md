# Murasaki Translator - Linux Server Package

> Linux remote server package for GUI full-feature remote mode (`/api/v1/*`)  
> and OpenAI-compatible mode (`/v1/*`).

## Requirements

- Linux x64 (Ubuntu 20.04+ / Debian 11+ recommended)
- Python 3.10+
- GPU driver:
  - NVIDIA (recommended): modern driver
  - AMD/Intel: Vulkan driver

## One-Line Production Deploy (Recommended)

```bash
MODEL='/path/to/model.gguf'; API_KEY='replace-with-strong-key'; curl -fsSL https://github.com/soundstarrain/Murasaki-Translator/releases/latest/download/murasaki-server-linux-x64.tar.gz | tar -xz && cd murasaki-server && nohup ./start.sh --host 0.0.0.0 --port 8000 --model "$MODEL" --api-key "$API_KEY" --enable-openai-proxy --openai-port 8001 > server.log 2>&1 &
```

After startup:
- GUI remote URL: `http://<server-ip>:8000`
- GUI API Key: the same `API_KEY`
- OpenAI base URL: `http://<server-ip>:8001/v1`

## Auth Behavior

- `GET /health`: public (for health probes)
- `/api/v1/*`: requires `Authorization: Bearer <API_KEY>` when API key is configured
- `/v1/*`: requires `Authorization: Bearer <API_KEY>` when API key is configured

## GUI Full-Feature Remote Endpoints

- `POST /api/v1/translate`
- `GET /api/v1/translate/{task_id}`
- `DELETE /api/v1/translate/{task_id}`
- `POST /api/v1/upload/file`
- `GET /api/v1/download/{task_id}`
- `WS /api/v1/ws/{task_id}`

## Quick Verification

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8000/api/v1/status
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8001/v1/models
```

`/health` should include capabilities:
- `api_v1`
- `api_v1_full_parity`

## Windows GUI Connection (One Page)

In Windows GUI remote panel:
- `Server URL`: `http://<server-ip>:8000`
- `API Key`: same value as `API_KEY`

Then click connect and run translation normally. The remote flow supports upload / task status / cancel / download / realtime logs.

### Common Issues

- **401/403**: API key mismatch, check `Authorization: Bearer <API_KEY>`.
- **Connection timeout**: firewall/security group did not open port `8000`.
- **Realtime log not updating**: reverse proxy is missing WebSocket upgrade headers.

## Security Notes

- Use a strong API key in public networks.
- Restrict incoming ports (`8000`, `8001`) by firewall/security group.
- Use HTTPS via reverse proxy when exposing service publicly.

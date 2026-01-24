# OpenAI 格式代理服务器

将 llama-server 的私有 API 封装为标准 OpenAI Chat Completions API。

## 安装

```bash
cd middleware/openai_proxy
pip install -r requirements.txt
```

## 运行

```bash
# 设置 llama-server 地址
export LLAMA_SERVER_URL=http://127.0.0.1:8080

# 启动代理服务器
uvicorn server:app --host 0.0.0.0 --port 8000
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/models` | GET | 列出可用模型 |
| `/v1/chat/completions` | POST | Chat Completions API |
| `/health` | GET | 健康检查 |

## Linux 部署

```bash
# 复制服务文件
sudo cp openai_proxy.service /etc/systemd/system/

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable openai_proxy
sudo systemctl start openai_proxy

# 查看日志
sudo journalctl -u openai_proxy -f
```

## 使用示例

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local",
    "messages": [{"role": "user", "content": "Hello!"}],
    "temperature": 0.7
  }'
```

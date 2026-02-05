# Murasaki Translator - Linux CLI Server

> OpenAI 兼容的翻译 API 服务器，用于远程/无头部署

## 系统要求

- **操作系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- **Python**: 3.10+
- **显卡**: 
  - NVIDIA (推荐): 驱动 ≥ 550
  - AMD/Intel: Vulkan 驱动

## 安装

```bash
# 1. 解压
tar -xzf murasaki-server-linux.tar.gz
cd murasaki-server

# 2. 安装依赖
pip3 install -r requirements.txt
pip3 install fastapi uvicorn httpx python-multipart

# 3. 下载模型
# 前往 https://huggingface.co/Murasaki-Project 下载 GGUF 模型
```

## 启动服务器

```bash
# 基本启动
python3 murasaki_server.py --model /path/to/model.gguf --port 8080

# 指定 GPU 和上下文
python3 murasaki_server.py \
  --model /path/to/model.gguf \
  --gpu-layers -1 \
  --ctx 8192 \
  --port 8080

# 后台运行
nohup python3 murasaki_server.py --model /path/to/model.gguf &
```

## 🔐 API Key 认证

> **安全提示**：服务器启动时会自动生成 API Key 并打印到控制台。如未指定，将自动生成随机 Key。

```bash
# 使用自定义 API Key
python3 murasaki_server.py --model /path/to/model.gguf --api-key your-secret-key

# 启动时会显示：
# ╠══════════════════════════════════════════════════════════════╣
# ║  🔐 API Key: your-secret-key                                 ║
# ╚══════════════════════════════════════════════════════════════╝
```

⚠️ **警告**：如在公网部署，请务必：
1. 使用强 API Key
2. 配置防火墙限制端口访问
3. 使用 HTTPS（反向代理）

## API 使用

服务器提供 OpenAI 兼容的 `/v1/chat/completions` 接口：

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "murasaki",
    "messages": [{"role": "user", "content": "翻译: こんにちは"}]
  }'
```

## 与 GUI 配合使用

Windows/macOS GUI 可以连接远程 Linux 服务器：

1. 在 Linux 服务器启动 CLI Server
2. 在 GUI 高级设置中输入服务器地址 `http://server-ip:8080`
3. 输入 API Key（从服务器控制台复制）
4. 点击连接

## 链接

- **项目主页**: https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**: https://huggingface.co/Murasaki-Project
- **问题反馈**: https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见 murasaki-translator.LICENSE.txt。
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator

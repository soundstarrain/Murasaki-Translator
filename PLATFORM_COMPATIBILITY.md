# 平台兼容性与部署指南

本文档说明桌面版与服务器版的兼容平台、下载形态与部署方式，并提供 Linux Server 的完整部署与连接流程。

## 1. 下载包一览

| 文件名模式 | 平台 | GPU | 形态 | 一键运行 |
| --- | --- | --- | --- | --- |
| `*-win-cuda-x64.zip` | Windows x64 | NVIDIA | GUI 桌面版 | ✅ |
| `*-win-vulkan-x64.zip` | Windows x64 | AMD / Intel / NVIDIA | GUI 桌面版 | ✅ |
| `*-arm64.dmg` | macOS Apple Silicon | Apple GPU (Metal) | GUI 桌面版 | ✅ |
| `*.dmg`（无 arm64 后缀） | macOS Intel | CPU | GUI 桌面版 | ✅ |
| `*.AppImage` | Linux Desktop x64 | Vulkan | GUI 桌面版 | ✅ |
| `murasaki-server-*.tar.gz` | Linux Server x64 | CUDA / Vulkan | 远程 API 服务 | ✅ |

说明：GUI 桌面版为完整图形界面；Server 包提供 `/api/v1/*` 远程接口供 GUI 连接。

## 2. GUI 桌面版

### 2.1 Windows

| 显卡类型 | 下载包 | 后端 | 备注 |
| --- | --- | --- | --- |
| NVIDIA | `*-win-cuda-x64.zip` | CUDA | 需要 NVIDIA 驱动支持 CUDA |
| AMD / Intel | `*-win-vulkan-x64.zip` | Vulkan | 无需 CUDA |

运行步骤：
1. 下载匹配显卡的压缩包。
2. 解压后运行 `Murasaki Translator.exe`。
3. 首次启动会自动检测 GPU 并选择对应后端。

### 2.2 macOS

| 机型 | 下载包 | 后端 | 备注 |
| --- | --- | --- | --- |
| Apple Silicon | `*-arm64.dmg` | Metal | 推荐 |
| Intel | `*.dmg` | CPU | 速度较慢 |

运行步骤：
1. 下载对应架构的 `.dmg`。
2. 拖入 Applications。
3. 首次运行请右键应用 → “打开” 以通过 Gatekeeper。

### 2.3 Linux Desktop（AppImage）

```bash
chmod +x Murasaki-Translator-*.AppImage
./Murasaki-Translator-*.AppImage
```

说明：AppImage 默认使用 Vulkan 后端，适配 NVIDIA / AMD / Intel。若发布包内包含 `linux-cuda` 且检测到 NVIDIA GPU，会优先使用 CUDA。CUDA 版 `llama-server` 需要手动准备时，请参考第 4 节放置到 `middleware/bin/linux-cuda`。如提示缺少 FUSE 运行库，请安装系统对应的 FUSE 包（例如 `libfuse2`）。

## 3. Linux Server（远程 API）

远程服务提供 GUI 全功能链路（`/api/v1/*`）与可选 OpenAI 兼容链路（`/v1/*`）。适用于 GPU 服务器、云平台、多设备协作或局域网共享。

### 3.1 版本说明

| 部署方式 | 适用场景 | 说明 |
| --- | --- | --- |
| Release 包 | 生产 / 快速部署 | 下载 `murasaki-server-*.tar.gz` 即可启动 |
| 源码运行 | 开发 / 自定义 | 直接使用仓库代码与 Python 环境 |

### 3.2 主流云 GPU 平台通用部署（AutoDL / RunPod / AWS / GCP / Azure 等）

适用于主流云 GPU 平台与自建机房环境。整体流程如下：

1. 创建 GPU 实例（Ubuntu 20.04/22.04 推荐），确认驱动可用：`nvidia-smi`。
2. 准备持久化磁盘（模型较大，建议放在独立数据盘或持久卷）。
3. 选择访问方式：
   - 平台端口映射：将容器/实例的 `8000`（可选 `8001`）映射到公网端口或平台域名。
   - 公网直连：安全组放行端口，并用 `--host 0.0.0.0` 监听。
   - 反向代理：绑定域名 + TLS，转发 WebSocket（`/api/v1/ws`）。

### 3.3 推理框架与后端选择（Linux Server）

- 服务端由 FastAPI 驱动的 API Server 提供接口，内部通过 `translation_worker` 常驻管理 `llama-server`（llama.cpp）。
- 后端选择逻辑：
  - 检测到 NVIDIA GPU 且存在 `middleware/bin/linux-cuda/llama-server` → 使用 CUDA。
  - 否则使用 `middleware/bin/linux-vulkan/llama-server`。
- Linux CUDA 版 `llama-server` 需要手动准备（从 llama.cpp Release 获取对应 CUDA 版本），未提供时会自动回退 Vulkan。
- OpenAI 兼容接口为可选代理层，需显式开启。

### 3.4 下载模型（示例）

```bash
MODEL_DIR="$HOME/murasaki-models"
mkdir -p "$MODEL_DIR"

MODEL_PAGE_URL="https://huggingface.co/Murasaki-Project/Murasaki-14B-v0.2-GGUF/blob/main/Murasaki-14B-v0.2-IQ4_XS.gguf"
MODEL_URL="${MODEL_PAGE_URL}?download=1"
MODEL_PATH="$MODEL_DIR/Murasaki-14B-v0.2-IQ4_XS.gguf"

curl -L "$MODEL_URL" -o "$MODEL_PATH"
```

### 3.5 一键部署（Release 包）

```bash
API_KEY='replace-with-strong-key'
curl -fsSL https://github.com/soundstarrain/Murasaki-Translator/releases/latest/download/murasaki-server-linux-x64.tar.gz | tar -xz
cd murasaki-server
nohup ./start.sh --host 127.0.0.1 --port 8000 --model "$MODEL_PATH" --api-key "$API_KEY" > server.log 2>&1 &
```

`start.sh` 会自动创建虚拟环境并安装依赖。

### 3.6 从源码部署（跨平台）

Linux / macOS:
```bash
python3 -m venv middleware/.venv
source middleware/.venv/bin/activate
pip install -r middleware/requirements.txt
pip install -r middleware/server/requirements.txt
bash middleware/server/start_server.sh --host 127.0.0.1 --port 8000 --model /path/to/model.gguf --api-key your-key
```

Windows PowerShell:
```bash
python -m venv middleware/.venv
middleware/.venv/Scripts/activate
pip install -r middleware/requirements.txt
pip install -r middleware/server/requirements.txt
python middleware/server/api_server.py --host 127.0.0.1 --port 8000 --model C:\path\to\model.gguf --api-key your-key
```

提示：服务端启动时若未提供 `--api-key`，会自动生成随机 Key 并输出到日志中。

### 3.7 可选：启用 OpenAI 兼容接口

Release 包示例：
```bash
./start.sh --host 127.0.0.1 --port 8000 --model "$MODEL_PATH" --api-key "$API_KEY" --enable-openai-proxy --openai-port 8001
```

源码模式（Linux / macOS）示例：
```bash
bash middleware/server/start_server.sh --host 127.0.0.1 --port 8000 --model /path/to/model.gguf --api-key your-key --enable-openai-proxy --openai-port 8001
```

OpenAI 兼容接口地址：`http://<host>:8001/v1/*`。鉴权与 `/api/v1/*` 共用同一 API Key。

### 3.8 推荐的安全访问方式

建议默认使用本机回环地址并通过 SSH 隧道访问，避免直接暴露公网端口：

```bash
ssh -N -L 8000:127.0.0.1:8000 user@your-server
```

如需局域网或公网访问，请将 `--host` 设为 `0.0.0.0` 并在防火墙中仅放行必要端口，同时务必设置强度足够的 API Key。

### 3.9 公网直连（不走 SSH 隧道）

适用于需要公网直连的场景。请确保安全组/防火墙只放行必要端口，并设置强度足够的 API Key。

```bash
API_KEY='replace-with-strong-key'
./start.sh --host 0.0.0.0 --port 8000 --model "$MODEL_PATH" --api-key "$API_KEY"
```

访问方式示例：

- `Server URL`：`http://<your-public-ip>:8000`
- `API Key`：`API_KEY`

注意：如需同时启用 OpenAI 兼容接口，还需放行 `--openai-port` 对应端口。

### 3.10 反向代理 / TLS（示例）

适用于需要 HTTPS、域名或统一入口的场景。反向代理需要转发 WebSocket（`/api/v1/ws`）并保留升级头。

Nginx 示例：
```nginx
server {
  listen 443 ssl;
  server_name your.domain.com;

  ssl_certificate     /etc/ssl/certs/your.crt;
  ssl_certificate_key /etc/ssl/private/your.key;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Caddy 示例：
```caddy
your.domain.com {
  reverse_proxy 127.0.0.1:8000 {
    header_up Connection "upgrade"
    header_up Upgrade {http.request.header.Upgrade}
  }
}
```

### 3.11 端口放行 / 网关映射（示例）

如果使用公网直连或反向代理，请确保端口已放行或完成网关映射。以下为常见示例（按发行版自行选择）：

UFW（Ubuntu 系）：
```bash
sudo ufw allow 8000/tcp
sudo ufw allow 8001/tcp
```

firewalld（CentOS / Rocky / AlmaLinux）：
```bash
sudo firewall-cmd --permanent --add-port=8000/tcp
sudo firewall-cmd --permanent --add-port=8001/tcp
sudo firewall-cmd --reload
```

云厂商场景还需在安全组放行对应端口。

### 3.12 GUI 连接方式

在 GUI 的远程连接面板填写：

- `Server URL`：`http://127.0.0.1:8000`（或服务器实际地址）
- `API Key`：部署时设置的 Key

### 3.13 连通性自检

```bash
API_KEY='replace-with-strong-key'
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8000/api/v1/status
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8000/api/v1/models
```

### 3.14 服务端文件域限制

为安全起见，`/api/v1/translate` 仅允许访问服务端 `uploads/` 或 `outputs/` 目录中的文件，下载接口也只会返回 `outputs/` 目录下的产物。

### 3.15 需要替换的字段

- `MODEL_PAGE_URL` / `MODEL_URL`：换成你要下载的模型地址
- `MODEL_PATH`：模型实际保存路径
- `API_KEY`：换成强度足够的密钥
- `user@your-server`：你的 SSH 用户名与服务器地址
- `--port`：端口冲突时请更换
- `--host`：需要局域网/公网访问时可改为 `0.0.0.0`

## 4. llama-server 选择与目录结构

系统会根据平台与 GPU 自动选择 `llama-server` 二进制。Linux 在检测到 NVIDIA 但缺失 CUDA 二进制时会回退到 Vulkan；Windows 需提供与硬件匹配的 CUDA / Vulkan 版本。可将二进制放入下列目录：

| 平台 | 目录 | 二进制 |
| --- | --- | --- |
| Windows NVIDIA | `middleware/bin/win-cuda` | `llama-server.exe` |
| Windows AMD / Intel | `middleware/bin/win-vulkan` | `llama-server.exe` |
| macOS Apple Silicon | `middleware/bin/darwin-metal` | `llama-server` |
| macOS Intel | `middleware/bin/darwin-x64` | `llama-server` |
| Linux NVIDIA | `middleware/bin/linux-cuda` | `llama-server` |
| Linux AMD / Intel | `middleware/bin/linux-vulkan` | `llama-server` |

兼容旧结构：如果你使用的是 `llama-*/` 旧目录，程序仍可自动识别。Linux / macOS 需要确保二进制具备可执行权限（`chmod +x`）。

## 5. 常见问题

| 问题 | 解决方案 |
| --- | --- |
| 401 / 403 鉴权失败 | 确认 GUI 内 API Key 与服务端一致，并使用 `Authorization: Bearer <key>` |
| 端口占用导致启动失败 | 修改 `--port`，或释放占用的 8000/8001 端口 |
| Linux AppImage 无法启动 | 安装 FUSE 运行库（例如 `libfuse2`） |
| 提示找不到 `llama-server` | 检查 `middleware/bin/<platform>` 目录与文件权限 |
| WebSocket 实时日志不可用 | 反向代理需放行 WebSocket Upgrade 头 |

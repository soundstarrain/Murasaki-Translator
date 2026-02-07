# 平台兼容性与安装指南

本文档详细说明 Murasaki Translator 在不同平台上的下载与运行步骤。

---

## � 下载包一览

| 文件名 | 平台 | GPU | 说明 |
|--------|------|-----|------|
| `*-win-cuda-x64.zip` | Windows | NVIDIA | ✅ 一键运行，解压即用 |
| `*-win-vulkan-x64.zip` | Windows | AMD / Intel | ✅ 一键运行，解压即用 |
| `*-arm64.dmg` | macOS | Apple Silicon (M1/M2/M3/M4) | ✅ 一键运行，Metal 加速 |
| `*.dmg` (无 arm64 后缀) | macOS | Intel | ✅ 一键运行，CPU 模式 |
| `*.AppImage` | Linux | 所有 GPU (Vulkan) | ✅ 一键运行，桌面用户 |
| `murasaki-server-*.tar.gz` | Linux | 所有 GPU | ⚠️ CLI 服务器，需安装依赖 |

---

## 🪟 Windows

> [!IMPORTANT]
> **NVIDIA 用户驱动要求**：驱动版本 ≥ 551.61（支持 CUDA 12.4+）。无需安装 CUDA Toolkit。

### 下载与运行

1. **NVIDIA 显卡**：下载 `Murasaki-Translator-*-win-cuda-x64.zip`
2. **AMD / Intel 显卡**：下载 `Murasaki-Translator-*-win-vulkan-x64.zip`
3. 解压后运行 `Murasaki Translator.exe`

程序会自动检测 GPU 并加载对应后端。

---

## 🍎 macOS

### 下载与运行

1. **Apple Silicon (M1/M2/M3/M4)**：下载 `Murasaki.Translator-*-arm64.dmg`
2. **Intel Mac**：下载 `Murasaki.Translator-*.dmg`（无 arm64 后缀）
3. 打开 `.dmg`，将应用拖入 Applications 文件夹
4. 首次运行：右键点击应用 → "打开"（绕过 Gatekeeper）

> Apple Silicon 使用 Metal 加速，性能显著优于 Intel Mac 的 CPU 模式。

---

## 🐧 Linux

### 桌面用户（AppImage）

下载 `Murasaki-Translator-*.AppImage`，添加执行权限后运行：

```bash
chmod +x Murasaki-Translator-*.AppImage
./Murasaki-Translator-*.AppImage
```

> AppImage 内置 Vulkan 后端，支持 NVIDIA / AMD / Intel 显卡。

---

### 服务器用户（CLI Server）

CLI 服务器提供 OpenAI 兼容 API，适合服务器运行转发给其他终端批量处理。

#### 部署步骤

```bash
# 1. 下载并解压
tar -xzf murasaki-server-linux-x64.tar.gz
cd murasaki-server

# 2. 安装 Python 依赖
pip3 install -r requirements.txt
pip3 install fastapi uvicorn httpx

# 3. 启动服务
./start.sh --model /path/to/model.gguf --port 8000
```

#### GPU 后端说明

| 你的硬件 | 自动使用后端 | 备注 |
|----------|--------------|------|
| 无 GPU / CPU 服务器 | `linux-cpu` | 开箱即用 |
| AMD / Intel GPU | `linux-vulkan` | 开箱即用 |
| NVIDIA GPU | `linux-vulkan` | 默认回退，性能接近 CUDA |
| NVIDIA GPU + CUDA | `linux-cuda` | 需自行编译，见下方 |

---

### 🏎️ NVIDIA CUDA 加速（可选）

> llama.cpp 官方不提供 Linux CUDA 预编译包。Vulkan 在 NVIDIA 上性能已接近 CUDA，大多数用户无需编译。

如确需 CUDA 加速：

```bash
# 前置条件：已安装 CUDA Toolkit 12.x (验证: nvcc --version)

git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j$(nproc)

# 复制到 Murasaki 目录
mkdir -p /path/to/murasaki-server/bin/linux-cuda
cp build/bin/llama-server /path/to/murasaki-server/bin/linux-cuda/
chmod +x /path/to/murasaki-server/bin/linux-cuda/llama-server
```

编译完成后，程序会自动优先使用 `linux-cuda` 后端。

---

## 🔧 常见问题

| 问题 | 解决方案 |
|------|----------|
| macOS 提示"无法验证开发者" | 右键应用 → "打开" |
| Linux AppImage 无法启动 | 安装 FUSE：`sudo apt install libfuse2` |
| CLI 找不到 llama-server | 检查 `bin/linux-vulkan/llama-server` 是否存在且有执行权限 |

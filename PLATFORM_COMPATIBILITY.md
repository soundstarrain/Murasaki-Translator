# 平台兼容性与安装指南

本文档详细说明 Murasaki Translator 在不同平台上的下载、安装和运行步骤。

---

## 📊 平台支持一览表

| 平台 | GPU 类型 | 后端 | 下载包 | 一键运行 |
|------|----------|------|--------|----------|
| **Windows** | NVIDIA | CUDA | `.exe` 安装包 | ✅ |
| **Windows** | AMD/Intel | Vulkan | `.exe` 安装包 | ✅ |
| **macOS** | Apple Silicon (M1/M2/M3/M4) | Metal | `.dmg` 安装包 | ✅ |
| **macOS** | Intel | CPU | `.dmg` 安装包 | ✅ |
| **Linux Desktop** | 所有 GPU | Vulkan | `.AppImage` | ✅ |
| **Linux Server** | AMD/Intel/无 GPU | Vulkan/CPU | CLI 包 | ⚠️ 需安装依赖 |
| **Linux Server** | NVIDIA (CUDA) | CUDA | CLI 包 + 自编译 | ❌ 需手动操作 |

---

## 🪟 Windows

> [!IMPORTANT]
> **⚠️ 关于 NVIDIA 显卡驱动版本的关键说明**
> 若使用 NVIDIA 显卡加速，驱动必须支持 **CUDA 12.4** 或更高版本。
> - **无需安装 CUDA Toolkit**：普通用户**不需要**下载安装庞大的 CUDA 开发包。
> - **必须更新驱动**：请确保驱动版本 **≥ 551.61**（即 2024 年初及之后的版本）。
> - **典型故障**：若驱动版本过旧，系统将自动回退至 CPU 模式或无法加载引擎。


### 一键安装（推荐）

1. 从 [Releases](https://github.com/yourrepo/releases) 下载 `Murasaki-Translator-x.x.x-win-x64-Setup.exe`
2. 双击运行安装程序
3. 启动应用，自动检测 GPU 并选择最佳后端：
   - **NVIDIA GPU** → 使用 CUDA 后端（最快）
   - **AMD/Intel GPU** → 使用 Vulkan 后端

### 便携版

下载 `Murasaki-Translator-x.x.x-win-x64-portable.zip`，解压后运行 `Murasaki Translator.exe`。

---

## 🍎 macOS

### 一键安装

1. 从 [Releases](https://github.com/yourrepo/releases) 下载：
   - **Apple Silicon (M1/M2/M3/M4)**：`Murasaki-Translator-x.x.x-mac-arm64.dmg`
   - **Intel Mac**：`Murasaki-Translator-x.x.x-mac-x64.dmg`
2. 打开 `.dmg` 文件，将应用拖入 Applications 文件夹
3. 首次运行需右键点击 → "打开"（绕过 Gatekeeper）

> **性能提示**：Apple Silicon 使用 Metal 加速，性能优于 Intel Mac 的 CPU 模式。

---

## 🐧 Linux

### 桌面用户（AppImage）✅ 一键运行

1. 下载 `Murasaki-Translator-x.x.x-linux-x86_64.AppImage`
2. 添加执行权限并运行：

```bash
chmod +x Murasaki-Translator-*.AppImage
./Murasaki-Translator-*.AppImage
```

> **注意**：AppImage 内置 Vulkan 后端，支持所有主流 GPU（NVIDIA/AMD/Intel）。

---

### 服务器用户（CLI Server）

CLI 服务器提供 OpenAI 兼容的 API，适合无头服务器或批量处理。

#### 下载与安装

1. 下载 `murasaki-cli-linux-x64.tar.gz`
2. 解压：

```bash
tar -xzf murasaki-cli-linux-x64.tar.gz
cd murasaki-server
```

3. 安装 Python 依赖：

```bash
pip3 install -r requirements.txt
pip3 install fastapi uvicorn httpx
```

4. 启动服务：

```bash
./start.sh --model /path/to/model.gguf --port 8000
```

#### GPU 后端选择

| 你的 GPU | 默认行为 | 额外步骤 |
|----------|----------|----------|
| **无 GPU / 仅 CPU** | 使用 `linux-cpu` 后端 | 无 |
| **AMD GPU** | 使用 `linux-vulkan` 后端 | 无 |
| **Intel GPU** | 使用 `linux-vulkan` 后端 | 无 |
| **NVIDIA GPU** | 尝试 `linux-cuda` → 回退 `linux-vulkan` | 见下方 CUDA 安装指南 |

---

### 🏎️ NVIDIA CUDA 加速（可选，高级用户）

> **为什么需要手动操作？**  
> llama.cpp 官方不提供 Linux CUDA 预编译包。如需 CUDA 加速，需自行编译。

#### 方法一：使用预编译 Vulkan（推荐大多数用户）

Vulkan 后端在 NVIDIA GPU 上也能工作，性能接近 CUDA，无需额外操作。

#### 方法二：自行编译 CUDA 版本

```bash
# 前置条件：CUDA Toolkit 12.x 已安装
# 验证：nvcc --version

# 1. 克隆 llama.cpp
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp

# 2. 编译 CUDA 版本
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j$(nproc)

# 3. 复制到 Murasaki 目录
mkdir -p /path/to/murasaki-server/bin/linux-cuda
cp build/bin/llama-server /path/to/murasaki-server/bin/linux-cuda/
chmod +x /path/to/murasaki-server/bin/linux-cuda/llama-server
```

编译完成后，程序会自动检测并优先使用 `linux-cuda` 后端。

---

## 🔧 常见问题

### Q: Windows 提示"无法识别的发布者"？
A: 这是因为安装包未签名。点击"更多信息" → "仍要运行"即可。

### Q: macOS 提示"无法打开，因为无法验证开发者"？
A: 右键点击应用 → "打开" → 在弹出对话框中点击"打开"。

### Q: Linux AppImage 无法启动？
A: 确保已安装 FUSE：
```bash
# Ubuntu/Debian
sudo apt install libfuse2

# Fedora
sudo dnf install fuse
```

### Q: Linux CLI 提示找不到 llama-server？
A: 确保在正确目录下运行，或检查 `bin/linux-vulkan/llama-server` 是否存在且有执行权限。

---

## 📝 版本说明

- **v1.5.0+**：完整跨平台支持
- **v1.4.x及以下**：仅支持 Windows

# Murasaki Translator 开发指南

本文档面向从源码构建和调试的开发者，覆盖 GUI 与 middleware 的本地开发流程。

## 1. 环境准备

- Windows / macOS / Linux
- Git
- Python 3.10+
- Node.js LTS（建议 18+）
- 可选：GPU 驱动（NVIDIA / AMD / Intel）与对应运行时
- 可选：CMake / 编译工具链（仅当需要自行编译 llama.cpp 时）

## 2. 克隆项目

```bash
git clone https://github.com/soundstarrain/Murasaki-Translator.git
cd Murasaki-Translator
```

## 3. 配置 Python（middleware）

创建虚拟环境（推荐放在 `middleware/.venv`）：

Windows PowerShell:
```bash
python -m venv middleware/.venv
middleware/.venv/Scripts/activate
```

macOS / Linux:
```bash
python3 -m venv middleware/.venv
source middleware/.venv/bin/activate
```

安装基础依赖（本地翻译必需）：
```bash
pip install -r middleware/requirements.txt
```

如果需要本机常驻 API 或远程模式（`/api/v1`）：
```bash
pip install -r middleware/server/requirements.txt
```

如果要启用 OpenAI 兼容代理（`/v1`）：
```bash
pip install -r middleware/openai_proxy/requirements.txt
```

提示：开发模式下 GUI 会优先使用 `middleware/.venv`。如需指定 Python，可设置环境变量 `ELECTRON_PYTHON_PATH` 指向目标解释器。

## 4. 准备 llama-server 二进制

项目不包含 `llama-server`，请从 llama.cpp Release 下载或自行编译，并把 `llama-server` 及其依赖库放到 `middleware/bin` 的对应目录。

| 平台 | 目录 | 二进制 |
| --- | --- | --- |
| Windows NVIDIA | `middleware/bin/win-cuda` | `llama-server.exe` + 相关 DLL |
| Windows AMD / Intel | `middleware/bin/win-vulkan` | `llama-server.exe` + 相关 DLL |
| macOS Apple Silicon | `middleware/bin/darwin-metal` | `llama-server` |
| macOS Intel | `middleware/bin/darwin-x64` | `llama-server` |
| Linux NVIDIA | `middleware/bin/linux-cuda` | `llama-server` |
| Linux AMD / Intel | `middleware/bin/linux-vulkan` | `llama-server` |

说明：旧的 `llama-*` 目录结构仍可被自动识别，但推荐使用 `middleware/bin/<platform>`。macOS / Linux 需要确保二进制可执行权限（`chmod +x`）。

## 5. 准备模型

将 `.gguf` 模型放到 `middleware/models`，或在 GUI 中选择自定义路径。若使用默认配置，后端会尝试 `middleware/models/ACGN-8B-Step150-Q4_K_M.gguf`。

## 6. 前端依赖

```bash
cd GUI
npm install
```

## 7. 启动开发

```bash
cd GUI
npm run dev
```

## 8. 构建打包

本机构建（不生成安装包）：
```bash
cd GUI
npm run build
```

Windows 安装包：
```bash
cd GUI
npm run build:win
```

需要内置 Python（Windows 分发常用）时，请自行创建 `python_env` 并安装与 `middleware/requirements.txt`、`middleware/server/requirements.txt` 对应依赖；打包时会把 `python_env` 复制到应用资源目录。

## 9. 调试指南

可在本地创建 `.vscode/launch.json` 调试配置，用于 Electron 主进程和 Python 后端断点调试。

### 前置准备

确保已按第 3 节创建 `middleware/.venv` 虚拟环境并安装依赖。Electron 开发模式会自动检测 `middleware/.venv` 中的 Python，无需额外配置。

安装 Python 调试依赖到虚拟环境（仅调试 Python 时需要）：
```bash
middleware/.venv/bin/pip install debugpy
```

建议将本地 VSCode 调试配置（`.vscode/launch.json`）中的 Python 解释器指向 `middleware/.venv/bin/python3`，并安装推荐扩展（如 `ms-python.debugpy`）。

> **注意**：`.vscode/` 目录在 `.gitignore` 中，不会提交到仓库。如需共享调试配置，可参考本节内容手动创建。

### 工作流 A: 调试 Electron 主进程

```bash
cd GUI
npm run dev:debug
```

然后在 VSCode 中运行 **"Attach to Electron Main"** 配置，即可在 `src/main/*.ts` 中设置断点。

`dev:debug:brk` 变体会在主进程第一行暂停，适合调试启动逻辑：
```bash
cd GUI
npm run dev:debug:brk
```

### 工作流 B: 调试 Python（从 Electron spawn 的子进程）

设置环境变量 `ELECTRON_PYTHON_DEBUG=1`，Python 子进程启动时会通过 debugpy 等待调试器连接（默认端口 5678）：

```bash
cd GUI
ELECTRON_PYTHON_DEBUG=1 npm run dev:debug
```

在 GUI 中触发翻译后，Python 进程会暂停等待调试器。此时在 VSCode 中运行 **"Attach to Python (spawn)"** 配置，即可在 `murasaki_translator/*.py` 中设置断点。

可通过 `ELECTRON_PYTHON_DEBUG_PORT` 自定义端口：
```bash
ELECTRON_PYTHON_DEBUG=1 ELECTRON_PYTHON_DEBUG_PORT=5679 npm run dev:debug
```

### 工作流 C: 直接运行 Python CLI 调试

不需要启动 Electron，直接在 VSCode 中按 F5 运行 **"Debug Python (CLI)"** 配置，会提示输入文件路径、模型路径和 llama-server 路径，然后直接启动 `main.py`：

```bash
# 等效命令行：
cd middleware
python murasaki_translator/main.py --file test.epub --model models/xxx.gguf --server bin/darwin-metal/llama-server
```

### 工作流 D: API Server 模式调试

适合调试 `api_server.py` 及远程服务相关代码：

1. 在 VSCode 中运行 **"Debug Python API Server"** 配置（启动带 `--reload` 热重载的 FastAPI 服务）
2. 另开终端启动 GUI：`cd GUI && npm run dev`
3. 在 GUI 的 ServiceView 中远程连接到 `http://127.0.0.1:8000`，API Key 填 `dev123`

### 复合调试：Full Stack Debug

运行 **"Full Stack Debug"** 复合配置可同时 attach Electron 主进程和 Python 子进程，实现全栈断点调试。使用前需确保：
1. 已通过 `ELECTRON_PYTHON_DEBUG=1 npm run dev:debug` 启动应用
2. 已在 GUI 中触发翻译（使 Python 进程启动并等待 debugger）

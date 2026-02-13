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

# Murasaki Translator 开发指南

本文档将指导你从源码构建 Murasaki Translator。

## 1. 环境准备 (Prerequisites)

在开始之前，请确保你的 Windows 系统已安装以下软件：

*   **Git**: 用于克隆代码仓库 ([下载](https://git-scm.com/))
*   **Python 3.10+**: 用于运行后端中间件 ([下载](https://www.python.org/))
    *   *注意：安装时请勾选 "Add Python to PATH"*
*   **Node.js (LTS)**: 用于构建 Electron 前端 (建议 v18 或更高) ([下载](https://nodejs.org/))
*   **NVIDIA CUDA Toolkit**: (推荐) 如果你的显卡支持 CUDA，建议安装对应版本的 CUDA Toolkit 以获得最佳推理性能。

## 2. 克隆项目 (Clone)

```bash
git clone https://github.com/soundstarrain/Murasaki-Translator.git
cd Murasaki-Translator
```

## 3. 配置后端环境 (Backend Setup)

本项目在打包时会封装一个独立的 Python 环境。你需要手动创建并配置这个环境。

1.  **创建虚拟环境**
    在项目根目录下，创建一个名为 `python_env` 的虚拟环境：
    ```bash
    python -m venv python_env
    ```

2.  **激活虚拟环境**
    ```bash
    .\python_env\Scripts\activate
    ```

3.  **安装依赖**
    安装中间件运行所需的 Python 库：
    ```bash
    pip install -r middleware/requirements.txt
    ```
    *注意：此步骤仅安装推理所需的最小依赖库。*

4.  **下载推理后端 (Server Binary)**
    由于相关文件较大且未包含在仓库中，你需要手动下载 `llama.cpp` 的 Windows 编译版本。
    
    1.  前往 [llama.cpp Release](https://github.com/ggerganov/llama.cpp/releases) 下载最新版本的 `llama-bxxxx-bin-win-cuda-12.4-x64.zip` (或对应你显卡 CUDA 版本的包)。
    2.  解压下载的压缩包。
    3.  将解压后的所有文件（包含 `llama-server.exe` 和 `*.dll`）放置在项目的以下目录中：
        ```
        middleware\llama-b7770-bin-win-cuda-12.4-x64\
        ```
        *注：如果没有该文件夹，请手动创建。如果你的版本号不同（非 b7770），请重命名文件夹以匹配代码中的硬编码路径，或修改 `middleware/murasaki_translator/main.py` 中的 `default_server` 路径。*

5.  **验证推理引擎**
    确保目录 `middleware\llama-b7770-bin-win-cuda-12.4-x64` 下存在 `llama-server.exe` 文件。

## 4. 配置前端环境 (Frontend Setup)

1.  **进入前端目录**
    ```bash
    cd GUI
    ```

2.  **安装依赖**
    推荐使用 `npm` 进行安装：
    ```bash
    npm install
    ```

## 5. 运行与编译 (Run & Build)

### 开发模式 (Development)
如果你想修改 UI 代码并实时预览：

```bash
npm run dev
```
此命令将启动 Electron 开发窗口。

### 编译打包 (Build Production)
构建最终的 Windows 安装包 (`.exe`)：

1.  确保 `python_env` 已经准备好（参考第 3 步）。
2.  在 `GUI` 目录下运行：
    ```bash
    npm run build:win
    ```
3.  构建完成后，安装包将生成在 `GUI/dist` 目录下。

---

> **提示**: 构建过程会自动将根目录下的 `python_env` 和 `middleware` 文件夹复制到安装包资源中，因此请务必保持这两个文件夹的结构正确。

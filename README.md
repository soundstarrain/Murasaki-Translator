<div align="center">

<img src="./GUI/resources/icon.png" width="120" height="120" alt="Murasaki Logo">

# Murasaki Translator

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器<br>Murasaki 系列模型官方推理前端

[![Release](https://img.shields.io/github/v/release/soundstarrain/Murasaki-Translator?style=flat-square&color=8a2be2&label=Download)](https://github.com/soundstarrain/Murasaki-Translator/releases)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows)](https://github.com/soundstarrain/Murasaki-Translator/releases)
[![Model](https://img.shields.io/badge/Model-Murasaki_LLM-FFD21E?style=flat-square&logo=huggingface&logoColor=black)](https://huggingface.co/Murasaki-Project)

<br>

<img src="./preview.png" alt="Murasaki UI Preview" width="850" style="border-radius: 12px; box-shadow: 0 8px 16px rgba(0,0,0,0.3);">

<br>

[下载最新版](https://github.com/soundstarrain/Murasaki-Translator/releases) | [模型仓库 (Hugging Face)](https://huggingface.co/Murasaki-Project) | [反馈问题](https://github.com/soundstarrain/Murasaki-Translator/issues)

</div>

---

**Murasaki Translator** 是 **Murasaki 系列模型** 的官方配套推理引擎。

**Murasaki 系列模型** 是针对 ACGN 领域特化微调的翻译模型，其训练数据中 90% 以上为高质量的段落级长文本。模型原生支持 **Chain-of-Thought (CoT)** 思维链机制，具备结合长上下文进行精准 ACGN 文本翻译的能力。

---

本项目基于 Murasaki 系列模型的原生 CoT 能力和长上下文特性，专门设计并优化了翻译引擎。我们对模型底层格式及特性进行了深度的适配与工程优化，底层采用 **llama.cpp** 推理框架，前端使用 **Electron + React** 构建，旨在为轻小说翻译提供一个轻量级、高性能且功能完备的解决方案。

## 功能特性

本项目是专为 Murasaki 模型打造的完整翻译工作流前端，针对轻小说长文本翻译场景进行了深度的工程化适配。

### 1. 交互体验与硬件监控
提供完整的可视化翻译工作台。支持文件与文件夹的拖拽导入，系统会自动建立翻译队列。
- **实时预览**：支持原文与译文的逐行对照流式输出，即时查看翻译进度。
- **硬件仪表盘**：内置显存 (VRAM) 占用与 GPU 负载监控，实时显示 Token 生成速度与字符处理速度，帮助用户掌握硬件状态。

### 2. 模型原生术语表支持
Murasaki 模型针对术语表进行了特化训练，支持 **Prompt 级术语注入**，模型会在 CoT 中识别术语表并且进行分析替换。
- **原生支持**：模型能理解术语表指令，根据上下文灵活嵌入术语，而非生硬的字符串替换。
- **自动挂载**：支持 `JSON` 与 `TXT` 格式。系统会自动扫描并挂载与翻译文件同名的术语表。
- **覆盖率动态重试**：实现了覆盖率检测机制，若译文未正确包含指定术语，系统会自动调整参数并进行重试。

### 3. 可视化校对模式
专为长文本设计的后期校对工具，解决长篇翻译后的精修需求。
- 提供原文与译文的**联动对照**视图。
- 支持快速编辑与保存，方便对模型输出的特定段落进行人工润色，无需导出后再使用第三方编辑器。
- 可直接在校对页面调用翻译引擎，对选中的 Block 进行**重新翻译**。
- 内置**质量检测功能**，自动检测潜在的翻译质量问题，并快速定位到具体行提示用户进行检查。

### 4. 针对性质量控制 (Quality Control)
基于 Murasaki 模型输出特性（CoT 思维链）定制的自动化容错系统。
- **行数校验 (Line Check)**：自动监控译文与原文的行数对应关系，发现行数漂移或漏翻时自动触发重试。
- **动态参数调优**：当检测到模型陷入复读或死循环时，自动动态调整重复惩罚 (Rep Penalty) 和温度 (Temperature) 尝试挽救，最大程度减少人工干预。

### 5. 通用预处理与后处理
内置强大的文本清洗引擎，确保输入模型的数据干净规范。
- **规则沙盒**：提供实时测试环境，可视化预览规则对文本的清洗效果。
- **格式化模板**：内置“轻小说预处理”与“通用文本”方案，一键处理段落间距、全角/半角符号转换及特殊字符清洗。
- **正则扩展**：全面支持用户自定义正则表达式 (Regex)，可针对特定文本源编写清洗规则。

### 6. 远程推理服务 (Windows)
支持计算节点与操作节点分离，适应多机环境。
- **API 服务**：可在另一台高性能 Windows 服务器上启动后端服务，本地 GUI 作为客户端通过局域网连接进行推理。
- **专属适配**：该协议目前专为 Murasaki 模型设计，确保远程调用时所有 CoT 特性与参数控制依然生效。

## 使用说明

> [!NOTE]
> 建议使用 NVIDIA 显卡，并至少拥有 8GB 以上显存。

1. **准备环境**: 
   确保拥有 NVIDIA GPU 且驱动已更新至最新。请直接下载 GitHub 页面右侧的 [Release](https://github.com/soundstarrain/Murasaki-Translator/releases) 版本。
   *(如需通过源码编译，请参考 [开发指南](./DEVELOPMENT.md)。)*
   
> [!IMPORTANT]
> **⚠️ 关于显卡驱动版本的关键说明**
> 本项目内置的推理核心基于 **CUDA 12.4** 编译，对显卡驱动有以下硬性要求：
> - **无需安装 CUDA Toolkit**：普通用户**不需要**下载安装庞大的 CUDA 开发包。
> - **必须更新驱动**：您的 NVIDIA 显卡驱动必须支持 CUDA 12.4 或更高版本。请确保驱动版本 **≥ 551.61**（即 2024 年初及之后的版本）。
> - **典型故障**：若驱动版本过旧（如仅支持 CUDA 11.x），程序启动时将无法加载 `ggml-cuda.dll` 导致直接崩溃或无响应。遇到此类问题请优先前往 NVIDIA 官网或使用 GeForce Experience 更新驱动。
   
2. **获取模型**: 
   前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 `Murasaki-GGUF` 模型文件。

3. **启动翻译**: 
   将下载的模型文件放入项目的 `\resources\middleware\models` 目录中，启动软件并上传需要翻译的文件即可开始工作。

### 性能参考
在 **GeForce RTX 4080 Laptop** 环境下，运行 **4-bit 量化模型**：
- **平均速度**: ~90 字/s
- **内容构成**: 思维链 (CoT) 内容与翻译文本比例约为 50%:50%

---

### 常见问题

**基础使用：**
1. **实验性功能**：部分标记为“实验性”的功能开启后可能与其他功能冲突，导致翻译异常。若遇到问题，请优先关闭此类功能。
2. **默认配置**：大部分预设配置即为通用最佳值，通常无需调整。
3. **故障排查**：如果翻译遇到问题，请首先尝试重置所有配置。若问题依旧，请提交 Issue 并附带设置中导出的完整调试日志。

**高级调优 (CoT 与 上下文)：**
1. **CoT 比例与效率**：CoT 内容与翻译文本的比例与上下文长度相关。通常**批次大小 (Batch Size)** 越大，CoT 在总输出中的占比越小，纯文本翻译的效率则越高。
2. **参数定义**：
   - **上下文 (Context)**：指模型处理的总预算空间，包含术语表、Prompt、CoT 思维链和实际翻译文本。
   - **批次大小 (Batch Size)**：指模型一次性处理的文本切片长度（设置中会自动换算）。
3. **参数推荐**：
   - 建议**批次大小**设置在 `512` - `4096` 之间。
   - **最佳甜点区间**为 `1024` - `2048`（对应的上下文约为 3000 - 6000 token）。
   - *注：此区间是兼顾模型逻辑推理能力（CoT）、翻译文本产出效率以及上下文信息利用率的最佳平衡点。*

---

## 后续开发计划

我们会持续改进 Murasaki Translator 的体验，未来的开发重点有：

- [ ] **多格式文档支持**：计划扩展对多种文件格式的支持，特别是针对 **RPG** 及 **Galgame** 脚本等游戏文本格式的直接解析与翻译，进一步简化游戏汉化流程。
- [ ] **Linux Server 后端**：开发轻量级的 Linux 服务端，提供兼容 Llama 标准的 API 接口。届时 GUI 将支持直接连接远程服务器进行推理，方便在云端或高性能服务器上部署模型。
- [ ] **文档完善**：补充更详尽的**使用教程**与**功能文档**，帮助用户更深入地了解各项参数与特性。
- [ ] **模型迭代**：持续更新模型训练，发布质量更高、针对性更强的新版本模型。

---

## 协议与致谢

- **软件代码**: [Apache-2.0 License](./LICENSE)
- **模型权重**: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- **致谢**: 特别感谢 **SakuraLLM** (https://github.com/SakuraLLM/) 提供的 Base 模型。

---

<p align="center">
  Copyright © 2026 <b>Murasaki Translator</b>.
</p>
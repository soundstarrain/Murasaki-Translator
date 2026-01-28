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
- **原生支持**：模型能理解术语表指令，根据上下文灵活嵌入术语。
- **自动挂载**：支持 `JSON` 与 `TXT` 格式。系统会自动扫描并挂载与翻译文件同名的术语表。
- **术语转换器**：内置可视化的术语转换工具，支持导入大部分术语表格式
- **覆盖率动态重试**：实现了覆盖率检测机制，若译文未正确包含指定术语，系统会自动调整参数并进行重试。

### 3. 深度推理控制与优化
为进阶用户提供细粒度的推理参数控制，平衡质量与性能。
- **Flash Attention**：优化显存占用，显著提高长上下文推理的稳定性（需 RTX 20 系列及以上）。
- **KV Cache 量化**：支持配置缓存精度（F16, Q8_0, Q4_0），在有限显存下通过牺牲极少精度换取更长的上下文窗口。
- **末端平衡策略**：智能检测并合并文末短块，确保全文上下文长度均匀。

### 4. 鲁棒的断点续传系统
专为长篇小说设计的高可靠性恢复机制。
- **颗粒度恢复**：基于 `.temp.jsonl` 的实时记录，支持从精确的中断块恢复翻译。
- **指纹保护**：内置配置指纹检查，防止因配置变更导致的上下文损坏。

### 5. 可视化校对与质量控制
专为长文本设计的后期校对工具，解决长篇翻译后的精修需求。
- **联动校对**：提供原文与译文的对照视图，支持快速编辑与保存，无需导出第三方编辑器。
- 可直接在校对页面调用翻译引擎，对选中的 Block 进行**重新翻译**。
- 内置**质量检测功能**，自动检测潜在的翻译质量问题，并快速定位到具体行提示用户进行检查。
- **行数校验 (Line Check)**：自动监控译文与原文的行数对应关系，发现行数漂移或漏翻时自动触发重试。
- **自动化容错**：自动监控行数漂移与逻辑死循环。当检测到模型复读或漏翻时，自动动态调整重复惩罚 (Rep Penalty) 和温度 (Temperature) 触发重试。

### 6. 通用预处理与后处理
内置强大的文本清洗引擎，确保输入模型的数据干净规范。
- **规则沙盒**：提供实时测试环境，可视化预览规则对文本的清洗效果。
- **格式化模板**：内置“轻小说预处理”与“通用文本”方案，支持智能引号配对、缩进保留及特殊字符清洗。
- **正则扩展**：全面支持用户自定义正则表达式 (Regex)，可针对特定文本源编写清洗规则。

## 使用说明

> [!NOTE]
> 推荐使用 NVIDIA 显卡（6GB+ 显存）以获得最佳体验。

1. **准备环境**: 
   请直接下载 GitHub 页面右侧的 [Release](https://github.com/soundstarrain/Murasaki-Translator/releases) 版本。
   *(如需通过源码编译，请参考 [开发指南](./DEVELOPMENT.md)。)*
   
> [!IMPORTANT]
> **⚠️ 关于显卡驱动版本的关键说明**
> 若使用 NVIDIA 显卡加速，驱动必须支持 **CUDA 12.4** 或更高版本。
> - **无需安装 CUDA Toolkit**：普通用户**不需要**下载安装庞大的 CUDA 开发包。
> - **必须更新驱动**：请确保驱动版本 **≥ 551.61**（即 2024 年初及之后的版本）。
> - **典型故障**：若驱动版本过旧，系统将自动回退至 CPU 模式或无法加载引擎。
   
2. **获取模型**: 
   前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 `Murasaki-GGUF` 模型文件。

3. **启动翻译**: 
   将下载的模型文件放入项目的 `\resources\middleware\models` 目录中，启动软件并上传需要翻译的文件即可开始工作。

### 性能参考
在 **GeForce RTX 4080 Laptop** 环境下，运行 **4-bit 量化模型**，4个并发任务：
- **平均速度**: ~200 字/s
- **内容构成**: 思维链 (CoT) 内容与翻译文本比例约为 40%:60%

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
   - 建议**批次大小**设置在 `512` - `3072` 之间。
   - **最佳甜点区间**为 `1024` - `1536`（对应的上下文约为 3200 - 4600 token）。
   - *注：此区间是兼顾模型逻辑推理能力（CoT）、翻译文本产出效率以及上下文信息利用率的最佳平衡点。*
   - **精度与并行**：
     - **质量优先**：推荐使用 **KV Cache F16** 精度与 **单线程** 模式。任何降低缓存精度（如 Q8_0/Q4_0）或开启多任务并行的设置，均会导致推理质量产生不同程度的损耗。
     - **性能平衡**：总吞吐量由 GPU FLOPS、显存带宽及并行数量共同决定。请注意，**并行数量并非越高越好**，过高的并发会导致显存带宽瓶颈与资源争抢，反而降低整体处理速度。

---

## 后续开发计划

我们会持续改进 Murasaki Translator 的体验，未来的开发重点有：

- [ ] **多格式文档支持**：计划扩展对多种文件格式的支持，特别是针对 **RPG** 及 **Galgame** 脚本等游戏文本格式的直接解析与翻译。
- [ ] **Linux Server 后端**：开发轻量级的 Linux 服务端，提供兼容 Llama 标准的 API 接口，支持远程推理。
- [ ] **文档完善**：补充更详尽的**使用教程**与**功能文档**。
- [ ] **模型迭代**：持续更新模型训练，发布质量更高、针对性更强的新版本模型。

---

## 协议与致谢

- **软件代码**: [Apache-2.0 License](./LICENSE)
- **模型权重**: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- **致谢**: 特别感谢 [**SakuraLLM**](https://github.com/SakuraLLM/) 提供的 Base 模型。
- **致谢**  特别感谢 [**LinguaGacha**](https://github.com/neavo/LinguaGacha) ，本项目的处理规则（注音清理器、数字修复器等）参考了该项目

---

<p align="center">
  Copyright © 2026 <b>Murasaki Translator</b>.
</p>
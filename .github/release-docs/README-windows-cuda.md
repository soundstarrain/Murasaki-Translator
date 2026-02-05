# Murasaki Translator - Windows CUDA 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 系统要求

- **操作系统**: Windows 10/11 x64
- **显卡**: NVIDIA 显卡 (6GB+ 显存推荐)
- **驱动**: NVIDIA 驱动 ≥ 551.61 (需支持 CUDA 12.4)

> ⚠️ **重要**：无需安装 CUDA Toolkit，只需更新显卡驱动。

## 快速开始

1. **下载模型**: 前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 GGUF 模型文件
2. **放置模型**: 将模型放入 `resources\middleware\models` 目录
3. **启动软件**: 双击运行 `Murasaki-Translator.exe`

## 性能参考

| 显卡 | 量化 | 并发 | 速度 |
|------|------|------|------|
| RTX 4080 Laptop | Q4 | 4 | ~200 字/s |
| RTX 3060 | Q4 | 2 | ~100 字/s |

## 故障排查

- **无法启动**: 请确认驱动版本 ≥ 551.61
- **速度异常**: 检查任务管理器确认 GPU 占用
- **内存不足**: 尝试使用更小的量化模型 (如 Q4_K_M)

## 链接

- **项目主页**: https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**: https://huggingface.co/Murasaki-Project
- **问题反馈**: https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见 murasaki-translator.LICENSE.txt。
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator

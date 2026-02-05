# Murasaki Translator - Windows Vulkan 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 系统要求

- **操作系统**: Windows 10/11 x64
- **显卡**: AMD / Intel / NVIDIA 显卡 (需支持 Vulkan 1.2)
- **驱动**: 更新到最新版本的显卡驱动

> 💡 **适用场景**: AMD 显卡用户、Intel 核显用户、或 NVIDIA 驱动过旧无法使用 CUDA 版本的用户。

## 快速开始

1. **下载模型**: 前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 GGUF 模型文件
2. **放置模型**: 将模型放入 `resources\middleware\models` 目录
3. **启动软件**: 双击运行 `Murasaki-Translator.exe`

## 性能说明

Vulkan 版本在 AMD 显卡上性能较好，在 NVIDIA 显卡上可能略逊于 CUDA 版本。

## 故障排查

- **无法启动**: 请更新显卡驱动到最新版本
- **黑屏/崩溃**: 确认显卡支持 Vulkan 1.2
- **速度缓慢**: Vulkan 后端对某些老旧显卡支持不佳，可尝试降低并发数

## 链接

- **项目主页**: https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**: https://huggingface.co/Murasaki-Project
- **问题反馈**: https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见 murasaki-translator.LICENSE.txt。
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator

# Murasaki Translator - macOS 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 系统要求

- **操作系统**: macOS 12.0+ (Monterey 或更新)
- **芯片**: Apple Silicon (M1/M2/M3) 或 Intel x64
- **内存**: 16GB+ 推荐

> 💡 **性能提示**: Apple Silicon Mac 使用 Metal 加速，性能优于 Intel Mac。

## 快速开始

1. **下载模型**: 前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 GGUF 模型文件
2. **放置模型**: 将模型放入 `Murasaki-Translator.app/Contents/Resources/middleware/models`
3. **首次运行**: 右键点击 App → 打开 (绕过 Gatekeeper)

## 故障排查

- **"无法打开"警告**: 右键 → 打开，或在系统偏好设置中允许
- **运行缓慢**: Apple Silicon 原生支持 Metal，Intel Mac 使用 CPU 可能较慢
- **内存不足**: 使用更小的量化模型 (如 Q4_K_M)

## 链接

- **项目主页**: https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**: https://huggingface.co/Murasaki-Project
- **问题反馈**: https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见 murasaki-translator.LICENSE.txt。
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator

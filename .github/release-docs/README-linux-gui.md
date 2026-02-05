# Murasaki Translator - Linux GUI 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 系统要求

- **操作系统**: Ubuntu 20.04+ / Debian 11+ / 其他现代 Linux 发行版
- **显卡**: 
  - NVIDIA (推荐): 需安装 NVIDIA 驱动 (≥ 550)
  - AMD/Intel: 需安装 Vulkan 驱动 (mesa-vulkan-drivers)
- **依赖**: Python 3.10+, libvulkan1

## 安装依赖

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3 python3-pip libvulkan1

# NVIDIA 用户 (可选，如需 CUDA 加速)
# 请通过官方渠道安装 NVIDIA 驱动

# AMD/Intel 用户 (Vulkan)
sudo apt install mesa-vulkan-drivers
```

## 快速开始

1. **下载模型**: 前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 GGUF 模型文件
2. **解压软件**: `tar -xzf Murasaki-Translator-linux-x64.tar.gz`
3. **放置模型**: 将模型放入 `resources/middleware/models` 目录
4. **启动软件**: `./murasaki-translator`

## AppImage 用户

```bash
chmod +x Murasaki-Translator.AppImage
./Murasaki-Translator.AppImage
```

## 故障排查

- **权限错误**: `chmod +x murasaki-translator`
- **缺少 Vulkan**: `sudo apt install libvulkan1 mesa-vulkan-drivers`
- **NVIDIA 检测失败**: 确认 `nvidia-smi` 命令可用

## 链接

- **项目主页**: https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**: https://huggingface.co/Murasaki-Project
- **问题反馈**: https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见 murasaki-translator.LICENSE.txt。
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator

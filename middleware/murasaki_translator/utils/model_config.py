"""
模型配置字典 - Murasaki 翻译器官方模型配置
功能：通过 MD5 或文件名自动识别模型并返回推荐配置
"""
import hashlib
import os
from dataclasses import dataclass
from typing import Optional, Dict


@dataclass
class ModelConfig:
    """模型配置"""
    name: str           # 官方代号
    display_name: str   # 显示名称
    params: str         # 参数量
    quant: str          # 量化类型
    ctx_recommended: int    # 推荐上下文长度
    ctx_max: int            # 最大上下文长度
    preset: str             # 推荐 Prompt 预设
    gpu_layers: int         # 推荐 GPU 层数 (-1 = 全部)
    description: str        # 描述


# 官方模型配置字典
# Key: 文件名关键词 (小写)
MODEL_CONFIGS: Dict[str, ModelConfig] = {
    # Murasaki v0.1 系列 - Q4_K_M 量化
    "murasaki-8b-q4_k_m": ModelConfig(
        name="murasaki-8b-v0.1-q4km",
        display_name="Murasaki 8B v0.1 (Q4_K_M)",
        params="8B",
        quant="Q4_K_M",
        ctx_recommended=8192,
        ctx_max=16384,
        preset="training",
        gpu_layers=-1,
        description="Murasaki 翻译器 4-bit 量化版，适合 8GB+ VRAM"
    ),
    # Murasaki v0.1 系列 - F16 全精度
    "murasaki-8b-f16": ModelConfig(
        name="murasaki-8b-v0.1-f16",
        display_name="Murasaki 8B v0.1 (F16)",
        params="8B",
        quant="F16",
        ctx_recommended=8192,
        ctx_max=16384,
        preset="training",
        gpu_layers=-1,
        description="Murasaki 翻译器 16-bit 全精度版，需要 16GB+ VRAM"
    ),
}

# MD5 到模型配置的映射（用于精确识别）
MODEL_MD5_MAP: Dict[str, str] = {
    # 示例: "abc123...": "murasaki-8b-v0.1"
    # 实际 MD5 需要计算后填入
}


def get_file_md5(file_path: str, chunk_size: int = 8192) -> str:
    """计算文件 MD5（只读取前 1MB 以提高速度）"""
    md5 = hashlib.md5()
    bytes_read = 0
    max_bytes = 1024 * 1024  # 1MB
    
    try:
        with open(file_path, 'rb') as f:
            while bytes_read < max_bytes:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                md5.update(chunk)
                bytes_read += len(chunk)
        return md5.hexdigest()
    except Exception:
        return ""


def identify_model(model_path: str) -> Optional[ModelConfig]:
    """
    识别模型并返回配置
    :param model_path: 模型文件路径
    :return: 模型配置，未识别返回 None
    """
    if not model_path or not os.path.exists(model_path):
        return None
    
    filename = os.path.basename(model_path).lower()
    
    # 1. 尝试通过文件名关键词匹配
    for key, config in MODEL_CONFIGS.items():
        if key in filename:
            return config
    
    # 2. 尝试通过 MD5 匹配（更精确）
    file_md5 = get_file_md5(model_path)
    if file_md5 in MODEL_MD5_MAP:
        config_key = MODEL_MD5_MAP[file_md5]
        if config_key in MODEL_CONFIGS:
            return MODEL_CONFIGS[config_key]
    
    return None


def get_model_display_name(model_path: str) -> str:
    """获取模型显示名称"""
    config = identify_model(model_path)
    if config:
        return config.display_name
    
    # 默认返回文件名
    return os.path.basename(model_path)


def get_recommended_config(model_path: str) -> Dict:
    """获取推荐配置"""
    config = identify_model(model_path)
    if config:
        return {
            "ctx_size": config.ctx_recommended,
            "preset": config.preset,
            "gpu_layers": config.gpu_layers,
        }
    
    # 默认配置
    return {
        "ctx_size": 8192,
        "preset": "training",
        "gpu_layers": -1,
    }

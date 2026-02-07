"""
模型配置字典 - Murasaki 翻译器官方模型配置
功能：通过文件名自动识别模型参数和量化类型
"""
import os
import re
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
    gpu_layers: int         # 推荐 GPU 层数 (-1 = 全部)
    description: str        # 描述


# 量化类型识别模式 (按优先级排序，IQ 系列优先)
# ⚠️ KEEP IN SYNC WITH: GUI/src/renderer/src/lib/modelConfig.ts QUANT_PATTERNS
QUANT_PATTERNS = [
    # IQ 系列 (重要性量化)
    (r'[_-]IQ1[_-]?S', 'IQ1_S'),
    (r'[_-]IQ1[_-]?M', 'IQ1_M'),
    (r'[_-]IQ2[_-]?XXS', 'IQ2_XXS'),
    (r'[_-]IQ2[_-]?XS', 'IQ2_XS'),
    (r'[_-]IQ2[_-]?S', 'IQ2_S'),
    (r'[_-]IQ2[_-]?M', 'IQ2_M'),
    (r'[_-]IQ3[_-]?XXS', 'IQ3_XXS'),
    (r'[_-]IQ3[_-]?XS', 'IQ3_XS'),
    (r'[_-]IQ3[_-]?S', 'IQ3_S'),
    (r'[_-]IQ3[_-]?M', 'IQ3_M'),
    (r'[_-]IQ4[_-]?XXS', 'IQ4_XXS'),
    (r'[_-]IQ4[_-]?XS', 'IQ4_XS'),
    (r'[_-]IQ4[_-]?NL', 'IQ4_NL'),
    # K 系列量化
    (r'[_-]Q2[_-]?K[_-]?S', 'Q2_K_S'),
    (r'[_-]Q2[_-]?K[_-]?M', 'Q2_K_M'),
    (r'[_-]Q2[_-]?K', 'Q2_K'),
    (r'[_-]Q3[_-]?K[_-]?S', 'Q3_K_S'),
    (r'[_-]Q3[_-]?K[_-]?M', 'Q3_K_M'),
    (r'[_-]Q3[_-]?K[_-]?L', 'Q3_K_L'),
    (r'[_-]Q4[_-]?K[_-]?S', 'Q4_K_S'),
    (r'[_-]Q4[_-]?K[_-]?M', 'Q4_K_M'),
    (r'[_-]Q4[_-]?0', 'Q4_0'),
    (r'[_-]Q4[_-]?1', 'Q4_1'),
    (r'[_-]Q5[_-]?K[_-]?S', 'Q5_K_S'),
    (r'[_-]Q5[_-]?K[_-]?M', 'Q5_K_M'),
    (r'[_-]Q5[_-]?0', 'Q5_0'),
    (r'[_-]Q5[_-]?1', 'Q5_1'),
    (r'[_-]Q6[_-]?K', 'Q6_K'),
    (r'[_-]Q8[_-]?0', 'Q8_0'),
    # 全精度
    (r'[_-]F16', 'F16'),
    (r'[_-]F32', 'F32'),
    (r'[_-]BF16', 'BF16'),
]

# 参数量识别模式
PARAMS_PATTERNS = [
    (r'[_-](\d+\.?\d*)[Bb]', lambda m: f"{m.group(1)}B"),  # 8B, 7B, 1.5B 等
]

# 版本识别模式  
VERSION_PATTERN = r'[_-]v(\d+\.?\d*)'


def detect_quant_type(filename: str) -> str:
    """从文件名检测量化类型"""
    for pattern, quant_type in QUANT_PATTERNS:
        if re.search(pattern, filename, re.IGNORECASE):
            return quant_type
    return "Unknown"


def detect_params(filename: str) -> str:
    """从文件名检测参数量"""
    for pattern, formatter in PARAMS_PATTERNS:
        match = re.search(pattern, filename, re.IGNORECASE)
        if match:
            return formatter(match)
    return "Unknown"


def detect_version(filename: str) -> str:
    """从文件名检测版本号"""
    match = re.search(VERSION_PATTERN, filename, re.IGNORECASE)
    if match:
        return f"v{match.group(1)}"
    return ""


def identify_model(model_path: str) -> Optional[ModelConfig]:
    """
    识别模型并返回配置
    :param model_path: 模型文件路径
    :return: 模型配置，未识别返回 None
    """
    if not model_path or not os.path.exists(model_path):
        return None
    
    filename = os.path.basename(model_path)
    
    # 检测各项属性
    quant = detect_quant_type(filename)
    params = detect_params(filename)
    version = detect_version(filename)
    
    # 判断是否为 Murasaki 官方模型
    is_murasaki = "murasaki" in filename.lower()
    
    # 构建显示名称
    if is_murasaki:
        display_name = f"Murasaki {params} {version} ({quant})".strip()
        description = f"Murasaki 翻译器 {quant} 量化版"
    else:
        # 非官方模型，使用文件名
        base_name = os.path.splitext(filename)[0]
        display_name = base_name
        description = f"第三方模型 ({quant})"
    
    return ModelConfig(
        name=os.path.splitext(filename)[0].lower(),
        display_name=display_name,
        params=params,
        quant=quant,
        ctx_recommended=8192,
        ctx_max=32768,
        gpu_layers=-1,
        description=description
    )


def get_model_display_name(model_path: str) -> str:
    """获取模型显示名称"""
    config = identify_model(model_path)
    if config:
        return config.display_name
    
    # 默认返回文件名
    return os.path.basename(model_path)


def get_recommended_config(model_path: str) -> Dict:
    """
    获取推荐配置
    注意：不设置 preset，由全局配置决定
    """
    config = identify_model(model_path)
    if config:
        return {
            "ctx_size": config.ctx_recommended,
            "gpu_layers": config.gpu_layers,
        }
    
    # 默认配置
    return {
        "ctx_size": 8192,
        "gpu_layers": -1,
    }

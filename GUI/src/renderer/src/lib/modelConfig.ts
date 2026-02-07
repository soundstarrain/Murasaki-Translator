/**
 * 模型配置 - Murasaki 翻译器官方模型配置
 * 通过文件名自动识别模型并返回推荐配置
 * 注意：preset 由全局配置决定，不在模型配置中预设
 */

export interface ModelConfig {
  name: string; // 官方代号
  displayName: string; // 显示名称
  params: string; // 参数量
  quant: string; // 量化类型
  ctxRecommended: number; // 推荐上下文长度
  ctxMax: number; // 最大上下文长度
  gpuLayers: number; // 推荐 GPU 层数 (-1 = 全部)
  description: string; // 描述
}

// 量化类型识别模式 (按优先级排序，IQ 系列优先)
// ⚠️ KEEP IN SYNC WITH: middleware/murasaki_translator/utils/model_config.py QUANT_PATTERNS
const QUANT_PATTERNS: [RegExp, string][] = [
  // IQ 系列 (重要性量化)
  [/[_-]IQ1[_-]?S/i, "IQ1_S"],
  [/[_-]IQ1[_-]?M/i, "IQ1_M"],
  [/[_-]IQ2[_-]?XXS/i, "IQ2_XXS"],
  [/[_-]IQ2[_-]?XS/i, "IQ2_XS"],
  [/[_-]IQ2[_-]?S/i, "IQ2_S"],
  [/[_-]IQ2[_-]?M/i, "IQ2_M"],
  [/[_-]IQ3[_-]?XXS/i, "IQ3_XXS"],
  [/[_-]IQ3[_-]?XS/i, "IQ3_XS"],
  [/[_-]IQ3[_-]?S/i, "IQ3_S"],
  [/[_-]IQ3[_-]?M/i, "IQ3_M"],
  [/[_-]IQ4[_-]?XXS/i, "IQ4_XXS"],
  [/[_-]IQ4[_-]?XS/i, "IQ4_XS"],
  [/[_-]IQ4[_-]?NL/i, "IQ4_NL"],
  // K 系列量化
  [/[_-]Q2[_-]?K[_-]?S/i, "Q2_K_S"],
  [/[_-]Q2[_-]?K[_-]?M/i, "Q2_K_M"],
  [/[_-]Q2[_-]?K/i, "Q2_K"],
  [/[_-]Q3[_-]?K[_-]?S/i, "Q3_K_S"],
  [/[_-]Q3[_-]?K[_-]?M/i, "Q3_K_M"],
  [/[_-]Q3[_-]?K[_-]?L/i, "Q3_K_L"],
  [/[_-]Q4[_-]?K[_-]?S/i, "Q4_K_S"],
  [/[_-]Q4[_-]?K[_-]?M/i, "Q4_K_M"],
  [/[_-]Q4[_-]?0/i, "Q4_0"],
  [/[_-]Q4[_-]?1/i, "Q4_1"],
  [/[_-]Q5[_-]?K[_-]?S/i, "Q5_K_S"],
  [/[_-]Q5[_-]?K[_-]?M/i, "Q5_K_M"],
  [/[_-]Q5[_-]?0/i, "Q5_0"],
  [/[_-]Q5[_-]?1/i, "Q5_1"],
  [/[_-]Q6[_-]?K/i, "Q6_K"],
  [/[_-]Q8[_-]?0/i, "Q8_0"],
  // 全精度
  [/[_-]F16/i, "F16"],
  [/[_-]F32/i, "F32"],
  [/[_-]BF16/i, "BF16"],
];

/**
 * 从文件名检测量化类型
 */
function detectQuantType(filename: string): string {
  for (const [pattern, quantType] of QUANT_PATTERNS) {
    if (pattern.test(filename)) {
      return quantType;
    }
  }
  return "Unknown";
}

/**
 * 从文件名检测参数量
 */
function detectParams(filename: string): string {
  const match = filename.match(/[_-](\d+\.?\d*)[Bb]/);
  if (match) {
    return `${match[1]}B`;
  }
  return "Unknown";
}

/**
 * 从文件名检测版本号
 */
function detectVersion(filename: string): string {
  const match = filename.match(/[_-]v(\d+\.?\d*)/i);
  if (match) {
    return `v${match[1]}`;
  }
  return "";
}

/**
 * 识别模型并返回配置
 */
export function identifyModel(modelPath: string): ModelConfig | null {
  if (!modelPath) return null;

  const filename = modelPath.replace(/\\/g, "/").split("/").pop() || "";

  // 检测各项属性
  const quant = detectQuantType(filename);
  const params = detectParams(filename);
  const version = detectVersion(filename);

  // 判断是否为 Murasaki 官方模型
  const isMurasaki = filename.toLowerCase().includes("murasaki");

  // 构建显示名称
  let displayName: string;
  let description: string;

  if (isMurasaki) {
    displayName = `Murasaki ${params} ${version} (${quant})`.trim();
    description = `Murasaki 翻译器 ${quant} 量化版`;
  } else {
    displayName = filename.replace(/\.gguf$/i, "");
    description = `第三方模型 (${quant})`;
  }

  return {
    name: filename.toLowerCase().replace(/\.gguf$/i, ""),
    displayName,
    params,
    quant,
    ctxRecommended: 8192,
    ctxMax: 32768,
    gpuLayers: -1,
    description,
  };
}

/**
 * 获取模型显示名称
 */
export function getModelDisplayName(modelPath: string): string {
  const config = identifyModel(modelPath);
  if (config) return config.displayName;

  // 默认返回文件名
  const parts = modelPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || modelPath;
}

/**
 * 获取推荐配置
 * 注意：不设置 preset，由全局配置决定
 */
export function getRecommendedConfig(modelPath: string): {
  ctxSize: number;
  gpuLayers: number;
} {
  const config = identifyModel(modelPath);
  if (config) {
    return {
      ctxSize: config.ctxRecommended,
      gpuLayers: config.gpuLayers,
    };
  }

  // 默认配置
  return {
    ctxSize: 8192,
    gpuLayers: -1,
  };
}

/**
 * 检查是否为官方模型
 */
export function isOfficialModel(modelPath: string): boolean {
  if (!modelPath) return false;
  const filename = modelPath.toLowerCase();
  return filename.includes("murasaki");
}

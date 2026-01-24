/**
 * 模型配置 - Murasaki 翻译器官方模型配置
 * 通过文件名自动识别模型并返回推荐配置
 */

export interface ModelConfig {
    name: string           // 官方代号
    displayName: string    // 显示名称
    params: string         // 参数量
    quant: string          // 量化类型
    ctxRecommended: number // 推荐上下文长度
    ctxMax: number         // 最大上下文长度
    preset: string         // 推荐 Prompt 预设
    gpuLayers: number      // 推荐 GPU 层数 (-1 = 全部)
    description: string    // 描述
}

// 官方模型配置字典
const MODEL_CONFIGS: Record<string, ModelConfig> = {
    // Murasaki v0.1 系列 - Q4_K_M 量化
    "murasaki-8b-q4_k_m": {
        name: "murasaki-8b-v0.1-q4km",
        displayName: "Murasaki 8B v0.1 (Q4_K_M)",
        params: "8B",
        quant: "Q4_K_M",
        ctxRecommended: 8192,
        ctxMax: 16384,
        preset: "training",
        gpuLayers: -1,
        description: "Murasaki 翻译器 4-bit 量化版，适合 8GB+ VRAM"
    },
    // Murasaki v0.1 系列 - F16 全精度
    "murasaki-8b-f16": {
        name: "murasaki-8b-v0.1-f16",
        displayName: "Murasaki 8B v0.1 (F16)",
        params: "8B",
        quant: "F16",
        ctxRecommended: 8192,
        ctxMax: 16384,
        preset: "training",
        gpuLayers: -1,
        description: "Murasaki 翻译器 16-bit 全精度版，需要 16GB+ VRAM"
    }
}

// MD5 到模型配置的映射（用于精确识别）
// 计算方式：文件完整 MD5
const MODEL_MD5_MAP: Record<string, string> = {
    "5f0f364889e91b3ef49bf429901fb349": "murasaki-8b-q4_k_m",  // Murasaki-8B-Q4_K_M.gguf
    "269a5cee14190831de408a4954a43b35": "murasaki-8b-f16",      // Murasaki-8B-f16.gguf
}

/**
 * 识别模型并返回配置
 * @param modelPath 模型文件路径
 */
export function identifyModel(modelPath: string): ModelConfig | null {
    if (!modelPath) return null

    const filename = modelPath.toLowerCase()

    // 尝试通过文件名关键词匹配
    for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
        if (filename.includes(key.toLowerCase())) {
            return config
        }
    }

    // 特殊匹配：Murasaki 
    if (filename.includes("murasaki")) {
        // 检查量化类型
        if (filename.includes("f16") || filename.includes("fp16")) {
            return MODEL_CONFIGS["murasaki-8b-f16"]
        }
        // 默认返回 Q4_K_M 版本
        return MODEL_CONFIGS["murasaki-8b-q4_k_m"]
    }

    return null
}

/**
 * 获取模型显示名称
 */
export function getModelDisplayName(modelPath: string): string {
    const config = identifyModel(modelPath)
    if (config) return config.displayName

    // 默认返回文件名
    const parts = modelPath.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || modelPath
}

/**
 * 获取推荐配置
 */
export function getRecommendedConfig(modelPath: string): { ctxSize: number; preset: string; gpuLayers: number } {
    const config = identifyModel(modelPath)
    if (config) {
        return {
            ctxSize: config.ctxRecommended,
            preset: config.preset,
            gpuLayers: config.gpuLayers
        }
    }

    // 默认配置
    return {
        ctxSize: 8192,
        preset: "training",
        gpuLayers: -1
    }
}

/**
 * 检查是否为官方模型
 */
export function isOfficialModel(modelPath: string): boolean {
    return identifyModel(modelPath) !== null
}

/**
 * 通过 MD5 识别模型（需要后端计算）
 */
export function identifyModelByMd5(md5: string): ModelConfig | null {
    const configKey = MODEL_MD5_MAP[md5.toLowerCase()]
    if (configKey && MODEL_CONFIGS[configKey]) {
        return MODEL_CONFIGS[configKey]
    }
    return null
}

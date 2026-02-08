import packageInfo from "../../../../package.json";

// Official Links - 官方链接配置
export const APP_CONFIG = {
  // Application Info
  name: "Murasaki Translator",
  version: packageInfo.version,

  // Official Links
  officialRepo: "https://github.com/soundstarrain/Murasaki-Translator",
  projectRepo: "https://github.com/soundstarrain/Murasaki-project",
  feedbackEmail: "slimier.galls_9v@icloud.com",

  // Model Download Links - 模型下载地址
  modelDownload: {
    huggingfaceOrg: "Murasaki-Project",  // Organization name for auto-discovery
    huggingface: "https://huggingface.co/Murasaki-Project",  // Organization homepage
  },

  // Documentation
  docsUrl: "https://github.com/soundstarrain/Murasaki-Translator#readme",

  // Recommended Model
  recommendedModel: "Murasaki-8B-v0.2-Q4_K_M.gguf", // Updated to match actual model
} as const;

// User Tips - 用户提示文本
export const USER_TIPS = {
  zh: {
    modelRecommendation:
      "推荐使用官方 Murasaki 模型，配置已针对该模型专门优化。",
    resetOnError: '如遇到错误，请尝试在设置中"重置所有设置"后重试。',
    downloadModel: "尚未检测到模型，请先下载官方模型。",
    gpuOom:
      "如果出现显存不足 (OOM) 错误，请尝试降低上下文长度或使用 CPU 模式。",
    firstTimeSetup: "首次使用？请先在模型管理中下载并配置翻译模型。",
    warmupTip: "首次翻译前建议先进行预热，可加快后续翻译速度。",
  },
  en: {
    modelRecommendation:
      "We recommend using the official Murasaki model for best results.",
    resetOnError:
      'If you encounter errors, try "Reset All Settings" in Settings.',
    downloadModel:
      "No model detected. Please download the official model first.",
    gpuOom:
      "If you get OOM errors, try reducing context size or switching to CPU mode.",
    firstTimeSetup:
      "First time? Please download and configure a translation model first.",
    warmupTip:
      "We recommend warming up before your first translation for faster results.",
  },
  jp: {
    modelRecommendation:
      "最適な結果を得るには、公式の Murasaki モデルをお勧めします。",
    resetOnError:
      "エラーが発生した場合は、設定で「すべてリセット」をお試しください。",
    downloadModel:
      "モデルが検出されません。まず公式モデルをダウンロードしてください。",
    gpuOom:
      "OOM エラーが発生した場合は、コンテキストサイズを減らすか CPU モードをお試しください。",
    firstTimeSetup:
      "初めての方へ: まず翻訳モデルをダウンロードして設定してください。",
    warmupTip: "最初の翻訳前にウォームアップすることをお勧めします。",
  },
} as const;

export type Language = "zh" | "en" | "jp";

// Default Post-Processing Rules (matches RuleEditor post_novel preset)
// Used for system reset to ensure translation works immediately
export const DEFAULT_POST_RULES = [
  {
    id: "o1",
    type: "format",
    active: true,
    pattern: "ensure_double_newline",
    replacement: "",
    label: "强制双换行 (轻小说)",
  },
  {
    id: "o2",
    type: "format",
    active: true,
    pattern: "smart_quotes",
    replacement: "",
    label: "统一引号格式",
  },
] as const;

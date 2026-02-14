export interface FileConfig {
  // Model & Hardware
  model?: string;
  remoteModel?: string;
  gpuLayers?: number;
  ctxSize?: number;
  contextSize?: number; // Compatibility alias
  concurrency?: number;
  deviceMode?: "auto" | "cpu";
  gpuDeviceId?: string;

  // Translation Params
  temperature?: number;
  lineCheck?: boolean;
  lineToleranceAbs?: number;
  lineTolerancePct?: number;
  anchorCheck?: boolean;
  anchorCheckRetries?: number;
  strictMode?: string;
  repPenaltyBase?: number;
  repPenaltyMax?: number;
  repPenaltyStep?: number;
  maxRetries?: number;
  retryTempBoost?: number;
  retryPromptFeedback?: boolean;
  textProtect?: boolean;
  protectPatterns?: string;

  // Features
  alignmentMode?: boolean;
  saveCot?: boolean;
  rulesPreProfileId?: string;
  rulesPostProfileId?: string;
  flashAttn?: boolean;
  kvCacheType?: string;
  useLargeBatch?: boolean;
  physicalBatchSize?: number;
  coverageCheck?: boolean;
  outputHitThreshold?: number;
  cotCoverageThreshold?: number;
  coverageRetries?: number;
  resume?: boolean;
  daemonMode?: boolean;
  balanceEnable?: boolean;
  balanceThreshold?: number;
  balanceCount?: number;
  seed?: number;
  preset?: string;

  // System
  executionMode?: "local" | "remote";
  remoteSession?: {
    url: string;
    apiKey?: string;
    connectedAt: number;
    source?: "manual" | "local-daemon";
  };
  cacheDir?: string;
  outputDir?: string;
  glossaryPath?: string;
  useGlobalDefaults?: boolean;
}

export interface QueueItem {
  id: string;
  path: string;
  fileName: string;
  fileType: "txt" | "epub" | "srt" | "ass" | "ssa";
  addedAt: string;
  status: "pending" | "processing" | "completed" | "failed";
  config?: FileConfig;
  error?: string;
}

export const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const getFileType = (path: string): QueueItem["fileType"] => {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (["txt", "epub", "srt", "ass", "ssa"].includes(ext))
    return ext as QueueItem["fileType"];
  return "txt";
};

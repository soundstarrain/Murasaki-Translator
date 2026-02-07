export interface FileConfig {
  // Model & Hardware
  model?: string;
  gpuLayers?: number;
  ctxSize?: number;
  contextSize?: number; // Compatibility alias
  concurrency?: number;

  // Translation Params
  temperature?: number;
  lineCheck?: boolean;
  repPenaltyBase?: number;
  repPenaltyMax?: number;

  // Features
  alignmentMode?: boolean;
  saveCot?: boolean;
  flashAttn?: boolean;
  kvCacheType?: string;
  seed?: number;
  preset?: string;

  // System
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

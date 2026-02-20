/**
 * Window API Type Definitions
 * 统一定义 Electron preload 暴露的 API 接口类型
 */

export interface TranslationConfig {
  model: string;
  gpu: boolean;
  ctx: number;
  server: "embedded" | "external";
  preset: string;
  glossaryPath: string;
  inputPath: string;
  outputPath: string;
  cacheDir: string;
  traditional: boolean;
  rulesPrePath: string;
  rulesPostPath: string;
  temperature: number;
  lineCheck: boolean;
  lineToleranceAbs: number;
  lineTolerancePct: number;
  chunkMode?: "chunk" | "line";
  anchorCheck: boolean;
  anchorCheckRetries: number;
  saveCot: boolean;
  saveSummary: boolean;
  deviceMode: "auto" | "cpu" | "gpu" | "rocm";
  gpuDeviceId: number;
  repPenaltyBase: number;
  repPenaltyMax: number;
  repPenaltyStep: number;
  maxRetries: number;
  coverageCheck: boolean;
  outputHitThreshold: number;
  cotCoverageThreshold: number;
  coverageRetries: number;
}

export interface ServerStatus {
  running: boolean;
  pid?: number | null;
  port: number;
  host?: string;
  endpoint?: string;
  localEndpoint?: string;
  lanEndpoints?: string[];
  model?: string;
  mode?: "api_v1";
  authEnabled?: boolean;
  apiKeyHint?: string;
  deviceMode?: string;
  uptime?: number;
  logs?: string[];
}

export interface WarmupResult {
  success: boolean;
  durationMs?: number;
  error?: string;
}

export interface ModelInfo {
  name: string;
  path: string;
  size?: number;
  quantization?: string;
}

export interface TranslationProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface CacheBlock {
  index: number;
  src: string;
  dst: string;
  status: "none" | "processed" | "edited";
  warnings: string[];
  cot: string;
  srcLines: number;
  dstLines: number;
}

export interface CacheData {
  version: string;
  outputPath: string;
  modelName: string;
  glossaryPath: string;
  stats: {
    blockCount: number;
    srcLines: number;
    dstLines: number;
    srcChars: number;
    dstChars: number;
  };
  blocks: CacheBlock[];
}

export interface WatchFolderConfig {
  id: string;
  path: string;
  includeSubdirs: boolean;
  fileTypes: string[];
  enabled: boolean;
  createdAt?: string;
}

export interface WatchFolderEntry {
  config: WatchFolderConfig;
  active: boolean;
}

export type Unsubscribe = () => void;

export interface ProcessExitPayload {
  code: number | null;
  signal: string | null;
  stopRequested: boolean;
  runId?: string;
}

export type RemoteErrorCode =
  | "REMOTE_NETWORK"
  | "REMOTE_TIMEOUT"
  | "REMOTE_UNAUTHORIZED"
  | "REMOTE_PROTOCOL"
  | "REMOTE_NOT_FOUND"
  | "REMOTE_UNKNOWN";

export interface RemoteApiResponse<T = any> {
  ok: boolean;
  code?: RemoteErrorCode;
  message?: string;
  technicalMessage?: string;
  actionHint?: string;
  retryable?: boolean;
  statusCode?: number;
  data?: T;
}

export interface RemoteSessionInfo {
  url: string;
  apiKey?: string;
  connectedAt: number;
  source?: "manual" | "local-daemon";
}

export interface RemoteRuntimeStatus {
  connected: boolean;
  executionMode: "local" | "remote";
  session?: RemoteSessionInfo | null;
  fileScope?: "shared-local" | "isolated-remote";
  outputPolicy?: "same-dir" | "scoped-remote-dir";
  downgraded?: boolean;
  authRequired?: boolean;
  capabilities?: string[];
  status?: string;
  modelLoaded?: boolean;
  currentModel?: string;
  activeTasks?: number;
  version?: string;
  lastCheckedAt?: number;
  notice: string;
  syncMirrorPath: string;
  networkEventLogPath: string;
}

export interface RemoteNetworkEvent {
  timestamp: number;
  kind: "connection" | "http" | "upload" | "download" | "retry" | "ws";
  phase: "start" | "success" | "error" | "open" | "close" | "message";
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  attempt?: number;
  message?: string;
}

export interface RemoteNetworkStatus {
  connected: boolean;
  executionMode: "local" | "remote";
  session: RemoteSessionInfo | null;
  fileScope?: "shared-local" | "isolated-remote";
  outputPolicy?: "same-dir" | "scoped-remote-dir";
  wsConnected: boolean;
  inFlightRequests: number;
  totalEvents: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  uploadCount: number;
  downloadCount: number;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
  lastStatusCode?: number;
  lastEventAt?: number;
  lastError?: {
    at: number;
    kind: "connection" | "http" | "upload" | "download" | "retry" | "ws";
    message: string;
    path?: string;
    statusCode?: number;
  };
  notice: string;
  syncMirrorPath: string;
  networkEventLogPath: string;
  lastSyncAt?: number;
}

export interface RemoteDiagnostics {
  executionMode: "local" | "remote";
  connected: boolean;
  session: RemoteSessionInfo | null;
  healthFailures: number;
  activeTaskId: string | null;
  syncMirrorPath: string;
  networkEventLogPath: string;
  notice: string;
  network: RemoteNetworkStatus;
  lastSyncAt?: number | null;
}

export interface RemoteHfDownloadStatus {
  status:
    | "starting"
    | "checking"
    | "connecting"
    | "downloading"
    | "resuming"
    | "complete"
    | "skipped"
    | "error"
    | "cancelled";
  percent: number;
  speed?: string;
  downloaded?: string;
  total?: string;
  filePath?: string;
  error?: string;
}

export interface ElectronAPI {
  // Model Management
  getModels: () => Promise<string[]>;
  getModelsPath: () => Promise<string>;
  getGlossaries: () => Promise<string[]>;
  readGlossaryFile: (filename: string) => Promise<string | null>;
  saveGlossaryFile: (data: {
    filename: string;
    content: string;
  }) => Promise<boolean>;
  deleteGlossaryFile: (filename: string) => Promise<boolean>;
  renameGlossaryFile: (
    oldName: string,
    newName: string,
  ) => Promise<{ success: boolean; error?: string }>;
  openGlossaryFolder: () => Promise<void>;
  createGlossaryFile: (
    arg: string | { filename: string; content?: string },
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  getModelInfo: (modelName: string) => Promise<any>;

  // File Operations
  selectFile: (options?: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;
  selectFiles: () => Promise<string[]>;
  selectFolderFiles: () => Promise<string[]>;
  readFile: (path: string) => Promise<string | null>;
  selectDirectory: (options?: {
    title?: string;
    defaultPath?: string;
  }) => Promise<string | null>;
  selectFolder: (options?: {
    title?: string;
    defaultPath?: string;
  }) => Promise<string | null>;
  scanDirectory: (path: string, recursive?: boolean) => Promise<string[]>;
  openPath: (filePath: string) => Promise<string>;
  openFolder: (folderPath: string) => Promise<boolean>;
  writeFile: (path: string, content: string) => Promise<boolean>;
  writeFileVerbose: (
    path: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  saveFile: (options: any) => Promise<string | null>;
  importGlossary: (
    sourcePath: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  checkOutputFileExists: (
    inputFile: string,
    config: any,
  ) => Promise<{ exists: boolean; path?: string; isCache?: boolean }>;

  // Cache Operations
  loadCache: (path: string) => Promise<any>;
  saveCache: (path: string, data: any) => Promise<boolean>;
  rebuildDoc: (options: {
    cachePath: string;
    outputPath?: string;
  }) => Promise<{ success: boolean; error?: string }>;

  // Translation Process
  startTranslation: (
    inputPath: string,
    modelPath: string,
    config: any,
    runId?: string,
  ) => void;
  pipelineV2ProfilesPath: () => Promise<string>;
  pipelineV2ProfilesList: (
    kind: string,
  ) => Promise<
    { id: string; name: string; filename: string; chunk_type?: string }[]
  >;
  pipelineV2ProfilesLoad: (
    kind: string,
    id: string,
  ) => Promise<{ id: string; name: string; yaml: string; data: any } | null>;
  pipelineV2ProfilesLoadBatch: (
    kind: string,
    ids: string[],
  ) => Promise<Array<{ id: string; result: any | null }>>;
  pipelineV2ProfilesSave: (
    kind: string,
    id: string,
    yamlText: string,
    options?: { allowOverwrite?: boolean },
  ) => Promise<{
    ok: boolean;
    id?: string;
    error?: string;
    warnings?: string[];
  }>;
  pipelineV2ProfilesDelete: (
    kind: string,
    id: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  pipelineV2ApiTest: (payload: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    model?: string;
  }) => Promise<{
    ok: boolean;
    status?: number;
    latencyMs?: number;
    url?: string;
    message?: string;
    modelCount?: number;
  }>;
  pipelineV2ApiModels: (payload: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
  }) => Promise<{
    ok: boolean;
    status?: number;
    url?: string;
    message?: string;
    models?: string[];
  }>;
  pipelineV2ApiConcurrencyTest: (payload: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    maxConcurrency?: number;
  }) => Promise<{
    ok: boolean;
    maxConcurrency?: number;
    url?: string;
    message?: string;
    statusCounts?: Record<string, number>;
    latencyMs?: number;
  }>;
  pipelineV2Run: (payload: {
    filePath: string;
    pipelineId: string;
    profilesDir: string;
    outputPath?: string;
    rulesPrePath?: string;
    rulesPostPath?: string;
    glossaryPath?: string;
    sourceLang?: string;
    enableQuality?: boolean;
    textProtect?: boolean;
  }) => Promise<{ ok: boolean; runId: string; code?: number; error?: any }>;
  stopTranslation: () => void;
  retranslateBlock: (options: {
    src: string;
    index: number;
    modelPath: string;
    config: any;
  }) => Promise<any>;
  onLogUpdate: (callback: (chunk: string) => void) => Unsubscribe;
  onPipelineV2Log: (
    callback: (data: {
      runId: string;
      message: string;
      level?: string;
    }) => void,
  ) => Unsubscribe;
  onProcessExit: (
    callback: (payload: ProcessExitPayload) => void,
  ) => Unsubscribe;

  // Retranslate Progress
  onRetranslateLog: (
    callback: (data: {
      index: number;
      text: string;
      isError?: boolean;
    }) => void,
  ) => Unsubscribe;

  // Environment Fix Progress
  onEnvFixProgress: (
    callback: (data: {
      component: string;
      stage: string;
      progress: number;
      message: string;
      totalBytes?: number;
      downloadedBytes?: number;
    }) => void,
  ) => Unsubscribe;

  // Server Management
  serverStatus: () => Promise<ServerStatus>;
  serverStart: (config: {
    model: string;
    port?: number;
    host?: string;
    apiKey?: string;
    gpuLayers?: string | number;
    ctxSize?: string | number;
    concurrency?: number;
    flashAttn?: boolean;
    kvCacheType?: string;
    autoKvSwitch?: boolean;
    useLargeBatch?: boolean;
    physicalBatchSize?: number;
    seed?: number;
    deviceMode?: "auto" | "cpu";
    gpuDeviceId?: number | string;
    preset?: string;
    gpu?: boolean;
    autoConnectRemote?: boolean;
  }) => Promise<{
    success: boolean;
    error?: string;
    selectedPort?: number;
    requestedPort?: number;
    portChanged?: boolean;
    host?: string;
    endpoint?: string;
    localEndpoint?: string;
    lanEndpoints?: string[];
    apiKey?: string;
    remoteConnected?: boolean;
    autoRemoteSkipped?: boolean;
    source?: "local-daemon";
    executionMode?: "local" | "remote";
    remoteError?: RemoteApiResponse;
  }>;
  serverStop: () => Promise<boolean>;
  serverLogs: () => Promise<string[]>;
  serverWarmup: () => Promise<WarmupResult>;

  // Update
  checkUpdate: () => Promise<any>;

  // System Diagnostics
  getSystemDiagnostics: () => Promise<{
    os: {
      platform: string;
      release: string;
      arch: string;
      cpuCores: number;
      totalMem: string;
    };
    gpu: { name: string; driver?: string; vram?: string } | null;
    python: { version: string; path: string } | null;
    cuda: { version: string; available: boolean } | null;
    vulkan: { available: boolean; version?: string; devices?: string[] } | null;
    llamaServer: {
      status: "online" | "offline" | "unknown";
      port?: number;
      model?: string;
    };
  }>;

  // Environment Fixer
  checkEnvComponent: (
    component:
      | "Python"
      | "CUDA"
      | "Vulkan"
      | "LlamaBackend"
      | "Middleware"
      | "Permissions",
  ) => Promise<{
    success: boolean;
    report?: {
      system: { platform: string; arch: string };
      components: Array<{
        name: string;
        status: "ok" | "warning" | "error";
        version: string | null;
        path: string | null;
        issues: string[];
        fixes: string[];
        canAutoFix: boolean;
      }>;
      summary: {
        totalIssues: number;
        totalErrors: number;
        totalWarnings: number;
        overallStatus: string;
      };
    };
    component?: {
      name: string;
      status: "ok" | "warning" | "error";
      version: string | null;
      path: string | null;
      issues: string[];
      fixes: string[];
      canAutoFix: boolean;
    };
    error?: string;
  }>;
  fixEnvComponent: (
    component:
      | "Python"
      | "CUDA"
      | "Vulkan"
      | "LlamaBackend"
      | "Middleware"
      | "Permissions",
  ) => Promise<{
    success: boolean;
    message: string;
    exitCode?: number;
    output?: string;
    errorOutput?: string;
  }>;

  // System
  showNotification: (title: string, body: string) => void;
  setTheme: (theme: "dark" | "light") => void;
  openExternal: (url: string) => void;
  getHardwareSpecs: () => Promise<{
    cpuUsage: number;
    memUsage: number;
    gpuUsage?: number;
    gpuMemUsage?: number;
    gpuTemp?: number;
  }>;

  // Debug Export
  readServerLog: () => Promise<{
    exists: boolean;
    path?: string;
    lineCount?: number;
    content?: string;
    truncated?: boolean;
    error?: string;
  }>;
  getMainProcessLogs: () => Promise<string[]>;
  readTextTail: (
    path: string,
    options?: { maxBytes?: number; lineCount?: number },
  ) => Promise<{
    exists: boolean;
    path?: string;
    lineCount?: number;
    content?: string;
    truncated?: boolean;
    error?: string;
  }>;

  // Watch Folder
  watchFolderAdd: (
    config: WatchFolderConfig,
  ) => Promise<{ ok: boolean; error?: string }>;
  watchFolderToggle: (
    id: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  watchFolderRemove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  watchFolderList: () => Promise<{
    ok: boolean;
    entries?: WatchFolderEntry[];
    error?: string;
  }>;
  onWatchFolderFileAdded: (
    callback: (payload: {
      watchId: string;
      path: string;
      addedAt: string;
    }) => void,
  ) => Unsubscribe;

  // Rule System
  testRules: (
    text: string,
    rules: any[],
  ) => Promise<{
    success: boolean;
    steps: { label: string; text: string; changed?: boolean; error?: string }[];
    error?: string;
  }>;

  // Term Extraction
  extractTerms: (options: {
    filePath?: string;
    text?: string;
    topK?: number;
  }) => Promise<any>;
  onTermExtractProgress: (callback: (progress: number) => void) => Unsubscribe;

  // Remote Server
  remoteConnect: (config: {
    url: string;
    apiKey?: string;
  }) => Promise<RemoteApiResponse>;
  remoteDisconnect: () => Promise<RemoteApiResponse>;
  remoteStatus: () => Promise<RemoteApiResponse<RemoteRuntimeStatus>>;
  remoteModels: () => Promise<RemoteApiResponse<any[]>>;
  remoteGlossaries: () => Promise<RemoteApiResponse<any[]>>;
  remoteNetworkStatus: () => Promise<RemoteApiResponse<RemoteNetworkStatus>>;
  remoteNetworkEvents: (
    limit?: number,
  ) => Promise<RemoteApiResponse<RemoteNetworkEvent[]>>;
  remoteDiagnostics: () => Promise<RemoteApiResponse<RemoteDiagnostics>>;
  remoteHfCheckNetwork: () => Promise<
    RemoteApiResponse<{ status: string; message?: string }>
  >;
  remoteHfListRepos: (orgName: string) => Promise<RemoteApiResponse<any>>;
  remoteHfListFiles: (repoId: string) => Promise<RemoteApiResponse<any>>;
  remoteHfDownloadStart: (
    repoId: string,
    fileName: string,
    mirror?: string,
  ) => Promise<RemoteApiResponse<{ downloadId: string }>>;
  remoteHfDownloadStatus: (
    downloadId: string,
  ) => Promise<RemoteApiResponse<RemoteHfDownloadStatus>>;
  remoteHfDownloadCancel: (
    downloadId: string,
  ) => Promise<RemoteApiResponse<{ ok: boolean }>>;

  // HuggingFace Download
  hfListRepos: (orgName: string) => Promise<any>;
  hfListFiles: (repoId: string) => Promise<any>;
  hfDownloadStart: (
    repoId: string,
    fileName: string,
    mirror?: string,
  ) => Promise<any>;
  hfDownloadCancel: () => Promise<any>;
  onHfDownloadProgress: (callback: (data: any) => void) => Unsubscribe;
  onHfDownloadError: (callback: (data: any) => void) => Unsubscribe;
  hfVerifyModel: (orgName: string, filePath: string) => Promise<any>;
  hfCheckNetwork: () => Promise<any>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

export {};

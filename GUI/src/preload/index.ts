import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

type Unsubscribe = () => void;
type ProcessExitPayload = {
  code: number | null;
  signal: string | null;
  stopRequested: boolean;
  runId?: string;
};

const listenerRegistry = new Map<string, Set<(...args: any[]) => void>>();

const addIpcListener = <T>(
  channel: string,
  callback: (payload: T) => void,
): Unsubscribe => {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  if (!listenerRegistry.has(channel)) {
    listenerRegistry.set(channel, new Set());
  }
  listenerRegistry.get(channel)?.add(listener);
  return () => {
    ipcRenderer.off(channel, listener);
    const listeners = listenerRegistry.get(channel);
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      listenerRegistry.delete(channel);
    }
  };
};

// Custom APIs for renderer
const api = {
  selectFile: (options?: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => ipcRenderer.invoke("select-file", options),
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectFolderFiles: () => ipcRenderer.invoke("select-folder-files"),
  selectDirectory: (options?: { title?: string; defaultPath?: string }) =>
    ipcRenderer.invoke("select-directory", options),
  selectFolder: (options?: { title?: string; defaultPath?: string }) =>
    ipcRenderer.invoke("select-directory", options),
  scanDirectory: (path: string, recursive: boolean = false) =>
    ipcRenderer.invoke("scan-directory", path, recursive),
  getModels: () => ipcRenderer.invoke("get-models"),
  getModelsPath: () => ipcRenderer.invoke("get-models-path"),
  getModelInfo: (modelName: string) =>
    ipcRenderer.invoke("get-model-info", modelName),
  startTranslation: (
    inputFile: string,
    modelPath: string,
    config: any,
    runId?: string,
  ) =>
    ipcRenderer.send("start-translation", {
      inputFile,
      modelPath,
      config,
      runId,
    }),
  pipelineV2ProfilesPath: () => ipcRenderer.invoke("pipelinev2-profiles-path"),
  pipelineV2ProfilesList: (
    kind: string,
    options?: { preferLocal?: boolean },
  ) => ipcRenderer.invoke("pipelinev2-profiles-list", kind, options),
  pipelineV2ProfilesLoad: (kind: string, id: string) =>
    ipcRenderer.invoke("pipelinev2-profiles-load", kind, id),
  pipelineV2ProfilesLoadBatch: (kind: string, ids: string[]) =>
    ipcRenderer.invoke("pipelinev2-profiles-load-batch", kind, ids),
  pipelineV2ProfilesSave: (
    kind: string,
    id: string,
    yamlText: string,
    options?: { allowOverwrite?: boolean },
  ) =>
    ipcRenderer.invoke("pipelinev2-profiles-save", kind, id, yamlText, options),
  pipelineV2ProfilesDelete: (kind: string, id: string) =>
    ipcRenderer.invoke("pipelinev2-profiles-delete", kind, id),
  pipelineV2ApiTest: (payload: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    model?: string;
  }) => ipcRenderer.invoke("pipelinev2-api-test", payload),
  pipelineV2ApiModels: (payload: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
  }) => ipcRenderer.invoke("pipelinev2-api-models", payload),
  pipelineV2ApiConcurrencyTest: (payload: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    maxConcurrency?: number;
    model?: string;
  }) => ipcRenderer.invoke("pipelinev2-api-concurrency-test", payload),
  pipelineV2Run: (payload: {
    filePath: string;
    pipelineId: string;
    profilesDir: string;
    outputPath?: string;
    outputDir?: string;
    rulesPrePath?: string;
    rulesPostPath?: string;
    glossaryPath?: string;
    sourceLang?: string;
    enableQuality?: boolean;
    textProtect?: boolean;
    resume?: boolean;
    cacheDir?: string;
    saveCache?: boolean;
    runId?: string;
  }) => ipcRenderer.invoke("pipelinev2-run", payload),
  pipelineV2Stop: () => ipcRenderer.send("stop-pipelinev2"),
  getHardwareSpecs: () => ipcRenderer.invoke("get-hardware-specs"),
  stopTranslation: () => ipcRenderer.send("stop-translation"),
  getGlossaries: () => ipcRenderer.invoke("get-glossaries"),
  createGlossaryFile: (arg: string | { filename: string; content?: string }) =>
    ipcRenderer.invoke("create-glossary-file", arg),
  importGlossary: (sourcePath: string) =>
    ipcRenderer.invoke("import-glossary", sourcePath),
  checkOutputFileExists: (inputFile: string, config: any) =>
    ipcRenderer.invoke("check-output-file-exists", { inputFile, config }),
  openGlossaryFolder: () => ipcRenderer.invoke("open-glossary-folder"),
  readFile: (path: string) => ipcRenderer.invoke("read-file", path),
  showNotification: (title: string, body: string) =>
    ipcRenderer.send("show-notification", { title, body }),
  onLogUpdate: (callback: (log: string) => void) =>
    addIpcListener("log-update", callback),
  onPipelineV2Log: (callback: (data: any) => void) =>
    addIpcListener("pipelinev2-log", callback),
  onProcessExit: (callback: (payload: ProcessExitPayload) => void) =>
    addIpcListener("process-exit", (payload: any) => {
      if (typeof payload === "number" || payload === null) {
        callback({ code: payload, signal: null, stopRequested: false });
        return;
      }
      callback({
        code:
          typeof payload?.code === "number" || payload?.code === null
            ? payload.code
            : null,
        signal:
          typeof payload?.signal === "string" || payload?.signal === null
            ? payload.signal
            : null,
        stopRequested: Boolean(payload?.stopRequested),
      });
    }),

  pipelineV2SandboxTest: (payload: {
    text: string;
    pipeline: Record<string, any>;
  }) => ipcRenderer.invoke("pipelinev2-sandbox-test", payload),

  // Glossary Management
  readGlossaryFile: (filename: string) =>
    ipcRenderer.invoke("read-glossary-file", filename),
  saveGlossaryFile: (data: { filename: string; content: string }) =>
    ipcRenderer.invoke("save-glossary-file", data),
  deleteGlossaryFile: (filename: string) =>
    ipcRenderer.invoke("delete-glossary-file", filename),
  renameGlossaryFile: (oldName: string, newName: string) =>
    ipcRenderer.invoke("rename-glossary-file", { oldName, newName }),
  openPath: (filePath: string) => ipcRenderer.invoke("open-path", filePath),
  openFolder: (folderPath: string) =>
    ipcRenderer.invoke("open-folder", folderPath),

  // 校对界面相关 API
  loadCache: (cachePath: string) => ipcRenderer.invoke("load-cache", cachePath),
  saveCache: (cachePath: string, data: any) =>
    ipcRenderer.invoke("save-cache", cachePath, data),
  rebuildDoc: (options: { cachePath: string; outputPath?: string }) =>
    ipcRenderer.invoke("rebuild-doc", options),
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke("write-file", path, content),
  writeFileVerbose: (path: string, content: string) =>
    ipcRenderer.invoke("write-file-verbose", path, content),
  saveFile: (options: any) => ipcRenderer.invoke("save-file", options),
  retranslateBlock: (options: any) =>
    ipcRenderer.invoke("retranslate-block", options),

  // Watch Folder
  watchFolderAdd: (config: any) =>
    ipcRenderer.invoke("watch-folder-add", config),
  watchFolderToggle: (id: string, enabled: boolean) =>
    ipcRenderer.invoke("watch-folder-toggle", { id, enabled }),
  watchFolderRemove: (id: string) =>
    ipcRenderer.invoke("watch-folder-remove", id),
  watchFolderList: () => ipcRenderer.invoke("watch-folder-list"),
  onWatchFolderFileAdded: (
    callback: (payload: {
      watchId: string;
      path: string;
      addedAt: string;
    }) => void,
  ) => addIpcListener("watch-folder-file-added", callback),

  // Server Manager
  serverStatus: () => ipcRenderer.invoke("server-status"),
  serverStart: (config: any) => ipcRenderer.invoke("server-start", config),
  serverStop: () => ipcRenderer.invoke("server-stop"),
  serverLogs: () => ipcRenderer.invoke("server-logs"),
  serverWarmup: () => ipcRenderer.invoke("server-warmup"),

  // Update System
  checkUpdate: () => ipcRenderer.invoke("check-update"),

  // System Diagnostics
  getSystemDiagnostics: () => ipcRenderer.invoke("get-system-diagnostics"),
  checkEnvComponent: (
    component:
      | "Python"
      | "CUDA"
      | "Vulkan"
      | "LlamaBackend"
      | "Middleware"
      | "Permissions",
  ) => ipcRenderer.invoke("check-env-component", component),
  fixEnvComponent: (
    component:
      | "Python"
      | "CUDA"
      | "Vulkan"
      | "LlamaBackend"
      | "Middleware"
      | "Permissions",
  ) => ipcRenderer.invoke("fix-env-component", component),

  // Env Fix Progress
  onEnvFixProgress: (
    callback: (data: {
      component: string;
      stage: string;
      progress: number;
      message: string;
      totalBytes?: number;
      downloadedBytes?: number;
    }) => void,
  ) => addIpcListener("env-fix-progress", callback),

  // Debug Export
  readServerLog: () => ipcRenderer.invoke("read-server-log"),
  getMainProcessLogs: () => ipcRenderer.invoke("get-main-process-logs"),
  readTextTail: (
    path: string,
    options?: { maxBytes?: number; lineCount?: number },
  ) => ipcRenderer.invoke("read-text-tail", path, options),

  // Theme Sync (for Windows title bar)
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("set-theme", theme),

  // External Links
  openExternal: (url: string) => ipcRenderer.send("open-external", url),

  // Rule System
  testRules: (text: string, rules: any[]) =>
    ipcRenderer.invoke("test-rules", { text, rules }),

  // Retranslate Progress
  onRetranslateLog: (
    callback: (data: {
      index: number;
      text: string;
      isError?: boolean;
    }) => void,
  ) => addIpcListener("retranslate-log", callback),

  // Term Extraction
  extractTerms: (options: {
    filePath?: string;
    text?: string;
    topK?: number;
  }) => ipcRenderer.invoke("extract-terms", options),
  onTermExtractProgress: (callback: (progress: number) => void) =>
    addIpcListener("term-extract-progress", callback),

  // Remote Server
  remoteConnect: (config: { url: string; apiKey?: string }) =>
    ipcRenderer.invoke("remote-connect", config),
  remoteDisconnect: () => ipcRenderer.invoke("remote-disconnect"),
  remoteStatus: () => ipcRenderer.invoke("remote-status"),
  remoteModels: () => ipcRenderer.invoke("remote-models"),
  remoteGlossaries: () => ipcRenderer.invoke("remote-glossaries"),
  remoteNetworkStatus: () => ipcRenderer.invoke("remote-network-status"),
  remoteNetworkEvents: (limit?: number) =>
    ipcRenderer.invoke("remote-network-events", limit),
  remoteDiagnostics: () => ipcRenderer.invoke("remote-diagnostics"),
  remoteHfCheckNetwork: () => ipcRenderer.invoke("remote-hf-check-network"),
  remoteHfListRepos: (orgName: string) =>
    ipcRenderer.invoke("remote-hf-list-repos", orgName),
  remoteHfListFiles: (repoId: string) =>
    ipcRenderer.invoke("remote-hf-list-files", repoId),
  remoteHfDownloadStart: (
    repoId: string,
    fileName: string,
    mirror: string = "direct",
  ) => ipcRenderer.invoke("remote-hf-download-start", repoId, fileName, mirror),
  remoteHfDownloadStatus: (downloadId: string) =>
    ipcRenderer.invoke("remote-hf-download-status", downloadId),
  remoteHfDownloadCancel: (downloadId: string) =>
    ipcRenderer.invoke("remote-hf-download-cancel", downloadId),

  // HuggingFace Download
  hfListRepos: (orgName: string) =>
    ipcRenderer.invoke("hf-list-repos", orgName),
  hfListFiles: (repoId: string) => ipcRenderer.invoke("hf-list-files", repoId),
  hfDownloadStart: (
    repoId: string,
    fileName: string,
    mirror: string = "direct",
  ) => ipcRenderer.invoke("hf-download-start", repoId, fileName, mirror),
  hfDownloadCancel: () => ipcRenderer.invoke("hf-download-cancel"),
  onHfDownloadProgress: (callback: (data: any) => void) =>
    addIpcListener("hf-download-progress", callback),
  onHfDownloadError: (callback: (data: any) => void) =>
    addIpcListener("hf-download-error", callback),
  hfVerifyModel: (orgName: string, filePath: string) =>
    ipcRenderer.invoke("hf-verify-model", orgName, filePath),
  hfCheckNetwork: () => ipcRenderer.invoke("hf-check-network"),
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}

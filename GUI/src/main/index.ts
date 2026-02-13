import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Notification,
  nativeTheme,
} from "electron";
import { join, basename, resolve, relative, isAbsolute, dirname } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import { ServerManager } from "./serverManager";
import { getLlamaServerPath, detectPlatform, clearGpuCache } from "./platform";
import { TranslateOptions } from "./remoteClient";

let pythonProcess: ChildProcess | null = null;
let translationStopRequested = false;
let remoteTranslationBridge: {
  client: any;
  taskId: string;
  cancelRequested: boolean;
} | null = null;
let mainWindow: BrowserWindow | null = null;
let hardwareSpecsInFlight: Promise<any> | null = null;
let hardwareSpecsCache:
  | {
    at: number;
    data: any;
  }
  | null = null;
const HARDWARE_SPECS_CACHE_TTL_MS = 12000;
let envCheckInFlight: Promise<
  | { ok: true; report: any }
  | { ok: false; error: string; output?: string; errorOutput?: string }
> | null = null;
let envCheckCache:
  | {
    at: number;
    report: any;
  }
  | null = null;
const ENV_CHECK_CACHE_TTL_MS = 12000;

// 主进程日志缓冲区 - 用于调试工具箱查看完整终端日志
const mainProcessLogs: string[] = [];
const MAX_MAIN_LOGS = 1000;

// Hook console methods and collect main-process logs
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) return "[Circular]";
        seen.add(currentValue);
      }
      if (typeof currentValue === "bigint") return currentValue.toString();
      return currentValue;
    });
  } catch {
    try {
      return String(value);
    } catch {
      return "[Unserializable]";
    }
  }
};

const addMainLog = (level: string, ...args: unknown[]) => {
  const timestamp = new Date().toISOString().slice(11, 23);
  const message = args
    .map((a) => (typeof a === "object" ? safeStringify(a) : String(a)))
    .join(" ");
  mainProcessLogs.push(`[${timestamp}] [${level}] ${message}`);
  if (mainProcessLogs.length > MAX_MAIN_LOGS) {
    mainProcessLogs.shift();
  }
};

console.log = (...args) => {
  addMainLog("LOG", ...args);
  originalConsoleLog(...args);
};
console.warn = (...args) => {
  addMainLog("WARN", ...args);
  originalConsoleWarn(...args);
};
console.error = (...args) => {
  addMainLog("ERROR", ...args);
  originalConsoleError(...args);
};

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running
  console.log("[App] Another instance is already running. Exiting...");
  app.quit();
} else {
  // Focus existing window when a second instance is launched
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  // Theme will be synced from renderer via IPC

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 900,
    minWidth: 1300,
    minHeight: 900,
    show: false,
    autoHideMenuBar: true,
    title: "Murasaki Translator",
    icon: join(__dirname, "../../resources/icon.png"),
    backgroundColor: "#0a0a0f", // Match app dark background
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Allow manual F12 toggle
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" && input.type === "keyDown") {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

/**
 * 清理所有子进程
 */
function cleanupProcesses(): void {
  console.log("[App] Cleaning up processes...");

  // 停止翻译进程
  if (pythonProcess) {
    try {
      pythonProcess.kill();
      if (process.platform === "win32" && pythonProcess.pid) {
        spawn("taskkill", ["/pid", pythonProcess.pid.toString(), "/f", "/t"]);
      }
    } catch (e) {
      console.error("[App] Error killing python process:", e);
    }
    pythonProcess = null;
  }

  // 停止 ServerManager 管理的 llama-server
  try {
    ServerManager.getInstance().stop();
  } catch (e) {
    console.error("[App] Error stopping server:", e);
  }

  if (remoteTranslationBridge) {
    const bridge = remoteTranslationBridge;
    remoteTranslationBridge = null;
    void bridge.client.cancelTask(bridge.taskId).catch(() => undefined);
  }
}

/**
 * 清理临时文件目录（启动时调用，防止残留）
 */
function cleanupTempDirectory(): void {
  try {
    const tempDir = join(getUserDataPath(), "temp");
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try {
          fs.unlinkSync(join(tempDir, file));
        } catch (_) { }
      }
      console.log(`[App] Cleaned ${files.length} temp files`);
    }
  } catch (e) {
    console.error("[App] Temp cleanup error:", e);
  }

  try {
    const middlewareDir = getMiddlewarePath();
    if (fs.existsSync(middlewareDir)) {
      const files = fs.readdirSync(middlewareDir);
      for (const file of files) {
        if (!/^temp_rules_(pre|post)_[\w-]+\.json$/i.test(file)) continue;
        try {
          fs.unlinkSync(join(middlewareDir, file));
        } catch { }
      }
    }
  } catch (e) {
    console.error("[App] Legacy temp rule cleanup error:", e);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Clean up any residual temp files from crashed sessions
  cleanupTempDirectory();

  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 应用退出前清理资源
app.on("before-quit", () => {
  cleanupProcesses();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  cleanupProcesses();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// --- Custom Logic ---

// Helper to find middleware path
const getMiddlewarePath = () => {
  // In dev: project/GUI/out/main -> project/llm/middleware
  if (is.dev) {
    return join(__dirname, "../../../middleware");
  }
  // In prod: resources/middleware
  return join(process.resourcesPath, "middleware");
};

// Helper to find python executable or bundled engine
const getPythonPath = (): { type: "python" | "bundle"; path: string } => {
  if (is.dev) {
    return {
      type: "python",
      path: process.env.ELECTRON_PYTHON_PATH || getScriptPythonPath(),
    };
  }

  // In prod: platform-specific Python path
  if (process.platform === "win32") {
    // Windows: resources/python_env/python.exe (Embeddable)
    const embeddedPath = join(process.resourcesPath, "python_env", "python.exe");
    return {
      type: "python",
      path: fs.existsSync(embeddedPath) ? embeddedPath : getScriptPythonPath(),
    };
  } else {
    // macOS/Linux: Check for PyInstaller bundle first
    const bundlePath = join(
      process.resourcesPath,
      "middleware",
      "bin",
      "python-bundle",
      "murasaki-engine",
    );
    if (fs.existsSync(bundlePath)) {
      return { type: "bundle", path: bundlePath };
    }
    // Fallback to script-capable Python resolver
    return { type: "python", path: getScriptPythonPath() };
  }
};

// Helper to find a script-capable Python runtime (used by utility scripts like env_fixer/get_specs)
const getScriptPythonPath = (): string => {
  const middlewarePath = getMiddlewarePath();
  const middlewarePythonCandidates =
    process.platform === "win32"
      ? [
        join(middlewarePath, ".venv", "Scripts", "python.exe"),
        join(middlewarePath, "python_env", "python.exe"),
      ]
      : [
        join(middlewarePath, ".venv", "bin", "python3"),
        join(middlewarePath, ".venv", "bin", "python"),
        join(middlewarePath, "python_env", "bin", "python3"),
        join(middlewarePath, "python_env", "bin", "python"),
        join(middlewarePath, "python_env", "python3"),
        join(middlewarePath, "python_env", "python"),
      ];

  if (is.dev) {
    if (process.env.ELECTRON_PYTHON_PATH)
      return process.env.ELECTRON_PYTHON_PATH;
    for (const candidate of middlewarePythonCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return process.platform === "win32" ? "python" : "python3";
  }

  if (process.platform === "win32") {
    const embeddedPath = join(
      process.resourcesPath,
      "python_env",
      "python.exe",
    );
    return fs.existsSync(embeddedPath) ? embeddedPath : "python";
  }

  const candidates = [
    ...middlewarePythonCandidates,
    join(process.resourcesPath, "python_env", "bin", "python3"),
    join(process.resourcesPath, "python_env", "bin", "python"),
    join(process.resourcesPath, "python_env", "python3"),
    join(process.resourcesPath, "python_env", "python"),
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "python3";
};

const getScriptPythonInfo = (): { type: "python"; path: string } => ({
  type: "python",
  path: getScriptPythonPath(),
});

const tryParseJson = <T = any>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const extractLastJsonObject = <T = any>(raw: string): T | null => {
  const text = raw.trim();
  if (!text) return null;

  const direct = tryParseJson<T>(text);
  if (direct !== null) return direct;

  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString && ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  for (let i = objects.length - 1; i >= 0; i--) {
    const parsed = tryParseJson<T>(objects[i]);
    if (parsed !== null) return parsed;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = tryParseJson<T>(lines[i]);
    if (parsed !== null) return parsed;
  }

  return null;
};

const readEnvReportFromFile = <T = any>(middlewareDir: string): T | null => {
  try {
    const reportPath = join(middlewareDir, "environment_report.json");
    if (!fs.existsSync(reportPath)) return null;
    const content = fs.readFileSync(reportPath, "utf-8");
    return tryParseJson<T>(content);
  } catch {
    return null;
  }
};

// Helper to spawn Python process with sanitized environment
// Supports both Python mode (python script.py) and Bundle mode (./murasaki-engine --script=main)
const spawnPythonProcess = (
  pythonInfo: { type: "python" | "bundle"; path: string },
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdio?:
    | "pipe"
    | "inherit"
    | "ignore"
    | Array<"pipe" | "inherit" | "ignore" | "ipc" | null>;
  },
) => {
  // 1. Base Environment
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env, // Merge user provided env (e.g. CUDA_VISIBLE_DEVICES)
    PYTHONIOENCODING: "utf-8",
  };

  // 2. Sanitation: Remove system-wide Python paths
  delete env["PYTHONHOME"];
  delete env["PYTHONPATH"];

  let cmd: string;
  let finalArgs: string[];

  if (pythonInfo.type === "bundle") {
    // Bundle mode: directly execute the bundle with args
    // PyInstaller bundle 内置入口点，需要移除脚本路径
    // args = ['path/to/main.py', '--file', ...] -> ['--file', ...]
    cmd = pythonInfo.path;
    // 移除脚本路径，仅保留实际参数
    finalArgs = args.slice(1);
    console.log(`[Spawn Bundle] ${cmd} ${finalArgs.join(" ")}`);
  } else {
    // Python mode: python script.py args
    cmd = pythonInfo.path;
    finalArgs = args;
    console.log(`[Spawn Python] ${cmd} ${args[0]}... (Env Sanitized)`);
  }

  return spawn(cmd, finalArgs, {
    ...options,
    env,
  });
};

// Helper for mutable data root (models / glossaries / cache)
const getUserDataPath = () => {
  return getMiddlewarePath();
};

const isPathWithinBase = (targetPath: string, basePath: string): boolean => {
  const target = resolve(targetPath);
  const base = resolve(basePath);
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const ensurePathWithinUserData = (targetPath: string): string => {
  const resolvedPath = resolve(targetPath);
  const userDataRoot = resolve(getUserDataPath());
  if (!isPathWithinBase(resolvedPath, userDataRoot)) {
    throw new Error(`Access denied: ${resolvedPath}`);
  }
  return resolvedPath;
};

const ensureLocalFilePathForUserOperation = (targetPath: string): string => {
  const resolvedPath = resolve(targetPath);
  // Local desktop app: allow absolute paths selected by user (e.g. F:\test\*.cache.json).
  // Keep relative paths constrained to middleware root to avoid accidental traversal.
  if (isAbsolute(targetPath)) {
    return resolvedPath;
  }
  return ensurePathWithinUserData(resolvedPath);
};

// Ensure User Data Dirs Exist
const initUserData = () => {
  const userDataPath = getUserDataPath();
  const modelsDir = join(userDataPath, "models");
  const glossariesDir = join(userDataPath, "glossaries");

  // In prod these should usually exist from installer, but ensures if missing
  if (!fs.existsSync(userDataPath))
    fs.mkdirSync(userDataPath, { recursive: true });
  if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
  if (!fs.existsSync(glossariesDir))
    fs.mkdirSync(glossariesDir, { recursive: true });

  return { modelsDir, glossariesDir };
};

// Call on startup
initUserData();

// IPC Handlers
ipcMain.handle(
  "select-file",
  async (
    _event,
    options?: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    },
  ) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options?.title,
      defaultPath: options?.defaultPath,
      properties: ["openFile"],
      filters: options?.filters || [
        { name: "Documents", extensions: ["txt", "epub", "srt", "ass", "ssa"] },
      ],
    });
    if (canceled) return null;
    return filePaths[0];
  },
);

ipcMain.handle(
  "select-directory",
  async (_event, options?: { title?: string; defaultPath?: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options?.title,
      defaultPath: options?.defaultPath,
      properties: ["openDirectory"],
    });
    if (canceled) return null;
    return filePaths[0];
  },
);

// Select folder for cache file browsing
ipcMain.handle(
  "select-folder",
  async (_event, options?: { title?: string; defaultPath?: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options?.title || "选择文件夹",
      defaultPath: options?.defaultPath,
      properties: ["openDirectory"],
    });
    if (canceled) return null;
    return filePaths[0];
  },
);

// List cache files in a directory

ipcMain.handle("list-cache-files", async (_event, folderPath: string) => {
  try {
    const files = fs.readdirSync(folderPath);
    return files
      .filter((f) => f.endsWith(".cache.json"))
      .map((f) => ({
        name: f,
        path: join(folderPath, f),
      }));
  } catch (e) {
    console.error("[IPC] list-cache-files error:", e);
    return [];
  }
});

// Multi-file selection for batch translation
ipcMain.handle("select-files", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documents", extensions: ["txt", "epub", "srt", "ass", "ssa"] },
    ],
  });
  if (canceled) return [];
  return filePaths;
});

ipcMain.handle("import-glossary", async (_event, sourcePath: string) => {
  try {
    const isDev = process.env.NODE_ENV === "development";
    const middlewareDir = isDev
      ? join(__dirname, "../../middleware")
      : join(process.resourcesPath, "middleware");
    const glossaryDir = join(middlewareDir, "glossaries");

    if (!fs.existsSync(glossaryDir))
      fs.mkdirSync(glossaryDir, { recursive: true });

    const fileName = sourcePath.split(/[/\\]/).pop() || "imported.json";
    const targetPath = join(glossaryDir, fileName);

    fs.copyFileSync(sourcePath, targetPath);
    return { success: true, path: targetPath };
  } catch (e) {
    console.error("[IPC] import-glossary failed:", e);
    return { success: false, error: String(e) };
  }
});

// --- Server Manager IPC ---
ipcMain.handle("server-status", () => {
  return ServerManager.getInstance().getStatus();
});

ipcMain.handle("server-start", async (_event, config) => {
  return await ServerManager.getInstance().start(config);
});

ipcMain.handle("server-stop", async () => {
  await ServerManager.getInstance().stop();
  return true;
});

ipcMain.handle("server-logs", () => {
  return ServerManager.getInstance().getLogs();
});

ipcMain.handle("server-warmup", async () => {
  return await ServerManager.getInstance().warmup();
});
// --------------------------

// --- Remote Server IPC ---
import {
  RemoteClient,
  clearRemoteClient,
  RemoteClientObserver,
  RemoteNetworkEvent,
} from "./remoteClient";

let remoteClient: RemoteClient | null = null;
const REMOTE_NOTICE =
  "远程模式已启用：所有交互都会直接发送到服务器，并同步镜像保存到本地。";
const REMOTE_SYNC_ROOT = join(getUserDataPath(), "remote-sync");
const REMOTE_SYNC_MIRROR_PATH = join(REMOTE_SYNC_ROOT, "sync-mirror.log");
const REMOTE_EVENT_LOG_PATH = join(REMOTE_SYNC_ROOT, "network-events.log");
const REMOTE_MAX_EVENTS = 500;
const REMOTE_EVENT_LOG_BATCH_SIZE = 200;
const REMOTE_EVENT_LOG_FLUSH_DELAY_MS = 80;
const REMOTE_MIRROR_LOG_BATCH_SIZE = 200;
const REMOTE_MIRROR_LOG_FLUSH_DELAY_MS = 80;

let remoteSession: {
  url: string;
  apiKey?: string;
  connectedAt: number;
  source: "manual" | "local-daemon";
} | null = null;
let remoteCapabilities: string[] = [];
let remoteAuthRequired: boolean | undefined = undefined;
let remoteVersion: string | undefined = undefined;
let remoteStatusCache: {
  status?: string;
  modelLoaded?: boolean;
  currentModel?: string;
  activeTasks?: number;
  lastCheckedAt?: number;
} = {};
let remoteHealthFailures = 0;
let remoteActiveTaskId: string | null = null;
let remoteNetworkEvents: RemoteNetworkEvent[] = [];
let remoteEventLogQueue: string[] = [];
let remoteEventLogFlushTimer: NodeJS.Timeout | null = null;
let remoteEventLogFlushing = false;
let remoteMirrorLogQueue: string[] = [];
let remoteMirrorLogFlushTimer: NodeJS.Timeout | null = null;
let remoteMirrorLogFlushing = false;
let remoteNetworkStats = {
  wsConnected: false,
  inFlightRequests: 0,
  totalEvents: 0,
  successCount: 0,
  errorCount: 0,
  retryCount: 0,
  uploadCount: 0,
  downloadCount: 0,
  lastLatencyMs: undefined as number | undefined,
  avgLatencyMs: undefined as number | undefined,
  latencyTotalMs: 0,
  latencyCount: 0,
  lastStatusCode: undefined as number | undefined,
  lastEventAt: undefined as number | undefined,
  lastError: undefined as
    | {
      at: number;
      kind: "connection" | "http" | "upload" | "download" | "retry" | "ws";
      message: string;
      path?: string;
      statusCode?: number;
    }
    | undefined,
  lastSyncAt: undefined as number | undefined,
};

const ensureRemoteStorage = () => {
  try {
    fs.mkdirSync(REMOTE_SYNC_ROOT, { recursive: true });
  } catch (error) {
    console.warn("[Remote] Failed to ensure storage directory:", error);
  }
};

const flushRemoteEventLog = async () => {
  if (remoteEventLogFlushing) return;
  if (remoteEventLogQueue.length === 0) return;

  remoteEventLogFlushing = true;
  try {
    ensureRemoteStorage();
    while (remoteEventLogQueue.length > 0) {
      const chunk = remoteEventLogQueue
        .splice(0, REMOTE_EVENT_LOG_BATCH_SIZE)
        .join("");
      await fs.promises.appendFile(REMOTE_EVENT_LOG_PATH, chunk, "utf-8");
    }
  } catch {
    // Ignore local log write failures
  } finally {
    remoteEventLogFlushing = false;
    if (remoteEventLogQueue.length > 0) {
      void flushRemoteEventLog();
    }
  }
};

const enqueueRemoteEventLog = (event: RemoteNetworkEvent) => {
  remoteEventLogQueue.push(`${JSON.stringify(event)}\n`);
  if (remoteEventLogQueue.length > REMOTE_MAX_EVENTS * 4) {
    remoteEventLogQueue = remoteEventLogQueue.slice(-REMOTE_MAX_EVENTS * 2);
  }
  if (remoteEventLogFlushTimer) return;

  remoteEventLogFlushTimer = setTimeout(() => {
    remoteEventLogFlushTimer = null;
    void flushRemoteEventLog();
  }, REMOTE_EVENT_LOG_FLUSH_DELAY_MS);
};

const flushRemoteMirrorLog = async () => {
  if (remoteMirrorLogFlushing) return;
  if (remoteMirrorLogQueue.length === 0) return;

  remoteMirrorLogFlushing = true;
  try {
    ensureRemoteStorage();
    while (remoteMirrorLogQueue.length > 0) {
      const chunk = remoteMirrorLogQueue
        .splice(0, REMOTE_MIRROR_LOG_BATCH_SIZE)
        .join("");
      await fs.promises.appendFile(REMOTE_SYNC_MIRROR_PATH, chunk, "utf-8");
    }
  } catch {
    // Ignore local log write failures
  } finally {
    remoteMirrorLogFlushing = false;
    if (remoteMirrorLogQueue.length > 0) {
      void flushRemoteMirrorLog();
    }
  }
};

const enqueueRemoteMirrorLog = (entry: {
  timestamp: number;
  taskId?: string;
  serverUrl?: string;
  model?: string;
  level?: string;
  message: string;
}) => {
  remoteMirrorLogQueue.push(`${JSON.stringify(entry)}\n`);
  if (remoteMirrorLogQueue.length > REMOTE_MAX_EVENTS * 4) {
    remoteMirrorLogQueue = remoteMirrorLogQueue.slice(-REMOTE_MAX_EVENTS * 2);
  }
  if (remoteMirrorLogFlushTimer) return;

  remoteMirrorLogFlushTimer = setTimeout(() => {
    remoteMirrorLogFlushTimer = null;
    void flushRemoteMirrorLog();
  }, REMOTE_MIRROR_LOG_FLUSH_DELAY_MS);
};

const getExecutionMode = (): "local" | "remote" =>
  remoteClient && remoteSession ? "remote" : "local";

const getFileScope = (): "shared-local" | "isolated-remote" =>
  remoteSession?.source === "local-daemon" ? "shared-local" : "isolated-remote";

const getOutputPolicy = (): "same-dir" | "scoped-remote-dir" =>
  remoteSession?.source === "local-daemon" ? "same-dir" : "scoped-remote-dir";

const detectRemoteSessionSource = (
  url: string,
): "manual" | "local-daemon" => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
      return "manual";
    }
    const serverStatus = ServerManager.getInstance().getStatus();
    if (!serverStatus.running) return "manual";
    const parsedPort = Number.parseInt(parsed.port || "80", 10);
    if (parsedPort === serverStatus.port) {
      return "local-daemon";
    }
  } catch {
    return "manual";
  }
  return "manual";
};

const appendRemoteEvent = (event: RemoteNetworkEvent) => {
  const sanitizedEvent: RemoteNetworkEvent = {
    ...event,
    path: event.path
      ? event.path.replace(/([?&]token=)[^&]+/gi, "$1***")
      : event.path,
  };
  ensureRemoteStorage();
  remoteNetworkEvents.push(sanitizedEvent);
  if (remoteNetworkEvents.length > REMOTE_MAX_EVENTS) {
    remoteNetworkEvents = remoteNetworkEvents.slice(-REMOTE_MAX_EVENTS);
  }
  enqueueRemoteEventLog(sanitizedEvent);

  const isHttpKind =
    sanitizedEvent.kind === "http" ||
    sanitizedEvent.kind === "upload" ||
    sanitizedEvent.kind === "download";
  if (isHttpKind && sanitizedEvent.phase === "start") {
    remoteNetworkStats.inFlightRequests += 1;
  } else if (
    isHttpKind &&
    (sanitizedEvent.phase === "success" || sanitizedEvent.phase === "error")
  ) {
    remoteNetworkStats.inFlightRequests = Math.max(
      0,
      remoteNetworkStats.inFlightRequests - 1,
    );
  }

  if (sanitizedEvent.kind === "ws") {
    if (sanitizedEvent.phase === "open") remoteNetworkStats.wsConnected = true;
    if (sanitizedEvent.phase === "close" || sanitizedEvent.phase === "error") {
      remoteNetworkStats.wsConnected = false;
    }
  }

  remoteNetworkStats.totalEvents += 1;
  if (sanitizedEvent.phase === "success" || sanitizedEvent.phase === "open") {
    remoteNetworkStats.successCount += 1;
  }
  if (sanitizedEvent.phase === "error") {
    remoteNetworkStats.errorCount += 1;
    remoteNetworkStats.lastError = {
      at: sanitizedEvent.timestamp,
      kind: sanitizedEvent.kind,
      message: sanitizedEvent.message || "Unknown remote error",
      path: sanitizedEvent.path,
      statusCode: sanitizedEvent.statusCode,
    };
  }
  if (sanitizedEvent.kind === "retry" && sanitizedEvent.phase === "start") {
    remoteNetworkStats.retryCount += 1;
  }
  if (sanitizedEvent.kind === "upload" && sanitizedEvent.phase === "success") {
    remoteNetworkStats.uploadCount += 1;
  }
  if (sanitizedEvent.kind === "download" && sanitizedEvent.phase === "success") {
    remoteNetworkStats.downloadCount += 1;
  }

  if (
    typeof sanitizedEvent.durationMs === "number" &&
    Number.isFinite(sanitizedEvent.durationMs)
  ) {
    remoteNetworkStats.lastLatencyMs = sanitizedEvent.durationMs;
    remoteNetworkStats.latencyTotalMs += sanitizedEvent.durationMs;
    remoteNetworkStats.latencyCount += 1;
    remoteNetworkStats.avgLatencyMs = Math.round(
      remoteNetworkStats.latencyTotalMs / Math.max(1, remoteNetworkStats.latencyCount),
    );
  }

  if (typeof sanitizedEvent.statusCode === "number") {
    remoteNetworkStats.lastStatusCode = sanitizedEvent.statusCode;
  }
  remoteNetworkStats.lastEventAt = sanitizedEvent.timestamp;
  remoteNetworkStats.lastSyncAt = sanitizedEvent.timestamp;
};

const remoteObserver: RemoteClientObserver = {
  onNetworkEvent: (event) => appendRemoteEvent(event),
};

const formatRemoteError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const retryable =
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("temporarily unavailable");
  const errorCode = lower.includes("timeout")
    ? "REMOTE_TIMEOUT"
    : lower.includes("http 403")
      ? "REMOTE_UNAUTHORIZED"
      : lower.includes("http 404")
        ? "REMOTE_NOT_FOUND"
        : lower.includes("network") || lower.includes("fetch failed")
          ? "REMOTE_NETWORK"
          : "REMOTE_UNKNOWN";
  return {
    error: message,
    errorCode,
    retryable,
  };
};

const buildRemoteErrorResponse = (
  error: unknown,
  fallbackMessage?: string,
) => {
  const formatted = formatRemoteError(error);
  return {
    ok: false,
    code: formatted.errorCode,
    message: fallbackMessage || formatted.error,
    technicalMessage: formatted.error,
    retryable: formatted.retryable,
  };
};

const getSanitizedRemoteSession = () =>
  remoteSession
    ? {
      url: remoteSession.url,
      connectedAt: remoteSession.connectedAt,
      source: remoteSession.source,
    }
    : null;

const buildRemoteNetworkStatus = () => ({
  connected: Boolean(remoteClient && remoteSession),
  executionMode: getExecutionMode(),
  session: getSanitizedRemoteSession(),
  fileScope: getFileScope(),
  outputPolicy: getOutputPolicy(),
  wsConnected: remoteNetworkStats.wsConnected,
  inFlightRequests: remoteNetworkStats.inFlightRequests,
  totalEvents: remoteNetworkStats.totalEvents,
  successCount: remoteNetworkStats.successCount,
  errorCount: remoteNetworkStats.errorCount,
  retryCount: remoteNetworkStats.retryCount,
  uploadCount: remoteNetworkStats.uploadCount,
  downloadCount: remoteNetworkStats.downloadCount,
  lastLatencyMs: remoteNetworkStats.lastLatencyMs,
  avgLatencyMs: remoteNetworkStats.avgLatencyMs,
  lastStatusCode: remoteNetworkStats.lastStatusCode,
  lastEventAt: remoteNetworkStats.lastEventAt,
  lastError: remoteNetworkStats.lastError,
  notice: REMOTE_NOTICE,
  syncMirrorPath: REMOTE_SYNC_MIRROR_PATH,
  networkEventLogPath: REMOTE_EVENT_LOG_PATH,
  lastSyncAt: remoteNetworkStats.lastSyncAt,
});

const buildRemoteRuntimeStatus = () => ({
  connected: Boolean(remoteClient && remoteSession),
  executionMode: getExecutionMode(),
  session: getSanitizedRemoteSession(),
  fileScope: getFileScope(),
  outputPolicy: getOutputPolicy(),
  authRequired: remoteAuthRequired,
  capabilities: remoteCapabilities,
  status: remoteStatusCache.status || "unknown",
  modelLoaded: remoteStatusCache.modelLoaded ?? false,
  currentModel: remoteStatusCache.currentModel,
  activeTasks: remoteStatusCache.activeTasks ?? 0,
  version: remoteVersion,
  lastCheckedAt: remoteStatusCache.lastCheckedAt,
  notice: REMOTE_NOTICE,
  syncMirrorPath: REMOTE_SYNC_MIRROR_PATH,
  networkEventLogPath: REMOTE_EVENT_LOG_PATH,
});

const buildRemoteDiagnostics = () => ({
  executionMode: getExecutionMode(),
  connected: Boolean(remoteClient && remoteSession),
  session: getSanitizedRemoteSession(),
  healthFailures: remoteHealthFailures,
  activeTaskId: remoteActiveTaskId,
  syncMirrorPath: REMOTE_SYNC_MIRROR_PATH,
  networkEventLogPath: REMOTE_EVENT_LOG_PATH,
  notice: REMOTE_NOTICE,
  network: buildRemoteNetworkStatus(),
  lastSyncAt: remoteNetworkStats.lastSyncAt,
});

ipcMain.handle(
  "remote-connect",
  async (_event, config: { url: string; apiKey?: string }) => {
    ensureRemoteStorage();
    try {
      remoteClient = new RemoteClient(config, remoteObserver);
      const result = await remoteClient.testConnection();
      if (!result.ok) {
        remoteClient = null;
        remoteSession = null;
        return {
          ok: false,
          code: "REMOTE_PROTOCOL",
          message: result.message || "Remote connection failed",
        };
      }

      remoteSession = {
        url: config.url.trim().replace(/\/+$/, ""),
        apiKey: config.apiKey?.trim() || undefined,
        connectedAt: Date.now(),
        source: detectRemoteSessionSource(config.url),
      };

      const [health, status] = await Promise.all([
        remoteClient.getHealth(),
        remoteClient.getStatus(),
      ]);
      remoteVersion = result.version || health.version;
      remoteCapabilities = health.capabilities || [];
      remoteAuthRequired = health.authRequired;
      remoteStatusCache = {
        status: status.status,
        modelLoaded: status.modelLoaded,
        currentModel: status.currentModel,
        activeTasks: status.activeTasks,
        lastCheckedAt: Date.now(),
      };
      remoteHealthFailures = 0;
      return {
        ok: true,
        message: result.message || "Connected",
        data: {
          version: remoteVersion,
        },
      };
    } catch (e) {
      remoteClient = null;
      remoteSession = null;
      return buildRemoteErrorResponse(e, "Failed to connect remote server");
    }
  },
);

ipcMain.handle("remote-disconnect", async () => {
  if (remoteTranslationBridge) {
    const bridge = remoteTranslationBridge;
    remoteTranslationBridge = null;
    remoteActiveTaskId = null;
    void bridge.client.cancelTask(bridge.taskId).catch(() => undefined);
  }
  remoteClient = null;
  remoteSession = null;
  remoteCapabilities = [];
  remoteAuthRequired = undefined;
  remoteVersion = undefined;
  remoteStatusCache = {};
  remoteActiveTaskId = null;
  remoteNetworkStats.wsConnected = false;
  remoteNetworkStats.inFlightRequests = 0;
  remoteClient = null;
  clearRemoteClient();
  return {
    ok: true,
    message: "Disconnected",
  };
});

ipcMain.handle("remote-status", async () => {
  if (!remoteClient || !remoteSession) {
    return {
      ok: true,
      data: buildRemoteRuntimeStatus(),
    };
  }
  try {
    const [health, status] = await Promise.all([
      remoteClient.getHealth(),
      remoteClient.getStatus(),
    ]);
    remoteVersion = health.version || remoteVersion;
    remoteCapabilities = health.capabilities || [];
    remoteAuthRequired = health.authRequired;
    remoteStatusCache = {
      status: status.status,
      modelLoaded: status.modelLoaded,
      currentModel: status.currentModel,
      activeTasks: status.activeTasks,
      lastCheckedAt: Date.now(),
    };
    remoteHealthFailures = 0;
    return {
      ok: true,
      data: buildRemoteRuntimeStatus(),
    };
  } catch (e) {
    remoteHealthFailures += 1;
    return {
      ...buildRemoteErrorResponse(e, "Failed to fetch remote runtime status"),
      data: buildRemoteRuntimeStatus(),
    };
  }
});

ipcMain.handle("remote-models", async () => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const models = await remoteClient.listModels();
    return {
      ok: true,
      data: models,
    };
  } catch (e) {
    console.error("[Remote] listModels error:", e);
    return buildRemoteErrorResponse(e, "Failed to fetch remote models");
  }
});

ipcMain.handle("remote-glossaries", async () => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const glossaries = await remoteClient.listGlossaries();
    return {
      ok: true,
      data: glossaries,
    };
  } catch (e) {
    console.error("[Remote] listGlossaries error:", e);
    return buildRemoteErrorResponse(e, "Failed to fetch remote glossaries");
  }
});

ipcMain.handle(
  "remote-translate",
  async (_event, options: TranslateOptions) => {
    if (!remoteClient) {
      return {
        ok: false,
        code: "REMOTE_PROTOCOL",
        message: "Not connected to remote server",
      };
    }
    try {
      const { taskId, status } = await remoteClient.createTranslation(options);
      remoteActiveTaskId = taskId;
      return {
        ok: true,
        data: { taskId, status },
      };
    } catch (e) {
      return buildRemoteErrorResponse(e, "Failed to create remote translation task");
    }
  },
);

ipcMain.handle(
  "remote-task-status",
  async (
    _event,
    taskId: string,
    query?: { logFrom?: number; logLimit?: number },
  ) => {
    if (!remoteClient) {
      return {
        ok: false,
        code: "REMOTE_PROTOCOL",
        message: "Not connected to remote server",
      };
    }
    try {
      const status = await remoteClient.getTaskStatus(taskId, query);
      if (
        remoteActiveTaskId === taskId &&
        ["completed", "failed", "cancelled"].includes(status.status)
      ) {
        remoteActiveTaskId = null;
      }
      return {
        ok: true,
        data: status,
      };
    } catch (e) {
      return buildRemoteErrorResponse(e, "Failed to fetch remote task status");
    }
  },
);

ipcMain.handle("remote-cancel", async (_event, taskId: string) => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const result = await remoteClient.cancelTask(taskId);
    if (remoteActiveTaskId === taskId) {
      remoteActiveTaskId = null;
    }
    return {
      ok: true,
      data: result,
    };
  } catch (e) {
    return buildRemoteErrorResponse(e, "Failed to cancel remote task");
  }
});

ipcMain.handle("remote-upload", async (_event, filePath: string) => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const uploaded = await remoteClient.uploadFile(filePath);
    return {
      ok: true,
      data: uploaded,
    };
  } catch (e) {
    return buildRemoteErrorResponse(e, "Failed to upload file to remote server");
  }
});

ipcMain.handle(
  "remote-download",
  async (_event, taskId: string, savePath: string) => {
    if (!remoteClient) {
      return {
        ok: false,
        code: "REMOTE_PROTOCOL",
        message: "Not connected to remote server",
      };
    }
    try {
      await remoteClient.downloadResult(taskId, savePath);
      return {
        ok: true,
        data: { success: true, path: savePath },
      };
    } catch (e) {
      return buildRemoteErrorResponse(
        e,
        "Failed to download result from remote server",
      );
    }
  },
);

ipcMain.handle("remote-network-status", async () => {
  return {
    ok: true,
    data: buildRemoteNetworkStatus(),
  };
});

ipcMain.handle("remote-network-events", async (_event, limit?: number) => {
  const normalizedLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(1, Math.min(REMOTE_MAX_EVENTS, Math.floor(limit)))
      : 50;
  const events = remoteNetworkEvents.slice(-normalizedLimit);
  return {
    ok: true,
    data: events,
  };
});

ipcMain.handle("remote-diagnostics", async () => {
  return {
    ok: true,
    data: buildRemoteDiagnostics(),
  };
});

ipcMain.handle("remote-hf-check-network", async () => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const data = await remoteClient.checkHfNetwork();
    return { ok: true, data };
  } catch (e) {
    return buildRemoteErrorResponse(e, "Failed to check remote network");
  }
});

ipcMain.handle("remote-hf-list-repos", async (_event, orgName: string) => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const data = await remoteClient.listHfRepos(orgName);
    return { ok: true, data };
  } catch (e) {
    return buildRemoteErrorResponse(e, "Failed to list remote repos");
  }
});

ipcMain.handle("remote-hf-list-files", async (_event, repoId: string) => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const data = await remoteClient.listHfFiles(repoId);
    return { ok: true, data };
  } catch (e) {
    return buildRemoteErrorResponse(e, "Failed to list remote files");
  }
});

ipcMain.handle(
  "remote-hf-download-start",
  async (_event, repoId: string, fileName: string, mirror: string = "direct") => {
    if (!remoteClient) {
      return {
        ok: false,
        code: "REMOTE_PROTOCOL",
        message: "Not connected to remote server",
      };
    }
    try {
      const data = await remoteClient.startHfDownload(repoId, fileName, mirror);
      return { ok: true, data };
    } catch (e) {
      return buildRemoteErrorResponse(e, "Failed to start remote download");
    }
  },
);

ipcMain.handle("remote-hf-download-status", async (_event, downloadId: string) => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const data = await remoteClient.getHfDownloadStatus(downloadId);
    return { ok: true, data };
  } catch (e) {
    return buildRemoteErrorResponse(e, "Failed to fetch remote download status");
  }
});

ipcMain.handle("remote-hf-download-cancel", async (_event, downloadId: string) => {
  if (!remoteClient) {
    return {
      ok: false,
      code: "REMOTE_PROTOCOL",
      message: "Not connected to remote server",
    };
  }
  try {
    const data = await remoteClient.cancelHfDownload(downloadId);
    return { ok: true, data };
  } catch (e) {
    return buildRemoteErrorResponse(e, "Failed to cancel remote download");
  }
});

// --------------------------

// Single Block Retranslation

// Select folder and get all supported files
ipcMain.handle("select-folder-files", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (canceled || !filePaths[0]) return [];
  const folderPath = filePaths[0];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(txt|epub|srt|ass|ssa)$/i.test(f))
    .map((f) => join(folderPath, f));
  return files;
});

// Scan directory for supported files (Drag & Drop support)
// Scan directory for supported files (Drag & Drop support)
// Helper for async directory scanning with concurrency control and symlink safety
const scanDirectoryAsync = async (
  dir: string,
  recursive: boolean,
): Promise<string[]> => {
  try {
    // withFileTypes avoids separate stat calls and safer for symlinks
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    const subdirs: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip symbolic links to prevent infinite recursion loops
      if (entry.isSymbolicLink()) continue;

      if (entry.isFile()) {
        if (/\.(txt|epub|srt|ass|ssa)$/i.test(fullPath)) {
          results.push(fullPath);
        }
      } else if (entry.isDirectory() && recursive) {
        subdirs.push(fullPath);
      }
    }

    // Process subdirectories with simple batch concurrency to prevent EMFILE
    if (subdirs.length > 0) {
      const CONCURRENCY = 8; // Limit concurrent directory scans
      for (let i = 0; i < subdirs.length; i += CONCURRENCY) {
        const batch = subdirs.slice(i, i + CONCURRENCY);
        // Parallelize within the batch
        const batchResults = await Promise.all(
          batch.map((d) => scanDirectoryAsync(d, recursive)),
        );
        // Flatten and merge
        for (const res of batchResults) {
          results.push(...res);
        }
      }
    }

    return results;
  } catch (e) {
    // console.error('Scan dir error:', dir, e)
    return [];
  }
};

ipcMain.handle(
  "scan-directory",
  async (_event, path: string, recursive: boolean = false) => {
    try {
      if (!fs.existsSync(path)) return [];

      // Use promises.stat for entry point too
      const stats = await fs.promises.stat(path);

      // If it's a file, return if supported
      if (stats.isFile()) {
        return /\.(txt|epub|srt|ass|ssa)$/i.test(path) ? [path] : [];
      }

      // If directory
      if (stats.isDirectory()) {
        return await scanDirectoryAsync(path, recursive);
      }
      return [];
    } catch (e) {
      console.error("[IPC] scan-directory error:", e);
      return [];
    }
  },
);

// --- Update System IPC ---
ipcMain.handle("check-update", async () => {
  try {
    const repo = "soundstarrain/Murasaki-Translator";
    const url = `https://api.github.com/repos/${repo}/releases/latest`;

    const fetch = (url: string) =>
      new Promise<string>((resolve, reject) => {
        const https = require("https");
        const options = {
          headers: { "User-Agent": "Murasaki-Translator" },
          timeout: 10000,
        };
        const req = https.get(
          url,
          options,
          (res: import("http").IncomingMessage) => {
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API returned status ${res.statusCode}`));
              return;
            }
            let data = "";
            res.on("data", (chunk: Buffer) => (data += chunk));
            res.on("end", () => resolve(data));
          },
        );
        req.on("timeout", () => {
          req.destroy(new Error("Update check request timed out"));
        });
        req.on("error", reject);
      });

    const resBody = await fetch(url);
    const data = JSON.parse(resBody);

    return {
      success: true,
      currentVersion: app.getVersion(),
      latestVersion: data.tag_name?.replace("v", ""),
      releaseNotes: data.body,
      url: data.html_url,
    };
  } catch (e) {
    console.error("[Update Check] Failed:", e);
    return { success: false, error: String(e) };
  }
});
// --------------------------

// --- Main Process Logs IPC ---
ipcMain.handle("get-main-process-logs", () => {
  return mainProcessLogs.slice(); // 返回副本
});

// --- System Diagnostics IPC ---
ipcMain.handle("get-system-diagnostics", async () => {
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);
  const os = require("os");
  const net = require("net");

  const result: {
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
  } = {
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuCores: os.cpus().length,
      totalMem: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB`,
    },
    gpu: null,
    python: null,
    cuda: null,
    vulkan: null,
    llamaServer: { status: "unknown" },
  };

  const shellQuote = (value: string) => {
    if (!value.includes(" ") && !value.includes('"')) return value;
    return `"${value.replace(/"/g, '\\"')}"`;
  };

  // 辅助函数：带超时的异步执行
  const execWithTimeout = async (
    cmd: string,
    timeout: number,
  ): Promise<{ stdout: string; stderr: string }> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        signal: controller.signal,
        windowsHide: true,
      });
      return { stdout, stderr };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const resolveCommandPath = async (
    command: string,
  ): Promise<string | null> => {
    if (!command) return null;

    const looksLikePath = command.includes("/") || command.includes("\\");
    if (looksLikePath) {
      return fs.existsSync(command) ? command : null;
    }

    const lookupCommand =
      process.platform === "win32"
        ? `where ${command}`
        : `command -v ${command}`;

    try {
      const { stdout } = await execWithTimeout(lookupCommand, 2000);
      const first = stdout
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .find((line: string) => Boolean(line));
      return first || null;
    } catch {
      return null;
    }
  };

  const parsePythonVersion = (output: string): string | null => {
    const match = output.match(/Python\s+(\d+\.\d+\.\d+)/i);
    return match ? match[1] : null;
  };

  // GPU Detection (NVIDIA) - parallel execution
  const gpuPromise = (async () => {
    try {
      const scriptPath = join(getMiddlewarePath(), "get_specs.py");
      if (fs.existsSync(scriptPath)) {
        const py = getScriptPythonPath();
        const { stdout, stderr } = await execWithTimeout(
          `${shellQuote(py)} ${shellQuote(scriptPath)}`,
          8000,
        );
        const merged = `${stdout}\n${stderr}`;
        const marker = merged.match(
          /__HW_SPEC_JSON_START__(.*?)__HW_SPEC_JSON_END__/s,
        );
        if (marker) {
          const specs = tryParseJson<any>(marker[1]);
          if (specs?.gpu_name && !/unknown/i.test(String(specs.gpu_name))) {
            result.gpu = {
              name: String(specs.gpu_name),
              driver: specs.gpu_backend
                ? String(specs.gpu_backend).toUpperCase()
                : undefined,
              vram:
                typeof specs.vram_gb === "number"
                  ? `${specs.vram_gb} GB`
                  : undefined,
            };
            return;
          }
        }
      }
    } catch { }

    try {
      const { stdout } = await execWithTimeout(
        "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits",
        5000,
      );
      const first = stdout
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .find((line: string) => Boolean(line));
      if (first) {
        const parts = first.split(",").map((v: string) => v.trim());
        if (parts.length >= 3) {
          result.gpu = {
            name: parts[0],
            driver: parts[1],
            vram: `${parts[2]} MB`,
          };
          return;
        }
      }
    } catch { }

    if (process.platform === "win32") {
      try {
        const { stdout } = await execWithTimeout(
          "wmic path win32_VideoController get Name,DriverVersion,AdapterRAM /format:csv",
          5000,
        );
        const lines = stdout
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter((line: string) => line && !line.startsWith("Node"));
        for (const line of lines) {
          const parts = line.split(",").map((v: string) => v.trim());
          if (parts.length < 4) continue;
          const adapterRam = Number(parts[1]);
          const name = parts[2];
          const driver = parts[3];
          if (!name || /microsoft|basic/i.test(name)) continue;
          const vram =
            Number.isFinite(adapterRam) && adapterRam > 0
              ? `${Math.round((adapterRam / 1024 ** 3) * 10) / 10} GB`
              : undefined;
          result.gpu = { name, driver: driver || undefined, vram };
          return;
        }
      } catch { }

      try {
        const { stdout } = await execWithTimeout(
          'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress"',
          5000,
        );
        const payload = tryParseJson<any>(stdout.trim());
        const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
        for (const row of rows) {
          const name = String(row?.Name || "").trim();
          if (!name || /microsoft|basic/i.test(name)) continue;
          const driver = String(row?.DriverVersion || "").trim();
          const adapterRam = Number(row?.AdapterRAM);
          const vram =
            Number.isFinite(adapterRam) && adapterRam > 0
              ? `${Math.round((adapterRam / 1024 ** 3) * 10) / 10} GB`
              : undefined;
          result.gpu = { name, driver: driver || undefined, vram };
          return;
        }
      } catch { }
    }

    if (process.platform === "darwin") {
      try {
        const { stdout } = await execWithTimeout(
          "system_profiler SPDisplaysDataType -json",
          8000,
        );
        const payload = tryParseJson<any>(stdout);
        const display = payload?.SPDisplaysDataType?.[0];
        if (display) {
          const name =
            display.sppci_model ||
            display._name ||
            display.spdisplays_vendor ||
            "Apple GPU";
          const rawVram = display.spdisplays_vram || display.sppci_vram || "";
          const vramMatch = String(rawVram).match(/(\d+)\s*(GB|MB)/i);
          const vram = vramMatch
            ? `${vramMatch[1]} ${String(vramMatch[2]).toUpperCase()}`
            : `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB (shared)`;
          result.gpu = { name: String(name), driver: "METAL", vram };
          return;
        }
      } catch { }
    }

    if (process.platform === "linux") {
      try {
        const { stdout } = await execWithTimeout(
          "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits",
          5000,
        );
        const first = stdout
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .find((line: string) => Boolean(line));
        if (first) {
          const parts = first.split(",").map((v: string) => v.trim());
          if (parts.length >= 3) {
            result.gpu = {
              name: parts[0],
              driver: parts[1],
              vram: `${parts[2]} MB`,
            };
            return;
          }
        }
      } catch { }

      try {
        const { stdout } = await execWithTimeout("lspci", 4000);
        const line = stdout
          .split(/\r?\n/)
          .find((entry: string) => /(VGA|3D|Display)/i.test(entry));
        if (line) {
          result.gpu = {
            name: line.split(":").slice(2).join(":").trim() || line.trim(),
            driver: "Detected via lspci",
          };
          return;
        }
      } catch { }

      try {
        const { stdout } = await execWithTimeout("glxinfo -B", 4000);
        const line = stdout
          .split(/\r?\n/)
          .find((entry: string) => /Device:\s*/i.test(entry));
        if (line) {
          result.gpu = {
            name: line.replace(/.*Device:\s*/i, "").trim(),
            driver: "Detected via glxinfo",
          };
        }
      } catch { }
    }
  })();

  // Python Detection - prioritize script runtime, fallback to bundled engine
  const pythonPromise = (async () => {
    const primary = getPythonPath();
    const candidates: string[] = [];

    if (primary.type === "python") candidates.push(primary.path);

    const scriptPython = getScriptPythonPath();
    if (!candidates.includes(scriptPython)) candidates.push(scriptPython);
    if (!candidates.includes("python3")) candidates.push("python3");
    if (!candidates.includes("python")) candidates.push("python");

    for (const candidate of candidates) {
      try {
        const resolved = await resolveCommandPath(candidate);
        const executable = resolved || candidate;
        const { stdout, stderr } = await execWithTimeout(
          `${shellQuote(executable)} --version`,
          3000,
        );
        const combined = `${stdout}\n${stderr}`.trim();
        const version = parsePythonVersion(combined);
        if (version) {
          result.python = { version, path: executable };
          return;
        }
      } catch { }
    }

    if (primary.type === "bundle" && fs.existsSync(primary.path)) {
      result.python = { version: "Bundled Engine", path: primary.path };
    }
  })();

  // CUDA Detection
  const cudaPromise = (async () => {
    try {
      const { stdout, stderr } = await execWithTimeout("nvcc --version", 3000);
      const output = `${stdout}\n${stderr}`;
      const match = output.match(/release (\d+\.\d+)/);
      if (match) {
        result.cuda = { version: match[1], available: true };
      } else {
        result.cuda = { version: "N/A", available: false };
      }
    } catch {
      try {
        const { stdout } = await execWithTimeout(
          "nvidia-smi --query-gpu=driver_version --format=csv,noheader",
          3000,
        );
        const first = stdout
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .find((line: string) => Boolean(line));
        if (first) {
          result.cuda = { version: `driver ${first}`, available: true };
          return;
        }
      } catch { }
      result.cuda = { version: "N/A", available: false };
    }
  })();

  // Vulkan Detection
  const vulkanPromise = (async () => {
    try {
      const { stdout, stderr } = await execWithTimeout(
        "vulkaninfo --summary",
        5000,
      );
      const output = `${stdout}\n${stderr}`;
      const versionMatch = output.match(
        /Vulkan Instance Version:\s*(\d+\.\d+\.\d+)/i,
      );
      const version = versionMatch ? versionMatch[1] : undefined;
      result.vulkan = { available: true, version };
    } catch {
      try {
        const { stdout, stderr } = await execWithTimeout("vulkaninfo", 5000);
        const output = `${stdout}\n${stderr}`;
        const versionMatch = output.match(
          /Vulkan Instance Version:\s*(\d+\.\d+\.\d+)/i,
        );
        result.vulkan = {
          available: true,
          version: versionMatch ? versionMatch[1] : undefined,
        };
        return;
      } catch { }
      result.vulkan = { available: false };
    }
  })();

  // 并行等待所有检测完成
  await Promise.all([gpuPromise, pythonPromise, cudaPromise, vulkanPromise]);

  // llama-server Status Check (Use ServerManager's actual port)
  const checkPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, "127.0.0.1");
    });
  };

  const serverStatus = ServerManager.getInstance().getStatus();
  if (serverStatus.running) {
    result.llamaServer = {
      status: "online",
      port: serverStatus.port,
      model: serverStatus.model || undefined,
    };
  } else {
    // Fallback: Check default port 8080 (for external servers)
    try {
      const isOnline = await checkPort(8080);
      if (isOnline) {
        result.llamaServer = { status: "online", port: 8080 };
        // Try to get model info from /health endpoint
        try {
          const http = require("http");
          const healthData = await new Promise<string>((resolve, reject) => {
            const req = http.get(
              "http://127.0.0.1:8080/health",
              { timeout: 2000 },
              (res: import("http").IncomingMessage) => {
                let data = "";
                res.on("data", (chunk: Buffer) => (data += chunk));
                res.on("end", () => resolve(data));
              },
            );
            req.on("error", reject);
            req.on("timeout", () => {
              req.destroy();
              reject(new Error("timeout"));
            });
          });
          const health = JSON.parse(healthData);
          if (health.model) {
            result.llamaServer.model = health.model;
          }
        } catch {
          /* Health endpoint failed */
        }
      } else {
        result.llamaServer = { status: "offline" };
      }
    } catch {
      result.llamaServer = { status: "unknown" };
    }
  }

  return result;
});

// Open External link in system browser
ipcMain.on("open-external", (_event, url: string) => {
  const { shell } = require("electron");
  // Security validation: Only allow http and https protocols
  if (url.startsWith("https://") || url.startsWith("http://")) {
    shell
      .openExternal(url)
      .catch((e: Error) =>
        console.error("[Shell] Failed to open external URL:", e),
      );
  } else {
    console.warn("Blocked invalid or potentially dangerous external URL:", url);
  }
});

// Desktop Notification
ipcMain.on("show-notification", (_event, { title, body }) => {
  new Notification({ title, body }).show();
});

// Theme Sync - Update Windows title bar color
ipcMain.on("set-theme", (_event, theme: "dark" | "light") => {
  nativeTheme.themeSource = theme;
});

// Read tail of a text file (for log viewing)
ipcMain.handle(
  "read-text-tail",
  async (_event, path: string, options?: { maxBytes?: number; lineCount?: number }) => {
    try {
      if (!path) {
        return { exists: false, error: "Empty path" };
      }
      const safePath = ensureLocalFilePathForUserOperation(path);
      if (!fs.existsSync(safePath)) {
        return { exists: false, path: safePath };
      }

      const stats = fs.statSync(safePath);
      const maxBytes = Math.max(32 * 1024, options?.maxBytes ?? 512 * 1024);
      const lineCount = Math.max(50, options?.lineCount ?? 500);

      if (stats.size <= maxBytes) {
        const content = fs.readFileSync(safePath, "utf-8");
        const lines = content.split("\n");
        return {
          exists: true,
          path: safePath,
          lineCount: lines.length,
          content: lines.slice(-lineCount).join("\n"),
        };
      }

      return await new Promise((resolve) => {
        const chunks: string[] = [];
        const startPos = Math.max(0, stats.size - maxBytes);
        const stream = fs.createReadStream(safePath, {
          encoding: "utf-8",
          start: startPos,
        });

        stream.on("data", (chunk: string) => chunks.push(chunk));
        stream.on("end", () => {
          const content = chunks.join("");
          const lines = content.split("\n").slice(1);
          resolve({
            exists: true,
            path: safePath,
            lineCount: lines.length,
            content: lines.slice(-lineCount).join("\n"),
            truncated: true,
          });
        });
        stream.on("error", (err) => {
          resolve({ exists: false, path: safePath, error: String(err) });
        });
      });
    } catch (e) {
      return { exists: false, error: String(e) };
    }
  },
);

// Read server.log for debug export (streaming to avoid large-file memory spikes)
ipcMain.handle("read-server-log", async () => {
  try {
    const middlewareDir = getMiddlewarePath();
    const logPath = join(middlewareDir, "server.log");
    if (!fs.existsSync(logPath)) {
      return { exists: false, path: logPath };
    }

    const stats = fs.statSync(logPath);
    const maxBytes = 512 * 1024; // 最多读取 512KB（约 10000 行）
    const lineCount = 500;

    // 如果文件较小，直接读取
    if (stats.size <= maxBytes) {
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.split("\n");
      return {
        exists: true,
        path: logPath,
        lineCount: lines.length,
        content: lines.slice(-lineCount).join("\n"),
      };
    }

    // 大文件：仅读取末尾部分
    return new Promise((resolve) => {
      const chunks: string[] = [];
      const startPos = Math.max(0, stats.size - maxBytes);
      const stream = fs.createReadStream(logPath, {
        encoding: "utf-8",
        start: startPos,
      });

      stream.on("data", (chunk: string) => chunks.push(chunk));
      stream.on("end", () => {
        const content = chunks.join("");
        // 跳过第一行（可能是不完整行）
        const lines = content.split("\n").slice(1);
        resolve({
          exists: true,
          path: logPath,
          lineCount: lines.length,
          content: lines.slice(-lineCount).join("\n"),
          truncated: true,
        });
      });
      stream.on("error", (err) => {
        resolve({ exists: false, path: logPath, error: String(err) });
      });
    });
  } catch (e) {
    return { exists: false, error: String(e) };
  }
});

ipcMain.handle("get-models", async () => {
  // Models are now in Documents/MurasakiTranslator/models
  const userDataPath = getUserDataPath();
  const modelDir = join(userDataPath, "models");
  if (!fs.existsSync(modelDir)) return [];
  return fs.readdirSync(modelDir).filter((f) => f.endsWith(".gguf"));
});

// Official Murasaki Models Dictionary - keyed by exact file size in bytes
// This allows accurate identification without MD5 computation
const OFFICIAL_MODELS: Record<
  number,
  {
    name: string;
    paramsB: number;
    quant: string;
    vramGB: number;
    isOfficial: boolean;
  }
> = {
  // Murasaki-8B-v0.1-Q4_K_M.gguf - approximately 4.92 GB
  5284823040: {
    name: "Murasaki-8B-v0.1-Q4_K_M",
    paramsB: 8,
    quant: "Q4_K_M",
    vramGB: 5.9,
    isOfficial: true,
  },
  // Murasaki-8B-v0.1-f16.gguf - approximately 16 GB
  17179869184: {
    name: "Murasaki-8B-v0.1-f16",
    paramsB: 8,
    quant: "F16",
    vramGB: 19.2,
    isOfficial: true,
  },
  // Add more official models here as they are released
  // Format: exactSizeBytes: { name, paramsB, quant, vramGB, isOfficial: true }
};

ipcMain.handle("get-model-info", async (_event, modelName: string) => {
  const userDataPath = getUserDataPath();
  const modelPath = join(userDataPath, "models", modelName);
  if (!fs.existsSync(modelPath)) return null;

  const stats = fs.statSync(modelPath);
  const sizeBytes = stats.size;
  const sizeGB = sizeBytes / (1024 * 1024 * 1024);

  // Check if this is an official model by exact file size
  const officialModel = OFFICIAL_MODELS[sizeBytes];
  if (officialModel) {
    return {
      sizeGB: Math.round(sizeGB * 100) / 100,
      estimatedVramGB: officialModel.vramGB,
      paramsB: officialModel.paramsB,
      quant: officialModel.quant,
      isOfficial: true,
      officialName: officialModel.name,
    };
  }

  // Fallback: Parse model name for quant and params
  // Common patterns: xxx-8B-Q4_K_M.gguf, xxx_7b_q5_k.gguf
  const nameLower = modelName.toLowerCase();

  // Extract params (e.g., 8B, 7b, 12B)
  const paramsMatch = nameLower.match(/(\d+\.?\d*)b/);
  const paramsB = paramsMatch ? parseFloat(paramsMatch[1]) : null;

  // Extract quant (e.g., IQ4_XS, IQ3_M, Q4_K_M, Q5_K, Q8_0, F16)
  // 优先匹配 IQ 系列，再匹配 Q 系列
  const quantMatch = modelName.match(
    /IQ[1-4]_?(XXS|XS|S|M|NL)|Q[2-8]_?[Kk]?_?[MmSsLl]?|[Ff]16|BF16/i,
  );
  const quant = quantMatch ? quantMatch[0].toUpperCase() : "Unknown";

  // Estimate VRAM: model size + ~20% for KV cache overhead at 8k context
  const estimatedVramGB = sizeGB * 1.2;

  return {
    sizeGB: Math.round(sizeGB * 100) / 100,
    estimatedVramGB: Math.round(estimatedVramGB * 100) / 100,
    paramsB: paramsB,
    quant: quant,
    isOfficial: false,
  };
});

ipcMain.handle("get-hardware-specs", async () => {
  if (
    hardwareSpecsCache &&
    Date.now() - hardwareSpecsCache.at < HARDWARE_SPECS_CACHE_TTL_MS
  ) {
    return hardwareSpecsCache.data;
  }
  if (hardwareSpecsInFlight) {
    return hardwareSpecsInFlight;
  }

  const middlewareDir = getMiddlewarePath();
  const scriptPath = join(middlewareDir, "get_specs.py");
  const pythonCmd = getScriptPythonInfo();

  console.log("[HardwareSpecs] Middleware Dir:", middlewareDir);
  console.log("[HardwareSpecs] Python Cmd:", pythonCmd);
  console.log("[HardwareSpecs] Script Path:", scriptPath);

  hardwareSpecsInFlight = new Promise((resolve) => {
    if (!fs.existsSync(scriptPath)) {
      const err = `Spec script missing at: ${scriptPath}`;
      console.error(err);
      resolve({ error: err });
      return;
    }

    const proc = spawnPythonProcess(pythonCmd, ["get_specs.py"], {
      cwd: middlewareDir,
      // shell: false, // Default is false in helper
      // env merged in helper
    });

    let output = "";
    let errorOutput = "";
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const errMsg = "Get specs timeout - killing process";
      console.error(errMsg);
      proc.kill();
      resolve({ error: errMsg });
    }, 30000);

    if (proc.stdout) {
      proc.stdout.on("data", (d) => (output += d.toString()));
    }
    if (proc.stderr) {
      proc.stderr.on("data", (d) => (errorOutput += d.toString()));
    }

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      const errMsg = `Failed to spawn specs process: ${err.message}`;
      console.error(errMsg);
      resolve({ error: errMsg });
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const err = `Get specs failed (code ${code}): ${errorOutput}`;
        console.error(err);
        resolve({ error: err });
        return;
      }

      try {
        // Find JSON in output with unique markers
        const match = output.match(
          /__HW_SPEC_JSON_START__(.*?)__HW_SPEC_JSON_END__/s,
        );
        if (match) {
          const data = JSON.parse(match[1]);
          resolve(data);
        } else {
          // Legacy/Fallback parsing
          try {
            resolve(JSON.parse(output.trim()));
          } catch {
            const err = `No valid JSON found in specs output. Raw: ${output}`;
            console.error(err);
            resolve({ error: err });
          }
        }
      } catch (e) {
        const err = `Failed to parse specs: ${e}. Output: ${output}`;
        console.error(err);
        resolve({ error: err });
      }
    });
  });
  try {
    const result = await hardwareSpecsInFlight;
    hardwareSpecsCache = {
      at: Date.now(),
      data: result,
    };
    return result;
  } finally {
    hardwareSpecsInFlight = null;
  }
});

// 刷新 GPU 检测（清理缓存并重新探测）
ipcMain.handle("refresh-gpu-detection", async () => {
  clearGpuCache();
  const platformInfo = detectPlatform();
  console.log("[Platform] GPU detection refreshed:", platformInfo);
  return {
    os: platformInfo.os,
    arch: platformInfo.arch,
    backend: platformInfo.backend,
    binaryDir: platformInfo.binaryDir,
  };
});

ipcMain.handle("check-env-component", async (_event, component: string) => {
  const middlewareDir = getMiddlewarePath();
  const scriptPath = join(middlewareDir, "env_fixer.py");
  const pythonCmd = getScriptPythonInfo();

  console.log(`[EnvFixer] Checking component: ${component}`);

  return new Promise((resolve) => {
    if (!fs.existsSync(scriptPath)) {
      resolve({ success: false, error: `Script not found: ${scriptPath}` });
      return;
    }

    const proc = spawnPythonProcess(
      pythonCmd,
      ["env_fixer.py", "--check", "--json"],
      {
        cwd: middlewareDir,
      },
    );

    let output = "";
    let errorOutput = "";
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      resolve({ success: false, error: "Check timed out" });
    }, 30000);

    if (proc.stdout) {
      proc.stdout.on("data", (d) => (output += d.toString()));
    }
    if (proc.stderr) {
      proc.stderr.on("data", (d) => (errorOutput += d.toString()));
    }

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    proc.on("close", (_code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      try {
        // 稳健提取：优先从进程输出解析 JSON，失败则回退读取报告文件
        const mergedOutput = [output, errorOutput].filter(Boolean).join("\n");
        const report =
          extractLastJsonObject<any>(mergedOutput) ||
          readEnvReportFromFile<any>(middlewareDir);
        if (!report) {
          resolve({
            success: false,
            error: "Failed to parse report: no JSON object found",
            output,
            errorOutput,
          });
          return;
        }
        // 找到指定组件的信息
        const componentData = report.components?.find(
          (c: any) => c.name.toLowerCase() === component.toLowerCase(),
        );
        resolve({
          success: true,
          report,
          component: componentData || null,
        });
      } catch (e) {
        resolve({
          success: false,
          error: `Failed to parse report: ${e}`,
          output,
          errorOutput,
        });
      }
    });
  });
});

const runEnvCheckReport = (
  middlewareDir: string,
  pythonCmd: { type: "python"; path: string },
): Promise<
  | { ok: true; report: any }
  | { ok: false; error: string; output?: string; errorOutput?: string }
> =>
  new Promise((resolve) => {
    const proc = spawnPythonProcess(
      pythonCmd,
      ["env_fixer.py", "--check", "--json"],
      {
        cwd: middlewareDir,
      },
    );

    let output = "";
    let errorOutput = "";
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      resolve({ ok: false, error: "Check timed out", output, errorOutput });
    }, 60000);

    if (proc.stdout) {
      proc.stdout.on("data", (d) => (output += d.toString()));
    }
    if (proc.stderr) {
      proc.stderr.on("data", (d) => (errorOutput += d.toString()));
    }

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message, output, errorOutput });
    });

    proc.on("close", (_code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try {
        const mergedOutput = [output, errorOutput].filter(Boolean).join("\n");
        const report =
          extractLastJsonObject<any>(mergedOutput) ||
          readEnvReportFromFile<any>(middlewareDir);
        if (!report) {
          resolve({
            ok: false,
            error: "Failed to parse report: no JSON object found",
            output,
            errorOutput,
          });
          return;
        }
        resolve({ ok: true, report });
      } catch (error) {
        resolve({
          ok: false,
          error: `Failed to parse report: ${error}`,
          output,
          errorOutput,
        });
      }
    });
  });

ipcMain.removeHandler("check-env-component");
ipcMain.handle("check-env-component", async (_event, component: string) => {
  const middlewareDir = getMiddlewarePath();
  const scriptPath = join(middlewareDir, "env_fixer.py");
  const pythonCmd = getScriptPythonInfo();

  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `Script not found: ${scriptPath}` };
  }

  const now = Date.now();
  if (envCheckCache && now - envCheckCache.at < ENV_CHECK_CACHE_TTL_MS) {
    const componentData = envCheckCache.report?.components?.find(
      (c: any) => c.name.toLowerCase() === component.toLowerCase(),
    );
    return {
      success: true,
      report: envCheckCache.report,
      component: componentData || null,
    };
  }

  if (!envCheckInFlight) {
    console.log(`[EnvFixer] Checking environment (requested: ${component})`);
    envCheckInFlight = runEnvCheckReport(middlewareDir, pythonCmd);
  }

  const inFlight = envCheckInFlight;
  try {
    const result = await inFlight;
    if (!result.ok) {
      return {
        success: false,
        error: result.error,
        output: result.output,
        errorOutput: result.errorOutput,
      };
    }
    envCheckCache = {
      at: Date.now(),
      report: result.report,
    };
    const componentData = result.report?.components?.find(
      (c: any) => c.name.toLowerCase() === component.toLowerCase(),
    );
    return {
      success: true,
      report: result.report,
      component: componentData || null,
    };
  } finally {
    if (envCheckInFlight === inFlight) {
      envCheckInFlight = null;
    }
  }
});

ipcMain.handle("fix-env-component", async (_event, component: string) => {
  const middlewareDir = getMiddlewarePath();
  const scriptPath = join(middlewareDir, "env_fixer.py");
  const pythonCmd = getScriptPythonInfo();

  console.log(`[EnvFixer] Fixing component: ${component}`);
  envCheckCache = null;
  envCheckInFlight = null;

  return new Promise((resolve) => {
    if (!fs.existsSync(scriptPath)) {
      resolve({ success: false, error: `Script not found: ${scriptPath}` });
      return;
    }

    const proc = spawnPythonProcess(
      pythonCmd,
      ["env_fixer.py", "--fix", component, "--json"],
      {
        cwd: middlewareDir,
      },
    );

    let output = "";
    let errorOutput = "";
    let resolved = false;
    let stdoutBuffer = "";
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      resolve({ success: false, error: "Fix timed out (10 minutes)" });
    }, 600000); // 10 分钟超时
    if (proc.stdout) {
      proc.stdout.on("data", (d) => {
        stdoutBuffer += d.toString();
        // 解析进度并发送到前端（带分片拼接，避免跨 chunk JSON 断裂）
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith("__PROGRESS__:")) {
            try {
              const progressData = JSON.parse(
                trimmedLine.substring("__PROGRESS__:".length),
              );
              console.log(
                `[EnvFixer] Progress: ${progressData.stage} ${progressData.progress}%`,
              );
              // 将进度事件发送到前端
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("env-fix-progress", {
                  component,
                  ...progressData,
                });
              }
            } catch (e) {
              console.error("[EnvFixer] Failed to parse progress:", e);
            }
          } else if (trimmedLine.startsWith("{") && trimmedLine.endsWith("}")) {
            // 可能是结果 JSON 行，先收集后统一解析
            output += line + "\n";
          } else {
            output += line + "\n";
          }
        }
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", (d) => (errorOutput += d.toString()));
    }

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (stdoutBuffer.trim()) {
        output += stdoutBuffer + "\n";
      }

      try {
        // 清理 output 中可能夹杂的非 JSON 内容
        const mergedOutput = [output, errorOutput].filter(Boolean).join("\n");
        const result = extractLastJsonObject<any>(mergedOutput);
        if (!result) {
          resolve({
            success: false,
            error: "Failed to parse result: no JSON object found",
            output,
            errorOutput,
          });
          return;
        }
        resolve({
          success:
            result.fixResult?.success ||
            result.summary?.overallStatus === "ok" ||
            false,
          message:
            result.fixResult?.message ||
            (result.summary?.overallStatus === "ok" ? "修复成功" : "未知结果"),
          exitCode: code,
          output,
          errorOutput,
        });
      } catch (e) {
        resolve({
          success: false,
          error: `Failed to parse result: ${e}`,
          output,
          errorOutput,
        });
      }
    });
  });
});

ipcMain.handle("test-rules", async (_event, { text, rules }) => {
  const middlewareDir = getMiddlewarePath();
  const scriptPath = join(middlewareDir, "test_rules.py");
  const pythonCmd = getPythonPath();

  return new Promise((resolve) => {
    if (!fs.existsSync(scriptPath)) {
      resolve({ success: false, error: `Test script missing: ${scriptPath}` });
      return;
    }

    const proc = spawnPythonProcess(pythonCmd, ["test_rules.py"], {
      cwd: middlewareDir,
      // env merged in helper
    });

    let output = "";
    let errorOutput = "";

    proc.stdout?.on("data", (d) => (output += d.toString()));
    proc.stderr?.on("data", (d) => (errorOutput += d.toString()));

    // Send data to stdin
    if (proc.stdin) {
      proc.stdin.write(JSON.stringify({ text, rules }));
      proc.stdin.end();
    }

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: `Python error (code ${code}): ${errorOutput}`,
        });
        return;
      }
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        resolve({
          success: false,
          error: `Invalid JSON from Python: ${output}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: `Failed to spawn: ${err.message}` });
    });
  });
});

ipcMain.handle("get-glossaries", async () => {
  const userDataPath = getUserDataPath();
  const glossaryDir = join(userDataPath, "glossaries");
  if (!fs.existsSync(glossaryDir)) return [];
  return fs.readdirSync(glossaryDir).filter((f) => f.endsWith(".json"));
});

ipcMain.handle("open-glossary-folder", async () => {
  const userDataPath = getUserDataPath();
  const glossaryDir = join(userDataPath, "glossaries");
  if (!fs.existsSync(glossaryDir)) fs.mkdirSync(glossaryDir);
  shell.openPath(glossaryDir);
});

ipcMain.handle("save-glossary-file", async (_event, { filename, content }) => {
  const userDataPath = getUserDataPath();
  const glossaryDir = join(userDataPath, "glossaries");
  await fs.promises.mkdir(glossaryDir, { recursive: true });
  const safeFilename = basename(filename);
  const filePath = ensurePathWithinUserData(join(glossaryDir, safeFilename));
  await fs.promises.writeFile(filePath, content, "utf-8");
  return true;
});

ipcMain.handle("delete-glossary-file", async (_event, filename) => {
  const userDataPath = getUserDataPath();
  const filePath = ensurePathWithinUserData(
    join(userDataPath, "glossaries", basename(filename)),
  );
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
    return true;
  }
  return false;
});

ipcMain.handle("rename-glossary-file", async (_event, { oldName, newName }) => {
  const userDataPath = getUserDataPath();
  const glossaryDir = join(userDataPath, "glossaries");
  const oldPath = ensurePathWithinUserData(
    join(glossaryDir, basename(oldName)),
  );

  // Auto-append .json if missing
  let safeNewName = basename(newName);
  if (!safeNewName.endsWith(".json")) safeNewName += ".json";

  const newPath = ensurePathWithinUserData(join(glossaryDir, safeNewName));

  if (fs.existsSync(newPath)) {
    return { success: false, error: "Target filename already exists" };
  }

  if (fs.existsSync(oldPath)) {
    try {
      await fs.promises.rename(oldPath, newPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
  return { success: false, error: "Source file not found" };
});

ipcMain.handle("create-glossary-file", async (_event, arg) => {
  const userDataPath = getUserDataPath();
  const glossaryDir = join(userDataPath, "glossaries");
  await fs.promises.mkdir(glossaryDir, { recursive: true });
  let filename, content;

  // Support both direct string (filename only) and object ({filename, content})
  if (typeof arg === "string") {
    filename = basename(arg);
    content = "{}";
  } else {
    filename = basename(arg.filename);
    content = arg.content || "{}";
  }

  // Ensure ends with .json
  if (filename && !filename.endsWith(".json")) filename += ".json";

  const filePath = ensurePathWithinUserData(join(glossaryDir, filename));
  if (fs.existsSync(filePath)) {
    return { success: false, error: "File already exists" };
  }

  try {
    await fs.promises.writeFile(filePath, content, "utf-8");
    return { success: true, path: filePath };
  } catch (e) {
    console.error(e);
    return { success: false, error: String(e) };
  }
});

ipcMain.handle("read-glossary-file", async (_event, filename) => {
  const userDataPath = getUserDataPath();
  const filePath = ensurePathWithinUserData(
    join(userDataPath, "glossaries", basename(filename)),
  );
  if (fs.existsSync(filePath)) {
    return await fs.promises.readFile(filePath, "utf-8");
  }
  return null;
});

ipcMain.handle("read-file", async (_event, path: string) => {
  try {
    const safePath = ensureLocalFilePathForUserOperation(path);
    if (fs.existsSync(safePath)) {
      return await fs.promises.readFile(safePath, "utf-8");
    }
  } catch (e) {
    console.error("read-file denied or failed:", e);
    return null;
  }
  return null;
});

// 写入文件（用于导出译文）
ipcMain.handle("write-file", async (_event, path: string, content: string) => {
  try {
    const safePath = ensureLocalFilePathForUserOperation(path);
    await fs.promises.mkdir(dirname(safePath), { recursive: true });
    await fs.promises.writeFile(safePath, content, "utf-8");
    return true;
  } catch (e) {
    console.error("write-file error:", e);
    return false;
  }
});

// 加载翻译缓存（用于校对界面）
ipcMain.handle("load-cache", async (_event, cachePath: string) => {
  try {
    const safePath = ensureLocalFilePathForUserOperation(cachePath);
    if (fs.existsSync(safePath)) {
      const content = await fs.promises.readFile(safePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (e) {
    console.error("load-cache error:", e);
  }
  return null;
});

// 保存翻译缓存（用于校对界面）
ipcMain.handle(
  "save-cache",
  async (_event, cachePath: string, data: Record<string, unknown>) => {
    try {
      const safePath = ensureLocalFilePathForUserOperation(cachePath);
      await fs.promises.mkdir(dirname(safePath), { recursive: true });
      await fs.promises.writeFile(
        safePath,
        JSON.stringify(data, null, 2),
        "utf-8",
      );
      return true;
    } catch (e) {
      console.error("save-cache error:", e);
      return false;
    }
  },
);

// 重建文档（从缓存）
ipcMain.handle("rebuild-doc", async (_event, { cachePath, outputPath }) => {
  try {
    const safeCachePath = ensureLocalFilePathForUserOperation(cachePath);
    const safeOutputPath = outputPath
      ? ensureLocalFilePathForUserOperation(outputPath)
      : undefined;
    const middlewareDir = getMiddlewarePath();
    const scriptPath = join(middlewareDir, "murasaki_translator", "main.py");
    const pythonCmd = getPythonPath();

    const args = [
      scriptPath,
      "--file",
      "REBUILD_STUB", // Parser requires --file
      "--rebuild-from-cache",
      safeCachePath,
    ];

    if (safeOutputPath) {
      args.push("--output", safeOutputPath);
    }

    console.log("[Rebuild] Executing:", pythonCmd, args.join(" "));

    return new Promise((resolve) => {
      // const { spawn } = require('child_process') // Use global spawnPythonProcess
      const proc = spawnPythonProcess(pythonCmd, args, { cwd: middlewareDir });

      let errorOutput = "";
      if (proc.stderr) {
        proc.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });
      }

      proc.on("close", (code: number) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: errorOutput || `Process exited with code ${code}`,
          });
        }
      });
    });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    return { success: false, error: errorMsg };
  }
});

// 单块重翻（用于校对界面）
ipcMain.handle(
  "retranslate-block",
  async (event, { src, index, modelPath, config }) => {
    const middlewareDir = getMiddlewarePath();
    const scriptPath = join(middlewareDir, "murasaki_translator", "main.py");
    const pythonCmd = getPythonPath(); // Use the same python as main translation

    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: `Script not found` };
    }

    // Model Resolution Logic (Match start-translation)
    let effectiveModelPath = modelPath;
    const userDataPath = getUserDataPath();

    // 1. Check if direct path
    if (!fs.existsSync(effectiveModelPath)) {
      // 2. Check User Data models
      const userModel = join(userDataPath, "models", basename(modelPath));
      if (fs.existsSync(userModel)) {
        effectiveModelPath = userModel;
      } else {
        // 3. Check Middleware models (bundled)
        const bundledModel = join(middlewareDir, "models", basename(modelPath));
        if (fs.existsSync(bundledModel)) {
          effectiveModelPath = bundledModel;
        }
      }
    }

    const args = [
      "murasaki_translator/main.py", // Use relative path in cwd
      "--file",
      "dummy.txt", // Required by argparse
      "--single-block",
      src,
      "--model",
      effectiveModelPath,
      "--json-output", // Force JSON output for easy parsing
      "--debug", // Enable CoT logs
    ];

    // Apply Config (Reusing logic from start-translation simplified)
    if (config) {
      if (config.deviceMode === "cpu") {
        args.push("--gpu-layers", "0");
      } else {
        // 默认使用 -1（尽可能加载到 GPU），若用户指定则使用用户值
        const gpuLayers =
          config.gpuLayers !== undefined ? config.gpuLayers : -1;
        args.push("--gpu-layers", gpuLayers.toString());
      }

      if (config.ctxSize) args.push("--ctx", config.ctxSize);
      if (config.temperature)
        args.push("--temperature", config.temperature.toString());
      if (config.repPenaltyBase)
        args.push("--rep-penalty-base", config.repPenaltyBase.toString());
      if (config.repPenaltyMax)
        args.push("--rep-penalty-max", config.repPenaltyMax.toString());
      if (config.repPenaltyStep)
        args.push("--rep-penalty-step", config.repPenaltyStep.toString());
      if (config.preset) args.push("--preset", config.preset);

      // Force f16 KV Cache for single block re-translation (Quality Priority)
      args.push("--kv-cache-type", "f16");

      // Glossary Path
      if (config.glossaryPath && fs.existsSync(config.glossaryPath)) {
        args.push("--glossary", config.glossaryPath);
      }

      // Retry Strategy for Single Block
      if (config.maxRetries !== undefined) {
        args.push("--max-retries", config.maxRetries.toString());
      }
      if (config.retryTempBoost !== undefined) {
        args.push("--retry-temp-boost", config.retryTempBoost.toString());
      }
      if (config.retryPromptFeedback) {
        args.push("--retry-prompt-feedback");
      }
      if (config.outputHitThreshold !== undefined) {
        args.push(
          "--output-hit-threshold",
          config.outputHitThreshold.toString(),
        );
      }
      if (config.cotCoverageThreshold !== undefined) {
        args.push(
          "--cot-coverage-threshold",
          config.cotCoverageThreshold.toString(),
        );
      }
    }

    // Server Handling: Assume server is already running or provided
    // For single block, we might want to attach to existing server if possible?
    // main.py creates InferenceEngine which tries to find server.
    // If not running, it spawns one. Optimally, we want to reuse the one from Dashboard.
    // Dashboard typically starts one if daemon mode.
    // Let's check if ServerManager has a running instance.
    const sm = ServerManager.getInstance();
    const status = sm.getStatus();
    if (status.running && status.mode !== "api_v1") {
      args.push("--server", `http://127.0.0.1:${status.port}`);
      args.push("--no-server-spawn");
    } else if (status.running && status.mode === "api_v1") {
      console.warn(
        "[Retranslate] Local daemon is api_v1 mode, fallback to direct llama-server path for compatibility.",
      );
    }

    console.log("[Retranslate] Spawning:", pythonCmd, args.join(" "));

    return new Promise((resolve) => {
      const proc = spawnPythonProcess(pythonCmd, args, {
        cwd: middlewareDir,
        env: { CUDA_VISIBLE_DEVICES: config?.gpuDeviceId }, // Only pass custom vars, helper merges process.env and sanitizes
        stdio: ["ignore", "pipe", "pipe"],
      });

      let outputBuffer = "";
      let errorBuffer = "";

      if (proc.stdout) {
        proc.stdout.on("data", (data) => {
          const str = data.toString();
          outputBuffer += str;

          // Stream log to renderer
          // Filter out JSON_RESULT line from log view to keep it clean, or keep it?
          // The main log loop in main.py prints raw CoT.
          if (!str.startsWith("JSON_RESULT:")) {
            event.sender.send("retranslate-log", { index, text: str });
          }
        });
      }

      if (proc.stderr) {
        proc.stderr.on("data", (data) => {
          const str = data.toString();
          errorBuffer += str;

          // Filter out noisy llama-server logs (Same as start-translation)
          if (
            str.trim() === "." ||
            str.includes("llama_") ||
            str.includes("common_init") ||
            str.includes("srv ") ||
            str.startsWith("slot ") ||
            str.includes("sched_reserve")
          ) {
            return;
          }

          event.sender.send("retranslate-log", {
            index,
            text: str,
            isError: true,
          });
        });
      }

      proc.on("close", (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            error: errorBuffer || `Process exited with code ${code}`,
          });
          return;
        }

        // Parse Output
        try {
          // Find "JSON_RESULT:{...}"
          const marker = "JSON_RESULT:";
          const lines = outputBuffer.split("\n");
          let jsonStr = "";
          for (const line of lines) {
            if (line.trim().startsWith(marker)) {
              jsonStr = line.trim().substring(marker.length);
              break;
            }
          }

          if (jsonStr) {
            const result = JSON.parse(jsonStr);
            resolve(result);
          } else {
            // Fallback: try to find the last non-empty line if it looks like the result (legacy)
            // But we used --json-output so it should be there.
            resolve({
              success: false,
              error: "No JSON result found in output",
            });
          }
        } catch (e: unknown) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          resolve({ success: false, error: errorMsg });
        }
      });
    });
  },
);

// 保存文件对话框
ipcMain.handle(
  "save-file",
  async (
    _event,
    options: {
      title?: string;
      defaultPath?: string;
      filters?: Electron.FileFilter[];
    },
  ) => {
    const result = await dialog.showSaveDialog({
      title: options?.title || "Save File",
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: "All Files", extensions: ["*"] }],
    });
    return result.canceled ? null : result.filePath;
  },
);

// 打开文件（使用系统默认程序）
ipcMain.handle("open-path", async (_event, filePath: string) => {
  if (fs.existsSync(filePath)) {
    return await shell.openPath(filePath);
  }
  return "File not found";
});

// 在文件管理器中显示文件/文件夹
ipcMain.handle("open-folder", async (_event, filePath: string) => {
  if (!filePath || typeof filePath !== "string") return false;

  // Resolve middleware-relative paths and block traversal escapes.
  if (filePath.startsWith("middleware")) {
    const middlewareDir = getMiddlewarePath();
    const relativePart = filePath.replace(/^middleware[\\/]?/, "");
    const resolvedPath = resolve(middlewareDir, relativePart);
    if (!isPathWithinBase(resolvedPath, middlewareDir)) {
      console.warn(`[IPC] open-folder blocked path traversal: ${filePath}`);
      return false;
    }
    filePath = resolvedPath;

    if (!fs.existsSync(filePath)) {
      try {
        fs.mkdirSync(filePath, { recursive: true });
      } catch (e) {
        console.error("Failed to create dir: " + filePath);
      }
    }
  }

  if (fs.existsSync(filePath)) {
    // use openPath for directories to open INSIDE them, showItemInFolder selects them.
    // The user wants "Open Folder" to enter the directory.
    // If file, show item. If dir, open dir.
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      shell.openPath(filePath);
    } else {
      shell.showItemInFolder(filePath);
    }
    return true;
  }
  return false;
});

ipcMain.handle(
  "check-output-file-exists",
  async (_event, { inputFile, config }) => {
    try {
      const { basename, extname, join } = await import("path");
      const fs = await import("fs");

      let outPath = "";

      // Logic must match main.py and start-translation handler
      if (config.outputDir && fs.existsSync(config.outputDir)) {
        // Custom Directory logic: input_translated.ext
        // From line 773: const baseName = basename(inputFile, `.${ext}`)
        // But main.py uses os.path.splitext logic? NO, index.ts logic (773) is used to pass --output.
        // So if outputDir is active, MAIN.PY USES IT AS IS.
        // Index.ts logic:
        const ext = inputFile.split(".").pop(); // simple split
        // basename in node handling ext might be tricky if multiple dots.
        // Line 773: basename(inputFile, `.${ext}`)
        const baseName = basename(inputFile, `.${ext}`);
        const outFilename = `${baseName}_translated.${ext}`;
        outPath = join(config.outputDir, outFilename);
      } else {
        // Default logic from main.py:
        // output_path = f"{base}_{model_name}{ext}"
        const ext = extname(inputFile);
        const base = inputFile.substring(0, inputFile.length - ext.length);

        // 从模型路径提取模型名称（去掉扩展名）
        // 健壮性处理：兼容 Windows/POSIX 路径分隔符
        let modelName = "unknown";
        if (
          config.modelPath &&
          typeof config.modelPath === "string" &&
          config.modelPath.trim()
        ) {
          // 统一处理 Windows (\\) 和 POSIX (/) 分隔符
          const normalizedPath = config.modelPath.replace(/\\/g, "/");
          const fileName = normalizedPath.split("/").pop() || "";
          modelName = fileName.replace(/\.gguf$/i, "") || "unknown";
        }

        const suffix = `_${modelName}`;
        outPath = `${base}${suffix}${ext}`;
      }

      console.log("[check-output-file-exists] inputFile:", inputFile);
      console.log("[check-output-file-exists] outPath:", outPath);

      if (fs.existsSync(outPath)) {
        console.log("Detected existing output:", outPath);
        return { exists: true, path: outPath };
      }

      // 检测临时进度文件（翻译中断后的主要缓存）
      const tempPath = outPath + ".temp.jsonl";
      if (fs.existsSync(tempPath)) {
        console.log("Detected existing temp progress:", tempPath);
        return { exists: true, path: tempPath, isCache: true };
      }

      // 兼容旧版缓存文件
      const cachePath = outPath + ".cache.json";
      if (fs.existsSync(cachePath)) {
        console.log("Detected existing cache:", cachePath);
        return { exists: true, path: cachePath, isCache: true };
      }

      return { exists: false };
    } catch (e) {
      console.error("Check output error:", e);
      return { exists: false };
    }
  },
);

const normalizeRemoteUrl = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return raw.replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const resolveConfiguredRemoteUrl = (config: any): string => {
  const candidates = [
    config?.remoteUrl,
    config?.serverUrl,
    config?.config_remote_url,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeRemoteUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
};

const resolveConfiguredRemoteApiKey = (config: any): string | undefined => {
  const candidates = [config?.apiKey, config?.remoteApiKey, config?.config_api_key];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }
  return undefined;
};

const normalizeLineTolerancePct = (value: unknown, fallback: number = 0.2): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric > 1) return numeric / 100;
  if (numeric < 0) return 0;
  return numeric;
};

const resolveTranslationOutputPath = (
  inputFile: string,
  effectiveModelPath: string,
  config: any,
): string => {
  const outputDir = String(config?.outputDir || "").trim();
  if (outputDir && fs.existsSync(outputDir)) {
    const ext = inputFile.split(".").pop() || "";
    const baseName = ext ? basename(inputFile, `.${ext}`) : basename(inputFile);
    const outFilename = ext
      ? `${baseName}_translated.${ext}`
      : `${baseName}_translated`;
    return join(outputDir, outFilename);
  }

  const ext = inputFile.includes(".") ? `.${inputFile.split(".").pop()}` : "";
  const base = ext ? inputFile.slice(0, -ext.length) : inputFile;
  const normalizedPath = effectiveModelPath.replace(/\\/g, "/");
  const fileName = normalizedPath.split("/").pop() || "";
  const modelName = fileName.replace(/\.gguf$/i, "") || "unknown";
  return `${base}_${modelName}${ext}`;
};

const buildRemoteTranslateOptionsFromConfig = (
  config: any,
  effectiveModelPath: string,
  remoteFilePath: string,
): TranslateOptions => {
  const toInt = (value: unknown, fallback: number): number => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const toFloat = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const parsedGpuLayers = toInt(config?.gpuLayers, -1);
  const parsedSeed = Number.parseInt(String(config?.seed ?? ""), 10);

  return {
    filePath: remoteFilePath,
    model: effectiveModelPath || undefined,
    glossary: config?.glossaryPath,
    preset: config?.preset || "novel",
    mode: config?.mode || "doc",
    chunkSize: toInt(config?.chunkSize, 1000),
    ctx: toInt(config?.ctxSize, 8192),
    gpuLayers: config?.deviceMode === "cpu" ? 0 : parsedGpuLayers,
    temperature: toFloat(config?.temperature, 0.3),
    lineFormat: config?.lineFormat || "single",
    strictMode: config?.strictMode || "off",
    lineCheck: config?.lineCheck !== false,
    lineToleranceAbs: toInt(config?.lineToleranceAbs, 10),
    lineTolerancePct: normalizeLineTolerancePct(config?.lineTolerancePct, 0.2),
    traditional: config?.traditional === true,
    saveCot: config?.saveCot === true,
    saveSummary: config?.saveSummary === true,
    alignmentMode: config?.alignmentMode === true,
    resume: config?.resume === true,
    saveCache: config?.saveCache !== false,
    cachePath: config?.cacheDir,
    rulesPreInline: Array.isArray(config?.rulesPre) ? config.rulesPre : undefined,
    rulesPostInline: Array.isArray(config?.rulesPost) ? config.rulesPost : undefined,
    repPenaltyBase: toFloat(config?.repPenaltyBase, 1.0),
    repPenaltyMax: toFloat(config?.repPenaltyMax, 1.5),
    repPenaltyStep: toFloat(config?.repPenaltyStep, 0.1),
    maxRetries: toInt(config?.maxRetries, 3),
    outputHitThreshold: toFloat(config?.outputHitThreshold, 60),
    cotCoverageThreshold: toFloat(config?.cotCoverageThreshold, 80),
    coverageRetries: toInt(config?.coverageRetries, 3),
    retryTempBoost: toFloat(config?.retryTempBoost, 0.05),
    retryPromptFeedback: config?.retryPromptFeedback !== false,
    balanceEnable: config?.balanceEnable !== false,
    balanceThreshold: toFloat(config?.balanceThreshold, 0.6),
    balanceCount: toInt(config?.balanceCount, 3),
    parallel: Math.max(1, toInt(config?.concurrency, 1)),
    flashAttn: config?.flashAttn === true,
    kvCacheType: String(config?.kvCacheType || "f16"),
    useLargeBatch: config?.useLargeBatch === true,
    batchSize:
      toInt(config?.physicalBatchSize, 0) > 0
        ? toInt(config?.physicalBatchSize, 0)
        : undefined,
    seed:
      config?.seed === undefined || config?.seed === null || config?.seed === ""
        ? undefined
        : Number.isFinite(parsedSeed)
          ? parsedSeed
          : undefined,
    textProtect: config?.textProtect === true,
    protectPatterns: config?.protectPatterns,
    fixRuby: config?.fixRuby === true,
    fixKana: config?.fixKana === true,
    fixPunctuation: config?.fixPunctuation === true,
    gpuDeviceId: String(config?.gpuDeviceId || "").trim() || undefined,
  };
};

const appendRemoteMirrorMessage = (params: {
  taskId?: string;
  serverUrl?: string;
  model?: string;
  level?: string;
  message: string;
}) => {
  enqueueRemoteMirrorLog({
    timestamp: Date.now(),
    taskId: params.taskId,
    serverUrl: params.serverUrl,
    model: params.model,
    level: params.level || "info",
    message: params.message,
  });
};

const runTranslationViaRemoteApi = async (
  event: any,
  params: {
    client: RemoteClient;
    sourceLabel: string;
    inputFile: string;
    effectiveModelPath: string;
    config: any;
  },
) => {
  const { client, sourceLabel, inputFile, effectiveModelPath, config } = params;
  const outputPath = resolveTranslationOutputPath(inputFile, effectiveModelPath, config);
  let taskId = "";
  let nextLogIndex = 0;
  let lastProgressSig = "";
  const serverUrl = client.getBaseUrl?.() || "";
  let serverVersion = "";

  try {
    try {
      const health = await client.getHealth();
      serverVersion = health?.version || "";
    } catch {
      // ignore health fetch failure
    }
    event.reply("log-update", `System: Execution mode remote-api (${sourceLabel})\n`);
    // [Feature] 发送远程执行信息供 Dashboard 记录到翻译历史
    const remoteInfoPayload = {
      executionMode: "remote-api",
      source: sourceLabel,
      serverUrl,
      model: effectiveModelPath,
      serverVersion,
    };
    event.reply("log-update", `JSON_REMOTE_INFO:${JSON.stringify(remoteInfoPayload)}\n`);
    if (serverVersion) {
      appendRemoteMirrorMessage({
        taskId,
        serverUrl,
        model: effectiveModelPath,
        message: `System: Remote server version v${serverVersion}`,
      });
    }
    event.reply("log-update", "System: Uploading source file to remote server...\n");
    appendRemoteMirrorMessage({
      taskId,
      serverUrl,
      model: effectiveModelPath,
      message: "System: Uploading source file to remote server...",
    });
    const uploaded = await client.uploadFile(inputFile);
    event.reply("log-update", `System: Upload completed (${uploaded.fileId})\n`);
    appendRemoteMirrorMessage({
      taskId,
      serverUrl,
      model: effectiveModelPath,
      message: `System: Upload completed (${uploaded.fileId})`,
    });

    const options = buildRemoteTranslateOptionsFromConfig(
      config,
      effectiveModelPath,
      uploaded.serverPath,
    );
    const created = await client.createTranslation(options);
    taskId = created.taskId;
    remoteActiveTaskId = taskId;
    remoteTranslationBridge = {
      client,
      taskId,
      cancelRequested: false,
    };
    event.reply("log-update", `System: Remote task created (${taskId})\n`);
    appendRemoteMirrorMessage({
      taskId,
      serverUrl,
      model: effectiveModelPath,
      message: `System: Remote task created (${taskId})`,
    });
    event.reply(
      "log-update",
      `JSON_REMOTE_INFO:${JSON.stringify({
        ...remoteInfoPayload,
        taskId,
      })}\n`,
    );

    while (true) {
      if (!remoteTranslationBridge || remoteTranslationBridge.taskId !== taskId) return;
      const status = await client.getTaskStatus(taskId, {
        logFrom: nextLogIndex,
        logLimit: 200,
      });
      if (!remoteTranslationBridge || remoteTranslationBridge.taskId !== taskId) return;

      const taskLogs = Array.isArray(status.logs) ? status.logs : [];
      // 检查日志中是否已含 main.py 输出的 JSON_PROGRESS（含真实速度/token 数据）
      const logsContainProgress = taskLogs.some((log) => typeof log === "string" && log.includes("JSON_PROGRESS:"));
      if (taskLogs.length > 0) {
        event.reply("log-update", `${taskLogs.join("\n")}\n`);
        taskLogs.forEach((logLine) => {
          if (!logLine) return;
          appendRemoteMirrorMessage({
            taskId,
            serverUrl,
            model: effectiveModelPath,
            message: logLine,
          });
        });
      }
      if (typeof status.nextLogIndex === "number" && Number.isFinite(status.nextLogIndex)) {
        nextLogIndex = status.nextLogIndex;
      } else {
        nextLogIndex += taskLogs.length;
      }

      // 仅当日志中无 JSON_PROGRESS 时才发送补充性 block 进度
      // 避免用硬编码零值覆盖 main.py 的真实速度/token 数据
      if (!logsContainProgress) {
        const percentRaw =
          typeof status.progress === "number" && Number.isFinite(status.progress)
            ? status.progress <= 1
              ? status.progress * 100
              : status.progress
            : status.totalBlocks > 0
              ? (status.currentBlock / status.totalBlocks) * 100
              : 0;
        const progressPayload = {
          current: status.currentBlock || 0,
          total: status.totalBlocks || 0,
          percent: Math.max(0, Math.min(100, Number(percentRaw.toFixed(2)))),
        };
        const progressSig = `${progressPayload.current}/${progressPayload.total}/${progressPayload.percent}`;
        if (progressSig !== lastProgressSig) {
          event.reply("log-update", `JSON_PROGRESS:${JSON.stringify(progressPayload)}\n`);
          lastProgressSig = progressSig;
        }
      }

      if (status.status === "completed") {
        // [Fix Bug 6/7] 追加获取所有剩余日志，确保 JSON_FINAL/PREVIEW_BLOCK 不被 200 行分页截断
        if (typeof status.logTotal === "number" && nextLogIndex < status.logTotal) {
          const finalStatus = await client.getTaskStatus(taskId, {
            logFrom: nextLogIndex,
            logLimit: 1000,
          });
          const finalLogs = Array.isArray(finalStatus.logs) ? finalStatus.logs : [];
          if (finalLogs.length > 0) {
            event.reply("log-update", `${finalLogs.join("\n")}\n`);
            finalLogs.forEach((logLine) => {
              if (!logLine) return;
              appendRemoteMirrorMessage({
                taskId,
                serverUrl,
                model: effectiveModelPath,
                message: logLine,
              });
            });
          }
        }
        await client.downloadResult(taskId, outputPath);
        // [Fix Bug 8] 尝试下载缓存文件（用于校对）
        try {
          const cachePath = outputPath + ".cache.json";
          await client.downloadCache(taskId, cachePath);
        } catch (e) {
          // 缓存下载失败不影响主流程
        }
        appendRemoteMirrorMessage({
          taskId,
          serverUrl,
          model: effectiveModelPath,
          message: `System: Remote task completed (${taskId})`,
        });
        event.reply("log-update", `JSON_OUTPUT_PATH:${JSON.stringify({ path: outputPath })}\n`);
        event.reply("process-exit", { code: 0, signal: null, stopRequested: false });
        return;
      }

      if (status.status === "failed") {
        event.reply("log-update", `ERR: ${status.error || "Remote translation failed"}\n`);
        appendRemoteMirrorMessage({
          taskId,
          serverUrl,
          model: effectiveModelPath,
          level: "error",
          message: status.error || "Remote translation failed",
        });
        event.reply("process-exit", { code: 1, signal: null, stopRequested: false });
        return;
      }

      if (status.status === "cancelled") {
        event.reply("log-update", "[WARN] Remote translation cancelled by user\n");
        appendRemoteMirrorMessage({
          taskId,
          serverUrl,
          model: effectiveModelPath,
          level: "warn",
          message: "Remote translation cancelled by user",
        });
        event.reply("process-exit", { code: 1, signal: null, stopRequested: true });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stopRequested =
      translationStopRequested || remoteTranslationBridge?.cancelRequested === true;
    if (taskId && !remoteTranslationBridge && stopRequested) {
      return;
    }
    event.reply("log-update", `ERR: Remote translation failed. ${message}\n`);
    appendRemoteMirrorMessage({
      taskId,
      serverUrl,
      model: effectiveModelPath,
      level: "error",
      message: `Remote translation failed. ${message}`,
    });
    event.reply("process-exit", {
      code: 1,
      signal: null,
      stopRequested,
    });
  } finally {
    translationStopRequested = false;
    if (taskId && remoteActiveTaskId === taskId) {
      remoteActiveTaskId = null;
    }
    if (taskId && remoteTranslationBridge?.taskId === taskId) {
      remoteTranslationBridge = null;
    }
  }
};

ipcMain.on("start-translation", async (event, { inputFile, modelPath, config }) => {
  if (pythonProcess || remoteTranslationBridge) return; // Already running
  translationStopRequested = false;

  const middlewareDir = getMiddlewarePath();
  const tempRuleFiles: string[] = [];
  // Use the proper translator script
  const scriptPath = join(middlewareDir, "murasaki_translator", "main.py");

  if (!fs.existsSync(scriptPath)) {
    event.reply("log-update", `ERR: Script not found at ${scriptPath}`);
    return;
  }

  const pythonCmd = getPythonPath();
  console.log("Using Python:", pythonCmd);

  // 使用跨平台检测获取正确的二进制路径
  let serverExePath: string;
  try {
    const platformInfo = detectPlatform();
    event.reply(
      "log-update",
      `System: Platform ${platformInfo.os}/${platformInfo.arch}, Backend: ${platformInfo.backend}`,
    );
    serverExePath = getLlamaServerPath();
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    event.reply("log-update", `ERR: ${errorMsg}`);
    return;
  }

  const configuredRemoteUrl = resolveConfiguredRemoteUrl(config);
  const configuredRemoteApiKey = resolveConfiguredRemoteApiKey(config);
  const serverManager = ServerManager.getInstance();
  const daemonStatus = config?.daemonMode ? serverManager.getStatus() : null;
  const daemonConnection =
    daemonStatus?.running && daemonStatus.mode === "api_v1"
      ? serverManager.getConnectionInfo()
      : null;

  let remoteExecutionClient: RemoteClient | null = null;
  let remoteExecutionSource = "";

  if (remoteClient && remoteSession) {
    remoteExecutionClient = remoteClient;
    remoteExecutionSource =
      remoteSession.source === "local-daemon"
        ? "connected-local-daemon"
        : "connected-remote-session";
  } else if (daemonConnection?.url && config?.executionMode === "remote") {
    // 仅当用户明确选择远程模式时才为本地 daemon 创建 RemoteClient。
    // 本地翻译不走 HTTP API 桥接，避免轮询延迟导致的性能回退。
    remoteExecutionClient = new RemoteClient(
      {
        url: daemonConnection.url,
        apiKey: daemonConnection.apiKey,
      },
      remoteObserver,
    );
    remoteExecutionSource = "local-daemon-api_v1";
  } else if (configuredRemoteUrl && config?.executionMode === "remote") {
    remoteExecutionClient = new RemoteClient(
      {
        url: configuredRemoteUrl,
        apiKey: configuredRemoteApiKey,
      },
      remoteObserver,
    );
    remoteExecutionSource = "configured-remote-url";
  }

  const effectiveRemoteModelPath = (
    (typeof config?.remoteModel === "string" && config.remoteModel.trim()
      ? config.remoteModel.trim()
      : null) ||
    (typeof config?.modelPath === "string" && config.modelPath.trim()
      ? config.modelPath.trim()
      : null) ||
    modelPath ||
    ""
  ).trim();

  if (remoteExecutionClient) {
    await runTranslationViaRemoteApi(event, {
      client: remoteExecutionClient,
      sourceLabel: remoteExecutionSource,
      inputFile,
      effectiveModelPath: effectiveRemoteModelPath,
      config,
    });
    return;
  }

  // Model selection
  let effectiveModelPath =
    typeof config?.modelPath === "string" && config.modelPath.trim()
      ? config.modelPath.trim()
      : modelPath;
  const userDataPath = getUserDataPath();
  const middlewareRelativePrefix = /^middleware[\\/]?/;
  console.log("[start-translation] modelPath from frontend:", modelPath);
  console.log("[start-translation] config.modelPath:", config?.modelPath);
  console.log("[start-translation] userDataPath:", userDataPath);

  if (!effectiveModelPath) {
    // Auto-select from User Data models folder
    const modelDir = join(userDataPath, "models");
    console.log("[start-translation] Auto-selecting from:", modelDir);
    if (fs.existsSync(modelDir)) {
      const models = fs
        .readdirSync(modelDir)
        .filter((f) => f.endsWith(".gguf"));
      console.log("[start-translation] Available models:", models);
      if (models.length > 0) {
        effectiveModelPath = join(modelDir, models[0]);
        console.log("Auto-selected model:", effectiveModelPath);
      }
    }
  } else if (middlewareRelativePrefix.test(effectiveModelPath)) {
    const relativePart = effectiveModelPath.replace(middlewareRelativePrefix, "");
    effectiveModelPath = resolve(middlewareDir, relativePart);
    console.log(
      "[start-translation] Resolved middleware-relative model path to:",
      effectiveModelPath,
    );
  } else if (
    !effectiveModelPath.includes("\\") &&
    !effectiveModelPath.includes("/")
  ) {
    // Relative model name, resolve to full path in User Data
    effectiveModelPath = join(userDataPath, "models", effectiveModelPath);
    console.log(
      "[start-translation] Resolved relative path to:",
      effectiveModelPath,
    );
  }

  console.log("[start-translation] effectiveModelPath:", effectiveModelPath);
  console.log(
    "[start-translation] Model exists:",
    effectiveModelPath ? fs.existsSync(effectiveModelPath) : false,
  );

  if (!effectiveModelPath || !fs.existsSync(effectiveModelPath)) {
    console.error("[start-translation] Model not found, returning early");
    event.reply("log-update", `ERR: Model not found at ${effectiveModelPath}`);
    return;
  }

  console.log("[start-translation] Model check passed, building args...");

  // serverExePath 已在上面的 try-catch 中验证
  // Build args for murasaki_translator/main.py
  const args = [
    join("murasaki_translator", "main.py"),
    "--file",
    inputFile,
    "--model",
    effectiveModelPath,
  ];

  const configuredServerUrl = config?.executionMode === "remote" ? configuredRemoteUrl : "";
  const useRemoteServerUrl = (() => {
    if (!configuredServerUrl) return false;
    try {
      const parsed = new URL(configuredServerUrl);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  })();

  if (useRemoteServerUrl) {
    args.push("--server", configuredServerUrl);
    args.push("--no-server-spawn");
    console.log("[start-translation] Using configured remote server:", configuredServerUrl);
  } else if (config && config.daemonMode) {
    const sm = ServerManager.getInstance();
    const status = sm.getStatus();

    if (status.running && status.mode !== "api_v1") {
      // 非 api_v1 daemon：直接连接其 llama-server 端口
      args.push("--server", `http://127.0.0.1:${status.port}`);
      args.push("--no-server-spawn");
      console.log("[start-translation] Using local daemon server on port", status.port);
      event.reply("log-update", `System: Connected to local daemon on port ${status.port}`);
    } else if (status.running && status.mode === "api_v1") {
      // api_v1 daemon：API server 端口与 llama-server 协议不兼容，
      // 回退到标准 spawn（main.py 自行启动 llama-server）
      console.log("[start-translation] api_v1 daemon detected, using direct spawn for performance.");
      event.reply("log-update", "System: Local daemon(api_v1) detected, using direct spawn mode for best performance.");
      args.push("--server", serverExePath);
    } else {
      // Daemon 未运行，回退到标准 spawn
      args.push("--server", serverExePath);
    }
  } else {
    args.push("--server", serverExePath);
  }

  // Apply Advanced Config
  if (config) {
    // Device Mode Logic
    if (config.deviceMode === "cpu") {
      args.push("--gpu-layers", "0");
      console.log("Mode: CPU Only (Forced gpu-layers 0)");
    } else {
      // 默认使用 -1（尽可能加载到 GPU），若用户指定则使用用户值
      const gpuLayers = config.gpuLayers !== undefined ? config.gpuLayers : -1;
      args.push("--gpu-layers", gpuLayers.toString());
      console.log(`Mode: GPU with ${gpuLayers} layers`);
    }

    if (config.ctxSize) args.push("--ctx", config.ctxSize);
    if (config.chunkSize) args.push("--chunk-size", config.chunkSize);
    if (config.concurrency) {
      args.push("--concurrency", config.concurrency.toString());
    }

    // Chunk Balancing
    if (config.balanceEnable) {
      args.push("--balance-enable");
    }
    if (config.balanceThreshold !== undefined) {
      args.push("--balance-threshold", config.balanceThreshold.toString());
    }
    if (config.balanceCount) {
      args.push("--balance-count", config.balanceCount.toString());
    }

    // Fidelity & Performance Control (Granular)
    if (config.flashAttn) args.push("--flash-attn");
    if (config.kvCacheType) args.push("--kv-cache-type", config.kvCacheType);
    if (config.useLargeBatch) args.push("--use-large-batch");
    if (config.physicalBatchSize)
      args.push("--batch-size", config.physicalBatchSize.toString());

    if (
      config.seed !== undefined &&
      config.seed !== null &&
      config.seed !== ""
    ) {
      args.push("--seed", config.seed.toString());
    }

    // Custom Output Directory
    if (config.outputDir && fs.existsSync(config.outputDir)) {
      const ext = inputFile.split(".").pop();
      const baseName = basename(inputFile, `.${ext}`);
      const outFilename = `${baseName}_translated.${ext}`;
      const outPath = join(config.outputDir, outFilename);
      args.push("--output", outPath);
      console.log("Custom Output Path:", outPath);
    }

    // Glossary
    if (config.glossaryPath) {
      const gPath = config.glossaryPath;
      if (fs.existsSync(gPath)) {
        args.push("--glossary", gPath);
      } else {
        const managedPath = join(middlewareDir, "glossaries", gPath);
        if (fs.existsSync(managedPath)) {
          args.push("--glossary", managedPath);
        }
      }
    }

    if (config.preset) {
      args.push("--preset", config.preset);
    }

    if (config.lineFormat) {
      args.push("--line-format", config.lineFormat);
    }

    if (config.strictMode) {
      args.push("--strict-mode", config.strictMode);
    }

    // Debug/Save Options
    if (config.saveCot) {
      args.push("--save-cot");
    }
    if (config.alignmentMode) {
      args.push("--alignment-mode");
    }
    if (config.saveSummary) {
      args.push("--save-summary");
    }

    // User-defined Rules (written as temp files with unique names)
    if (config.rulesPre && config.rulesPre.length > 0) {
      const uid = require("crypto").randomUUID().slice(0, 8);
      const preRulesPath = join(middlewareDir, `temp_rules_pre_${uid}.json`);
      fs.writeFileSync(preRulesPath, JSON.stringify(config.rulesPre), "utf8");
      args.push("--rules-pre", preRulesPath);
      tempRuleFiles.push(preRulesPath);
    }
    if (config.rulesPost && config.rulesPost.length > 0) {
      const uid = require("crypto").randomUUID().slice(0, 8);
      const postRulesPath = join(middlewareDir, `temp_rules_post_${uid}.json`);
      fs.writeFileSync(postRulesPath, JSON.stringify(config.rulesPost), "utf8");
      args.push("--rules-post", postRulesPath);
      tempRuleFiles.push(postRulesPath);
    }

    // Quality Control Settings
    if (config.temperature !== undefined) {
      args.push("--temperature", config.temperature.toString());
    }
    if (config.lineCheck) {
      args.push("--line-check");
      args.push(
        "--line-tolerance-abs",
        (config.lineToleranceAbs || 20).toString(),
      );
      args.push(
        "--line-tolerance-pct",
        ((config.lineTolerancePct || 20) / 100).toString(),
      );
    }
    if (config.repPenaltyBase !== undefined) {
      args.push("--rep-penalty-base", config.repPenaltyBase.toString());
    }
    if (config.repPenaltyMax !== undefined) {
      args.push("--rep-penalty-max", config.repPenaltyMax.toString());
    }
    if (config.repPenaltyStep !== undefined) {
      args.push("--rep-penalty-step", config.repPenaltyStep.toString());
    }
    if (config.maxRetries !== undefined) {
      args.push("--max-retries", config.maxRetries.toString());
    }

    // Glossary Coverage Check（术语覆盖率检测）
    if (config.coverageCheck) {
      args.push(
        "--output-hit-threshold",
        (config.outputHitThreshold || 60).toString(),
      );
      args.push(
        "--cot-coverage-threshold",
        (config.cotCoverageThreshold || 80).toString(),
      );
      args.push("--coverage-retries", (config.coverageRetries || 3).toString());
    }

    // Incremental Translation（增量翻译）
    if (config.resume) {
      args.push("--resume");
    }

    // Text Protection（文本保护）

    // Dynamic Retry Strategy（动态重试策略）
    if (config.retryTempBoost !== undefined) {
      args.push("--retry-temp-boost", config.retryTempBoost.toString());
    }
    if (config.retryPromptFeedback) {
      args.push("--retry-prompt-feedback");
    }

    // Save Cache（默认启用，用于校对界面）
    if (config.saveCache !== false) {
      args.push("--save-cache");
      // Cache Directory
      if (config.cacheDir && fs.existsSync(config.cacheDir)) {
        args.push("--cache-path", config.cacheDir);
      }
    }
  }

  console.log("Spawning:", pythonCmd, args.join(" "), "in", middlewareDir);
  event.reply("log-update", `System: CMD: ${pythonCmd} ${args.join(" ")}`);
  event.reply("log-update", `System: CWD: ${middlewareDir}`);
  event.reply(
    "log-update",
    `System: Config - CTX: ${config?.ctxSize || "4096"}, Concurrency: ${config?.concurrency || "1"}, KV: ${config?.kvCacheType || "f16"}`,
  );

  // Set GPU ID if specified and not in CPU mode
  const customEnv: NodeJS.ProcessEnv = {};
  if (config?.deviceMode !== "cpu" && config?.gpuDeviceId) {
    customEnv["CUDA_VISIBLE_DEVICES"] = config.gpuDeviceId;
    console.log(`Setting CUDA_VISIBLE_DEVICES=${config.gpuDeviceId}`);
    event.reply(
      "log-update",
      `System: CUDA_VISIBLE_DEVICES=${config.gpuDeviceId}`,
    );
  }

  try {
    pythonProcess = spawnPythonProcess(pythonCmd, args, {
      cwd: middlewareDir,
      env: customEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    pythonProcess.on("error", (err) => {
      console.error("Spawn Error:", err);
      event.reply(
        "log-update",
        `CRITICAL ERROR: Failed to spawn python. ${err.message}`,
      );
      translationStopRequested = false;
      pythonProcess = null;
    });

    if (pythonProcess.stdout) {
      pythonProcess.stdout.on("data", (data) => {
        const str = data.toString();
        console.log("STDOUT:", str);
        event.reply("log-update", str);
      });
    }

    if (pythonProcess.stderr) {
      pythonProcess.stderr.on("data", (data) => {
        const str = data.toString();

        // Filter out noisy llama-server logs
        if (
          str.trim() === "." ||
          str.includes("llama_") ||
          str.includes("common_init") ||
          str.includes("srv ") ||
          str.startsWith("slot ") ||
          str.includes("sched_reserve")
        ) {
          // console.log('Suppressed log:', str) // Optional debug
          return;
        }

        console.error("STDERR:", str);
        // If it's still informational (e.g. from llama-server or python logging that wasn't redirected)
        if (str.includes("INFO") || str.includes("WARN")) {
          event.reply("log-update", `System: ${str}`);
        } else {
          event.reply("log-update", `ERR: ${str}`);
        }
      });
    }

    pythonProcess.on("close", (code, signal) => {
      const stopRequested = translationStopRequested;
      translationStopRequested = false;
      console.log(
        `[Translation] Process exited (code=${String(code)}, signal=${String(signal)}, stopRequested=${stopRequested})`,
      );
      event.reply("process-exit", {
        code,
        signal,
        stopRequested,
      });
      pythonProcess = null;
      // 清理临时规则文件
      for (const tmpFile of tempRuleFiles) {
        try {
          fs.unlinkSync(tmpFile);
        } catch (_) { }
      }
    });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    event.reply("log-update", `Exception: ${errorMsg}`);
    console.error(e);
  }
});

ipcMain.on("stop-translation", () => {
  if (remoteTranslationBridge) {
    translationStopRequested = true;
    const bridge = remoteTranslationBridge;
    bridge.cancelRequested = true;
    console.log(`[Stop] Cancelling remote task: ${bridge.taskId}`);
    mainWindow?.webContents.send("log-update", "System: Cancelling remote task...\n");
    const cancellingTaskId = bridge.taskId;
    setTimeout(() => {
      if (
        remoteTranslationBridge &&
        remoteTranslationBridge.taskId === cancellingTaskId &&
        remoteTranslationBridge.cancelRequested
      ) {
        remoteTranslationBridge = null;
        if (remoteActiveTaskId === cancellingTaskId) {
          remoteActiveTaskId = null;
        }
        mainWindow?.webContents.send("process-exit", {
          code: 1,
          signal: null,
          stopRequested: true,
        });
      }
    }, 8000);
    void bridge.client.cancelTask(bridge.taskId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      mainWindow?.webContents.send(
        "log-update",
        `ERR: Failed to cancel remote task immediately: ${message}\n`,
      );
    });
    return;
  }

  if (pythonProcess) {
    translationStopRequested = true;
    const pid = pythonProcess.pid;
    console.log(`[Stop] Stopping translation process with PID: ${pid}`);

    if (process.platform === "win32" && pid) {
      console.log(`[Stop] Executing async: taskkill /pid ${pid} /f /t`);
      const killProc = spawn("taskkill", ["/pid", pid.toString(), "/f", "/t"], {
        stdio: "pipe",
        windowsHide: true,
      });
      killProc.on("close", (code) => {
        console.log(`[Stop] taskkill exited with code ${code}`);
      });
      killProc.on("error", (err) => {
        console.error("[Stop] taskkill spawn error:", err.message);
        // Fallback
        try {
          pythonProcess?.kill();
        } catch (_) { }
      });
      // 超时兜底：3s 后若进程仍然存活
      setTimeout(() => {
        try {
          pythonProcess?.kill("SIGKILL");
        } catch (_) { }
      }, 3000);
    } else {
      pythonProcess.kill();
    }

    pythonProcess = null;

    console.log("[Stop] Translation process stopped signal sent");
  }
});

// --- Term Extraction ---
ipcMain.handle(
  "extract-terms",
  async (
    _event,
    options: { filePath?: string; text?: string; topK?: number },
  ) => {
    const middlewarePath = getMiddlewarePath();
    const pythonInfo = getScriptPythonInfo();
    const scriptPath = join(middlewarePath, "term_extractor.py");

    // Check script exists
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: "term_extractor.py not found" };
    }

    try {
      let inputPath = options.filePath;
      let tempFile: string | null = null;

      // If text provided instead of file, write to temp file
      if (!inputPath && options.text) {
        const tempDir = join(middlewarePath, "temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        tempFile = join(tempDir, `extract_input_${randomUUID()}.txt`);
        // Use async write to prevent UI blocking for large files
        await fs.promises.writeFile(tempFile, options.text, "utf-8");
        inputPath = tempFile;
      }

      if (!inputPath) {
        return { success: false, error: "No input provided" };
      }

      const args = [
        scriptPath,
        inputPath,
        "--simple",
        "-k",
        String(options.topK || 500),
      ];

      console.log(
        `[TermExtract] Running: ${pythonInfo.path} ${args.join(" ")}`,
      );

      return new Promise((resolve) => {
        const proc = spawnPythonProcess(pythonInfo, args, {
          cwd: middlewarePath,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        proc.stderr?.on("data", (data) => {
          const str = data.toString();
          stderr += str;
          // Send progress updates to renderer
          if (str.includes("[PROGRESS]")) {
            const match = str.match(/\[PROGRESS\]\s*([\d.]+)%/);
            if (match) {
              mainWindow?.webContents.send(
                "term-extract-progress",
                parseFloat(match[1]) / 100,
              );
            }
          }
        });

        proc.on("close", (code) => {
          // Cleanup temp file
          if (tempFile && fs.existsSync(tempFile)) {
            try {
              fs.unlinkSync(tempFile);
            } catch (_) { }
          }

          if (code === 0) {
            try {
              const terms = JSON.parse(stdout);
              resolve({ success: true, terms });
            } catch (e: unknown) {
              const errorMsg = e instanceof Error ? e.message : String(e);
              resolve({
                success: false,
                error: `JSON parse error: ${errorMsg}`,
                raw: stdout,
              });
            }
          } else {
            resolve({
              success: false,
              error: stderr || `Process exited with code ${code}`,
            });
          }
        });

        proc.on("error", (err) => {
          resolve({ success: false, error: err.message });
        });
      });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return { success: false, error: errorMsg };
    }
  },
);

// --- HuggingFace Download ---
let hfDownloadProcess: ReturnType<typeof spawn> | null = null;

ipcMain.handle("hf-list-repos", async (_event, orgName: string) => {
  const middlewarePath = getMiddlewarePath();
  const pythonInfo = getScriptPythonInfo();
  const scriptPath = join(middlewarePath, "hf_downloader.py");

  if (!fs.existsSync(scriptPath)) {
    return { error: "hf_downloader.py not found" };
  }

  return new Promise((resolve) => {
    const proc = spawnPythonProcess(
      pythonInfo,
      [scriptPath, "repos", orgName],
      {
        cwd: middlewarePath,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const result =
            extractLastJsonObject<any>(stdout) ||
            extractLastJsonObject<any>(stderr);
          if (result) resolve(result);
          else resolve({ error: "Failed to parse response", raw: stdout });
        } catch {
          resolve({ error: "Failed to parse response", raw: stdout });
        }
      } else {
        resolve({ error: stderr || `Process exited with code ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ error: err.message });
    });
  });
});

ipcMain.handle("hf-list-files", async (_event, repoId: string) => {
  const middlewarePath = getMiddlewarePath();
  const pythonInfo = getScriptPythonInfo();
  const scriptPath = join(middlewarePath, "hf_downloader.py");

  if (!fs.existsSync(scriptPath)) {
    return { error: "hf_downloader.py not found" };
  }

  return new Promise((resolve) => {
    const proc = spawnPythonProcess(pythonInfo, [scriptPath, "list", repoId], {
      cwd: middlewarePath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const result =
            extractLastJsonObject<any>(stdout) ||
            extractLastJsonObject<any>(stderr);
          if (result) resolve(result);
          else resolve({ error: "Failed to parse response", raw: stdout });
        } catch {
          resolve({ error: "Failed to parse response", raw: stdout });
        }
      } else {
        resolve({ error: stderr || `Process exited with code ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ error: err.message });
    });
  });
});

// Get models directory path
ipcMain.handle("get-models-path", async () => {
  const middlewarePath = getMiddlewarePath();
  return join(middlewarePath, "models");
});

ipcMain.handle(
  "hf-download-start",
  async (
    event,
    repoId: string,
    fileName: string,
    mirror: string = "direct",
  ) => {
    const middlewarePath = getMiddlewarePath();
    const pythonInfo = getScriptPythonInfo();
    const scriptPath = join(middlewarePath, "hf_downloader.py");
    const modelsPath = join(middlewarePath, "models");

    if (!fs.existsSync(scriptPath)) {
      event.sender.send("hf-download-error", {
        message: "hf_downloader.py not found",
      });
      return { success: false };
    }

    // 单例保护：防止并发下载导致孤儿进程
    if (hfDownloadProcess !== null) {
      console.warn(
        "[HF Download] Download already in progress, rejecting new request",
      );
      event.sender.send("hf-download-error", {
        message: "已有下载任务进行中，请等待完成或取消后再试",
      });
      return { success: false, error: "Download already in progress" };
    }

    // Ensure models directory exists
    if (!fs.existsSync(modelsPath)) {
      fs.mkdirSync(modelsPath, { recursive: true });
    }

    console.log(
      `[HF Download] Starting download: ${repoId}/${fileName} (mirror: ${mirror})`,
    );

    hfDownloadProcess = spawnPythonProcess(
      pythonInfo,
      [scriptPath, "download", repoId, fileName, modelsPath, mirror],
      {
        cwd: middlewarePath,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdoutBuffer = "";
    let terminalSignalHandled = false;
    hfDownloadProcess.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg =
            extractLastJsonObject<any>(trimmed) || tryParseJson<any>(trimmed);
          if (!msg) throw new Error("non-json output");
          if (msg.type === "progress") {
            event.sender.send("hf-download-progress", msg);
          } else if (msg.type === "complete") {
            event.sender.send("hf-download-progress", {
              ...msg,
              status: "complete",
              percent: 100,
            });
            terminalSignalHandled = true;
            hfDownloadProcess = null;
          } else if (msg.type === "error") {
            event.sender.send("hf-download-error", { message: msg.message });
            terminalSignalHandled = true;
            hfDownloadProcess = null;
          }
        } catch {
          console.log("[HF Download] stdout:", trimmed);
        }
      }
    });

    hfDownloadProcess.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      let handled = false;
      for (const line of lines) {
        const msg = extractLastJsonObject<any>(line) || tryParseJson<any>(line);
        if (!msg) continue;
        if (msg.type === "progress") {
          event.sender.send("hf-download-progress", msg);
          handled = true;
        } else if (msg.type === "complete") {
          event.sender.send("hf-download-progress", {
            ...msg,
            status: "complete",
            percent: 100,
          });
          terminalSignalHandled = true;
          handled = true;
        } else if (msg.type === "error") {
          event.sender.send("hf-download-error", { message: msg.message });
          terminalSignalHandled = true;
          handled = true;
        }
      }
      if (!handled) console.log("[HF Download] stderr:", text);
    });

    hfDownloadProcess.on("close", (code) => {
      const tail = stdoutBuffer.trim();
      if (tail) {
        try {
          const msg =
            extractLastJsonObject<any>(tail) || tryParseJson<any>(tail);
          if (!msg) throw new Error("non-json tail");
          if (msg.type === "progress") {
            event.sender.send("hf-download-progress", msg);
          } else if (msg.type === "complete") {
            event.sender.send("hf-download-progress", {
              ...msg,
              status: "complete",
              percent: 100,
            });
            terminalSignalHandled = true;
          } else if (msg.type === "error") {
            event.sender.send("hf-download-error", { message: msg.message });
            terminalSignalHandled = true;
          }
        } catch {
          // ignore tail parse failure
        }
      }
      console.log(`[HF Download] Process exited with code ${code}`);
      if (code !== 0 && !terminalSignalHandled) {
        event.sender.send("hf-download-error", {
          message: `Download process exited with code ${code}`,
        });
      }
      hfDownloadProcess = null;
    });

    hfDownloadProcess.on("error", (err) => {
      event.sender.send("hf-download-error", { message: err.message });
      hfDownloadProcess = null;
    });

    return { success: true };
  },
);

ipcMain.handle("hf-download-cancel", async () => {
  if (hfDownloadProcess) {
    console.log("[HF Download] Cancelling download...");
    const pid = hfDownloadProcess.pid;
    if (process.platform === "win32" && pid) {
      try {
        spawn("taskkill", ["/pid", pid.toString(), "/f", "/t"]);
      } catch {
        try {
          hfDownloadProcess.kill();
        } catch { }
      }
    } else {
      hfDownloadProcess.kill("SIGTERM");
    }
    hfDownloadProcess = null;
    return { success: true };
  }
  return { success: false, message: "No download in progress" };
});

// Verify model integrity against HuggingFace
ipcMain.handle(
  "hf-verify-model",
  async (_event, orgName: string, filePath: string) => {
    const middlewarePath = getMiddlewarePath();
    const pythonInfo = getScriptPythonInfo();
    const scriptPath = join(middlewarePath, "hf_downloader.py");

    console.log(`[HF Verify] Verifying ${filePath} against ${orgName}...`);

    if (!fs.existsSync(scriptPath)) {
      return { error: "hf_downloader.py not found" };
    }

    return new Promise((resolve) => {
      const proc = spawnPythonProcess(
        pythonInfo,
        [scriptPath, "verify", orgName, filePath],
        {
          cwd: middlewarePath,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const lines = stdout.trim().split("\n");
            for (const line of lines) {
              const parsed = JSON.parse(line);
              if (parsed.type === "verify_result") {
                resolve(parsed);
                return;
              }
            }
            resolve({ error: "No verification result" });
          } catch (e) {
            resolve({ error: `Parse error: ${e}` });
          }
        } else {
          resolve({ error: stderr || `Process exited with code ${code}` });
        }
      });

      proc.on("error", (err) => {
        resolve({ error: err.message });
      });
    });
  },
);

// Check network connectivity to HuggingFace
ipcMain.handle("hf-check-network", async () => {
  const middlewarePath = getMiddlewarePath();
  const pythonInfo = getScriptPythonInfo();
  const scriptPath = join(middlewarePath, "hf_downloader.py");

  if (!fs.existsSync(scriptPath)) {
    return { status: "error", message: "hf_downloader.py not found" };
  }

  return new Promise((resolve) => {
    const proc = spawnPythonProcess(pythonInfo, [scriptPath, "network"], {
      cwd: middlewarePath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const result =
            extractLastJsonObject<any>(stdout) ||
            extractLastJsonObject<any>(stderr);
          if (result) resolve(result);
          else
            resolve({ status: "error", message: "Failed to parse response" });
        } catch {
          resolve({ status: "error", message: "Failed to parse response" });
        }
      } else {
        resolve({
          status: "error",
          message: stderr || `Process exited with code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ status: "error", message: err.message });
    });
  });
});

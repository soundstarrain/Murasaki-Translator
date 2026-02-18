import { spawn, ChildProcess } from "child_process";
import { join, resolve, isAbsolute } from "path";
import fs from "fs";
import net from "net";
import os from "os";
import { randomBytes } from "crypto";
import { is } from "@electron-toolkit/utils";
import { getMiddlewarePath } from "./platform";

const getUserDataPath = () => getMiddlewarePath();

const DEFAULT_HOST = "127.0.0.1";
const LOCAL_ACCESS_HOST = "127.0.0.1";

interface ServerStatus {
  running: boolean;
  pid: number | null;
  port: number;
  host: string;
  endpoint: string;
  localEndpoint?: string;
  lanEndpoints?: string[];
  model: string | null;
  mode: "api_v1";
  authEnabled: boolean;
  apiKeyHint?: string;
  deviceMode: string;
  uptime: number;
  logs: string[];
}

interface ServerStartResult {
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
}

interface ServerConnectionInfo {
  url: string;
  apiKey?: string;
  host: string;
  port: number;
}

interface HttpJsonResponse<T> {
  statusCode: number;
  body: T | null;
}

interface DependencyCheckResult {
  ok: boolean;
  missing: string[];
}

const dedupeList = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

export class ServerManager {
  private static instance: ServerManager;
  private static readonly MAX_LOG_LINES = 2000;
  private static readonly PORT_SCAN_RANGE = 20;

  private process: ChildProcess | null = null;
  private port = 8000;
  private host = DEFAULT_HOST;
  private model: string | null = null;
  private deviceMode = "auto";
  private startTime = 0;
  private logs: string[] = [];
  private apiKey: string | null = null;

  private constructor() {}

  static getInstance(): ServerManager {
    if (!ServerManager.instance) {
      ServerManager.instance = new ServerManager();
    }
    return ServerManager.instance;
  }

  getStatus(): ServerStatus {
    const localEndpoint = this.getLocalAccessUrl();
    return {
      running: !!this.process,
      pid: this.process?.pid || null,
      port: this.port,
      host: this.host,
      endpoint: localEndpoint,
      localEndpoint,
      lanEndpoints: this.getLanAccessUrls(),
      model: this.model,
      mode: "api_v1",
      authEnabled: Boolean(this.apiKey),
      apiKeyHint: this.maskApiKey(this.apiKey),
      deviceMode: this.deviceMode,
      uptime: this.process ? (Date.now() - this.startTime) / 1000 : 0,
      logs: this.logs.slice(-50),
    };
  }

  getLogs(): string[] {
    return this.logs.slice();
  }

  getConnectionInfo(): ServerConnectionInfo | null {
    if (!this.process) return null;
    return {
      url: this.getLocalAccessUrl(),
      apiKey: this.apiKey || undefined,
      host: this.host,
      port: this.port,
    };
  }

  private appendLog(message: string): void {
    this.logs.push(message);
    if (this.logs.length > ServerManager.MAX_LOG_LINES) {
      this.logs = this.logs.slice(-ServerManager.MAX_LOG_LINES);
    }
  }

  private parseHost(rawHost: unknown): string {
    const host = String(rawHost || DEFAULT_HOST).trim();
    if (host === "0.0.0.0") return "0.0.0.0";
    if (host === "localhost") return DEFAULT_HOST;
    return DEFAULT_HOST;
  }

  private parseOptionalInteger(rawValue: unknown): number | null {
    if (rawValue === undefined || rawValue === null) return null;
    const normalized = String(rawValue).trim();
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getLocalAccessUrl(): string {
    return `http://${LOCAL_ACCESS_HOST}:${this.port}`;
  }

  private getLanAccessUrls(): string[] {
    if (this.host !== "0.0.0.0") return [];
    const interfaces = os.networkInterfaces() as Record<
      string,
      os.NetworkInterfaceInfo[] | undefined
    >;
    const urls = new Set<string>();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (!entry || entry.family !== "IPv4" || entry.internal) continue;
        const address = (entry.address || "").trim();
        if (!address) continue;
        urls.add(`http://${address}:${this.port}`);
      }
    }
    return Array.from(urls).sort();
  }

  private maskApiKey(value: string | null): string | undefined {
    if (!value) return undefined;
    if (value.length <= 8) return "********";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private isPortAvailable(port: number, host: string): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net.createServer();
      tester
        .once("error", () => {
          resolve(false);
        })
        .once("listening", () => {
          tester.close(() => resolve(true));
        })
        .listen(port, host);
    });
  }

  private async pickAvailablePort(
    preferredPort: number,
    host: string,
  ): Promise<number | null> {
    for (let i = 0; i <= ServerManager.PORT_SCAN_RANGE; i += 1) {
      const candidate = preferredPort + i;
      if (await this.isPortAvailable(candidate, host)) {
        return candidate;
      }
    }
    return null;
  }

  private resolvePythonPathCandidates(middlewareDir: string): string[] {
    const envPython = process.env.ELECTRON_PYTHON_PATH?.trim();
    const resourcesPath =
      typeof process.resourcesPath === "string" ? process.resourcesPath : "";

    const candidates: string[] = [
      ...(is.dev && envPython ? [envPython] : []),
      ...(process.platform === "win32"
        ? [
            join(middlewareDir, ".venv", "Scripts", "python.exe"),
            join(middlewareDir, "python_env", "python.exe"),
            join(resourcesPath, "python_env", "python.exe"),
          ]
        : [
            join(middlewareDir, ".venv", "bin", "python3"),
            join(middlewareDir, ".venv", "bin", "python"),
            join(middlewareDir, "python_env", "bin", "python3"),
            join(middlewareDir, "python_env", "bin", "python"),
            join(resourcesPath, "python_env", "bin", "python3"),
            join(resourcesPath, "python_env", "bin", "python"),
          ]),
      process.platform === "win32" ? "python" : "python3",
    ];

    const resolved: string[] = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (
        candidate === "python" ||
        candidate === "python3" ||
        fs.existsSync(candidate)
      ) {
        resolved.push(candidate);
      }
    }

    return dedupeList(resolved);
  }

  private resolvePythonPath(middlewareDir: string): string {
    const candidates = this.resolvePythonPathCandidates(middlewareDir);
    return (
      candidates[0] || (process.platform === "win32" ? "python" : "python3")
    );
  }

  private resolveModelPath(modelPath: string, middlewareDir: string): string {
    const userDataPath = getUserDataPath();
    let effectiveModelPath = modelPath;
    const middlewareRelativePrefix = /^middleware[\\/]?/;
    if (middlewareRelativePrefix.test(effectiveModelPath)) {
      const relativePart = effectiveModelPath.replace(
        middlewareRelativePrefix,
        "",
      );
      effectiveModelPath = resolve(middlewareDir, relativePart);
    } else if (!isAbsolute(effectiveModelPath)) {
      const candidatePaths = [
        resolve(effectiveModelPath),
        resolve(middlewareDir, effectiveModelPath),
        join(userDataPath, "models", effectiveModelPath),
      ];
      const existingPath = candidatePaths.find((path) => fs.existsSync(path));
      effectiveModelPath =
        existingPath || join(userDataPath, "models", effectiveModelPath);
    }
    return effectiveModelPath;
  }

  private async checkApiServerDependencies(
    pythonPath: string,
  ): Promise<DependencyCheckResult> {
    const probeScript = `
import importlib.util
import json
import sys

modules = ["fastapi", "uvicorn", "httpx", "pydantic", "multipart"]
missing = [name for name in modules if importlib.util.find_spec(name) is None]
print(json.dumps({"missing": missing}))
sys.exit(0 if not missing else 3)
`.trim();

    return await new Promise<DependencyCheckResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(pythonPath, ["-c", probeScript], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });

      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore timeout kill failures
        }
      }, 10000);

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.once("error", () => {
        clearTimeout(timer);
        resolve({
          ok: false,
          missing: [],
        });
      });

      child.once("close", (code) => {
        clearTimeout(timer);
        const output = `${stdout}\n${stderr}`.trim();
        if (code === 0) {
          resolve({ ok: true, missing: [] });
          return;
        }

        const match = output.match(/\{[\s\S]*"missing"[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]) as { missing?: string[] };
            const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
            resolve({ ok: missing.length === 0, missing });
            return;
          } catch {
            // fallback below
          }
        }

        resolve({
          ok: false,
          missing: [],
        });
      });
    });
  }

  private waitForProcessClose(
    processRef: ChildProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (processRef.exitCode !== null || processRef.signalCode !== null) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), timeoutMs);
      processRef.once("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private async killWindowsProcessTree(pid: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/F", "/T", "/PID", pid.toString()], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      const timer = setTimeout(() => {
        try {
          killer.kill("SIGKILL");
        } catch {
          // Ignore kill failure
        }
        resolve();
      }, 6000);

      killer.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      killer.once("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async killUnixProcessTree(
    processRef: ChildProcess,
    pid: number,
  ): Promise<void> {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Process group may not exist
    }
    try {
      processRef.kill("SIGTERM");
    } catch {
      // Process may already be gone
    }

    const gracefulClosed = await this.waitForProcessClose(processRef, 1500);
    if (gracefulClosed) return;

    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Ignore
    }
    try {
      processRef.kill("SIGKILL");
    } catch {
      // Ignore
    }
    await this.waitForProcessClose(processRef, 1000);
  }

  private async requestJson<T = any>(
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: unknown,
    options?: { withAuth?: boolean; timeoutMs?: number },
  ): Promise<HttpJsonResponse<T>> {
    const http = await import("http");
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (requestBody !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(requestBody).toString();
    }

    const withAuth = options?.withAuth ?? true;
    if (withAuth && this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: LOCAL_ACCESS_HOST,
          port: this.port,
          path,
          method,
          headers,
          timeout: options?.timeoutMs ?? 5000,
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => {
            raw += chunk.toString();
          });
          res.on("end", () => {
            let parsed: T | null = null;
            if (raw.trim().length > 0) {
              try {
                parsed = JSON.parse(raw) as T;
              } catch {
                parsed = null;
              }
            }
            resolve({
              statusCode: res.statusCode || 0,
              body: parsed,
            });
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error(`Request timeout: ${method} ${path}`));
      });

      if (requestBody !== undefined) {
        req.write(requestBody);
      }
      req.end();
    });
  }

  private async waitForApiReady(
    timeoutMs: number,
  ): Promise<{ ok: boolean; error?: string }> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "Unknown startup error";

    while (Date.now() < deadline) {
      if (!this.process) {
        return { ok: false, error: "API server process exited unexpectedly." };
      }

      try {
        const health = await this.requestJson<{ status?: string }>(
          "/health",
          "GET",
          undefined,
          { withAuth: false, timeoutMs: 1500 },
        );
        if (health.statusCode >= 200 && health.statusCode < 300) {
          return { ok: true };
        }
        lastError = `Health check HTTP ${health.statusCode}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return { ok: false, error: lastError };
  }

  async start(config: any): Promise<ServerStartResult> {
    if (this.process) {
      const localEndpoint = this.getLocalAccessUrl();
      return {
        success: true,
        selectedPort: this.port,
        requestedPort: this.port,
        portChanged: false,
        host: this.host,
        endpoint: localEndpoint,
        localEndpoint,
        lanEndpoints: this.getLanAccessUrls(),
        apiKey: this.apiKey || undefined,
      };
    }

    this.logs = [];
    this.model = config?.model || null;
    this.deviceMode = config?.deviceMode || "auto";

    if (!this.model) {
      return {
        success: false,
        error: "Model is required for local API daemon.",
      };
    }

    const requestedHost = this.parseHost(config?.host);
    const customPort = config?.port
      ? Number.parseInt(String(config.port), 10)
      : 8000;
    const preferredPort =
      Number.isFinite(customPort) && customPort > 0 ? customPort : 8000;
    const selectedPort = await this.pickAvailablePort(
      preferredPort,
      requestedHost,
    );

    if (!selectedPort) {
      return {
        success: false,
        error: `No available port found in range ${preferredPort}-${preferredPort + ServerManager.PORT_SCAN_RANGE}`,
      };
    }

    this.host = requestedHost;
    this.port = selectedPort;
    const portChanged = selectedPort !== preferredPort;
    if (portChanged) {
      this.appendLog(
        `[Port] Requested ${preferredPort} is occupied, switched to ${selectedPort}.`,
      );
    }

    const middlewareDir = getMiddlewarePath();
    const apiServerScript = join(middlewareDir, "server", "api_server.py");
    if (!fs.existsSync(apiServerScript)) {
      return {
        success: false,
        error: `API server script not found: ${apiServerScript}`,
      };
    }

    const effectiveModelPath = this.resolveModelPath(this.model, middlewareDir);
    if (!fs.existsSync(effectiveModelPath)) {
      const msg = `Model not found: ${effectiveModelPath}`;
      this.appendLog(msg);
      return { success: false, error: msg };
    }
    this.model = effectiveModelPath;

    const pythonCandidates = this.resolvePythonPathCandidates(middlewareDir);
    let pythonPath = this.resolvePythonPath(middlewareDir);
    let depCheck = await this.checkApiServerDependencies(pythonPath);
    if (!depCheck.ok) {
      for (const candidate of pythonCandidates) {
        if (candidate === pythonPath) continue;
        const fallbackCheck = await this.checkApiServerDependencies(candidate);
        if (fallbackCheck.ok) {
          this.appendLog(
            `[Daemon] Python fallback activated: ${pythonPath} -> ${candidate}`,
          );
          pythonPath = candidate;
          depCheck = fallbackCheck;
          break;
        }
      }
    }
    if (!depCheck.ok) {
      const missingText =
        depCheck.missing.length > 0
          ? depCheck.missing.join(", ")
          : "fastapi/uvicorn stack";
      const requirementsPath = join(
        middlewareDir,
        "server",
        "requirements.txt",
      );
      return {
        success: false,
        error: `Missing Python dependencies (${missingText}). Run: "${pythonPath}" -m pip install -r "${requirementsPath}". Python candidates: ${pythonCandidates.join(", ")}`,
      };
    }
    const providedApiKey = String(config?.apiKey || "").trim();
    this.apiKey = providedApiKey || randomBytes(16).toString("hex");
    const configuredCtx = this.parseOptionalInteger(config?.ctxSize);
    const configuredGpuLayers = this.parseOptionalInteger(config?.gpuLayers);
    const configuredBatchSize = this.parseOptionalInteger(
      config?.physicalBatchSize,
    );
    const configuredParallel = this.parseOptionalInteger(config?.concurrency);
    const configuredSeed = this.parseOptionalInteger(config?.seed);
    const configuredKvCacheType = String(config?.kvCacheType || "").trim();
    const configuredFlashAttn = config?.flashAttn === true;
    const configuredUseLargeBatch = config?.useLargeBatch === true;
    const effectiveGpuLayers =
      this.deviceMode === "cpu" ? 0 : configuredGpuLayers;

    const args = [
      apiServerScript,
      "--host",
      this.host,
      "--port",
      String(this.port),
      "--model",
      effectiveModelPath,
      "--api-key",
      this.apiKey,
    ];

    if (configuredCtx !== null && configuredCtx > 0) {
      args.push("--ctx", String(configuredCtx));
    }
    if (effectiveGpuLayers !== null) {
      args.push("--gpu-layers", String(effectiveGpuLayers));
    }
    if (configuredBatchSize !== null && configuredBatchSize > 0) {
      args.push("--batch-size", String(configuredBatchSize));
    }
    if (configuredParallel !== null && configuredParallel > 0) {
      args.push("--parallel", String(configuredParallel));
    }
    if (configuredFlashAttn) {
      args.push("--flash-attn");
    }
    if (configuredKvCacheType) {
      args.push("--kv-cache-type", configuredKvCacheType);
    }
    if (configuredUseLargeBatch) {
      args.push("--use-large-batch");
    }
    if (configuredSeed !== null) {
      args.push("--seed", String(configuredSeed));
    }

    this.appendLog(
      `[Daemon] Local API mode enabled on ${this.host}:${this.port}`,
    );
    this.appendLog(`[Daemon] Using model: ${effectiveModelPath}`);
    this.appendLog(`[Daemon] Python: ${pythonPath}`);
    this.appendLog(`[Daemon] API key: ${this.maskApiKey(this.apiKey)}`);

    const env = { ...process.env };

    if (configuredCtx !== null && configuredCtx > 0) {
      env.MURASAKI_DEFAULT_CTX = String(configuredCtx);
    } else {
      delete env.MURASAKI_DEFAULT_CTX;
    }

    if (this.deviceMode !== "cpu" && config?.gpuDeviceId !== undefined) {
      const gpuDeviceId = String(config.gpuDeviceId).trim();
      if (gpuDeviceId.length > 0) {
        env.CUDA_VISIBLE_DEVICES = gpuDeviceId;
      }
    }

    if (effectiveGpuLayers !== null) {
      env.MURASAKI_DEFAULT_GPU_LAYERS = String(effectiveGpuLayers);
    } else {
      delete env.MURASAKI_DEFAULT_GPU_LAYERS;
    }

    if (configuredBatchSize !== null && configuredBatchSize > 0) {
      env.MURASAKI_DEFAULT_BATCH = String(configuredBatchSize);
    } else {
      delete env.MURASAKI_DEFAULT_BATCH;
    }
    if (configuredParallel !== null && configuredParallel > 0) {
      env.MURASAKI_DEFAULT_CONCURRENCY = String(configuredParallel);
    } else {
      delete env.MURASAKI_DEFAULT_CONCURRENCY;
    }
    if (configuredFlashAttn) {
      env.MURASAKI_DEFAULT_FLASH_ATTN = "1";
    } else {
      env.MURASAKI_DEFAULT_FLASH_ATTN = "0";
    }
    if (configuredKvCacheType) {
      env.MURASAKI_DEFAULT_KV_CACHE_TYPE = configuredKvCacheType;
    } else {
      delete env.MURASAKI_DEFAULT_KV_CACHE_TYPE;
    }
    if (configuredUseLargeBatch) {
      env.MURASAKI_DEFAULT_USE_LARGE_BATCH = "1";
    } else {
      env.MURASAKI_DEFAULT_USE_LARGE_BATCH = "0";
    }
    if (configuredSeed !== null) {
      env.MURASAKI_DEFAULT_SEED = String(configuredSeed);
    } else {
      delete env.MURASAKI_DEFAULT_SEED;
    }

    this.appendLog(
      `[Daemon] Effective defaults: ctx=${env.MURASAKI_DEFAULT_CTX || "inherit"}, gpu_layers=${env.MURASAKI_DEFAULT_GPU_LAYERS || "inherit"}, batch=${env.MURASAKI_DEFAULT_BATCH || "inherit"}, parallel=${env.MURASAKI_DEFAULT_CONCURRENCY || "inherit"}, flash_attn=${env.MURASAKI_DEFAULT_FLASH_ATTN || "0"}, kv=${env.MURASAKI_DEFAULT_KV_CACHE_TYPE || "inherit"}, large_batch=${env.MURASAKI_DEFAULT_USE_LARGE_BATCH || "0"}, seed=${env.MURASAKI_DEFAULT_SEED || "inherit"}`,
    );

    try {
      this.process = spawn(pythonPath, args, {
        cwd: middlewareDir,
        env,
        shell: false,
        detached: process.platform !== "win32",
      });
      this.startTime = Date.now();

      this.process.stdout?.on("data", (d) => {
        const text = d.toString().trim();
        if (text) this.appendLog(text);
      });

      this.process.stderr?.on("data", (d) => {
        const text = d.toString().trim();
        if (text) this.appendLog(text);
      });

      this.process.on("close", (code, signal) => {
        if (code === null) {
          this.appendLog(
            `Process terminated by signal ${signal || "unknown"} (no exit code).`,
          );
        } else {
          this.appendLog(`Process exited with code ${code}`);
        }
        this.process = null;
        this.model = null;
        this.apiKey = null;
      });

      this.process.on("error", (error) => {
        this.appendLog(`Spawn error: ${error.message}`);
        this.process = null;
        this.model = null;
        this.apiKey = null;
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const ready = await this.waitForApiReady(15000);
    if (!ready.ok) {
      const failureLogs = this.logs.slice(-20);
      const compactFailureTail = failureLogs
        .slice(-8)
        .map((line) =>
          String(line || "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .join(" || ");
      const failureText = failureLogs.join(" ").toLowerCase();
      const looksLikeBindConflict =
        failureText.includes("address already in use") ||
        failureText.includes("eaddrinuse") ||
        failureText.includes("10048") ||
        failureText.includes("only one usage of each socket address");
      const retryDepth = Number(config?._daemonRetryDepth || 0);

      if (looksLikeBindConflict && retryDepth < 3) {
        const retryPort = await this.pickAvailablePort(
          this.port + 1,
          this.host,
        );
        if (retryPort && retryPort !== this.port) {
          this.appendLog(
            `[Port] Bind conflict detected on ${this.port}, retrying with ${retryPort}.`,
          );
          await this.stop();
          return this.start({
            ...config,
            port: retryPort,
            _daemonRetryDepth: retryDepth + 1,
          });
        }
      }

      const lastLog = failureLogs[failureLogs.length - 1];
      await this.stop();
      return {
        success: false,
        error: `Local API daemon failed to start on ${this.host}:${this.port}: ${ready.error || "health check timeout"}${lastLog ? ` | Last log: ${lastLog}` : ""}${compactFailureTail ? ` | Tail: ${compactFailureTail}` : ""}`,
      };
    }

    const localEndpoint = this.getLocalAccessUrl();
    const lanEndpoints = this.getLanAccessUrls();
    this.appendLog(`[Daemon] Ready at ${localEndpoint}`);
    if (lanEndpoints.length > 0) {
      this.appendLog(`[Daemon] LAN endpoints: ${lanEndpoints.join(", ")}`);
    }
    return {
      success: true,
      selectedPort: this.port,
      requestedPort: preferredPort,
      portChanged,
      host: this.host,
      endpoint: localEndpoint,
      localEndpoint,
      lanEndpoints,
      apiKey: this.apiKey || undefined,
    };
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    const managedProcess = this.process;
    const pid = managedProcess.pid;
    this.appendLog("Stopping local API daemon...");

    try {
      managedProcess.kill("SIGTERM");
    } catch {
      // Ignore if process already exited
    }

    if (pid) {
      if (process.platform === "win32") {
        await this.killWindowsProcessTree(pid);
      } else {
        await this.killUnixProcessTree(managedProcess, pid);
      }
    } else if (
      managedProcess.exitCode === null &&
      managedProcess.signalCode === null
    ) {
      await this.waitForProcessClose(managedProcess, 1500);
    }

    // Extra safety: kill persisted llama-server PID if present
    if (process.platform === "win32") {
      try {
        const pidFile = resolve(getMiddlewarePath(), "llama-daemon.pid");
        if (fs.existsSync(pidFile)) {
          const raw = fs.readFileSync(pidFile, "utf-8").trim();
          const parsed = Number.parseInt(raw, 10);
          if (Number.isFinite(parsed)) {
            await this.killWindowsProcessTree(parsed);
          }
          try {
            fs.unlinkSync(pidFile);
          } catch {
            // ignore pid file cleanup failure
          }
        }
      } catch {
        // ignore pid cleanup failure
      }
    }

    this.process = null;
    this.model = null;
    this.apiKey = null;
  }

  async warmup(): Promise<{
    success: boolean;
    durationMs?: number;
    error?: string;
  }> {
    if (!this.process) {
      return { success: false, error: "Server not running" };
    }

    const startedAt = Date.now();
    try {
      const status = await this.requestJson<{ model_loaded?: boolean }>(
        "/api/v1/status",
        "GET",
      );
      if (status.statusCode >= 400) {
        return {
          success: false,
          error: `Status check failed (HTTP ${status.statusCode})`,
        };
      }

      if (status.body?.model_loaded) {
        const durationMs = Date.now() - startedAt;
        this.appendLog(
          `Warmup skipped: model already loaded (${durationMs}ms)`,
        );
        return { success: true, durationMs };
      }

      const createTask = await this.requestJson<{
        task_id?: string;
        message?: string;
      }>("/api/v1/translate", "POST", {
        text: "Warmup request",
        model: this.model,
        line_check: false,
        parallel: 1,
        temperature: 0.1,
        save_cache: false,
        save_cot: false,
        save_summary: false,
      });

      if (createTask.statusCode >= 400 || !createTask.body?.task_id) {
        return {
          success: false,
          error:
            createTask.body?.message ||
            `Warmup create failed (HTTP ${createTask.statusCode})`,
        };
      }

      const taskId = createTask.body.task_id;
      const timeoutAt = Date.now() + 120000;
      while (Date.now() < timeoutAt) {
        const taskStatus = await this.requestJson<{
          status?: string;
          error?: string;
        }>(`/api/v1/translate/${taskId}?log_from=0&log_limit=1`, "GET");

        if (taskStatus.statusCode >= 400) {
          return {
            success: false,
            error: `Warmup status failed (HTTP ${taskStatus.statusCode})`,
          };
        }

        const state = taskStatus.body?.status;
        if (state === "completed") {
          const durationMs = Date.now() - startedAt;
          this.appendLog(`Warmup completed in ${durationMs}ms`);
          return { success: true, durationMs };
        }
        if (state === "failed" || state === "cancelled") {
          return {
            success: false,
            error:
              taskStatus.body?.error || `Warmup ended with status ${state}`,
          };
        }

        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      return { success: false, error: "Warmup timeout (120s)" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

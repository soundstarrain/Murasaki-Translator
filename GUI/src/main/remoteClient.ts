/**
 * Remote Translation Client
 * Connects to a remote translation service and exposes an API compatible with local workflow.
 */

interface RemoteServerConfig {
  url: string;
  apiKey?: string;
  timeout?: number;
}

export interface TranslateOptions {
  text?: string;
  filePath?: string;
  model?: string;
  glossary?: string;
  preset?: string;
  mode?: "doc" | "line";
  chunkSize?: number;
  ctx?: number;
  gpuLayers?: number;
  temperature?: number;
  lineFormat?: string;
  strictMode?: string;
  lineCheck?: boolean;
  lineToleranceAbs?: number;
  lineTolerancePct?: number;
  anchorCheck?: boolean;
  anchorCheckRetries?: number;
  traditional?: boolean;
  saveCot?: boolean;
  saveSummary?: boolean;
  alignmentMode?: boolean;
  resume?: boolean;
  saveCache?: boolean;
  cachePath?: string;
  rulesPre?: string;
  rulesPost?: string;
  rulesPreInline?: unknown;
  rulesPostInline?: unknown;
  repPenaltyBase?: number;
  repPenaltyMax?: number;
  repPenaltyStep?: number;
  maxRetries?: number;
  outputHitThreshold?: number;
  cotCoverageThreshold?: number;
  coverageRetries?: number;
  retryTempBoost?: number;
  retryPromptFeedback?: boolean;
  balanceEnable?: boolean;
  balanceThreshold?: number;
  balanceCount?: number;
  parallel?: number;
  flashAttn?: boolean;
  kvCacheType?: string;
  useLargeBatch?: boolean;
  batchSize?: number;
  seed?: number;
  textProtect?: boolean;
  protectPatterns?: string;
  fixRuby?: boolean;
  fixKana?: boolean;
  fixPunctuation?: boolean;
  gpuDeviceId?: string;
}

interface TranslateTask {
  taskId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  currentBlock: number;
  totalBlocks: number;
  logs: string[];
  nextLogIndex?: number;
  logTotal?: number;
  logsTruncated?: boolean;
  result?: string;
  error?: string;
}

interface ModelInfo {
  name: string;
  path: string;
  sizeGb: number;
}

type RemoteNetworkEventKind =
  | "connection"
  | "http"
  | "upload"
  | "download"
  | "retry"
  | "ws";

type RemoteNetworkEventPhase =
  | "start"
  | "success"
  | "error"
  | "open"
  | "close"
  | "message";

export interface RemoteNetworkEvent {
  timestamp: number;
  kind: RemoteNetworkEventKind;
  phase: RemoteNetworkEventPhase;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  attempt?: number;
  message?: string;
}

export interface RemoteClientObserver {
  onNetworkEvent?: (event: RemoteNetworkEvent) => void;
}

interface RemoteServerStatusRaw {
  status: string;
  model_loaded: boolean;
  current_model?: string;
  active_tasks: number;
}

interface RemoteHealthRaw {
  status: string;
  version?: string;
  capabilities?: string[];
  auth_required?: boolean;
}

interface RemoteModelInfoRaw {
  name: string;
  path: string;
  size_gb?: number;
  sizeGb?: number;
}

interface RemoteHfDownloadStatusRaw {
  status: string;
  percent?: number;
  speed?: string;
  downloaded?: string;
  total?: string;
  file_path?: string;
  error?: string;
}

interface RemoteTaskStatusRaw {
  task_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  current_block: number;
  total_blocks: number;
  logs: string[];
  next_log_index?: number;
  log_total?: number;
  logs_truncated?: boolean;
  result?: string;
  error?: string;
}

interface TaskStatusQuery {
  logFrom?: number;
  logLimit?: number;
}

interface RemoteTranslateResponseRaw {
  task_id: string;
  status: string;
}

export class RemoteClient {
  private config: RemoteServerConfig;
  private observer?: RemoteClientObserver;

  constructor(config: RemoteServerConfig, observer?: RemoteClientObserver) {
    this.config = {
      timeout: 300000,
      ...config,
      url: config.url.replace(/\/+$/, ""),
    };
    this.observer = observer;
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<{
    ok: boolean;
    message: string;
    version?: string;
  }> {
    this.emitNetworkEvent({ kind: "connection", phase: "start", path: "/health" });
    try {
      const response = await this.fetch("/health");
      if (response.status === "ok") {
        await this.fetch("/api/v1/status");
        this.emitNetworkEvent({ kind: "connection", phase: "success", path: "/api/v1/status" });
        return { ok: true, message: "Connected", version: response.version };
      }
      this.emitNetworkEvent({
        kind: "connection",
        phase: "error",
        path: "/health",
        message: "Invalid response",
      });
      return { ok: false, message: "Invalid response" };
    } catch (error: unknown) {
      const status = this.getHttpStatusFromError(error);
      const message =
        status === 401 || status === 403
          ? "Authentication failed: missing or invalid API key"
          : this.normalizeErrorMessage(error);
      this.emitNetworkEvent({ kind: "connection", phase: "error", path: "/health", statusCode: status ?? undefined, message });
      return { ok: false, message };
    }
  }

  async getHealth(): Promise<{
    status: string;
    version?: string;
    capabilities?: string[];
    authRequired?: boolean;
  }> {
    const response = (await this.fetch("/health")) as RemoteHealthRaw;
    return {
      status: response.status,
      version: response.version,
      capabilities: response.capabilities,
      authRequired: response.auth_required,
    };
  }

  /**
   * 获取服务状态
   */
  async getStatus(): Promise<{
    status: string;
    modelLoaded: boolean;
    currentModel?: string;
    activeTasks: number;
  }> {
    const response = (await this.fetch("/api/v1/status")) as RemoteServerStatusRaw;
    return {
      status: response.status,
      modelLoaded: response.model_loaded,
      currentModel: response.current_model,
      activeTasks: response.active_tasks,
    };
  }

  /**
   * 获取可用模型列表
   */
  async listModels(): Promise<ModelInfo[]> {
    const response = (await this.fetch("/api/v1/models")) as RemoteModelInfoRaw[];
    return response.map((item) => ({
      name: item.name,
      path: item.path,
      sizeGb: item.size_gb ?? item.sizeGb ?? 0,
    }));
  }

  async checkHfNetwork(): Promise<{ status: string; message?: string }> {
    return this.fetch("/api/v1/models/hf/network");
  }

  async listHfRepos(orgName: string): Promise<any> {
    const query = new URLSearchParams({ org: orgName });
    return this.fetch(`/api/v1/models/hf/repos?${query.toString()}`);
  }

  async listHfFiles(repoId: string): Promise<any> {
    const query = new URLSearchParams({ repo_id: repoId });
    return this.fetch(`/api/v1/models/hf/files?${query.toString()}`);
  }

  async startHfDownload(repoId: string, fileName: string, mirror: string = "direct"): Promise<{ downloadId: string }> {
    const response = await this.fetch("/api/v1/models/hf/download", {
      method: "POST",
      body: JSON.stringify({
        repo_id: repoId,
        file_name: fileName,
        mirror,
      }),
    });
    return {
      downloadId: response.download_id,
    };
  }

  async getHfDownloadStatus(downloadId: string): Promise<{
    status: string;
    percent: number;
    speed?: string;
    downloaded?: string;
    total?: string;
    filePath?: string;
    error?: string;
  }> {
    const response = (await this.fetch(
      `/api/v1/models/hf/download/${downloadId}`,
    )) as RemoteHfDownloadStatusRaw;
    return {
      status: response.status,
      percent: response.percent ?? 0,
      speed: response.speed,
      downloaded: response.downloaded,
      total: response.total,
      filePath: response.file_path,
      error: response.error,
    };
  }

  async cancelHfDownload(downloadId: string): Promise<{ ok: boolean }> {
    await this.fetch(`/api/v1/models/hf/download/${downloadId}`, {
      method: "DELETE",
    });
    return { ok: true };
  }

  /**
   * 获取可用术语表列表
   */
  async listGlossaries(): Promise<{ name: string; path: string }[]> {
    return this.fetch("/api/v1/glossaries");
  }

  /**
   * 创建翻译任务
   */
  async createTranslation(
    options: TranslateOptions,
  ): Promise<{ taskId: string; status: string }> {
    const normalizedLineTolerancePct = (() => {
      const raw = options.lineTolerancePct;
      if (raw === undefined || raw === null || !Number.isFinite(raw)) return 0.2;
      const numeric = Number(raw);
      if (numeric > 1) return numeric / 100;
      if (numeric < 0) return 0;
      return numeric;
    })();

    const body = {
      text: options.text,
      file_path: options.filePath,
      model: options.model,
      glossary: options.glossary,
      preset: options.preset || "novel",
      mode: options.mode || "doc",
      chunk_size: options.chunkSize || 1000,
      ctx: options.ctx || 8192,
      gpu_layers: options.gpuLayers ?? -1,
      temperature: options.temperature ?? 0.7,
      line_format: options.lineFormat || "single",
      strict_mode: options.strictMode || "off",
      line_check: options.lineCheck ?? true,
      line_tolerance_abs: options.lineToleranceAbs ?? 10,
      line_tolerance_pct: normalizedLineTolerancePct,
      anchor_check: options.anchorCheck ?? true,
      anchor_check_retries: options.anchorCheckRetries ?? 1,
      traditional: options.traditional ?? false,
      save_cot: options.saveCot ?? false,
      save_summary: options.saveSummary ?? false,
      alignment_mode: options.alignmentMode ?? false,
      resume: options.resume ?? false,
      save_cache: options.saveCache ?? true,
      cache_path: options.cachePath,
      rules_pre: options.rulesPre,
      rules_post: options.rulesPost,
      rules_pre_inline: options.rulesPreInline,
      rules_post_inline: options.rulesPostInline,
      rep_penalty_base: options.repPenaltyBase ?? 1.0,
      rep_penalty_max: options.repPenaltyMax ?? 1.5,
      rep_penalty_step: options.repPenaltyStep ?? 0.1,
      max_retries: options.maxRetries ?? 3,
      output_hit_threshold: options.outputHitThreshold ?? 60,
      cot_coverage_threshold: options.cotCoverageThreshold ?? 80,
      coverage_retries: options.coverageRetries ?? 1,
      retry_temp_boost: options.retryTempBoost ?? 0.05,
      retry_prompt_feedback: options.retryPromptFeedback ?? true,
      balance_enable: options.balanceEnable ?? true,
      balance_threshold: options.balanceThreshold ?? 0.6,
      balance_count: options.balanceCount ?? 3,
      parallel: options.parallel ?? 1,
      flash_attn: options.flashAttn ?? false,
      kv_cache_type: options.kvCacheType || "f16",
      use_large_batch: options.useLargeBatch ?? true,
      batch_size: options.batchSize,
      seed: options.seed,
      text_protect: options.textProtect ?? false,
      protect_patterns: options.protectPatterns,
      fix_ruby: options.fixRuby ?? false,
      fix_kana: options.fixKana ?? false,
      fix_punctuation: options.fixPunctuation ?? false,
      gpu_device_id: options.gpuDeviceId,
    };

    const response = (await this.fetch(
      "/api/v1/translate",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      { retry: false },
    )) as RemoteTranslateResponseRaw;

    return {
      taskId: response.task_id,
      status: response.status,
    };
  }

  /**
   * 下载缓存文件（用于校对）
   */
  async downloadCache(taskId: string, savePath: string): Promise<void> {
    const url = this.config.url + `/api/v1/download/${taskId}/cache`;
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Cache download failed: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const fs = await import("fs");
    fs.writeFileSync(savePath, buffer);
  }

  /**
   * 获取服务端 base URL
   */
  getBaseUrl(): string {
    return this.config.url || "";
  }

  /**
   * 获取任务状态
   */
  async getTaskStatus(taskId: string, query?: TaskStatusQuery): Promise<TranslateTask> {
    let path = `/api/v1/translate/${taskId}`;
    if (query) {
      const params = new URLSearchParams();
      if (Number.isFinite(query.logFrom)) {
        params.set("log_from", String(query.logFrom));
      }
      if (Number.isFinite(query.logLimit)) {
        params.set("log_limit", String(query.logLimit));
      }
      const queryText = params.toString();
      if (queryText) {
        path += `?${queryText}`;
      }
    }

    const response = (await this.fetch(path)) as RemoteTaskStatusRaw;
    return {
      taskId: response.task_id,
      status: response.status,
      progress: response.progress,
      currentBlock: response.current_block,
      totalBlocks: response.total_blocks,
      logs: response.logs,
      nextLogIndex: response.next_log_index,
      logTotal: response.log_total,
      logsTruncated: response.logs_truncated,
      result: response.result,
      error: response.error,
    };
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<{ message: string }> {
    return this.fetch(`/api/v1/translate/${taskId}`, { method: "DELETE" });
  }

  /**
   * 上传文件
   */
  async uploadFile(
    filePath: string,
  ): Promise<{ fileId: string; serverPath: string }> {
    const fs = require("fs");
    const path = require("path");

    // 使用全局 FormData（Chromium 实现）而非 npm form-data 包，
    // 因为 Electron 的 fetch 无法正确序列化 npm form-data 的 stream body
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const blob = new Blob([fileBuffer]);

    const form = new FormData();
    form.append("file", blob, fileName);

    const response = (await this.fetchFormData(
      "/api/v1/upload/file",
      form,
    )) as { file_id: string; file_path: string };
    return {
      fileId: response.file_id,
      serverPath: response.file_path,
    };
  }

  /**
   * 下载翻译结果
   */
  async downloadResult(taskId: string, savePath: string): Promise<void> {
    const fs = require("fs");
    const response = await this.fetchRaw(`/api/v1/download/${taskId}`);
    await fs.promises.writeFile(savePath, response);
  }

  /**
   * 连接 WebSocket 获取实时日志
   */
  connectWebSocket(
    taskId: string,
    callbacks: {
      onLog?: (message: string) => void;
      onProgress?: (progress: number, current: number, total: number) => void;
      onComplete?: (status: string, result?: string, error?: string) => void;
      onError?: (error: string) => void;
      onOpen?: () => void;
      onClose?: (code?: number, reason?: string) => void;
    },
  ): WebSocket {
    const token = this.config.apiKey
      ? `?token=${encodeURIComponent(this.config.apiKey)}`
      : "";
    const wsPath = `/api/v1/ws/${taskId}${token}`;
    const wsUrl = this.config.url.replace(/^http/, "ws") + wsPath;
    this.emitNetworkEvent({ kind: "ws", phase: "start", path: wsPath });
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      this.emitNetworkEvent({ kind: "ws", phase: "open", path: wsPath });
      callbacks.onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const rawData =
          typeof event.data === "string"
            ? event.data
            : Buffer.isBuffer(event.data)
              ? event.data.toString("utf-8")
              : String(event.data);
        const data = JSON.parse(rawData);

        switch (data.type) {
          case "log":
            callbacks.onLog?.(data.message);
            break;
          case "progress":
            callbacks.onProgress?.(
              data.progress,
              data.current_block,
              data.total_blocks,
            );
            break;
          case "complete":
            this.emitNetworkEvent({
              kind: "ws",
              phase: "message",
              path: wsPath,
              message: `complete:${data.status}`,
            });
            callbacks.onComplete?.(data.status, data.result, data.error);
            ws.close();
            break;
        }
      } catch (e) {
        const message = String(e);
        this.emitNetworkEvent({ kind: "ws", phase: "error", path: wsPath, message });
        callbacks.onError?.(message);
      }
    };

    ws.onerror = (error) => {
      const message = String(error);
      this.emitNetworkEvent({ kind: "ws", phase: "error", path: wsPath, message });
      callbacks.onError?.(message);
    };

    ws.onclose = (event) => {
      this.emitNetworkEvent({
        kind: "ws",
        phase: "close",
        path: wsPath,
        message: `${event.code}:${event.reason || "closed"}`,
      });
      callbacks.onClose?.(event.code, event.reason);
    };

    return ws;
  }

  /**
   * Run full translation flow and wait for final result.
   */
  async translateAndWait(
    options: TranslateOptions,
    onProgress?: (progress: number, log: string) => void,
  ): Promise<string> {
    const { taskId } = await this.createTranslation(options);

    while (true) {
      const status = await this.getTaskStatus(taskId);

      if (onProgress) {
        const lastLog = status.logs[status.logs.length - 1] || "";
        onProgress(status.progress, lastLog);
      }

      if (status.status === "completed") {
        return status.result || "";
      }

      if (status.status === "failed") {
        throw new Error(status.error || "Translation failed");
      }

      if (status.status === "cancelled") {
        throw new Error("Translation cancelled");
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  private emitNetworkEvent(event: Omit<RemoteNetworkEvent, "timestamp">): void {
    this.observer?.onNetworkEvent?.({
      timestamp: Date.now(),
      ...event,
    });
  }

  private normalizeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getRetryDelayMs(attempt: number): number {
    return Math.min(1800, 400 * Math.pow(2, attempt - 1) + 100 * (attempt - 1));
  }

  private shouldRetryByMethod(method: string, retryOverride?: boolean): boolean {
    if (typeof retryOverride === "boolean") return retryOverride;
    return ["GET", "HEAD", "OPTIONS", "DELETE"].includes(method);
  }

  private getHttpStatusFromError(error: unknown): number | null {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/HTTP\s+(\d{3})/i);
    if (!match) return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private shouldRetryByStatus(status: number): boolean {
    return status === 408 || status === 429 || (status >= 500 && status <= 504);
  }

  private shouldRetryByError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch failed") ||
      message.includes("econnreset") ||
      message.includes("etimedout")
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetch(
    path: string,
    options: RequestInit = {},
    policy?: { retry?: boolean; maxAttempts?: number },
  ): Promise<any> {
    const url = this.config.url + path;
    const method = (options.method || "GET").toUpperCase();
    const maxAttempts = policy?.maxAttempts ?? 3;
    const allowRetry = this.shouldRetryByMethod(method, policy?.retry);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();
      this.emitNetworkEvent({ kind: "http", phase: "start", method, path, attempt });
      try {
        const response = await this.fetchWithTimeout(url, {
          ...options,
          method,
          headers,
        });

        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
          const text = await response.text();
          const canRetry =
            allowRetry && attempt < maxAttempts && this.shouldRetryByStatus(response.status);
          if (canRetry) {
            this.emitNetworkEvent({
              kind: "retry",
              phase: "start",
              method,
              path,
              attempt,
              statusCode: response.status,
              durationMs,
              message: `HTTP ${response.status}`,
            });
            await this.sleep(this.getRetryDelayMs(attempt));
            continue;
          }

          this.emitNetworkEvent({
            kind: "http",
            phase: "error",
            method,
            path,
            attempt,
            statusCode: response.status,
            durationMs,
            message: text,
          });
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        this.emitNetworkEvent({
          kind: "http",
          phase: "success",
          method,
          path,
          attempt,
          statusCode: response.status,
          durationMs,
        });

        return response.json();
      } catch (error: unknown) {
        const durationMs = Date.now() - startedAt;
        const canRetry =
          allowRetry && attempt < maxAttempts && this.shouldRetryByError(error);
        if (canRetry) {
          this.emitNetworkEvent({
            kind: "retry",
            phase: "start",
            method,
            path,
            attempt,
            durationMs,
            message: this.normalizeErrorMessage(error),
          });
          await this.sleep(this.getRetryDelayMs(attempt));
          continue;
        }

        this.emitNetworkEvent({
          kind: "http",
          phase: "error",
          method,
          path,
          attempt,
          durationMs,
          statusCode: this.getHttpStatusFromError(error) ?? undefined,
          message: this.normalizeErrorMessage(error),
        });
        throw error;
      }
    }

    throw new Error(`Request failed after ${maxAttempts} attempts`);
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.config.timeout || 300000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeoutMs / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchFormData(path: string, form: FormData): Promise<unknown> {
    const url = this.config.url + path;
    const headers: Record<string, string> = {
      ...(typeof (form as any).getHeaders === "function" ? (form as any).getHeaders() : {}),
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();
      this.emitNetworkEvent({ kind: "upload", phase: "start", method: "POST", path, attempt });
      try {
        const response = await this.fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: form,
        });

        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
          const text = await response.text();
          this.emitNetworkEvent({
            kind: "upload",
            phase: "error",
            method: "POST",
            path,
            attempt,
            statusCode: response.status,
            durationMs,
            message: text,
          });
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        this.emitNetworkEvent({
          kind: "upload",
          phase: "success",
          method: "POST",
          path,
          attempt,
          statusCode: response.status,
          durationMs,
        });

        return response.json();
      } catch (error: unknown) {
        const durationMs = Date.now() - startedAt;
        const canRetry = attempt < maxAttempts && this.shouldRetryByError(error);
        if (canRetry) {
          this.emitNetworkEvent({
            kind: "retry",
            phase: "start",
            method: "POST",
            path,
            attempt,
            durationMs,
            message: this.normalizeErrorMessage(error),
          });
          await this.sleep(this.getRetryDelayMs(attempt));
          continue;
        }

        this.emitNetworkEvent({
          kind: "upload",
          phase: "error",
          method: "POST",
          path,
          attempt,
          durationMs,
          statusCode: this.getHttpStatusFromError(error) ?? undefined,
          message: this.normalizeErrorMessage(error),
        });
        throw error;
      }
    }

    throw new Error(`Upload failed after ${maxAttempts} attempts`);
  }

  private async fetchRaw(path: string): Promise<Buffer> {
    const url = this.config.url + path;
    const headers: Record<string, string> = {};

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();
      this.emitNetworkEvent({ kind: "download", phase: "start", method: "GET", path, attempt });
      try {
        const response = await this.fetchWithTimeout(url, {
          method: "GET",
          headers,
        });

        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
          const text = await response.text();
          const canRetry =
            attempt < maxAttempts && this.shouldRetryByStatus(response.status);
          if (canRetry) {
            this.emitNetworkEvent({
              kind: "retry",
              phase: "start",
              method: "GET",
              path,
              attempt,
              statusCode: response.status,
              durationMs,
              message: `HTTP ${response.status}`,
            });
            await this.sleep(this.getRetryDelayMs(attempt));
            continue;
          }

          this.emitNetworkEvent({
            kind: "download",
            phase: "error",
            method: "GET",
            path,
            attempt,
            statusCode: response.status,
            durationMs,
            message: text,
          });
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        this.emitNetworkEvent({
          kind: "download",
          phase: "success",
          method: "GET",
          path,
          attempt,
          statusCode: response.status,
          durationMs,
          message: `bytes=${arrayBuffer.byteLength}`,
        });
        return Buffer.from(arrayBuffer);
      } catch (error: unknown) {
        const durationMs = Date.now() - startedAt;
        const canRetry = attempt < maxAttempts && this.shouldRetryByError(error);
        if (canRetry) {
          this.emitNetworkEvent({
            kind: "retry",
            phase: "start",
            method: "GET",
            path,
            attempt,
            durationMs,
            message: this.normalizeErrorMessage(error),
          });
          await this.sleep(this.getRetryDelayMs(attempt));
          continue;
        }

        this.emitNetworkEvent({
          kind: "download",
          phase: "error",
          method: "GET",
          path,
          attempt,
          durationMs,
          statusCode: this.getHttpStatusFromError(error) ?? undefined,
          message: this.normalizeErrorMessage(error),
        });
        throw error;
      }
    }

    throw new Error(`Download failed after ${maxAttempts} attempts`);
  }
}

/**
 * 获取/创建远程客户端单例
 */

/**
 * Remote Translation Client
 * 用于连接远程翻译服务器，提供与本地翻译完全相同的 API
 */

export interface RemoteServerConfig {
    url: string
    apiKey?: string
    timeout?: number
}

export interface TranslateOptions {
    text?: string
    filePath?: string
    model?: string
    glossary?: string
    preset?: string
    mode?: 'doc' | 'line'
    chunkSize?: number
    ctx?: number
    gpuLayers?: number
    temperature?: number
    lineCheck?: boolean
    traditional?: boolean
    saveCot?: boolean
    rulesPre?: string
    rulesPost?: string
    parallel?: number
    flashAttn?: boolean
    kvCacheType?: string
}

export interface TranslateTask {
    taskId: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    progress: number
    currentBlock: number
    totalBlocks: number
    logs: string[]
    result?: string
    error?: string
}

export interface ModelInfo {
    name: string
    path: string
    sizeGb: number
}

export class RemoteClient {
    private config: RemoteServerConfig

    constructor(config: RemoteServerConfig) {
        this.config = {
            timeout: 300000, // 5 minutes default
            ...config
        }
    }

    /**
     * 测试连接
     */
    async testConnection(): Promise<{ ok: boolean; message: string; version?: string }> {
        try {
            const response = await this.fetch('/health')
            if (response.status === 'ok') {
                return { ok: true, message: 'Connected', version: response.version }
            }
            return { ok: false, message: 'Invalid response' }
        } catch (error) {
            return { ok: false, message: String(error) }
        }
    }

    /**
     * 获取服务器状态
     */
    async getStatus(): Promise<{
        status: string
        modelLoaded: boolean
        currentModel?: string
        activeTasks: number
    }> {
        return this.fetch('/api/v1/status')
    }

    /**
     * 获取可用模型列表
     */
    async listModels(): Promise<ModelInfo[]> {
        return this.fetch('/api/v1/models')
    }

    /**
     * 获取可用术语表列表
     */
    async listGlossaries(): Promise<{ name: string; path: string }[]> {
        return this.fetch('/api/v1/glossaries')
    }

    /**
     * 创建翻译任务
     */
    async createTranslation(options: TranslateOptions): Promise<{ taskId: string; status: string }> {
        const body = {
            text: options.text,
            file_path: options.filePath,
            model: options.model,
            glossary: options.glossary,
            preset: options.preset || 'novel',
            mode: options.mode || 'doc',
            chunk_size: options.chunkSize || 1000,
            ctx: options.ctx || 8192,
            gpu_layers: options.gpuLayers ?? -1,
            temperature: options.temperature ?? 0.3,
            line_check: options.lineCheck ?? true,
            traditional: options.traditional ?? false,
            save_cot: options.saveCot ?? false,
            rules_pre: options.rulesPre,
            rules_post: options.rulesPost,
            parallel: options.parallel ?? 1,
            flash_attn: options.flashAttn ?? false,
            kv_cache_type: options.kvCacheType || 'q8_0'
        }

        const response = await this.fetch('/api/v1/translate', {
            method: 'POST',
            body: JSON.stringify(body)
        })

        return {
            taskId: response.task_id,
            status: response.status
        }
    }

    /**
     * 获取任务状态
     */
    async getTaskStatus(taskId: string): Promise<TranslateTask> {
        const response = await this.fetch(`/api/v1/translate/${taskId}`)
        return {
            taskId: response.task_id,
            status: response.status,
            progress: response.progress,
            currentBlock: response.current_block,
            totalBlocks: response.total_blocks,
            logs: response.logs,
            result: response.result,
            error: response.error
        }
    }

    /**
     * 取消任务
     */
    async cancelTask(taskId: string): Promise<{ message: string }> {
        return this.fetch(`/api/v1/translate/${taskId}`, { method: 'DELETE' })
    }

    /**
     * 上传文件
     */
    async uploadFile(filePath: string): Promise<{ fileId: string; serverPath: string }> {
        const fs = require('fs')
        const path = require('path')
        const FormData = require('form-data')

        const form = new FormData()
        form.append('file', fs.createReadStream(filePath), path.basename(filePath))

        const response = await this.fetchFormData('/api/v1/upload/file', form) as { file_id: string; file_path: string }
        return {
            fileId: response.file_id,
            serverPath: response.file_path
        }
    }

    /**
     * 下载翻译结果
     */
    async downloadResult(taskId: string, savePath: string): Promise<void> {
        const fs = require('fs')
        const response = await this.fetchRaw(`/api/v1/download/${taskId}`)
        fs.writeFileSync(savePath, response)
    }

    /**
     * WebSocket 连接，获取实时日志
     */
    connectWebSocket(
        taskId: string,
        callbacks: {
            onLog?: (message: string) => void
            onProgress?: (progress: number, current: number, total: number) => void
            onComplete?: (status: string, result?: string, error?: string) => void
            onError?: (error: string) => void
        }
    ): WebSocket {
        const wsUrl = this.config.url.replace(/^http/, 'ws') + `/api/v1/ws/${taskId}`
        const ws = new WebSocket(wsUrl)

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)

                switch (data.type) {
                    case 'log':
                        callbacks.onLog?.(data.message)
                        break
                    case 'progress':
                        callbacks.onProgress?.(data.progress, data.current_block, data.total_blocks)
                        break
                    case 'complete':
                        callbacks.onComplete?.(data.status, data.result, data.error)
                        ws.close()
                        break
                }
            } catch (e) {
                callbacks.onError?.(String(e))
            }
        }

        ws.onerror = (error) => {
            callbacks.onError?.(String(error))
        }

        return ws
    }

    /**
     * 执行完整翻译流程（阻塞等待结果）
     */
    async translateAndWait(
        options: TranslateOptions,
        onProgress?: (progress: number, log: string) => void
    ): Promise<string> {
        // 创建任务
        const { taskId } = await this.createTranslation(options)

        // 轮询状态
        while (true) {
            const status = await this.getTaskStatus(taskId)

            if (onProgress) {
                const lastLog = status.logs[status.logs.length - 1] || ''
                onProgress(status.progress, lastLog)
            }

            if (status.status === 'completed') {
                return status.result || ''
            }

            if (status.status === 'failed') {
                throw new Error(status.error || 'Translation failed')
            }

            if (status.status === 'cancelled') {
                throw new Error('Translation cancelled')
            }

            // 等待 500ms 再查询
            await new Promise((resolve) => setTimeout(resolve, 500))
        }
    }

    // ============================================
    // Private Methods
    // ============================================

    private async fetch(path: string, options: RequestInit = {}): Promise<any> {
        const url = this.config.url + path
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string>)
        }

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`
        }

        // 使用 AbortController 实现超时控制（原生 fetch 不支持 timeout 选项）
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout || 300000)

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            })

            if (!response.ok) {
                const text = await response.text()
                throw new Error(`HTTP ${response.status}: ${text}`)
            }

            return response.json()
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`Request timeout after ${(this.config.timeout || 300000) / 1000}s`)
            }
            throw error
        } finally {
            clearTimeout(timeoutId)
        }
    }

    private async fetchFormData(path: string, form: FormData): Promise<unknown> {
        const url = this.config.url + path
        const headers: Record<string, string> = {}

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: form
        })

        if (!response.ok) {
            const text = await response.text()
            throw new Error(`HTTP ${response.status}: ${text}`)
        }

        return response.json()
    }

    private async fetchRaw(path: string): Promise<Buffer> {
        const url = this.config.url + path
        const headers: Record<string, string> = {}

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`
        }

        const response = await fetch(url, { headers })

        if (!response.ok) {
            const text = await response.text()
            throw new Error(`HTTP ${response.status}: ${text}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        return Buffer.from(arrayBuffer)
    }
}

/**
 * 创建远程客户端单例
 */
let remoteClientInstance: RemoteClient | null = null

export function getRemoteClient(config?: RemoteServerConfig): RemoteClient | null {
    if (config) {
        remoteClientInstance = new RemoteClient(config)
    }
    return remoteClientInstance
}

export function clearRemoteClient(): void {
    remoteClientInstance = null
}

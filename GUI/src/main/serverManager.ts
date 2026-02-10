import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import fs from 'fs'
import { detectPlatform, getLlamaServerPath, getMiddlewarePath } from './platform'

// Helper for User Mutable Data
const getUserDataPath = () => {
    return getMiddlewarePath()
}

export interface ServerStatus {
    running: boolean
    pid: number | null
    port: number
    model: string | null
    deviceMode: string
    uptime: number
    logs: string[]
}

export class ServerManager {
    private static instance: ServerManager
    private process: ChildProcess | null = null
    private port: number = 8080
    private model: string | null = null
    private deviceMode: string = 'auto'
    private startTime: number = 0
    private logs: string[] = []

    private constructor() { }

    static getInstance(): ServerManager {
        if (!ServerManager.instance) {
            ServerManager.instance = new ServerManager()
        }
        return ServerManager.instance
    }

    getStatus(): ServerStatus {
        return {
            running: !!this.process,
            pid: this.process?.pid || null,
            port: this.port,
            model: this.model,
            deviceMode: this.deviceMode,
            uptime: this.process ? (Date.now() - this.startTime) / 1000 : 0,
            logs: this.logs.slice(-50) // Keep last 50 lines
        }
    }

    getLogs(): string[] {
        return this.logs
    }

    async start(config: any): Promise<{ success: boolean; error?: string }> {
        if (this.process) {
            // Check if same config? If same, return success.
            // If different, reject or restart?
            // For now, reject.
            if (config.model === this.model) {
                return { success: true }
            }
            return { success: false, error: 'Server already running with different model. Stop it first.' }
        }

        this.logs = []
        this.model = config.model
        this.deviceMode = config.deviceMode || 'auto'
        const customPort = config.port ? parseInt(config.port) : 8080
        this.port = customPort

        const middlewareDir = getMiddlewarePath()
        const userDataPath = getUserDataPath()

        // 使用跨平台检测获取正确的二进制路径
        let serverExePath: string
        try {
            const platformInfo = detectPlatform()
            console.log(`[ServerManager] Platform: ${platformInfo.os}/${platformInfo.arch}, Backend: ${platformInfo.backend}`)
            this.logs.push(`Platform: ${platformInfo.os}/${platformInfo.arch}, Backend: ${platformInfo.backend}`)
            serverExePath = getLlamaServerPath()
        } catch (e: any) {
            const msg = e.message || 'Failed to detect platform or find llama-server'
            this.logs.push(msg)
            return { success: false, error: msg }
        }

        // Resolve Model Path
        // If relative, resolve to User Data
        let effectiveModelPath = this.model!
        if (!effectiveModelPath.includes('\\') && !effectiveModelPath.includes('/')) {
            effectiveModelPath = join(userDataPath, 'models', effectiveModelPath)
        }
        if (!fs.existsSync(effectiveModelPath)) {
            const msg = `Model not found: ${effectiveModelPath}`
            this.logs.push(msg)
            return { success: false, error: msg }
        }

        // Build Args
        // llama-server args: -m <model> --port <port> -c <ctx> -ngl <layers>
        // Context Size Calculation (Total pool for all slots)
        const concurrency = config.concurrency || 1
        const perSlotCtx = config.ctxSize || 4096
        let totalCtx = perSlotCtx * concurrency

        // Hardcap (Match middleware safety limit)
        const MAX_POOL_CTX = 32768
        if (totalCtx > MAX_POOL_CTX) {
            console.warn(`[Server] Requested context ${totalCtx} exceeds pool limit ${MAX_POOL_CTX}. Capping.`)
            totalCtx = MAX_POOL_CTX
        }

        const args = [
            '-m', effectiveModelPath,
            '--port', this.port.toString(),
            '-c', totalCtx.toString(),
            '--host', '127.0.0.1' // Bind to localhost
        ]

        if (this.deviceMode === 'cpu') {
            args.push('-ngl', '0') // n-gpu-layers
            console.log('[ServerManager] Mode: CPU Only')
        } else {
            const gpuLayers = config.gpuLayers !== undefined ? config.gpuLayers : -1
            args.push('-ngl', gpuLayers.toString())
            console.log(`[ServerManager] Mode: GPU with ${gpuLayers} layers`)
        }

        const parallelCount = (config.concurrency || 1).toString()
        args.push('--parallel', parallelCount)
        args.push('-np', parallelCount) // number of parallel sequences

        // Seed
        if (config.seed !== undefined && config.seed !== null && config.seed !== "") {
            args.push('-s', config.seed.toString())
        }

        // High Fidelity Mode (Granular Control)
        if (config.highFidelity || config.flashAttn) args.push('-fa', 'on')

        // KV Cache Selection
        if (config.kvCacheType || config.highFidelity) {
            // Priority: explicit kvCacheType > highFidelity fallback
            let kvType = config.kvCacheType
            if (!kvType && config.highFidelity) {
                kvType = 'f16'
            }
            if (kvType) {
                args.push('--cache-type-k', kvType)
                args.push('--cache-type-v', kvType)
            }
        }

        // Batch Sync Logic
        if (config.useLargeBatch || config.highFidelity) {
            const requestedBatch = config.physicalBatchSize || (config.concurrency === 1 ? 2048 : 1024)
            const safeBatch = Math.min(requestedBatch, parseInt(config.ctxSize))
            args.push('-b', safeBatch.toString())
            args.push('-ub', safeBatch.toString())
        }


        console.log('[ServerManager] Args:', args)

        // Environment
        const env = { ...process.env }
        if (this.deviceMode !== 'cpu' && config.gpuDeviceId) {
            env['CUDA_VISIBLE_DEVICES'] = config.gpuDeviceId
        }

        const cmdStr = `"${serverExePath}" ${args.join(' ')}`
        console.log('[ServerManager] Spawning:', cmdStr)
        this.logs.push(`> ${cmdStr}`)

        try {
            this.process = spawn(serverExePath, args, {
                cwd: middlewareDir,
                env,
                shell: false // spawn directly
            })

            this.startTime = Date.now()

            this.process.stdout?.on('data', (d) => {
                const str = d.toString().trim()
                if (str) {
                    // Filter noisy logs if needed
                    if (str.includes('llama_print_')) return
                    this.logs.push(str)
                }
            })

            this.process.stderr?.on('data', (d) => {
                const str = d.toString().trim()
                if (str) {
                    this.logs.push(str)
                }
            })

            this.process.on('close', (code) => {
                console.log('[ServerManager] Process exited with', code)
                this.logs.push(`Process exited with code ${code}`)
                this.process = null
                this.model = null
            })

            this.process.on('error', (err) => {
                console.error('[ServerManager] Spawn Error:', err)
                this.logs.push(`Spawn Error: ${err.message}`)
                this.process = null
            })

        } catch (e: any) {
            return { success: false, error: e.message }
        }

        // Wait a bit to ensure it doesn't crash immediately
        return new Promise((resolve) => {
            setTimeout(() => {
                if (this.process) resolve({ success: true })
                else resolve({ success: false, error: 'Server process exited immediately. Check logs.' })
            }, 1000)
        })
    }

    async stop(): Promise<void> {
        if (this.process) {
            const pid = this.process.pid
            this.logs.push('Stopping server...')

            try {
                this.process.kill()
            } catch (e) {
                // Ignore if already dead
            }

            // Windows: Force kill with tree kill to ensure child processes are terminated
            if (process.platform === 'win32' && pid) {
                try {
                    const { execSync } = require('child_process')
                    execSync(`taskkill /F /T /PID ${pid}`, {
                        stdio: 'ignore',
                        windowsHide: true
                    })
                } catch (e) {
                    // Process may already be dead, ignore
                }
            }

            this.process = null
            this.model = null
        }
    }

    /**
     * Warmup: Send a test request to preload model into GPU memory
     * Returns warmup duration in milliseconds
     */
    async warmup(): Promise<{ success: boolean; durationMs?: number; error?: string }> {
        if (!this.process) {
            return { success: false, error: 'Server not running' }
        }

        const startTime = Date.now()
        const url = `http://127.0.0.1:${this.port}/completion`

        try {
            const http = await import('http')

            return new Promise((resolve) => {
                const postData = JSON.stringify({
                    prompt: 'Hello',
                    n_predict: 1,
                    temperature: 0.1
                })

                const req = http.request(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: 120000 // 2 min timeout for initial load
                }, (res) => {
                    let data = ''
                    res.on('data', (chunk) => { data += chunk })
                    res.on('end', () => {
                        const durationMs = Date.now() - startTime
                        this.logs.push(`Warmup completed in ${durationMs}ms`)
                        resolve({ success: true, durationMs })
                    })
                })

                req.on('error', (e) => {
                    this.logs.push(`Warmup failed: ${e.message}`)
                    resolve({ success: false, error: e.message })
                })

                req.on('timeout', () => {
                    req.destroy()
                    this.logs.push('Warmup timeout')
                    resolve({ success: false, error: 'Warmup timeout (120s)' })
                })

                req.write(postData)
                req.end()
            })
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }
}

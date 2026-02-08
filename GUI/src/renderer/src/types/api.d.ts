/**
 * Window API Type Definitions
 * 统一定义 Electron preload 暴露的 API 接口类型
 */

export interface TranslationConfig {
    model: string
    gpu: boolean
    ctx: number
    server: 'embedded' | 'external'
    preset: string
    glossaryPath: string
    inputPath: string
    outputPath: string
    cacheDir: string
    traditional: boolean
    rulesPrePath: string
    rulesPostPath: string
    temperature: number
    lineCheck: boolean
    lineToleranceAbs: number
    lineTolerancePct: number
    saveCot: boolean
    saveSummary: boolean
    deviceMode: 'auto' | 'cpu' | 'gpu' | 'rocm'
    gpuDeviceId: number
    repPenaltyBase: number
    repPenaltyMax: number
    repPenaltyStep: number
    maxRetries: number
    coverageCheck: boolean
    outputHitThreshold: number
    cotCoverageThreshold: number
    coverageRetries: number
}

export interface ServerStatus {
    running: boolean
    port: number
    model?: string
}

export interface WarmupResult {
    success: boolean
    durationMs?: number
    error?: string
}

export interface ModelInfo {
    name: string
    path: string
    size?: number
    quantization?: string
}

export interface TranslationProgress {
    current: number
    total: number
    percentage: number
}

export interface CacheBlock {
    index: number
    src: string
    dst: string
    status: 'none' | 'processed' | 'edited'
    warnings: string[]
    cot: string
    srcLines: number
    dstLines: number
}

export interface CacheData {
    version: string
    outputPath: string
    modelName: string
    glossaryPath: string
    stats: {
        blockCount: number
        srcLines: number
        dstLines: number
        srcChars: number
        dstChars: number
    }
    blocks: CacheBlock[]
}

export interface ElectronAPI {
    // Model Management
    getModels: () => Promise<string[]>
    getGlossaries: () => Promise<string[]>
    createGlossaryFile: (arg: string | { filename: string; content?: string }) => Promise<{ success: boolean; path?: string; error?: string }>
    getModelInfo: (modelName: string) => Promise<any>

    // File Operations
    selectFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
    selectFiles: () => Promise<string[]>
    readFile: (path: string) => Promise<string>
    selectDirectory: () => Promise<string | null>
    selectFolder: (options?: { title?: string }) => Promise<string | null>
    scanDirectory: (path: string, recursive?: boolean) => Promise<string[]>
    listCacheFiles: (folderPath: string) => Promise<{ name: string; path: string }[]>
    openPath: (filePath: string) => Promise<string>
    openFolder: (folderPath: string) => Promise<boolean>
    writeFile: (path: string, content: string) => Promise<boolean>
    saveFile: (options: any) => Promise<string | null>
    importGlossary: (sourcePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
    selectFolderFiles: () => Promise<string[]>
    checkOutputFileExists: (inputFile: string, config: any) => Promise<{ exists: boolean; path?: string }>

    // Cache Operations
    loadCache: (path: string) => Promise<any>
    saveCache: (path: string, data: any) => Promise<boolean>
    rebuildDoc: (options: { cachePath: string; outputPath?: string }) => Promise<{ success: boolean; error?: string }>
    exportTranslation: (cachePath: string, outputPath: string) => Promise<boolean>

    // Translation Process
    startProcess: (config: TranslationConfig) => Promise<{ success: boolean; error?: string }>
    stopProcess: () => Promise<void>
    startTranslation: (inputPath: string, modelPath: string, config: any) => void
    stopTranslation: () => void
    retranslateBlock: (options: { src: string, index: number, modelPath: string, config: any }) => Promise<any>
    onLogUpdate: (callback: (chunk: string) => void) => void
    onProcessExit: (callback: (code: number) => void) => void
    removeLogListener: () => void
    removeExitListener: () => void
    removeProcessExitListener: () => void

    // Retranslate Progress
    onRetranslateLog: (callback: (data: { index: number, text: string, isError?: boolean }) => void) => void
    removeRetranslateLogListener: () => void

    // Server Management
    serverStatus: () => Promise<ServerStatus>
    serverStart: (config: { model: string; preset: string; gpu: boolean; gpuDeviceId?: number }) => Promise<{ success: boolean; error?: string }>
    serverStop: () => Promise<{ success: boolean; error?: string }>
    serverLogs: () => Promise<string[]>
    serverWarmup: () => Promise<WarmupResult>

    // Update
    checkUpdate: () => Promise<any>

    // System Diagnostics
    getSystemDiagnostics: () => Promise<{
        os: { platform: string; release: string; arch: string; cpuCores: number; totalMem: string }
        gpu: { name: string; driver?: string; vram?: string } | null
        python: { version: string; path: string } | null
        cuda: { version: string; available: boolean } | null
        vulkan: { available: boolean; version?: string; devices?: string[] } | null
        llamaServer: { status: 'online' | 'offline' | 'unknown'; port?: number; model?: string }
    }>
    
    // Environment Fixer
    checkEnvComponent: (component: 'Python' | 'CUDA' | 'Vulkan' | 'LlamaBackend' | 'Middleware' | 'Permissions') => Promise<{
        success: boolean
        report?: {
            system: { platform: string; arch: string }
            components: Array<{
                name: string
                status: 'ok' | 'warning' | 'error'
                version: string | null
                path: string | null
                issues: string[]
                fixes: string[]
                canAutoFix: boolean
            }>
            summary: {
                totalIssues: number
                totalErrors: number
                totalWarnings: number
                overallStatus: string
            }
        }
        component?: {
            name: string
            status: 'ok' | 'warning' | 'error'
            version: string | null
            path: string | null
            issues: string[]
            fixes: string[]
            canAutoFix: boolean
        }
        error?: string
    }>
    fixEnvComponent: (component: 'Python' | 'CUDA' | 'Vulkan' | 'LlamaBackend' | 'Middleware' | 'Permissions') => Promise<{
        success: boolean
        message: string
        exitCode?: number
        output?: string
        errorOutput?: string
    }>

    // System
    showNotification: (title: string, body: string) => void
    setTheme: (theme: 'dark' | 'light') => void
    openExternal: (url: string) => void
    getHardwareInfo: () => Promise<{
        cpuUsage: number
        memUsage: number
        gpuUsage?: number
        gpuMemUsage?: number
        gpuTemp?: number
    }>

    // Single Block Translation
    translateBlock: (config: {
        model: string
        src: string
        glossaryPath?: string
        temperature?: number
    }) => Promise<{ success: boolean; dst?: string; error?: string }>

    // Rule System
    testRules: (text: string, rules: any[]) => Promise<{ success: boolean; steps: { label: string; text: string }[]; error?: string }>
}

declare global {
    interface Window {
        api: ElectronAPI
    }
}

export { }

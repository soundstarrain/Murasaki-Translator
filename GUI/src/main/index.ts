import { app, shell, BrowserWindow, ipcMain, dialog, Notification, nativeTheme } from 'electron'
import { join, basename } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { ServerManager } from './serverManager'
import { getLlamaServerPath, detectPlatform, clearGpuCache } from './platform'
import { TranslateOptions } from './remoteClient'

let pythonProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

// 单实例锁 - 防止重复启动
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    // 如果无法获取锁，说明已有实例在运行，退出
    console.log('[App] Another instance is already running. Exiting...')
    app.quit()
} else {
    // 当第二个实例启动时，聚焦到主窗口
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })
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
        title: 'Murasaki Translator',
        icon: join(__dirname, '../../resources/icon.png'),
        backgroundColor: '#0a0a0f', // Match app dark background
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // Allow manual F12 toggle
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            mainWindow?.webContents.toggleDevTools()
            event.preventDefault()
        }
    })
}

/**
 * 清理所有子进程
 */
function cleanupProcesses(): void {
    console.log('[App] Cleaning up processes...')

    // 停止翻译进程
    if (pythonProcess) {
        try {
            pythonProcess.kill()
            if (process.platform === 'win32' && pythonProcess.pid) {
                spawn('taskkill', ['/pid', pythonProcess.pid.toString(), '/f', '/t'])
            }
        } catch (e) {
            console.error('[App] Error killing python process:', e)
        }
        pythonProcess = null
    }

    // 停止 ServerManager 管理的 llama-server
    try {
        ServerManager.getInstance().stop()
    } catch (e) {
        console.error('[App] Error stopping server:', e)
    }
}

/**
 * 清理临时文件目录 (启动时调用，防止残留)
 */
function cleanupTempDirectory(): void {
    try {
        const tempDir = join(app.getPath('userData'), 'temp')
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir)
            for (const file of files) {
                try { fs.unlinkSync(join(tempDir, file)) } catch (_) { }
            }
            console.log(`[App] Cleaned ${files.length} temp files`)
        }
    } catch (e) {
        console.error('[App] Temp cleanup error:', e)
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    // Clean up any residual temp files from crashed sessions
    cleanupTempDirectory()

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// 应用退出前清理
app.on('before-quit', () => {
    cleanupProcesses()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    cleanupProcesses()
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// --- Custom Logic ---

// Helper to find middleware path
const getMiddlewarePath = () => {
    // In dev: project/GUI/out/main -> project/llm/middleware
    if (is.dev) {
        return join(__dirname, '../../../middleware')
    }
    // In prod: resources/middleware
    return join(process.resourcesPath, 'middleware')
}

// Helper to find python executable or bundled engine
const getPythonPath = (): { type: 'python' | 'bundle'; path: string } => {
    if (is.dev) {
        return { type: 'python', path: process.env.ELECTRON_PYTHON_PATH || 'python' }
    }

    // In prod: platform-specific Python path
    if (process.platform === 'win32') {
        // Windows: resources/python_env/python.exe (Embeddable)
        return { type: 'python', path: join(process.resourcesPath, 'python_env', 'python.exe') }
    } else {
        // macOS/Linux: Check for PyInstaller bundle first
        const bundlePath = join(process.resourcesPath, 'middleware', 'bin', 'python-bundle', 'murasaki-engine')
        if (fs.existsSync(bundlePath)) {
            return { type: 'bundle', path: bundlePath }
        }
        // Fallback to system Python
        return { type: 'python', path: 'python3' }
    }
}

// Helper to spawn Python process with sanitized environment
// Supports both Python mode (python script.py) and Bundle mode (./murasaki-engine --script=main)
const spawnPythonProcess = (
    pythonInfo: { type: 'python' | 'bundle'; path: string },
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore' | 'ipc' | null> }
) => {
    // 1. Base Environment
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...options.env, // Merge user provided env (e.g. CUDA_VISIBLE_DEVICES)
        PYTHONIOENCODING: 'utf-8'
    }

    // 2. Sanitation: Remove system-wide Python paths
    delete env['PYTHONHOME']
    delete env['PYTHONPATH']

    let cmd: string
    let finalArgs: string[]

    if (pythonInfo.type === 'bundle') {
        // Bundle mode: directly execute the bundle with args
        // PyInstaller bundle 已内置入口点，需移除脚本路径
        // args = ['path/to/main.py', '--file', ...] -> ['--file', ...]
        cmd = pythonInfo.path
        // 移除第一个元素（脚本路径），只保留实际参数
        finalArgs = args.slice(1)
        console.log(`[Spawn Bundle] ${cmd} ${finalArgs.join(' ')}`)
    } else {
        // Python mode: python script.py args
        cmd = pythonInfo.path
        finalArgs = args
        console.log(`[Spawn Python] ${cmd} ${args[0]}... (Env Sanitized)`)
    }

    return spawn(cmd, finalArgs, {
        ...options,
        env
    })
}

// Helper for User Mutable Data (Models, Glossaries)
// Reverted to Self-Contained (User Request):
// In Prod: resources/middleware (Same as binary)
// In Dev: project/llm/middleware
const getUserDataPath = () => {
    return getMiddlewarePath()
}

// Ensure User Data Dirs Exist
const initUserData = () => {
    const userDataPath = getUserDataPath()
    const modelsDir = join(userDataPath, 'models')
    const glossariesDir = join(userDataPath, 'glossaries')

    // In prod these should usually exist from installer, but ensures if missing
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true })
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true })
    if (!fs.existsSync(glossariesDir)) fs.mkdirSync(glossariesDir, { recursive: true })

    return { modelsDir, glossariesDir }
}

// Call on startup
initUserData()

// IPC Handlers
ipcMain.handle('select-file', async (_event, options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: options?.title,
        defaultPath: options?.defaultPath,
        properties: ['openFile'],
        filters: options?.filters || [{ name: 'Documents', extensions: ['txt', 'epub', 'srt', 'ass', 'ssa'] }]
    })
    if (canceled) return null
    return filePaths[0]
})

ipcMain.handle('select-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    })
    if (canceled) return null
    return filePaths[0]
})

// Select folder for cache file browsing
ipcMain.handle('select-folder', async (_event, options?: { title?: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: options?.title || '选择文件夹',
        properties: ['openDirectory']
    })
    if (canceled) return null
    return filePaths[0]
})

// List cache files in a directory




ipcMain.handle('list-cache-files', async (_event, folderPath: string) => {
    try {
        const files = fs.readdirSync(folderPath)
        return files
            .filter(f => f.endsWith('.cache.json'))
            .map(f => ({
                name: f,
                path: join(folderPath, f)
            }))
    } catch (e) {
        console.error('[IPC] list-cache-files error:', e)
        return []
    }
})

// Multi-file selection for batch translation
ipcMain.handle('select-files', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Documents', extensions: ['txt', 'epub', 'srt', 'ass', 'ssa'] }]
    })
    if (canceled) return []
    return filePaths
})

ipcMain.handle('import-glossary', async (_event, sourcePath: string) => {
    try {
        const isDev = process.env.NODE_ENV === 'development'
        const middlewareDir = isDev
            ? join(__dirname, '../../middleware')
            : join(process.resourcesPath, 'middleware')
        const glossaryDir = join(middlewareDir, 'glossaries')

        if (!fs.existsSync(glossaryDir)) fs.mkdirSync(glossaryDir, { recursive: true })

        const fileName = sourcePath.split(/[/\\]/).pop() || 'imported.json'
        const targetPath = join(glossaryDir, fileName)

        fs.copyFileSync(sourcePath, targetPath)
        return { success: true, path: targetPath }
    } catch (e) {
        console.error('[IPC] import-glossary failed:', e)
        return { success: false, error: String(e) }
    }
})

// --- Server Manager IPC ---
ipcMain.handle('server-status', () => {
    return ServerManager.getInstance().getStatus()
})

ipcMain.handle('server-start', async (_event, config) => {
    return await ServerManager.getInstance().start(config)
})

ipcMain.handle('server-stop', async () => {
    await ServerManager.getInstance().stop()
    return true
})

ipcMain.handle('server-logs', () => {
    return ServerManager.getInstance().getLogs()
})

ipcMain.handle('server-warmup', async () => {
    return await ServerManager.getInstance().warmup()
})
// --------------------------

// --- Remote Server IPC ---
import { RemoteClient, clearRemoteClient } from './remoteClient'

let remoteClient: RemoteClient | null = null

ipcMain.handle('remote-connect', async (_event, config: { url: string; apiKey?: string }) => {
    try {
        remoteClient = new RemoteClient(config)
        const result = await remoteClient.testConnection()
        if (!result.ok) {
            remoteClient = null
        }
        return result
    } catch (e) {
        remoteClient = null
        return { ok: false, message: String(e) }
    }
})

ipcMain.handle('remote-disconnect', async () => {
    remoteClient = null
    clearRemoteClient()
    return { ok: true }
})

ipcMain.handle('remote-status', async () => {
    if (!remoteClient) {
        return { connected: false }
    }
    try {
        const status = await remoteClient.getStatus()
        return { connected: true, ...status }
    } catch (e) {
        return { connected: false, error: String(e) }
    }
})

ipcMain.handle('remote-models', async () => {
    if (!remoteClient) return []
    try {
        return await remoteClient.listModels()
    } catch (e) {
        console.error('[Remote] listModels error:', e)
        return []
    }
})

ipcMain.handle('remote-glossaries', async () => {
    if (!remoteClient) return []
    try {
        return await remoteClient.listGlossaries()
    } catch (e) {
        console.error('[Remote] listGlossaries error:', e)
        return []
    }
})

ipcMain.handle('remote-translate', async (_event, options: TranslateOptions) => {
    if (!remoteClient) {
        return { error: 'Not connected to remote server' }
    }
    try {
        const { taskId, status } = await remoteClient.createTranslation(options)
        return { taskId, status }
    } catch (e) {
        return { error: String(e) }
    }
})

ipcMain.handle('remote-task-status', async (_event, taskId: string) => {
    if (!remoteClient) {
        return { error: 'Not connected to remote server' }
    }
    try {
        return await remoteClient.getTaskStatus(taskId)
    } catch (e) {
        return { error: String(e) }
    }
})

ipcMain.handle('remote-cancel', async (_event, taskId: string) => {
    if (!remoteClient) {
        return { error: 'Not connected to remote server' }
    }
    try {
        return await remoteClient.cancelTask(taskId)
    } catch (e) {
        return { error: String(e) }
    }
})

ipcMain.handle('remote-upload', async (_event, filePath: string) => {
    if (!remoteClient) {
        return { error: 'Not connected to remote server' }
    }
    try {
        return await remoteClient.uploadFile(filePath)
    } catch (e) {
        return { error: String(e) }
    }
})

ipcMain.handle('remote-download', async (_event, taskId: string, savePath: string) => {
    if (!remoteClient) {
        return { error: 'Not connected to remote server' }
    }
    try {
        await remoteClient.downloadResult(taskId, savePath)
        return { success: true }
    } catch (e) {
        return { error: String(e) }
    }
})
// --------------------------

// Single Block Retranslation

// Select folder and get all supported files
ipcMain.handle('select-folder-files', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    })
    if (canceled || !filePaths[0]) return []
    const folderPath = filePaths[0]
    const files = fs.readdirSync(folderPath)
        .filter(f => /\.(txt|epub|srt|ass|ssa)$/i.test(f))
        .map(f => join(folderPath, f))
    return files
})

// Scan directory for supported files (Drag & Drop support)
// Scan directory for supported files (Drag & Drop support)
// Helper for async directory scanning with concurrency control and symlink safety
const scanDirectoryAsync = async (dir: string, recursive: boolean): Promise<string[]> => {
    try {
        // withFileTypes avoids separate stat calls and safer for symlinks
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        const results: string[] = []
        const subdirs: string[] = []

        for (const entry of entries) {
            const fullPath = join(dir, entry.name)

            // Skip symbolic links to prevent infinite recursion loops
            if (entry.isSymbolicLink()) continue

            if (entry.isFile()) {
                if (/\.(txt|epub|srt|ass|ssa)$/i.test(fullPath)) {
                    results.push(fullPath)
                }
            } else if (entry.isDirectory() && recursive) {
                subdirs.push(fullPath)
            }
        }

        // Process subdirectories with simple batch concurrency to prevent EMFILE
        if (subdirs.length > 0) {
            const CONCURRENCY = 8 // Limit concurrent directory scans
            for (let i = 0; i < subdirs.length; i += CONCURRENCY) {
                const batch = subdirs.slice(i, i + CONCURRENCY)
                // Parallelize within the batch
                const batchResults = await Promise.all(batch.map(d => scanDirectoryAsync(d, recursive)))
                // Flatten and merge
                for (const res of batchResults) {
                    results.push(...res)
                }
            }
        }

        return results
    } catch (e) {
        // console.error('Scan dir error:', dir, e)
        return []
    }
}

ipcMain.handle('scan-directory', async (_event, path: string, recursive: boolean = false) => {
    try {
        if (!fs.existsSync(path)) return []

        // Use promises.stat for entry point too
        const stats = await fs.promises.stat(path)

        // If it's a file, return if supported
        if (stats.isFile()) {
            return /\.(txt|epub|srt|ass|ssa)$/i.test(path) ? [path] : []
        }

        // If directory
        if (stats.isDirectory()) {
            return await scanDirectoryAsync(path, recursive)
        }
        return []
    } catch (e) {
        console.error('[IPC] scan-directory error:', e)
        return []
    }
})

// --- Update System IPC ---
ipcMain.handle('check-update', async () => {
    try {
        const repo = 'soundstarrain/Murasaki-Translator'
        const url = `https://api.github.com/repos/${repo}/releases/latest`

        const fetch = (url: string) => new Promise<string>((resolve, reject) => {
            const https = require('https')
            const options = {
                headers: { 'User-Agent': 'Murasaki-Translator' }
            }
            https.get(url, options, (res: import('http').IncomingMessage) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`GitHub API returned status ${res.statusCode}`))
                    return
                }
                let data = ''
                res.on('data', (chunk: Buffer) => data += chunk)
                res.on('end', () => resolve(data))
            }).on('error', reject)
        })

        const resBody = await fetch(url)
        const data = JSON.parse(resBody)

        return {
            success: true,
            currentVersion: app.getVersion(),
            latestVersion: data.tag_name?.replace('v', ''),
            releaseNotes: data.body,
            url: data.html_url
        }
    } catch (e) {
        console.error('[Update Check] Failed:', e)
        return { success: false, error: String(e) }
    }
})
// --------------------------

// Open External link in system browser
ipcMain.on('open-external', (_event, url: string) => {
    const { shell } = require('electron')
    // Security validation: Only allow http and https protocols
    if (url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url).catch((e: Error) => console.error('[Shell] Failed to open external URL:', e))
    } else {
        console.warn('Blocked invalid or potentially dangerous external URL:', url)
    }
})

// Desktop Notification
ipcMain.on('show-notification', (_event, { title, body }) => {
    new Notification({ title, body }).show()
})

// Theme Sync - Update Windows title bar color
ipcMain.on('set-theme', (_event, theme: 'dark' | 'light') => {
    nativeTheme.themeSource = theme
})

// Read server.log for debug export - 使用流式读取避免大文件OOM
ipcMain.handle('read-server-log', async () => {
    try {
        const middlewareDir = getMiddlewarePath()
        const logPath = join(middlewareDir, 'server.log')
        if (!fs.existsSync(logPath)) {
            return { exists: false, path: logPath }
        }

        const stats = fs.statSync(logPath)
        const maxBytes = 512 * 1024 // 最多读取 512KB (约 10000 行)
        const lineCount = 500

        // 如果文件较小，直接读取
        if (stats.size <= maxBytes) {
            const content = fs.readFileSync(logPath, 'utf-8')
            const lines = content.split('\n')
            return {
                exists: true,
                path: logPath,
                lineCount: lines.length,
                content: lines.slice(-lineCount).join('\n')
            }
        }

        // 大文件：只读取末尾部分
        return new Promise((resolve) => {
            const chunks: string[] = []
            const startPos = Math.max(0, stats.size - maxBytes)
            const stream = fs.createReadStream(logPath, {
                encoding: 'utf-8',
                start: startPos
            })

            stream.on('data', (chunk: string) => chunks.push(chunk))
            stream.on('end', () => {
                const content = chunks.join('')
                // 跳过第一行（可能不完整）
                const lines = content.split('\n').slice(1)
                resolve({
                    exists: true,
                    path: logPath,
                    lineCount: lines.length,
                    content: lines.slice(-lineCount).join('\n'),
                    truncated: true
                })
            })
            stream.on('error', (err) => {
                resolve({ exists: false, path: logPath, error: String(err) })
            })
        })
    } catch (e) {
        return { exists: false, error: String(e) }
    }
})

ipcMain.handle('get-models', async () => {
    // Models are now in Documents/MurasakiTranslator/models
    const userDataPath = getUserDataPath()
    const modelDir = join(userDataPath, 'models')
    if (!fs.existsSync(modelDir)) return []
    return fs.readdirSync(modelDir).filter(f => f.endsWith('.gguf'))
})

// Official Murasaki Models Dictionary - keyed by exact file size in bytes
// This allows accurate identification without MD5 computation
const OFFICIAL_MODELS: Record<number, { name: string, paramsB: number, quant: string, vramGB: number, isOfficial: boolean }> = {
    // Murasaki-8B-v0.1-Q4_K_M.gguf - approximately 4.92 GB
    5284823040: { name: 'Murasaki-8B-v0.1-Q4_K_M', paramsB: 8, quant: 'Q4_K_M', vramGB: 5.9, isOfficial: true },
    // Murasaki-8B-v0.1-f16.gguf - approximately 16 GB
    17179869184: { name: 'Murasaki-8B-v0.1-f16', paramsB: 8, quant: 'F16', vramGB: 19.2, isOfficial: true },
    // Add more official models here as they are released
    // Format: exactSizeBytes: { name, paramsB, quant, vramGB, isOfficial: true }
}

ipcMain.handle('get-model-info', async (_event, modelName: string) => {
    const userDataPath = getUserDataPath()
    const modelPath = join(userDataPath, 'models', modelName)
    if (!fs.existsSync(modelPath)) return null

    const stats = fs.statSync(modelPath)
    const sizeBytes = stats.size
    const sizeGB = sizeBytes / (1024 * 1024 * 1024)

    // Check if this is an official model by exact file size
    const officialModel = OFFICIAL_MODELS[sizeBytes]
    if (officialModel) {
        return {
            sizeGB: Math.round(sizeGB * 100) / 100,
            estimatedVramGB: officialModel.vramGB,
            paramsB: officialModel.paramsB,
            quant: officialModel.quant,
            isOfficial: true,
            officialName: officialModel.name
        }
    }

    // Fallback: Parse model name for quant and params
    // Common patterns: xxx-8B-Q4_K_M.gguf, xxx_7b_q5_k.gguf
    const nameLower = modelName.toLowerCase()

    // Extract params (e.g., 8B, 7b, 12B)
    const paramsMatch = nameLower.match(/(\d+\.?\d*)b/)
    const paramsB = paramsMatch ? parseFloat(paramsMatch[1]) : null

    // Extract quant (e.g., IQ4_XS, IQ3_M, Q4_K_M, Q5_K, Q8_0, F16)
    // IQ 系列优先匹配，然后是 Q 系列
    const quantMatch = modelName.match(
        /IQ[1-4]_?(XXS|XS|S|M|NL)|Q[2-8]_?[Kk]?_?[MmSsLl]?|[Ff]16|BF16/i
    )
    const quant = quantMatch ? quantMatch[0].toUpperCase() : 'Unknown'

    // Estimate VRAM: model size + ~20% for KV cache overhead at 8k context
    const estimatedVramGB = sizeGB * 1.2

    return {
        sizeGB: Math.round(sizeGB * 100) / 100,
        estimatedVramGB: Math.round(estimatedVramGB * 100) / 100,
        paramsB: paramsB,
        quant: quant,
        isOfficial: false
    }
})

ipcMain.handle('get-hardware-specs', async () => {
    const middlewareDir = getMiddlewarePath()
    const scriptPath = join(middlewareDir, 'get_specs.py')
    const pythonCmd = getPythonPath()

    console.log("[HardwareSpecs] Middleware Dir:", middlewareDir)
    console.log("[HardwareSpecs] Python Cmd:", pythonCmd)
    console.log("[HardwareSpecs] Script Path:", scriptPath)

    return new Promise((resolve) => {
        if (!fs.existsSync(scriptPath)) {
            const err = `Spec script missing at: ${scriptPath}`
            console.error(err)
            resolve({ error: err })
            return
        }

        const proc = spawnPythonProcess(pythonCmd, ['get_specs.py'], {
            cwd: middlewareDir,
            // shell: false, // Default is false in helper
            // env merged in helper
        })

        let output = ''
        let errorOutput = ''
        let resolved = false

        const timeout = setTimeout(() => {
            if (resolved) return
            resolved = true
            const errMsg = "Get specs timeout - killing process"
            console.error(errMsg)
            proc.kill()
            resolve({ error: errMsg })
        }, 10000)

        if (proc.stdout) {
            proc.stdout.on('data', (d) => output += d.toString())
        }
        if (proc.stderr) {
            proc.stderr.on('data', (d) => errorOutput += d.toString())
        }

        proc.on('error', (err) => {
            if (resolved) return
            resolved = true
            clearTimeout(timeout)
            const errMsg = `Failed to spawn specs process: ${err.message}`
            console.error(errMsg)
            resolve({ error: errMsg })
        })

        proc.on('close', (code) => {
            if (resolved) return
            resolved = true
            clearTimeout(timeout)

            if (code !== 0) {
                const err = `Get specs failed (code ${code}): ${errorOutput}`
                console.error(err)
                resolve({ error: err })
                return
            }

            try {
                // Find JSON in output with unique markers
                const match = output.match(/__HW_SPEC_JSON_START__(.*?)__HW_SPEC_JSON_END__/s)
                if (match) {
                    const data = JSON.parse(match[1])
                    resolve(data)
                } else {
                    // Legacy/Fallback parsing
                    try {
                        resolve(JSON.parse(output.trim()))
                    } catch {
                        const err = `No valid JSON found in specs output. Raw: ${output}`
                        console.error(err)
                        resolve({ error: err })
                    }
                }
            } catch (e) {
                const err = `Failed to parse specs: ${e}. Output: ${output}`
                console.error(err)
                resolve({ error: err })
            }
        })
        proc.on('error', (e) => {
            console.error(e)
            resolve(null)
        })
    })
})

// 刷新 GPU 检测（清除缓存并重新检测）
ipcMain.handle('refresh-gpu-detection', async () => {
    clearGpuCache()
    const platformInfo = detectPlatform()
    console.log('[Platform] GPU detection refreshed:', platformInfo)
    return {
        os: platformInfo.os,
        arch: platformInfo.arch,
        backend: platformInfo.backend,
        binaryDir: platformInfo.binaryDir
    }
})

ipcMain.handle('test-rules', async (_event, { text, rules }) => {
    const middlewareDir = getMiddlewarePath()
    const scriptPath = join(middlewareDir, 'test_rules.py')
    const pythonCmd = getPythonPath()

    return new Promise((resolve) => {
        if (!fs.existsSync(scriptPath)) {
            resolve({ success: false, error: `Test script missing: ${scriptPath}` })
            return
        }

        const proc = spawnPythonProcess(pythonCmd, ['test_rules.py'], {
            cwd: middlewareDir,
            // env merged in helper
        })

        let output = ''
        let errorOutput = ''

        proc.stdout?.on('data', (d) => output += d.toString())
        proc.stderr?.on('data', (d) => errorOutput += d.toString())

        // Send data to stdin
        if (proc.stdin) {
            proc.stdin.write(JSON.stringify({ text, rules }))
            proc.stdin.end()
        }

        proc.on('close', (code) => {
            if (code !== 0) {
                resolve({ success: false, error: `Python error (code ${code}): ${errorOutput}` })
                return
            }
            try {
                const result = JSON.parse(output)
                resolve(result)
            } catch (e) {
                resolve({ success: false, error: `Invalid JSON from Python: ${output}` })
            }
        })

        proc.on('error', (err) => {
            resolve({ success: false, error: `Failed to spawn: ${err.message}` })
        })
    })
})

ipcMain.handle('get-glossaries', async () => {
    const userDataPath = getUserDataPath()
    const glossaryDir = join(userDataPath, 'glossaries')
    if (!fs.existsSync(glossaryDir)) return []
    return fs.readdirSync(glossaryDir).filter(f => f.endsWith('.json'))
})

ipcMain.handle('open-glossary-folder', async () => {
    const userDataPath = getUserDataPath()
    const glossaryDir = join(userDataPath, 'glossaries')
    if (!fs.existsSync(glossaryDir)) fs.mkdirSync(glossaryDir)
    shell.openPath(glossaryDir)
})

ipcMain.handle('save-glossary-file', async (_event, { filename, content }) => {
    const userDataPath = getUserDataPath()
    const glossaryDir = join(userDataPath, 'glossaries')
    const filePath = join(glossaryDir, filename)
    // Basic security check to prevent directory traversal
    if (!filePath.startsWith(glossaryDir)) {
        throw new Error("Invalid path")
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
})

ipcMain.handle('delete-glossary-file', async (_event, filename) => {
    const userDataPath = getUserDataPath()
    const filePath = join(userDataPath, 'glossaries', filename)
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        return true
    }
    return false
})

ipcMain.handle('rename-glossary-file', async (_event, { oldName, newName }) => {
    const userDataPath = getUserDataPath()
    const glossaryDir = join(userDataPath, 'glossaries')
    const oldPath = join(glossaryDir, oldName)

    // Auto-append .json if missing
    let safeNewName = newName
    if (!safeNewName.endsWith('.json')) safeNewName += '.json'

    const newPath = join(glossaryDir, safeNewName)

    if (fs.existsSync(newPath)) {
        return { success: false, error: 'Target filename already exists' }
    }

    if (fs.existsSync(oldPath)) {
        try {
            fs.renameSync(oldPath, newPath)
            return { success: true }
        } catch (e) {
            return { success: false, error: String(e) }
        }
    }
    return { success: false, error: 'Source file not found' }
})

ipcMain.handle('create-glossary-file', async (_event, arg) => {
    const userDataPath = getUserDataPath()
    const glossaryDir = join(userDataPath, 'glossaries')
    let filename, content

    // Support both direct string (filename only) and object ({filename, content})
    if (typeof arg === 'string') {
        filename = arg
        content = "{}"
    } else {
        filename = arg.filename
        content = arg.content || "{}"
    }

    // Ensure ends with .json
    if (filename && !filename.endsWith('.json')) filename += '.json'

    const filePath = join(glossaryDir, filename)
    if (fs.existsSync(filePath)) {
        return { success: false, error: 'File already exists' }
    }

    try {
        fs.writeFileSync(filePath, content, 'utf-8')
        return { success: true, path: filePath }
    } catch (e) {
        console.error(e)
        return { success: false, error: String(e) }
    }
})

ipcMain.handle('read-glossary-file', async (_event, filename) => {
    const userDataPath = getUserDataPath()
    const filePath = join(userDataPath, 'glossaries', filename)
    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8')
    }
    return null
})

ipcMain.handle('read-file', async (_event, path: string) => {
    if (fs.existsSync(path)) {
        return fs.readFileSync(path, 'utf-8')
    }
    return null
})

// 写入文件（用于导出译文）
ipcMain.handle('write-file', async (_event, path: string, content: string) => {
    try {
        fs.writeFileSync(path, content, 'utf-8')
        return true
    } catch (e) {
        console.error('write-file error:', e)
        return false
    }
})

// 加载翻译缓存（用于校对界面）
ipcMain.handle('load-cache', async (_event, cachePath: string) => {
    try {
        if (fs.existsSync(cachePath)) {
            const content = fs.readFileSync(cachePath, 'utf-8')
            return JSON.parse(content)
        }
    } catch (e) {
        console.error('load-cache error:', e)
    }
    return null
})

// 保存翻译缓存（用于校对界面）
ipcMain.handle('save-cache', async (_event, cachePath: string, data: Record<string, unknown>) => {
    try {
        fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8')
        return true
    } catch (e) {
        console.error('save-cache error:', e)
        return false
    }
})

// 重建文档（从缓存）
ipcMain.handle('rebuild-doc', async (_event, { cachePath, outputPath }) => {
    try {
        const middlewareDir = getMiddlewarePath()
        const scriptPath = join(middlewareDir, 'murasaki_translator', 'main.py')
        const pythonCmd = getPythonPath()

        const args = [
            scriptPath,
            '--file', 'REBUILD_STUB', // Parser requires --file
            '--rebuild-from-cache', cachePath
        ]

        if (outputPath) {
            args.push('--output', outputPath)
        }

        console.log('[Rebuild] Executing:', pythonCmd, args.join(' '))

        return new Promise((resolve) => {
            // const { spawn } = require('child_process') // Use global spawnPythonProcess
            const proc = spawnPythonProcess(pythonCmd, args, { cwd: middlewareDir })

            let errorOutput = ''
            if (proc.stderr) {
                proc.stderr.on('data', (data: Buffer) => {
                    errorOutput += data.toString()
                })
            }

            proc.on('close', (code: number) => {
                if (code === 0) {
                    resolve({ success: true })
                } else {
                    resolve({ success: false, error: errorOutput || `Process exited with code ${code}` })
                }
            })
        })
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        return { success: false, error: errorMsg }
    }
})

// 单块重翻（用于校对界面）
ipcMain.handle('retranslate-block', async (event, { src, index, modelPath, config }) => {
    const middlewareDir = getMiddlewarePath()
    const scriptPath = join(middlewareDir, 'murasaki_translator', 'main.py')
    const pythonCmd = getPythonPath() // Use the same python as main translation

    if (!fs.existsSync(scriptPath)) {
        return { success: false, error: `Script not found` }
    }

    // Model Resolution Logic (Match start-translation)
    let effectiveModelPath = modelPath
    const userDataPath = getUserDataPath()

    // 1. Check if direct path
    if (!fs.existsSync(effectiveModelPath)) {
        // 2. Check User Data models
        const userModel = join(userDataPath, 'models', basename(modelPath))
        if (fs.existsSync(userModel)) {
            effectiveModelPath = userModel
        } else {
            // 3. Check Middleware models (bundled)
            const bundledModel = join(middlewareDir, 'models', basename(modelPath))
            if (fs.existsSync(bundledModel)) {
                effectiveModelPath = bundledModel
            }
        }
    }

    const args = [
        'murasaki_translator/main.py', // Use relative path in cwd
        '--file', 'dummy.txt', // Required by argparse
        '--single-block', src,
        '--model', effectiveModelPath,
        '--json-output', // Force JSON output for easy parsing
        '--debug' // Enable CoT logs
    ]

    // Apply Config (Reusing logic from start-translation simplified)
    if (config) {
        if (config.deviceMode === 'cpu') {
            args.push('--gpu-layers', '0')
        } else {
            // 默认使用 -1 (全部加载到 GPU)，如果用户指定了值则使用用户值
            const gpuLayers = config.gpuLayers !== undefined ? config.gpuLayers : -1
            args.push('--gpu-layers', gpuLayers.toString())
        }

        if (config.ctxSize) args.push('--ctx', config.ctxSize)
        if (config.temperature) args.push('--temperature', config.temperature.toString())
        if (config.repPenaltyBase) args.push('--rep-penalty-base', config.repPenaltyBase.toString())
        if (config.repPenaltyMax) args.push('--rep-penalty-max', config.repPenaltyMax.toString())
        if (config.repPenaltyStep) args.push('--rep-penalty-step', config.repPenaltyStep.toString())
        if (config.preset) args.push('--preset', config.preset)

        // Force f16 KV Cache for single block re-translation (Quality Priority)
        args.push('--kv-cache-type', 'f16')

        // Glossary Path
        if (config.glossaryPath && fs.existsSync(config.glossaryPath)) {
            args.push('--glossary', config.glossaryPath)
        }

        // Retry Strategy for Single Block
        if (config.maxRetries !== undefined) {
            args.push('--max-retries', config.maxRetries.toString())
        }
        if (config.retryTempBoost !== undefined) {
            args.push('--retry-temp-boost', config.retryTempBoost.toString())
        }
        if (config.retryPromptFeedback) {
            args.push('--retry-prompt-feedback')
        }
        if (config.outputHitThreshold !== undefined) {
            args.push('--output-hit-threshold', config.outputHitThreshold.toString())
        }
        if (config.cotCoverageThreshold !== undefined) {
            args.push('--cot-coverage-threshold', config.cotCoverageThreshold.toString())
        }
    }

    // Server Handling: Assume server is already running or provided
    // For single block, we might want to attach to existing server if possible?
    // main.py creates InferenceEngine which tries to find server. 
    // If not running, it spawns one. Optimally, we want to reuse the one from Dashboard.
    // Dashboard typically starts one if daemon mode. 
    // Let's check if ServerManager has a running instance.
    const sm = ServerManager.getInstance()
    const status = sm.getStatus()
    if (status.running) {
        args.push('--server', `http://127.0.0.1:${status.port}`)
        args.push('--no-server-spawn')
    }

    console.log('[Retranslate] Spawning:', pythonCmd, args.join(' '))

    return new Promise((resolve) => {
        const proc = spawnPythonProcess(pythonCmd, args, {
            cwd: middlewareDir,
            env: { CUDA_VISIBLE_DEVICES: config?.gpuDeviceId }, // Only pass custom vars, helper merges process.env and sanitizes
            stdio: ['ignore', 'pipe', 'pipe']
        })

        let outputBuffer = ''
        let errorBuffer = ''

        if (proc.stdout) {
            proc.stdout.on('data', (data) => {
                const str = data.toString()
                outputBuffer += str

                // Stream log to renderer
                // Filter out JSON_RESULT line from log view to keep it clean, or keep it?
                // The main log loop in main.py prints raw CoT.
                if (!str.startsWith('JSON_RESULT:')) {
                    event.sender.send('retranslate-log', { index, text: str })
                }
            })
        }

        if (proc.stderr) {
            proc.stderr.on('data', (data) => {
                const str = data.toString()
                errorBuffer += str

                // Filter out noisy llama-server logs (Same as start-translation)
                if (str.trim() === '.' ||
                    str.includes('llama_') ||
                    str.includes('common_init') ||
                    str.includes('srv ') ||
                    str.startsWith('slot ') ||
                    str.includes('sched_reserve')) {
                    return
                }

                event.sender.send('retranslate-log', { index, text: str, isError: true })
            })
        }

        proc.on('close', (code) => {
            if (code !== 0) {
                resolve({ success: false, error: errorBuffer || `Process exited with code ${code}` })
                return
            }

            // Parse Output
            try {
                // Find "JSON_RESULT:{...}"
                const marker = "JSON_RESULT:"
                const lines = outputBuffer.split('\n')
                let jsonStr = ""
                for (const line of lines) {
                    if (line.trim().startsWith(marker)) {
                        jsonStr = line.trim().substring(marker.length)
                        break
                    }
                }

                if (jsonStr) {
                    const result = JSON.parse(jsonStr)
                    resolve(result)
                } else {
                    // Fallback: try to find the last non-empty line if it looks like the result (legacy)
                    // But we used --json-output so it should be there.
                    resolve({ success: false, error: "No JSON result found in output" })
                }
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e)
                resolve({ success: false, error: errorMsg })
            }
        })
    })
})

// 保存文件对话框
ipcMain.handle('save-file', async (_event, options: { title?: string; defaultPath?: string; filters?: Electron.FileFilter[] }) => {
    const result = await dialog.showSaveDialog({
        title: options?.title || 'Save File',
        defaultPath: options?.defaultPath,
        filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
    })
    return result.canceled ? null : result.filePath
})

// 打开文件（使用系统默认程序）
ipcMain.handle('open-path', async (_event, filePath: string) => {
    if (fs.existsSync(filePath)) {
        return await shell.openPath(filePath)
    }
    return 'File not found'
})

// 在文件管理器中显示文件
// 在文件管理器中显示文件/文件夹
ipcMain.handle('open-folder', async (_event, filePath: string) => {
    // Resolve relative path if it starts with 'middleware'
    if (filePath.startsWith('middleware')) {
        let relativePart = filePath.replace(/^middleware[\\/]/, '')

        // Redirect models/glossaries to User Data
        if (filePath.startsWith('middleware/models') || filePath.startsWith('middleware\\models') ||
            filePath.startsWith('middleware/glossaries') || filePath.startsWith('middleware\\glossaries')) {
            const userDataPath = getUserDataPath()
            // relativePart is "models" or "glossaries" (or subdirectory)
            filePath = join(userDataPath, relativePart)
        } else {
            // Other middleware paths (like logs in dev?) -> getMiddlewarePath (Resources)
            // But usually we don't open those.
            // Let's fallback to getMiddlewarePath just in case
            const middlewareDir = getMiddlewarePath()
            filePath = join(middlewareDir, relativePart)
        }

        // Ensure directory exists
        if (!fs.existsSync(filePath)) {
            try {
                fs.mkdirSync(filePath, { recursive: true })
            } catch (e) {
                console.error("Failed to create dir: " + filePath)
            }
        }
    }

    if (fs.existsSync(filePath)) {
        // use openPath for directories to open INSIDE them, showItemInFolder selects them.
        // The user wants "Open Folder" to enter the directory.
        // If file, show item. If dir, open dir.
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
            shell.openPath(filePath)
        } else {
            shell.showItemInFolder(filePath)
        }
        return true
    }
    return false
})

ipcMain.handle('check-output-file-exists', async (_event, { inputFile, config }) => {
    try {
        const { basename, extname, join } = await import('path')
        const fs = await import('fs')

        let outPath = ''

        // Logic must match main.py and start-translation handler
        if (config.outputDir && fs.existsSync(config.outputDir)) {
            // Custom Directory logic: input_translated.ext
            // From line 773: const baseName = basename(inputFile, `.${ext}`)
            // But main.py uses os.path.splitext logic? NO, index.ts logic (773) is used to pass --output.
            // So if outputDir is active, MAIN.PY USES IT AS IS.
            // Index.ts logic:
            const ext = inputFile.split('.').pop() // simple split
            // basename in node handling ext might be tricky if multiple dots.
            // Line 773: basename(inputFile, `.${ext}`)
            const baseName = basename(inputFile, `.${ext}`)
            const outFilename = `${baseName}_translated.${ext}`
            outPath = join(config.outputDir, outFilename)
        } else {
            // Default logic from main.py - 动态获取模型名称
            // output_path = f"{base}_{model_name}{ext}"
            const ext = extname(inputFile)
            const base = inputFile.substring(0, inputFile.length - ext.length)

            // 从模型路径提取模型名称（去掉扩展名）
            // ⚠️ 健壮性处理：兼容 Windows/POSIX 路径分隔符
            let modelName = 'unknown'
            if (config.modelPath && typeof config.modelPath === 'string' && config.modelPath.trim()) {
                // 统一处理 Windows (\) 和 POSIX (/) 分隔符
                const normalizedPath = config.modelPath.replace(/\\/g, '/')
                const fileName = normalizedPath.split('/').pop() || ''
                modelName = fileName.replace(/\.gguf$/i, '') || 'unknown'
            }

            const suffix = `_${modelName}`
            outPath = `${base}${suffix}${ext}`
        }

        if (fs.existsSync(outPath)) {
            console.log("Detected existing output:", outPath)
            return { exists: true, path: outPath }
        }
        return { exists: false }
    } catch (e) {
        console.error("Check output error:", e)
        return { exists: false }
    }
})

ipcMain.on('start-translation', (event, { inputFile, modelPath, config }) => {
    if (pythonProcess) return // Already running

    const middlewareDir = getMiddlewarePath()
    // Use the proper translator script
    const scriptPath = join(middlewareDir, 'murasaki_translator', 'main.py')

    if (!fs.existsSync(scriptPath)) {
        event.reply('log-update', `ERR: Script not found at ${scriptPath}`)
        return
    }

    const pythonCmd = getPythonPath()
    console.log("Using Python:", pythonCmd)

    // 使用跨平台检测获取正确的二进制路径
    let serverExePath: string
    try {
        const platformInfo = detectPlatform()
        event.reply('log-update', `System: Platform ${platformInfo.os}/${platformInfo.arch}, Backend: ${platformInfo.backend}`)
        serverExePath = getLlamaServerPath()
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        event.reply('log-update', `ERR: ${errorMsg}`)
        return
    }

    // Model selection
    let effectiveModelPath = modelPath
    const userDataPath = getUserDataPath()

    if (!effectiveModelPath) {
        // Auto-select from User Data models folder
        const modelDir = join(userDataPath, 'models')
        if (fs.existsSync(modelDir)) {
            const models = fs.readdirSync(modelDir).filter(f => f.endsWith('.gguf'))
            if (models.length > 0) {
                effectiveModelPath = join(modelDir, models[0])
                console.log("Auto-selected model:", effectiveModelPath)
            }
        }
    } else if (!effectiveModelPath.includes('\\') && !effectiveModelPath.includes('/')) {
        // Relative model name, resolve to full path in User Data
        effectiveModelPath = join(userDataPath, 'models', effectiveModelPath)
    }

    if (!effectiveModelPath || !fs.existsSync(effectiveModelPath)) {
        event.reply('log-update', `ERR: Model not found at ${effectiveModelPath}`)
        return
    }

    // serverExePath 已在上面的 try-catch 中验证

    // Build args for murasaki_translator/main.py
    const args = [
        join('murasaki_translator', 'main.py'),
        '--file', inputFile,
        '--model', effectiveModelPath
    ]

    if (config && config.daemonMode) {
        const sm = ServerManager.getInstance()
        const status = sm.getStatus()

        // Auto-start logic handled by frontend? 
        // Here we assume if daemonMode is checked, server should be ready.
        // Or we can try to start it here if not running?
        // For now, simpler: assume frontend started it via 'server-start'.

        // However, if we support auto-spawn in backend:
        if (!status.running) {
            console.log('[Daemon] Auto-starting server...')
            // Blocking start? Might delay UI.
            // Ideally frontend handles this.
        }

        if (status.running) {
            args.push('--server', `http://127.0.0.1:${status.port}`)
            args.push('--no-server-spawn')
        } else {
            // Fallback
            args.push('--server', serverExePath)
        }
    } else {
        args.push('--server', serverExePath)
    }

    // Apply Advanced Config
    if (config) {
        // Device Mode Logic
        if (config.deviceMode === 'cpu') {
            args.push('--gpu-layers', '0')
            console.log("Mode: CPU Only (Forced gpu-layers 0)")
        } else {
            // 默认使用 -1 (全部加载到 GPU)，如果用户指定了值则使用用户值
            const gpuLayers = config.gpuLayers !== undefined ? config.gpuLayers : -1
            args.push('--gpu-layers', gpuLayers.toString())
            console.log(`Mode: GPU with ${gpuLayers} layers`)
        }

        if (config.ctxSize) args.push('--ctx', config.ctxSize)
        if (config.chunkSize) args.push('--chunk-size', config.chunkSize)

        // Concurrency
        if (config.concurrency) {
            args.push('--concurrency', config.concurrency.toString())
        }

        // Chunk Balancing
        if (config.balanceEnable) {
            args.push('--balance-enable')
        }
        if (config.balanceThreshold !== undefined) {
            args.push('--balance-threshold', config.balanceThreshold.toString())
        }
        if (config.balanceCount) {
            args.push('--balance-count', config.balanceCount.toString())
        }

        // Fidelity & Performance Control (Granular)
        if (config.flashAttn) args.push('--flash-attn')
        if (config.kvCacheType) args.push('--kv-cache-type', config.kvCacheType)
        if (config.useLargeBatch) args.push('--use-large-batch')
        if (config.physicalBatchSize) args.push('--batch-size', config.physicalBatchSize.toString())

        if (config.seed !== undefined && config.seed !== null && config.seed !== "") {
            args.push('--seed', config.seed.toString())
        }

        // Custom Output Directory
        if (config.outputDir && fs.existsSync(config.outputDir)) {
            const ext = inputFile.split('.').pop()
            const baseName = basename(inputFile, `.${ext}`)
            const outFilename = `${baseName}_translated.${ext}`
            const outPath = join(config.outputDir, outFilename)
            args.push('--output', outPath)
            console.log("Custom Output Path:", outPath)
        }

        // Glossary
        if (config.glossaryPath) {
            let gPath = config.glossaryPath
            if (fs.existsSync(gPath)) {
                args.push('--glossary', gPath)
            } else {
                const managedPath = join(middlewareDir, 'glossaries', gPath)
                if (fs.existsSync(managedPath)) {
                    args.push('--glossary', managedPath)
                }
            }
        }

        if (config.preset) {
            args.push('--preset', config.preset)
        }

        if (config.lineFormat) {
            args.push('--line-format', config.lineFormat)
        }

        if (config.strictMode) {
            args.push('--strict-mode', config.strictMode)
        }


        // Debug/Save Options
        if (config.saveCot) {
            args.push('--save-cot')
        }
        if (config.alignmentMode) {
            args.push('--alignment-mode')
        }
        if (config.saveSummary) {
            args.push('--save-summary')
        }


        // User-defined Rules (written as temp files)
        if (config.rulesPre && config.rulesPre.length > 0) {
            const preRulesPath = join(middlewareDir, 'temp_rules_pre.json')
            fs.writeFileSync(preRulesPath, JSON.stringify(config.rulesPre), 'utf8')
            args.push('--rules-pre', preRulesPath)
        }
        if (config.rulesPost && config.rulesPost.length > 0) {
            const postRulesPath = join(middlewareDir, 'temp_rules_post.json')
            fs.writeFileSync(postRulesPath, JSON.stringify(config.rulesPost), 'utf8')
            args.push('--rules-post', postRulesPath)
        }

        // Quality Control Settings
        if (config.temperature !== undefined) {
            args.push('--temperature', config.temperature.toString())
        }
        if (config.lineCheck) {
            args.push('--line-check')
            args.push('--line-tolerance-abs', (config.lineToleranceAbs || 20).toString())
            args.push('--line-tolerance-pct', ((config.lineTolerancePct || 20) / 100).toString())
        }
        if (config.repPenaltyBase !== undefined) {
            args.push('--rep-penalty-base', config.repPenaltyBase.toString())
        }
        if (config.repPenaltyMax !== undefined) {
            args.push('--rep-penalty-max', config.repPenaltyMax.toString())
        }
        if (config.repPenaltyStep !== undefined) {
            args.push('--rep-penalty-step', config.repPenaltyStep.toString())
        }
        if (config.maxRetries !== undefined) {
            args.push('--max-retries', config.maxRetries.toString())
        }

        // Glossary Coverage Check (术语表覆盖率检测)
        if (config.coverageCheck) {
            args.push('--output-hit-threshold', (config.outputHitThreshold || 60).toString())
            args.push('--cot-coverage-threshold', (config.cotCoverageThreshold || 80).toString())
            args.push('--coverage-retries', (config.coverageRetries || 3).toString())
        }

        // Incremental Translation (增量翻译)
        if (config.resume) {
            args.push('--resume')
        }

        // Text Protection (文本保护)

        // Dynamic Retry Strategy (动态重试策略)
        if (config.retryTempBoost !== undefined) {
            args.push('--retry-temp-boost', config.retryTempBoost.toString())
        }
        if (config.retryPromptFeedback) {
            args.push('--retry-prompt-feedback')
        }

        // Save Cache (默认启用，用于校对界面)
        if (config.saveCache !== false) {
            args.push('--save-cache')
            // Cache Directory
            if (config.cacheDir && fs.existsSync(config.cacheDir)) {
                args.push('--cache-path', config.cacheDir)
            }
        }
    }

    console.log('Spawning:', pythonCmd, args.join(' '), 'in', middlewareDir)
    event.reply('log-update', `System: CMD: ${pythonCmd} ${args.join(' ')}`)
    event.reply('log-update', `System: CWD: ${middlewareDir}`)
    event.reply('log-update', `System: Config - CTX: ${config?.ctxSize || '4096'}, Concurrency: ${config?.concurrency || '1'}, KV: ${config?.kvCacheType || 'q8_0'}`)


    // Set GPU ID if specified and not in CPU mode
    let customEnv: NodeJS.ProcessEnv = {}
    if (config?.deviceMode !== 'cpu' && config?.gpuDeviceId) {
        customEnv['CUDA_VISIBLE_DEVICES'] = config.gpuDeviceId
        console.log(`Setting CUDA_VISIBLE_DEVICES=${config.gpuDeviceId}`)
        event.reply('log-update', `System: CUDA_VISIBLE_DEVICES=${config.gpuDeviceId}`)
    }

    try {
        pythonProcess = spawnPythonProcess(pythonCmd, args, {
            cwd: middlewareDir,
            env: customEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        })

        pythonProcess.on('error', (err) => {
            console.error('Spawn Error:', err)
            event.reply('log-update', `CRITICAL ERROR: Failed to spawn python. ${err.message}`)
            pythonProcess = null
        })

        if (pythonProcess.stdout) {
            pythonProcess.stdout.on('data', (data) => {
                const str = data.toString()
                console.log('STDOUT:', str)
                event.reply('log-update', str)
            })
        }

        if (pythonProcess.stderr) {
            pythonProcess.stderr.on('data', (data) => {
                const str = data.toString()

                // Filter out noisy llama-server logs
                if (str.trim() === '.' ||
                    str.includes('llama_') ||
                    str.includes('common_init') ||
                    str.includes('srv ') ||
                    str.startsWith('slot ') ||
                    str.includes('sched_reserve')) {
                    // console.log('Suppressed log:', str) // Optional debug
                    return
                }

                console.error('STDERR:', str)
                // If it's still informational (e.g. from llama-server or python logging that wasn't redirected)
                if (str.includes('INFO') || str.includes('WARN')) {
                    event.reply('log-update', `System: ${str}`)
                } else {
                    event.reply('log-update', `ERR: ${str}`)
                }
            })
        }

        pythonProcess.on('close', (code) => {
            console.log('Process exited with code', code)
            event.reply('process-exit', code)
            pythonProcess = null
        })
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        event.reply('log-update', `Exception: ${errorMsg}`)
        console.error(e)
    }
})

ipcMain.on('stop-translation', () => {
    if (pythonProcess) {
        const pid = pythonProcess.pid
        console.log(`[Stop] Stopping translation process with PID: ${pid}`)

        if (process.platform === 'win32' && pid) {
            try {
                const { execSync } = require('child_process')
                console.log(`[Stop] Executing: taskkill /pid ${pid} /f /t`)
                const output = execSync(`taskkill /pid ${pid} /f /t`)
                console.log('[Stop] taskkill output:', output.toString())
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e)
                console.error('[Stop] taskkill execution failed:', errorMsg)
                // Fallback
                try { pythonProcess.kill() } catch (_) { }
            }
        } else {
            pythonProcess.kill()
        }

        pythonProcess = null


        console.log('[Stop] Translation process stopped signal sent')
    }
})

// --- Term Extraction ---
ipcMain.handle('extract-terms', async (_event, options: { filePath?: string, text?: string, topK?: number }) => {
    const middlewarePath = getMiddlewarePath()
    const pythonPath = getPythonPath()
    const scriptPath = join(middlewarePath, 'term_extractor.py')

    // Check script exists
    if (!fs.existsSync(scriptPath)) {
        return { success: false, error: 'term_extractor.py not found' }
    }

    try {
        let inputPath = options.filePath
        let tempFile: string | null = null

        // If text provided instead of file, write to temp file
        if (!inputPath && options.text) {
            const tempDir = join(middlewarePath, 'temp')
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
            tempFile = join(tempDir, `extract_input_${randomUUID()}.txt`)
            // Use async write to prevent UI blocking for large files
            await fs.promises.writeFile(tempFile, options.text, 'utf-8')
            inputPath = tempFile
        }

        if (!inputPath) {
            return { success: false, error: 'No input provided' }
        }

        const args = [
            scriptPath,
            inputPath,
            '--simple',
            '-k', String(options.topK || 500)
        ]

        console.log(`[TermExtract] Running: ${pythonPath} ${args.join(' ')}`)

        return new Promise((resolve) => {
            const proc = spawnPythonProcess(pythonPath, args, {
                cwd: middlewarePath,
                stdio: ['pipe', 'pipe', 'pipe']
            })

            let stdout = ''
            let stderr = ''

            proc.stdout?.on('data', (data) => {
                stdout += data.toString()
            })

            proc.stderr?.on('data', (data) => {
                const str = data.toString()
                stderr += str
                // Send progress updates to renderer
                if (str.includes('[PROGRESS]')) {
                    const match = str.match(/\[PROGRESS\]\s*([\d.]+)%/)
                    if (match) {
                        mainWindow?.webContents.send('term-extract-progress', parseFloat(match[1]) / 100)
                    }
                }
            })

            proc.on('close', (code) => {
                // Cleanup temp file
                if (tempFile && fs.existsSync(tempFile)) {
                    try { fs.unlinkSync(tempFile) } catch (_) { }
                }

                if (code === 0) {
                    try {
                        const terms = JSON.parse(stdout)
                        resolve({ success: true, terms })
                    } catch (e: unknown) {
                        const errorMsg = e instanceof Error ? e.message : String(e)
                        resolve({ success: false, error: `JSON parse error: ${errorMsg}`, raw: stdout })
                    }
                } else {
                    resolve({ success: false, error: stderr || `Process exited with code ${code}` })
                }
            })

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message })
            })
        })
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        return { success: false, error: errorMsg }
    }
})

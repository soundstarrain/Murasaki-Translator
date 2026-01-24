import { app, shell, BrowserWindow, ipcMain, dialog, Notification, nativeTheme } from 'electron'
import { join, basename } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import { ServerManager } from './serverManager'

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

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
        // Ensure DevTools is closed in prod, just in case
        if (!is.dev) mainWindow.webContents.closeDevTools()
    }
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
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

// Helper to find python executable
const getPythonPath = () => {
    if (is.dev) {
        return process.env.ELECTRON_PYTHON_PATH || 'python'
    }
    // In prod: resources/python_env/python.exe
    return join(process.resourcesPath, 'python_env', 'python.exe')
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
        filters: options?.filters || [{ name: 'Documents', extensions: ['txt', 'epub'] }]
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
        filters: [{ name: 'Documents', extensions: ['txt', 'epub'] }]
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

// Single Block Retranslation
ipcMain.handle('retranslate-block', async (_event, { src, modelPath, config }) => {
    try {
        const isDev = process.env.NODE_ENV === 'development'
        // Resolve middleware directory
        const middlewareDir = isDev
            ? join(__dirname, '../../middleware')
            : join(process.resourcesPath, 'middleware')

        // Python Executable
        const pythonCmd = isDev
            ? 'python' // In dev, assume python is in PATH or venv
            : join(process.resourcesPath, 'python_env', 'python.exe')

        // Find llama-server.exe
        let serverExePath = ''
        const subdirs = fs.readdirSync(middlewareDir)
        for (const subdir of subdirs) {
            const candidate = join(middlewareDir, subdir, 'llama-server.exe')
            if (fs.existsSync(candidate)) {
                serverExePath = candidate
                break
            }
        }
        if (!serverExePath) throw new Error('llama-server.exe not found')

        // Resolve Model Path
        let effectiveModelPath = modelPath
        const userDataPath = getUserDataPath()

        if (effectiveModelPath && !effectiveModelPath.includes('\\') && !effectiveModelPath.includes('/')) {
            effectiveModelPath = join(userDataPath, 'models', effectiveModelPath)
        }
        if (!effectiveModelPath || !fs.existsSync(effectiveModelPath)) {
            throw new Error(`Model not found: ${modelPath}`)
        }

        // Build Args
        // 注意：retranslate-block 暂时复用 main.py，通过 --single-block 传递
        const args = [
            join('murasaki_translator', 'main.py'),
            '--file', 'dummy.txt', // 占位，main.py 需要
            '--model', effectiveModelPath,
            '--single-block', src,
            '--json-output'
        ]

        if (config && config.daemonMode) {
            const sm = ServerManager.getInstance()
            const status = sm.getStatus()
            // Assume server is running if daemonMode is true (Frontend should ensure)
            // But checking won't hurt
            if (status.running) {
                args.push('--server', `http://127.0.0.1:${status.port}`)
                args.push('--no-server-spawn')
            } else {
                // Warning: Daemon requested but not running? Fallback to legacy or error?
                // Let's fallback to legacy logic for safety if possible, or error.
                // Fallback requires serverExePath to be passed.
                args.push('--server', serverExePath)
            }
        } else {
            args.push('--server', serverExePath)
        }

        // Config Options
        if (config) {
            if (config.deviceMode === 'cpu') args.push('--gpu-layers', '0')
            else if (config.gpuLayers) args.push('--gpu-layers', config.gpuLayers)

            if (config.ctxSize) args.push('--ctx', config.ctxSize)
            if (config.preset) args.push('--preset', config.preset)
            if (config.temperature) args.push('--temperature', config.temperature.toString())
            if (config.textProtect) {
                args.push('--text-protect')
                if (config.protectPatterns && config.protectPatterns.trim()) {
                    const patternsPath = join(middlewareDir, 'temp_protect_single.txt')
                    fs.writeFileSync(patternsPath, config.protectPatterns, 'utf8')
                    args.push('--protect-patterns', patternsPath)
                }
            }

            // Glossary
            if (config.glossaryPath) {
                let gPath = config.glossaryPath
                try {
                    if (!fs.existsSync(gPath)) {
                        const managedPath = join(middlewareDir, 'glossaries', gPath)
                        if (fs.existsSync(managedPath)) gPath = managedPath
                    }
                } catch (e) {
                    // Ignore fs errors, let backend handle it
                }
                args.push('--glossary', gPath)
            }

            // Rules
            if (config.rulesPre && config.rulesPre.length > 0) {
                const preRulesPath = join(middlewareDir, 'temp_retry_pre.json')
                fs.writeFileSync(preRulesPath, JSON.stringify(config.rulesPre), 'utf8')
                args.push('--rules-pre', preRulesPath)
            }
            if (config.rulesPost && config.rulesPost.length > 0) {
                const postRulesPath = join(middlewareDir, 'temp_retry_post.json')
                fs.writeFileSync(postRulesPath, JSON.stringify(config.rulesPost), 'utf8')
                args.push('--rules-post', postRulesPath)
            }
        }

        console.log('[Retranslate] Spawning:', pythonCmd, args)

        return new Promise((resolve, reject) => {
            const child = spawn(pythonCmd, args, {
                cwd: middlewareDir,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
            })

            let output = ''
            let errorOut = ''

            child.stdout.on('data', (data) => {
                const str = data.toString()
                output += str
                // Check for JSON result
                const match = str.match(/JSON_RESULT:(.+)/)
                if (match) {
                    try {
                        const result = JSON.parse(match[1])
                        resolve(result)
                    } catch (e) {
                        // wait for more data? or reject
                    }
                }
            })

            child.stderr.on('data', (data) => {
                errorOut += data.toString()
                console.log('[Retranslate Stderr]:', data.toString())
            })

            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Process exited with code ${code}: ${errorOut}`))
                } else {
                    // Fallback if no JSON found (should resolve in stdout handler)
                    // If we are here, maybe we missed the JSON line or it wasn't printed
                    if (!output.includes('JSON_RESULT')) {
                        reject(new Error('No JSON result received from backend'))
                    }
                }
            })
        })

    } catch (error) {
        console.error('Retranslate Error:', error)
        return { success: false, error: (error as Error).message }
    }
})

// Select folder and get all supported files
ipcMain.handle('select-folder-files', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    })
    if (canceled || !filePaths[0]) return []
    const folderPath = filePaths[0]
    const files = fs.readdirSync(folderPath)
        .filter(f => /\.(txt|epub)$/i.test(f))
        .map(f => join(folderPath, f))
    return files
})

// Desktop Notification
ipcMain.on('show-notification', (_event, { title, body }) => {
    new Notification({ title, body }).show()
})

// Theme Sync - Update Windows title bar color
ipcMain.on('set-theme', (_event, theme: 'dark' | 'light') => {
    nativeTheme.themeSource = theme
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

    // Extract quant (e.g., Q4_K_M, Q5_K, Q8_0, F16)
    const quantMatch = modelName.match(/[Qq]\d+_?[Kk]?_?[MmSsLl]?|\.[Qq]\d+|[Ff]16|[Ff][Pp]16/)
    const quant = quantMatch ? quantMatch[0].toUpperCase().replace('.', '') : 'Unknown'

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

    return new Promise((resolve) => {
        if (!fs.existsSync(scriptPath)) {
            console.error("Spec script missing:", scriptPath)
            resolve(null)
            return
        }

        const proc = spawn(pythonCmd, ['get_specs.py'], {
            cwd: middlewareDir,
            shell: true
        })

        let output = ''
        proc.stdout.on('data', (d) => output += d.toString())
        proc.on('close', () => {
            try {
                resolve(JSON.parse(output))
            } catch (e) {
                console.error("Failed to parse specs:", output)
                resolve(null)
            }
        })
        proc.on('error', (e) => {
            console.error(e)
            resolve(null)
        })
    })
})

ipcMain.handle('get-glossaries', async () => {
    const userDataPath = getUserDataPath()
    const glossaryDir = join(userDataPath, 'glossaries')
    if (!fs.existsSync(glossaryDir)) return []
    return fs.readdirSync(glossaryDir).filter(f => f.endsWith('.json') || f.endsWith('.txt'))
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
    if (oldName.endsWith('.json') && !safeNewName.endsWith('.json')) safeNewName += '.json'
    if (oldName.endsWith('.txt') && !safeNewName.endsWith('.txt')) safeNewName += '.txt'

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
ipcMain.handle('save-cache', async (_event, cachePath: string, data: any) => {
    try {
        fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8')
        return true
    } catch (e) {
        console.error('save-cache error:', e)
        return false
    }
})

// 保存文件对话框
ipcMain.handle('save-file', async (_event, options: any) => {
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
            // Default logic from main.py
            // output_path = f"{base}{suffix}{ext}"
            // suffix = f"_Murasaki-8B-v0.1_{args.preset}_{args.mode}"
            // This is hardcoded in main.py v1.0

            const ext = extname(inputFile)
            const base = inputFile.substring(0, inputFile.length - ext.length)

            const preset = config.preset || "training"
            // mode is not part of config object passed from frontend? 
            // Dashboard.tsx line 470 passes "deviceMode" but main.py args line 276 has "mode" (doc/line).
            // Dashboard.tsx config object DOES NOT seem to have 'mode' (doc/line).
            // Let's check Dashboard.tsx config construction (line 456).
            // It has 'deviceMode'. But does it set main.py 'mode'?
            // main.py default mode is "doc".
            const mode = "doc" // Frontend currently doesn't seem to set this, main.py defaults to doc.

            const suffix = `_Murasaki-8B-v0.1_${preset}_${mode}`
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

    // Find llama-server.exe
    let serverExePath = ''
    for (const subdir of fs.readdirSync(middlewareDir)) {
        const candidate = join(middlewareDir, subdir, 'llama-server.exe')
        if (fs.existsSync(candidate)) {
            serverExePath = candidate
            break
        }
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

    if (!serverExePath) {
        event.reply('log-update', `ERR: llama-server.exe not found in ${middlewareDir}`)
        return
    }

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
            if (config.gpuLayers) args.push('--gpu-layers', config.gpuLayers)
        }

        if (config.ctxSize) args.push('--ctx', config.ctxSize)
        if (config.chunkSize) args.push('--chunk-size', config.chunkSize)

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

        // Debug/Save Options

        // Debug/Save Options
        if (config.saveCot) {
            args.push('--save-cot')
        }
        if (config.saveSummary) {
            args.push('--save-summary')
        }

        // [Experimental] Fixer Options
        if (config.fixRuby) {
            args.push('--fix-ruby')
        }
        if (config.fixKana) {
            args.push('--fix-kana')
        }
        if (config.fixPunctuation) {
            args.push('--fix-punctuation')
        }

        // Traditional Chinese Conversion
        if (config.traditional) {
            args.push('--traditional')
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
        if (config.textProtect) {
            args.push('--text-protect')
            if (config.protectPatterns && config.protectPatterns.trim()) {
                const patternsPath = join(middlewareDir, 'temp_protect_batch.txt')
                fs.writeFileSync(patternsPath, config.protectPatterns, 'utf8')
                args.push('--protect-patterns', patternsPath)
            }
        }

        // Dynamic Retry Strategy (动态重试策略)
        if (config.retryTempBoost !== undefined) {
            args.push('--retry-temp-boost', config.retryTempBoost.toString())
        }
        if (config.retryRepBoost !== undefined) {
            args.push('--retry-rep-boost', config.retryRepBoost.toString())
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
    event.reply('log-update', `System: Spawning backend... CWD=${middlewareDir}`)
    event.reply('log-update', `System: Config - CTX: ${config?.ctxSize || '8192'}, Chunk: ${config?.chunkSize || '1000'}, Device: ${config?.deviceMode || 'auto'}`)
    event.reply('log-update', `System: Traditional=${config?.traditional}, RulesPre=${config?.rulesPre?.length || 0}, RulesPost=${config?.rulesPost?.length || 0}`)

    const env = { ...process.env }

    // Set GPU ID if specified and not in CPU mode
    if (config?.deviceMode !== 'cpu' && config?.gpuDeviceId) {
        env['CUDA_VISIBLE_DEVICES'] = config.gpuDeviceId
        console.log(`Setting CUDA_VISIBLE_DEVICES=${config.gpuDeviceId}`)
        event.reply('log-update', `System: CUDA_VISIBLE_DEVICES=${config.gpuDeviceId}`)
    }

    try {
        pythonProcess = spawn(pythonCmd, args, {
            cwd: middlewareDir,
            env: env,
            // shell: true, // REMOVED: Shell causes PID mismatch, preventing kill
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
                event.reply('log-update', `ERR: ${str}`)
            })
        }

        pythonProcess.on('close', (code) => {
            console.log('Process exited with code', code)
            event.reply('process-exit', code)
            pythonProcess = null
        })
    } catch (e: any) {
        event.reply('log-update', `Exception: ${e.message}`)
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
            } catch (e: any) {
                console.error('[Stop] taskkill execution failed:', e.message)
                // Fallback
                try { pythonProcess.kill() } catch (_) { }
            }
        } else {
            pythonProcess.kill()
        }

        pythonProcess = null

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('process-exit', -1)
        }
        console.log('[Stop] Translation process stopped signal sent')
    }
})

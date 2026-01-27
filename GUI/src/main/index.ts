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
    // In prod: resources/python_env/Scripts/python.exe
    return join(process.resourcesPath, 'python_env', 'Scripts', 'python.exe')
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
            https.get(url, options, (res: any) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`GitHub API returned status ${res.statusCode}`))
                    return
                }
                let data = ''
                res.on('data', (chunk: any) => data += chunk)
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

        const proc = spawn(pythonCmd, ['get_specs.py'], {
            cwd: middlewareDir,
            shell: false,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
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

        proc.stdout.on('data', (d) => output += d.toString())
        proc.stderr.on('data', (d) => errorOutput += d.toString())

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

ipcMain.handle('test-rules', async (_event, { text, rules }) => {
    const middlewareDir = getMiddlewarePath()
    const scriptPath = join(middlewareDir, 'test_rules.py')
    const pythonCmd = getPythonPath()

    return new Promise((resolve) => {
        if (!fs.existsSync(scriptPath)) {
            resolve({ success: false, error: `Test script missing: ${scriptPath}` })
            return
        }

        const proc = spawn(pythonCmd, ['test_rules.py'], {
            cwd: middlewareDir,
            shell: false,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        })

        let output = ''
        let errorOutput = ''

        proc.stdout.on('data', (d) => output += d.toString())
        proc.stderr.on('data', (d) => errorOutput += d.toString())

        // Send data to stdin
        proc.stdin.write(JSON.stringify({ text, rules }))
        proc.stdin.end()

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
ipcMain.handle('save-cache', async (_event, cachePath: string, data: any) => {
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
            const { spawn } = require('child_process')
            const proc = spawn(pythonCmd, args, { cwd: middlewareDir })

            let errorOutput = ''
            proc.stderr.on('data', (data: Buffer) => {
                errorOutput += data.toString()
            })

            proc.on('close', (code: number) => {
                if (code === 0) {
                    resolve({ success: true })
                } else {
                    resolve({ success: false, error: errorOutput || `Process exited with code ${code}` })
                }
            })
        })
    } catch (e: any) {
        return { success: false, error: e.message }
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
        if (config.deviceMode === 'cpu') args.push('--gpu-layers', '0')
        else if (config.gpuLayers) args.push('--gpu-layers', config.gpuLayers)

        if (config.ctxSize) args.push('--ctx', config.ctxSize)
        if (config.temperature) args.push('--temperature', config.temperature.toString())
        if (config.repPenaltyBase) args.push('--rep-penalty-base', config.repPenaltyBase.toString())
        if (config.repPenaltyMax) args.push('--rep-penalty-max', config.repPenaltyMax.toString())
        if (config.preset) args.push('--preset', config.preset)

        // Force f16 KV Cache for single block re-translation (Quality Priority)
        args.push('--kv-cache-type', 'f16')

        // Glossary Coverage Check
        if (config.outputHitThreshold) args.push('--output-hit-threshold', config.outputHitThreshold.toString())
        if (config.cotCoverageThreshold) args.push('--cot-coverage-threshold', config.cotCoverageThreshold.toString())

        // Glossary Path
        if (config.glossaryPath && fs.existsSync(config.glossaryPath)) {
            args.push('--glossary', config.glossaryPath)
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
        const proc = spawn(pythonCmd, args, {
            cwd: middlewareDir,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', CUDA_VISIBLE_DEVICES: config?.gpuDeviceId },
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
            } catch (e: any) {
                resolve({ success: false, error: e.message })
            }
        })
    })
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

        // Debug/Save Options
        if (config.saveCot) {
            args.push('--save-cot')
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
    event.reply('log-update', `System: CMD: ${pythonCmd} ${args.join(' ')}`)
    event.reply('log-update', `System: CWD: ${middlewareDir}`)
    event.reply('log-update', `System: Config - CTX: ${config?.ctxSize || '8192'}, Concurrency: ${config?.concurrency || '1'}, KV: ${config?.kvCacheType || 'f16'}`)

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
            env: { ...env, PYTHONIOENCODING: 'utf-8' },
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

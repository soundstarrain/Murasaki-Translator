import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
    selectFile: (options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => ipcRenderer.invoke('select-file', options),
    selectFiles: () => ipcRenderer.invoke('select-files'),
    selectFolderFiles: () => ipcRenderer.invoke('select-folder-files'),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    selectFolder: () => ipcRenderer.invoke('select-directory'),
    scanDirectory: (path: string, recursive: boolean = false) => ipcRenderer.invoke('scan-directory', path, recursive),
    getModels: () => ipcRenderer.invoke('get-models'),
    getModelInfo: (modelName: string) => ipcRenderer.invoke('get-model-info', modelName),
    startTranslation: (inputFile: string, modelPath: string, config: any) => ipcRenderer.send('start-translation', { inputFile, modelPath, config }),
    getHardwareSpecs: () => ipcRenderer.invoke('get-hardware-specs'),
    refreshGpuDetection: () => ipcRenderer.invoke('refresh-gpu-detection'),
    stopTranslation: () => ipcRenderer.send('stop-translation'),
    getGlossaries: () => ipcRenderer.invoke('get-glossaries'),
    createGlossaryFile: (arg: string | { filename: string; content?: string }) => ipcRenderer.invoke('create-glossary-file', arg),
    importGlossary: (sourcePath: string) => ipcRenderer.invoke('import-glossary', sourcePath),
    checkOutputFileExists: (inputFile: string, config: any) => ipcRenderer.invoke('check-output-file-exists', { inputFile, config }),
    openGlossaryFolder: () => ipcRenderer.invoke('open-glossary-folder'),
    readFile: (path: string) => ipcRenderer.invoke('read-file', path),
    showNotification: (title: string, body: string) => ipcRenderer.send('show-notification', { title, body }),
    onLogUpdate: (callback: (log: string) => void) => ipcRenderer.on('log-update', (_event, value) => callback(value)),
    onProcessExit: (callback: (code: number) => void) => ipcRenderer.on('process-exit', (_event, value) => callback(value)),
    removeLogListener: () => ipcRenderer.removeAllListeners('log-update'),
    removeProcessExitListener: () => ipcRenderer.removeAllListeners('process-exit'),

    // Glossary Management
    readGlossaryFile: (filename: string) => ipcRenderer.invoke('read-glossary-file', filename),
    saveGlossaryFile: (data: { filename: string; content: string }) => ipcRenderer.invoke('save-glossary-file', data),
    deleteGlossaryFile: (filename: string) => ipcRenderer.invoke('delete-glossary-file', filename),
    renameGlossaryFile: (oldName: string, newName: string) => ipcRenderer.invoke('rename-glossary-file', { oldName, newName }),
    openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),
    openFolder: (folderPath: string) => ipcRenderer.invoke('open-folder', folderPath),

    // 校对界面相关 API
    loadCache: (cachePath: string) => ipcRenderer.invoke('load-cache', cachePath),
    saveCache: (cachePath: string, data: any) => ipcRenderer.invoke('save-cache', cachePath, data),
    rebuildDoc: (options: { cachePath: string; outputPath?: string }) => ipcRenderer.invoke('rebuild-doc', options),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('write-file', path, content),
    saveFile: (options: any) => ipcRenderer.invoke('save-file', options),
    retranslateBlock: (options: any) => ipcRenderer.invoke('retranslate-block', options),

    // Server Manager
    serverStatus: () => ipcRenderer.invoke('server-status'),
    serverStart: (config: any) => ipcRenderer.invoke('server-start', config),
    serverStop: () => ipcRenderer.invoke('server-stop'),
    serverLogs: () => ipcRenderer.invoke('server-logs'),
    serverWarmup: () => ipcRenderer.invoke('server-warmup'),

    // Update System
    checkUpdate: () => ipcRenderer.invoke('check-update'),

    // Debug Export
    readServerLog: () => ipcRenderer.invoke('read-server-log'),

    // Theme Sync (for Windows title bar)
    setTheme: (theme: 'dark' | 'light') => ipcRenderer.send('set-theme', theme),

    // External Links
    openExternal: (url: string) => ipcRenderer.send('open-external', url),

    // Rule System
    testRules: (text: string, rules: any[]) => ipcRenderer.invoke('test-rules', { text, rules }),

    // Retranslate Progress
    onRetranslateLog: (callback: (data: { index: number, text: string, isError?: boolean }) => void) =>
        ipcRenderer.on('retranslate-log', (_event, value) => callback(value)),
    removeRetranslateLogListener: () => ipcRenderer.removeAllListeners('retranslate-log'),

    // Term Extraction
    extractTerms: (options: { filePath?: string, text?: string, topK?: number }) =>
        ipcRenderer.invoke('extract-terms', options),
    onTermExtractProgress: (callback: (progress: number) => void) =>
        ipcRenderer.on('term-extract-progress', (_event, value) => callback(value)),
    removeTermExtractProgressListener: () => ipcRenderer.removeAllListeners('term-extract-progress'),

    // Remote Server
    remoteConnect: (config: { url: string; apiKey?: string }) => ipcRenderer.invoke('remote-connect', config),
    remoteDisconnect: () => ipcRenderer.invoke('remote-disconnect'),
    remoteStatus: () => ipcRenderer.invoke('remote-status'),
    remoteModels: () => ipcRenderer.invoke('remote-models'),
    remoteGlossaries: () => ipcRenderer.invoke('remote-glossaries'),
    remoteTranslate: (options: any) => ipcRenderer.invoke('remote-translate', options),
    remoteTaskStatus: (taskId: string) => ipcRenderer.invoke('remote-task-status', taskId),
    remoteCancel: (taskId: string) => ipcRenderer.invoke('remote-cancel', taskId),
    remoteUpload: (filePath: string) => ipcRenderer.invoke('remote-upload', filePath),
    remoteDownload: (taskId: string, savePath: string) => ipcRenderer.invoke('remote-download', taskId, savePath),
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI
    // @ts-ignore (define in dts)
    window.api = api
}

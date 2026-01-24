import { useState, useEffect } from "react"
import { Save, Settings, Trash2, AlertTriangle, Download, FolderOpen, XCircle, Github, Globe, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/core"
import { Button, Switch } from "./ui/core"
import { AlertModal } from "./ui/AlertModal"
import { translations, Language } from "../lib/i18n"
import { APP_CONFIG } from "../lib/config"

export function SettingsView({ lang }: { lang: Language }) {
    const t = translations[lang]

    // Output Config
    const [outputDir, setOutputDir] = useState("")
    const [autoTxt, setAutoTxt] = useState(false)
    const [autoEpub, setAutoEpub] = useState(false)
    const [traditional, setTraditional] = useState(false)
    // Storage Config
    const [cacheDir, setCacheDir] = useState("")

    const [saved, setSaved] = useState(false)

    useEffect(() => {
        setOutputDir(localStorage.getItem("config_output_dir") || "")
        setAutoTxt(localStorage.getItem("config_auto_txt") === "true")
        setAutoEpub(localStorage.getItem("config_auto_epub") === "true")
        setTraditional(localStorage.getItem("config_traditional") === "true")
        setCacheDir(localStorage.getItem("config_cache_dir") || "")
    }, [])

    const handleSelectDir = async () => {
        // @ts-ignore
        const path = await window.api.selectDirectory()
        if (path) {
            setOutputDir(path)
        }
    }

    const handleSave = () => {
        localStorage.setItem("config_output_dir", outputDir)
        localStorage.setItem("config_auto_txt", String(autoTxt))
        localStorage.setItem("config_auto_epub", String(autoEpub))
        localStorage.setItem("config_traditional", String(traditional))
        localStorage.setItem("config_cache_dir", cacheDir)

        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    // Alert State
    const [alertConfig, setAlertConfig] = useState<{
        open: boolean
        title: string
        description: string
        onConfirm: () => void
    }>({ open: false, title: '', description: '', onConfirm: () => { } })

    const handleResetSystem = () => {
        setAlertConfig({
            open: true,
            title: t.dangerZone,
            description: t.resetConfirm,
            onConfirm: () => {
                // Clear all config_ keys
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('config_')) {
                        localStorage.removeItem(key)
                    }
                })
                // Reload to apply defaults
                window.location.reload()
            }
        })
    }

    /**
     * Export all config and history for debugging/bug reports
     */
    const handleExportDebug = () => {
        // Collect all config keys with values
        // Collect all config keys dynamically
        const configData: Record<string, string | null> = {}
        // Iterate over all localStorage keys
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && (key.startsWith('config_') || key === 'selected_model' || key === 'last_input_path')) {
                configData[key] = localStorage.getItem(key)
            }
        }

        // Parse history
        let historyData: unknown = []
        let historyCount = 0
        try {
            const historyStr = localStorage.getItem('translation_history')
            if (historyStr) {
                historyData = JSON.parse(historyStr)
                historyCount = Array.isArray(historyData) ? historyData.length : 0
            }
        } catch {
            historyData = 'parse_error'
        }

        const debugData = {
            // Export metadata
            exportTime: new Date().toISOString(),
            exportVersion: '1.1',

            // App info
            app: {
                name: 'Murasaki Translator',
                version: 'v1.0-beta',
                build: 'electron'
            },

            // System info
            system: {
                platform: navigator.platform,
                userAgent: navigator.userAgent,
                language: navigator.language,
                languages: navigator.languages,
                cookieEnabled: navigator.cookieEnabled,
                onLine: navigator.onLine,
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory || 'unknown',
                maxTouchPoints: navigator.maxTouchPoints
            },

            // Screen info
            screen: {
                width: window.screen.width,
                height: window.screen.height,
                availWidth: window.screen.availWidth,
                availHeight: window.screen.availHeight,
                colorDepth: window.screen.colorDepth,
                pixelRatio: window.devicePixelRatio,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            },

            // All configuration
            config: configData,

            // History summary
            historySummary: {
                recordCount: historyCount,
                lastRecords: Array.isArray(historyData)
                    ? historyData.slice(-5).map((r: { fileName?: string; status?: string; startTime?: string; triggers?: unknown[] }) => ({
                        fileName: r.fileName,
                        status: r.status,
                        startTime: r.startTime,
                        triggerCount: r.triggers?.length || 0
                    }))
                    : []
            },

            // Full history (for detailed debug)
            history: historyData
        }

        const content = JSON.stringify(debugData, null, 2)
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `murasaki_debug_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    return (
        <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
            {/* Header - Fixed Top */}
            <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                    <Settings className="w-6 h-6 text-primary" />
                    {t.settingsTitle}
                </h2>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto px-8 pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/30">
                {/* Output Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">{t.config.outputConfig}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Output Directory */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium block">{t.config.outputDir}</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    className="flex-1 border border-border p-2 rounded bg-secondary text-muted-foreground text-sm"
                                    placeholder="默认 (源文件同目录)"
                                    value={outputDir}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleSelectDir}
                                >
                                    <FolderOpen className="w-4 h-4 mr-2" />
                                    选择文件夹
                                </Button>
                                {outputDir && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setOutputDir("")}
                                        title="重置为默认"
                                    >
                                        <XCircle className="w-4 h-4 text-muted-foreground" />
                                    </Button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {outputDir
                                    ? "翻译文件将保存到指定目录。"
                                    : "翻译文件将保存在源文件的同一目录下。"}
                            </p>
                        </div>

                        <div className="h-px bg-border" />

                        {/* Output Options */}
                        <div className="space-y-4">
                            {/* Traditional Chinese */}
                            <div className="flex items-start gap-4">
                                <Switch
                                    checked={traditional}
                                    onCheckedChange={setTraditional}
                                    className="mt-1"
                                />
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{t.config.traditional}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {t.config.traditionalDesc}
                                    </p>
                                </div>
                            </div>

                        </div>
                    </CardContent>
                </Card>

                {/* Storage Settings */}
                <div className="pt-6">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3 px-1">
                        {t.config.storage.title}
                    </h3>
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t.config.storage.cacheDir}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    className="flex-1 border border-border p-2 rounded bg-secondary text-muted-foreground text-sm"
                                    placeholder="默认 (输出文件同目录)"
                                    value={cacheDir}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                        // @ts-ignore
                                        const path = await window.api.selectFolder() as string | null
                                        if (path) setCacheDir(path)
                                    }}
                                >
                                    <FolderOpen className="w-4 h-4 mr-2" />
                                    选择文件夹
                                </Button>
                                {cacheDir && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setCacheDir("")}
                                        title="重置为默认"
                                    >
                                        <XCircle className="w-4 h-4 text-muted-foreground" />
                                    </Button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {cacheDir
                                    ? "缓存文件将保存到指定目录，可用于断点续传和人工校对。"
                                    : "缓存文件默认保存在输出文件的同一目录下，可用于断点续传和人工校对。"}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Danger Zone */}
                <div className="pt-6">
                    <h3 className="text-sm font-bold text-red-500 dark:text-red-400 flex items-center gap-2 mb-3 px-1">
                        <AlertTriangle className="w-4 h-4" />
                        {t.dangerZone}
                    </h3>
                    <Card className="border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/30">
                        <CardContent className="p-4 flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-red-900 dark:text-red-300">{t.resetSystem}</p>
                                <p className="text-xs text-red-700/70 dark:text-red-400/70">
                                    {t.config.resetDesc}
                                </p>
                                <p className="text-xs text-muted-foreground mt-2">
                                    {t.config.resetHelp}
                                </p>
                            </div>
                            <Button variant="destructive" size="sm" onClick={handleResetSystem} className="gap-2">
                                <Trash2 className="w-4 h-4" />
                                {t.resetSystem}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Debug & Support Section */}
                <div className="pt-6">
                    <h3 className="text-sm font-bold text-blue-500 dark:text-blue-400 flex items-center gap-2 mb-3 px-1">
                        <Download className="w-4 h-4" />
                        {t.settingsView.debug}
                    </h3>

                    {/* Official Resources */}
                    <Card className="border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/30">
                        <CardContent className="p-4 flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-blue-900 dark:text-blue-300">{t.settingsView.exportDebug}</p>
                                <p className="text-xs text-blue-700/70 dark:text-blue-400/70">
                                    {t.settingsView.exportDebugDesc}
                                </p>
                            </div>
                            <Button variant="outline" size="sm" onClick={handleExportDebug} className="gap-2 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30">
                                <Download className="w-4 h-4" />
                                {t.settingsView.export}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* About & Resources - Compact Cards */}
                    <div className="pt-8 pb-4">
                        <div className="grid grid-cols-2 gap-4">
                            {/* GitHub Card */}
                            <div
                                className="flex flex-col gap-1 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-all cursor-pointer group"
                                onClick={() => window.open(APP_CONFIG.officialRepo, '_blank')}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <Github className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                                    <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <span className="font-semibold text-sm">Source Code</span>
                                <span className="text-[10px] text-muted-foreground">
                                    Project {APP_CONFIG.name}
                                </span>
                            </div>

                            {/* HuggingFace Card */}
                            <div
                                className="flex flex-col gap-1 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background hover:bg-yellow-50/50 dark:hover:bg-yellow-900/10 transition-all cursor-pointer group"
                                onClick={() => window.open(APP_CONFIG.modelDownload.huggingface, '_blank')}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-lg">🤗</span>
                                    <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <span className="font-semibold text-sm">Model Hub</span>
                                <span className="text-[10px] text-muted-foreground">
                                    Download Updates
                                </span>
                            </div>
                        </div>

                        {/* Copyright / Version Minimal */}
                        <div className="text-center mt-8 text-[10px] text-muted-foreground/30 font-mono">
                            {APP_CONFIG.name} v{APP_CONFIG.version}
                        </div>
                    </div>
                </div>

                <div className="h-8" />
            </div>

            {/* Floating Footer - Fixed Bottom */}
            <div className="p-8 pt-4 pb-8 border-t bg-background shrink-0 z-10 flex justify-end">
                <Button onClick={handleSave} className="gap-2 shadow-sm px-6">
                    <Save className="w-4 h-4" />
                    {saved ? t.saved : t.save}
                </Button>
            </div>

            <AlertModal
                open={alertConfig.open}
                onOpenChange={(open) => setAlertConfig(prev => ({ ...prev, open }))}
                title={alertConfig.title}
                description={alertConfig.description}
                variant="destructive"
                onConfirm={alertConfig.onConfirm}
                showCancel={true}
                cancelText={t.glossaryView.cancel}
                confirmText={t.config.storage.reset}
            />
        </div>
    )
}

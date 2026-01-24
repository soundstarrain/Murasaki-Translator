import { useState, useEffect } from "react"
import { Save, Sparkles, Info, RefreshCw, Zap } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/core"
import { Button, Switch, Slider } from "./ui/core"
import { translations, Language } from "../lib/i18n"

export function AdvancedView({ lang }: { lang: Language }) {
    const t = translations[lang]
    const [saved, setSaved] = useState(false)

    // Model Config State
    const [gpuLayers, setGpuLayers] = useState("-1")
    const [ctxSize, setCtxSize] = useState("4096")
    const [serverUrl, setServerUrl] = useState("")
    const [promptPreset, setPromptPreset] = useState("training")

    // Device Config
    const [deviceMode, setDeviceMode] = useState<'auto' | 'cpu'>('auto')
    const [gpuDeviceId, setGpuDeviceId] = useState("")

    // Hardware Specs
    const [specs, setSpecs] = useState<any>(null)
    const [loadingSpecs, setLoadingSpecs] = useState(false)

    // Active Model Info
    const [activeModel, setActiveModel] = useState<string>("")
    const [modelInfo, setModelInfo] = useState<any>(null)

    // Text Processing State
    const [fixRuby, setFixRuby] = useState(false)
    const [fixKana, setFixKana] = useState(false)
    const [fixPunctuation, setFixPunctuation] = useState(false)

    // Quality Control Settings (高级质量控制)
    const [temperature, setTemperature] = useState(0.7)
    const [enableLineCheck, setEnableLineCheck] = useState(true)
    const [lineToleranceAbs, setLineToleranceAbs] = useState(10)
    const [lineTolerancePct, setLineTolerancePct] = useState(20)
    const [enableRepPenaltyRetry, setEnableRepPenaltyRetry] = useState(true)
    const [repPenaltyBase, setRepPenaltyBase] = useState(1.0)
    const [repPenaltyMax, setRepPenaltyMax] = useState(1.5)
    const [maxRetries, setMaxRetries] = useState(3)

    // Glossary Coverage Check (术语表覆盖率检测)
    const [enableCoverageCheck, setEnableCoverageCheck] = useState(true)
    const [outputHitThreshold, setOutputHitThreshold] = useState(60)  // 输出精确命中阈值
    const [cotCoverageThreshold, setCotCoverageThreshold] = useState(80)  // CoT覆盖阈值
    const [coverageRetries, setCoverageRetries] = useState(3)

    // Dynamic Retry Strategy (动态重试策略)
    const [retryTempBoost, setRetryTempBoost] = useState(0.1)
    const [retryRepBoost, setRetryRepBoost] = useState(0.1)
    const [retryPromptFeedback, setRetryPromptFeedback] = useState(true)

    // Incremental Translation (增量翻译)
    const [enableResume, setEnableResume] = useState(false)
    // Text Protection (文本保护)
    const [enableTextProtect, setEnableTextProtect] = useState(false)
    const [protectPatterns, setProtectPatterns] = useState("")

    // Server Daemon State (moved from Dashboard)
    const [daemonMode, setDaemonMode] = useState(() => localStorage.getItem("config_daemon_mode") === "true")
    const [serverStatus, setServerStatus] = useState<any>(null)
    const [isStartingServer, setIsStartingServer] = useState(false)
    const [isWarming, setIsWarming] = useState(false)
    const [warmupTime, setWarmupTime] = useState<number | null>(null)

    useEffect(() => {
        let timer: NodeJS.Timeout
        const checkStatus = async () => {
            if (daemonMode && (window as any).api?.serverStatus) {
                try {
                    const s = await (window as any).api.serverStatus()
                    setServerStatus(s)
                } catch (e) {
                    console.error("Server status check failed", e)
                }
            }
        }
        if (daemonMode) {
            checkStatus()
            timer = setInterval(checkStatus, 2000)
        } else {
            setServerStatus(null)
        }
        return () => clearInterval(timer)
    }, [daemonMode])

    useEffect(() => {
        // Load Model Config
        setGpuLayers(localStorage.getItem("config_gpu") || "-1")
        setCtxSize(localStorage.getItem("config_ctx") || "4096")
        setServerUrl(localStorage.getItem("config_server") || "")
        setPromptPreset(localStorage.getItem("config_preset") || "training")

        // Load Device Config
        setDeviceMode((localStorage.getItem("config_device_mode") as 'auto' | 'cpu') || 'auto')
        setGpuDeviceId(localStorage.getItem("config_gpu_device_id") || "")

        // Load Active Model
        const savedModel = localStorage.getItem("config_model")
        if (savedModel) {
            setActiveModel(savedModel)
            loadModelInfo(savedModel)
        }

        // Load Fixer Config
        setFixRuby(localStorage.getItem("config_fix_ruby") === "true")
        setFixKana(localStorage.getItem("config_fix_kana") === "true")
        setFixPunctuation(localStorage.getItem("config_fix_punctuation") === "true")

        // Load Quality Control Config
        const savedTemp = localStorage.getItem("config_temperature")
        if (savedTemp) setTemperature(parseFloat(savedTemp))
        setEnableLineCheck(localStorage.getItem("config_line_check") !== "false")
        const savedLineAbs = localStorage.getItem("config_line_tolerance_abs")
        if (savedLineAbs) setLineToleranceAbs(parseInt(savedLineAbs))
        const savedLinePct = localStorage.getItem("config_line_tolerance_pct")
        if (savedLinePct) setLineTolerancePct(parseInt(savedLinePct))
        setEnableRepPenaltyRetry(localStorage.getItem("config_rep_penalty_retry") !== "false")
        const savedRepBase = localStorage.getItem("config_rep_penalty_base")
        if (savedRepBase) setRepPenaltyBase(parseFloat(savedRepBase))
        const savedRepMax = localStorage.getItem("config_rep_penalty_max")
        if (savedRepMax) setRepPenaltyMax(parseFloat(savedRepMax))
        const savedMaxRetries = localStorage.getItem("config_max_retries")
        if (savedMaxRetries) setMaxRetries(parseInt(savedMaxRetries))

        // Load Glossary Coverage Check Config
        setEnableCoverageCheck(localStorage.getItem("config_coverage_check") !== "false")
        const savedOutputHitThreshold = localStorage.getItem("config_output_hit_threshold")
        if (savedOutputHitThreshold) setOutputHitThreshold(parseInt(savedOutputHitThreshold))
        const savedCotCoverageThreshold = localStorage.getItem("config_cot_coverage_threshold")
        if (savedCotCoverageThreshold) setCotCoverageThreshold(parseInt(savedCotCoverageThreshold))
        const savedCoverageRetries = localStorage.getItem("config_coverage_retries")
        // 修复：如果保存的值大于5，重置为默认值3
        if (savedCoverageRetries) {
            const val = parseInt(savedCoverageRetries)
            setCoverageRetries(val > 5 ? 3 : val)
        }

        // Load Resume Config
        setEnableResume(localStorage.getItem("config_resume") === "true")
        // Load Text Protect Config
        setEnableTextProtect(localStorage.getItem("config_text_protect") === "true")
        setProtectPatterns(localStorage.getItem("config_protect_patterns") || "")

        // Load Dynamic Retry Strategy Config
        const savedRetryTempBoost = localStorage.getItem("config_retry_temp_boost")
        if (savedRetryTempBoost) setRetryTempBoost(parseFloat(savedRetryTempBoost))
        const savedRetryRepBoost = localStorage.getItem("config_retry_rep_boost")
        if (savedRetryRepBoost) setRetryRepBoost(parseFloat(savedRetryRepBoost))
        setRetryPromptFeedback(localStorage.getItem("config_retry_prompt_feedback") !== "false")

        loadHardwareSpecs()
    }, [])

    const loadHardwareSpecs = async () => {
        setLoadingSpecs(true)
        try {
            // @ts-ignore
            const s = await window.api.getHardwareSpecs()
            console.log("Specs:", s)
            if (s) {
                setSpecs(s)
                // if (!localStorage.getItem("config_ctx")) {
                //     setCtxSize(s.recommended_ctx.toString())
                // }
            }
        } catch (e) {
            console.error(e)
        }
        setLoadingSpecs(false)
    }

    const loadModelInfo = async (modelName: string) => {
        try {
            // @ts-ignore
            const info = await window.api.getModelInfo(modelName)
            if (info) {
                console.log("Model Info:", info)
                setModelInfo(info)
            }
        } catch (e) {
            console.error(e)
        }
    }

    const handleSave = () => {
        // Save Model Config
        localStorage.setItem("config_gpu", gpuLayers)
        localStorage.setItem("config_ctx", ctxSize)
        localStorage.setItem("config_server", serverUrl)
        localStorage.setItem("config_preset", promptPreset)
        localStorage.setItem("config_api_key", localStorage.getItem("config_api_key") || "") // Preserve API Key

        // Save Device Config
        localStorage.setItem("config_device_mode", deviceMode)
        localStorage.setItem("config_gpu_device_id", gpuDeviceId)

        // Save Fixer Config
        localStorage.setItem("config_fix_ruby", String(fixRuby))
        localStorage.setItem("config_fix_kana", String(fixKana))
        localStorage.setItem("config_fix_punctuation", String(fixPunctuation))

        // Save Quality Control Config
        localStorage.setItem("config_temperature", String(temperature))
        localStorage.setItem("config_line_check", String(enableLineCheck))
        localStorage.setItem("config_line_tolerance_abs", String(lineToleranceAbs))
        localStorage.setItem("config_line_tolerance_pct", String(lineTolerancePct))
        localStorage.setItem("config_rep_penalty_retry", String(enableRepPenaltyRetry))
        localStorage.setItem("config_rep_penalty_base", String(repPenaltyBase))
        localStorage.setItem("config_rep_penalty_max", String(repPenaltyMax))
        localStorage.setItem("config_max_retries", String(maxRetries))

        // Save Resume Config
        localStorage.setItem("config_resume", String(enableResume))
        // Save Text Protect Config
        localStorage.setItem("config_text_protect", enableTextProtect.toString())
        localStorage.setItem("config_protect_patterns", protectPatterns)

        // Save Dynamic Retry Strategy Config
        localStorage.setItem("config_retry_temp_boost", String(retryTempBoost))
        localStorage.setItem("config_retry_rep_boost", String(retryRepBoost))
        localStorage.setItem("config_retry_prompt_feedback", String(retryPromptFeedback))

        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    const toggleDaemonMode = (e: boolean) => {
        setDaemonMode(e)
        localStorage.setItem("config_daemon_mode", e.toString())
    }

    const handleStartServer = async () => {
        if (!activeModel) {
            // alert? or just return
            return
        }
        setIsStartingServer(true)
        const config = {
            model: activeModel,
            port: parseInt(localStorage.getItem("config_server_port") || "8080"),
            gpuLayers: gpuLayers,
            ctxSize: ctxSize,
            deviceMode: deviceMode,
            gpuDeviceId: gpuDeviceId
        }
        await (window as any).api?.serverStart(config)
        setIsStartingServer(false)
        // Force immediate check
        if ((window as any).api?.serverStatus) {
            const s = await (window as any).api.serverStatus()
            setServerStatus(s)
        }
    }

    const handleStopServer = async () => {
        await (window as any).api?.serverStop()
        setServerStatus(null)
    }

    const handleWarmup = async () => {
        setIsWarming(true)
        setWarmupTime(null)
        try {
            const result = await (window as any).api?.serverWarmup()
            if (result?.success) {
                setWarmupTime(result.durationMs ?? null)
            }
        } catch (e) {
            console.error('Warmup failed', e)
        }
        setIsWarming(false)
    }

    return (
        <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
            {/* Header - Fixed Top */}
            <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                    <Sparkles className="w-6 h-6 text-primary" />
                    {t.nav.advanced}
                    {loadingSpecs && <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />}
                </h2>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto px-8 pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/30">
                <div className="grid gap-6">

                    {/* --- Model Engine Settings Section --- */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
                            模型与推理 (Model & Inference)
                        </h3>

                        {/* ===== GPU & 显存设置 - 一体化大卡片 ===== */}
                        <Card>
                            <CardContent className="pt-6 space-y-6">
                                {/* --- GPU 配置 --- */}
                                <div className="space-y-3">
                                    <div className="text-sm font-semibold border-b pb-2">GPU 配置</div>
                                    <div className={`grid gap-4 ${deviceMode === 'auto' ? 'grid-cols-3' : 'grid-cols-1'}`}>
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-muted-foreground">{t.config.device.mode}</label>
                                            <select
                                                className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                                                value={deviceMode}
                                                onChange={(e) => setDeviceMode(e.target.value as 'auto' | 'cpu')}
                                            >
                                                <option value="auto">{t.config.device.modes.auto}</option>
                                                <option value="cpu">{t.config.device.modes.cpu}</option>
                                            </select>
                                            {deviceMode === 'cpu' && (
                                                <p className="text-xs text-amber-600">⚠️ CPU 推理非常慢</p>
                                            )}
                                        </div>

                                        {deviceMode === 'auto' && (
                                            <>
                                                <div className="space-y-2">
                                                    <label className="text-xs font-medium text-muted-foreground">{t.config.device.gpuId}</label>
                                                    <input
                                                        type="text"
                                                        placeholder="0,1"
                                                        className="w-full border p-2 rounded text-sm bg-secondary"
                                                        value={gpuDeviceId}
                                                        onChange={e => setGpuDeviceId(e.target.value)}
                                                    />
                                                    <p className="text-xs text-muted-foreground">{t.config.device.gpuIdDesc}</p>
                                                </div>

                                                <div className="space-y-2">
                                                    <label className="text-xs font-medium text-muted-foreground">{t.config.gpuLayers}</label>
                                                    <select
                                                        className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                                                        value={gpuLayers}
                                                        onChange={e => setGpuLayers(e.target.value)}
                                                    >
                                                        <option value="-1">{t.advancedView.gpuLayersAll || '全部 (All)'}</option>
                                                        <option value="0">0 (CPU Only)</option>
                                                        <option value="16">16</option>
                                                        <option value="24">24</option>
                                                        <option value="32">32</option>
                                                        <option value="48">48</option>
                                                        <option value="64">64</option>
                                                    </select>
                                                    <p className="text-xs text-muted-foreground">{t.advancedView.gpuLayersDesc || '建议保持默认'}</p>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* --- 上下文长度 --- */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold border-b pb-2">
                                        {t.config.ctxSize}
                                        <span className="text-xs text-muted-foreground font-normal">(Tokens)</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-lg font-bold font-mono">{ctxSize}</span>
                                        <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                                            分块 ≈ {Math.round((parseInt(ctxSize) - 500) / 3.5 * 1.3)} 字符
                                        </span>
                                    </div>
                                    <Slider
                                        min={1024} max={16384} step={256}
                                        value={parseInt(ctxSize)}
                                        onChange={(e) => setCtxSize(e.target.value)}
                                        className="w-full h-2 rounded-lg"
                                        style={{
                                            background: specs ? `linear-gradient(to right, #22c55e 0%, #22c55e ${(specs.max_safe_ctx / 16384) * 100}%, #eab308 ${(specs.max_safe_ctx / 16384) * 100}%, #eab308 ${(specs.max_safe_ctx * 1.5 / 16384) * 100}%, #ef4444 ${(specs.max_safe_ctx * 1.5 / 16384) * 100}%, #ef4444 100%)` : undefined
                                        }}
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                        <span>1024</span>
                                        <span>16384</span>
                                    </div>

                                    {/* VRAM Status */}
                                    {specs && (() => {
                                        const ctx = parseInt(ctxSize)
                                        const systemOverhead = 2.0 + (ctx * 0.0004)
                                        const modelSize = modelInfo ? modelInfo.sizeGB : 8.0
                                        const totalNeeded = modelSize + systemOverhead
                                        const isSafe = totalNeeded <= specs.vram_gb
                                        const usagePercent = Math.min(100, (totalNeeded / specs.vram_gb) * 100)

                                        return (
                                            <div className={`text-xs p-3 rounded-lg border ${isSafe ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900/50' : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/50'}`}>
                                                <div className="flex justify-between items-center mb-1.5">
                                                    <span className="font-medium">{isSafe ? "✓ VRAM Safe" : "⚠ VRAM Risk"}</span>
                                                    <span className="font-mono">{totalNeeded.toFixed(1)}GB / {specs.vram_gb}GB</span>
                                                </div>
                                                <div className="w-full bg-black/10 dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
                                                    <div className={`h-full transition-all ${isSafe ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${usagePercent}%` }} />
                                                </div>
                                                <p className="mt-1.5 text-[10px] opacity-70">
                                                    Model: {modelInfo ? `${activeModel} (${modelInfo.sizeGB.toFixed(1)}GB)` : "Generic (8GB)"} + Sys/Ctx: {systemOverhead.toFixed(1)}GB
                                                </p>
                                            </div>
                                        )
                                    })()}
                                </div>

                                {/* --- 提示词预设 --- */}
                                <div className="space-y-2">
                                    <div className="text-sm font-semibold border-b pb-2">{t.config.promptPreset}</div>
                                    <select
                                        className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                                        value={promptPreset}
                                        onChange={(e) => setPromptPreset(e.target.value)}
                                    >
                                        <option value="training">Training (Default)</option>
                                        <option value="minimal">Minimal</option>
                                        <option value="short">Short (Zero-Shot)</option>
                                    </select>
                                    <p className="text-xs text-muted-foreground">
                                        {t.advancedView.promptPresetDesc || '推荐使用默认 Training 预设'}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* ===== 推理后端卡片 ===== */}
                        <Card>
                            <CardContent className="pt-6 space-y-6">
                                {/* --- 本地服务器 --- */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm font-semibold">本地推理服务</span>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                在本机启动 llama-server 提供 API 服务
                                            </p>
                                        </div>
                                        {/* 模式选择器 */}
                                        <div className="flex bg-secondary rounded-lg p-0.5 border">
                                            <button
                                                onClick={() => toggleDaemonMode(false)}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${!daemonMode
                                                    ? "bg-background text-foreground shadow-sm"
                                                    : "text-muted-foreground hover:text-foreground"
                                                    }`}
                                            >
                                                自动模式
                                            </button>
                                            <button
                                                onClick={() => toggleDaemonMode(true)}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${daemonMode
                                                    ? "bg-background text-foreground shadow-sm"
                                                    : "text-muted-foreground hover:text-foreground"
                                                    }`}
                                            >
                                                常驻模式
                                            </button>
                                        </div>
                                    </div>

                                    <p className="text-xs text-muted-foreground">
                                        {daemonMode
                                            ? "推理服务持续运行，翻译响应更快，但会持续占用显存。"
                                            : "翻译时自动启动推理服务，闲置时自动关闭以释放显存。"}
                                    </p>

                                    {daemonMode && (
                                        <div className="space-y-3 border-l-2 border-primary/30 pl-4">
                                            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-900/50">
                                                <p className="text-xs text-amber-700 dark:text-amber-300">
                                                    <strong>常驻模式：</strong>推理服务持续运行，翻译响应更快，但会持续占用显存。适合需要频繁翻译或对外提供 API 服务的场景。
                                                </p>
                                            </div>

                                            {/* 本地服务器配置 */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1">
                                                    <label className="text-xs font-medium text-muted-foreground">监听端口 (Port)</label>
                                                    <input
                                                        type="number"
                                                        className="w-full border p-2 rounded text-sm bg-secondary font-mono"
                                                        value={localStorage.getItem("config_local_port") || "8080"}
                                                        onChange={e => localStorage.setItem("config_local_port", e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs font-medium text-muted-foreground">绑定地址 (Host)</label>
                                                    <select
                                                        className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                                                        value={localStorage.getItem("config_local_host") || "127.0.0.1"}
                                                        onChange={e => localStorage.setItem("config_local_host", e.target.value)}
                                                    >
                                                        <option value="127.0.0.1">127.0.0.1 (仅本机)</option>
                                                        <option value="0.0.0.0">0.0.0.0 (局域网可访问)</option>
                                                    </select>
                                                </div>
                                            </div>

                                            {/* 服务器状态面板 */}
                                            <div className="p-3 bg-secondary/50 rounded-lg border border-border space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-2 h-2 rounded-full ${serverStatus?.running ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
                                                        <span className="text-xs font-bold">
                                                            {serverStatus?.running ? "运行中" : "已停止"}
                                                        </span>
                                                        {serverStatus?.running && (
                                                            <span className="text-[10px] bg-secondary px-1 rounded border font-mono text-muted-foreground">
                                                                :{serverStatus.port} (PID: {serverStatus.pid})
                                                            </span>
                                                        )}
                                                    </div>
                                                    {warmupTime && (
                                                        <span className="text-[10px] text-green-600">
                                                            预热耗时: {(warmupTime / 1000).toFixed(1)}s
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex gap-2">
                                                    {serverStatus?.running ? (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={handleWarmup}
                                                                disabled={isWarming}
                                                                className="flex-1 h-8 text-xs gap-2"
                                                            >
                                                                <Sparkles className="w-3 h-3" />
                                                                {isWarming ? "预热中..." : "预热模型"}
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="destructive"
                                                                onClick={handleStopServer}
                                                                className="flex-1 h-8 text-xs"
                                                            >
                                                                停止服务
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            onClick={handleStartServer}
                                                            disabled={isStartingServer}
                                                            className="flex-1 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                                                        >
                                                            {isStartingServer ? "启动中..." : "启动服务"}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* --- 远程服务器 --- */}
                                <div className="space-y-3 border-t pt-4">
                                    <div>
                                        <span className="text-sm font-semibold">远程 API 服务器</span>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                            连接远程部署的推理服务或第三方 API（如 OpenAI 兼容接口）
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground">API 地址 (Endpoint)</label>
                                            <input
                                                type="text"
                                                placeholder="http://127.0.0.1:8080"
                                                className="w-full border p-2 rounded text-sm bg-secondary"
                                                value={serverUrl}
                                                onChange={e => setServerUrl(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground">API Key (可选)</label>
                                            <input
                                                type="password"
                                                className="w-full border p-2 rounded text-sm bg-secondary"
                                                placeholder="sk-..."
                                                value={localStorage.getItem("config_api_key") || ""}
                                                onChange={e => localStorage.setItem("config_api_key", e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <Button variant="outline" size="sm" className="text-xs" onClick={async () => {
                                        try {
                                            const url = serverUrl || 'http://127.0.0.1:8080'
                                            const res = await fetch(`${url}/health`)
                                            if (res.ok) alert("✓ 连接成功")
                                            else alert("✗ 服务器返回错误: " + res.status)
                                        } catch (e) { alert("✗ 连接失败: " + e) }
                                    }}>
                                        测试连接
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* --- Quality Control Section (高级质量控制) --- */}
                    <div className="space-y-4 pt-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
                            {t.advancedView.qualityControl}
                            <span className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded font-normal">{t.advancedView.recommendDefault}</span>
                        </h3>

                        <Card>
                            <CardContent className="space-y-6 pt-6">
                                {/* Temperature */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.advancedView.temperature}</span>
                                            <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                        </div>
                                        <span className="text-sm font-mono bg-secondary px-2 py-0.5 rounded">{temperature.toFixed(2)}</span>
                                    </div>
                                    <Slider
                                        value={temperature}
                                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                                        min={0.1}
                                        max={1.5}
                                        step={0.05}
                                        className="w-full"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t.advancedView.temperatureDesc}
                                    </p>
                                </div>

                                {/* Global Max Retries - 全局最大重试次数 */}
                                <div className="space-y-3 border-t pt-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.advancedView.maxRetries}</span>
                                            <span className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">{t.advancedView.globalLabel || '全局'}</span>
                                        </div>
                                        <input
                                            type="number"
                                            className="w-20 border p-1.5 rounded text-sm bg-secondary text-center"
                                            value={maxRetries}
                                            onChange={e => setMaxRetries(parseInt(e.target.value) || 1)}
                                            onBlur={e => {
                                                const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 3))
                                                setMaxRetries(v)
                                                localStorage.setItem("config_max_retries", v.toString())
                                            }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t.advancedView.maxRetriesDesc}
                                    </p>
                                </div>

                                {/* Validation Rules Sub-header */}
                                <div className="flex items-center gap-2 border-t pt-4">
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t.advancedView.validationRules || '验证规则'}</span>
                                    <span className="text-[10px] text-muted-foreground">{t.advancedView.validationRulesDesc || '(触发重试的条件)'}</span>
                                </div>

                                {/* Line Count Check */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.advancedView.lineCheck}</span>
                                        </div>
                                        <Switch
                                            checked={enableLineCheck}
                                            onCheckedChange={setEnableLineCheck}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t.advancedView.lineCheckDesc}
                                    </p>
                                    {enableLineCheck && (
                                        <div className="border-l-2 border-primary/30 pl-4 ml-2 mt-2">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1">
                                                    <label className="text-xs text-muted-foreground">{t.advancedView.absTolerance}</label>
                                                    <input
                                                        type="number"
                                                        className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                        value={lineToleranceAbs}
                                                        onChange={e => setLineToleranceAbs(parseInt(e.target.value) || 20)}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs text-muted-foreground">{t.advancedView.pctTolerance}</label>
                                                    <input
                                                        type="number"
                                                        className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                        value={lineTolerancePct}
                                                        onChange={e => setLineTolerancePct(parseInt(e.target.value) || 20)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Repetition Penalty */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.advancedView.repPenalty}</span>
                                        </div>
                                        <Switch
                                            checked={enableRepPenaltyRetry}
                                            onCheckedChange={setEnableRepPenaltyRetry}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t.advancedView.repPenaltyDesc}
                                    </p>
                                    {enableRepPenaltyRetry && (
                                        <div className="border-l-2 border-primary/30 pl-4 ml-2 mt-2">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1">
                                                    <label className="text-xs text-muted-foreground">{t.advancedView.repBase}</label>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                        value={repPenaltyBase}
                                                        onChange={e => setRepPenaltyBase(parseFloat(e.target.value) || 1.0)}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs text-muted-foreground">{t.advancedView.repMax}</label>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                        value={repPenaltyMax}
                                                        onChange={e => setRepPenaltyMax(parseFloat(e.target.value) || 1.5)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Glossary Coverage Check */}
                                <div className="space-y-3 border-t pt-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.advancedView.glossaryCoverage}</span>
                                        </div>
                                        <Switch
                                            checked={enableCoverageCheck}
                                            onCheckedChange={(v) => {
                                                setEnableCoverageCheck(v)
                                                localStorage.setItem("config_coverage_check", v.toString())
                                            }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        检测译文中术语表翻译的命中率。输出精确命中达到阈值，或 CoT 中日文术语覆盖达到阈值即通过。
                                    </p>

                                    {enableCoverageCheck && (
                                        <div className="border-l-2 border-primary/30 pl-4 ml-2 mt-2 space-y-4">
                                            {/* Coverage Thresholds */}
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-xs text-muted-foreground">输出命中阈值 (%)</label>
                                                    <input
                                                        type="number"
                                                        className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                        value={outputHitThreshold}
                                                        onChange={e => setOutputHitThreshold(parseInt(e.target.value) || 0)}
                                                        onBlur={e => {
                                                            const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 60))
                                                            setOutputHitThreshold(v)
                                                            localStorage.setItem("config_output_hit_threshold", v.toString())
                                                        }}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs text-muted-foreground">CoT覆盖阈值 (%)</label>
                                                    <input
                                                        type="number"
                                                        className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                        value={cotCoverageThreshold}
                                                        onChange={e => setCotCoverageThreshold(parseInt(e.target.value) || 0)}
                                                        onBlur={e => {
                                                            const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 80))
                                                            setCotCoverageThreshold(v)
                                                            localStorage.setItem("config_cot_coverage_threshold", v.toString())
                                                        }}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs text-muted-foreground">{t.advancedView.coverageRetries}</label>
                                                    <input
                                                        type="number"
                                                        className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                        value={coverageRetries}
                                                        onChange={e => setCoverageRetries(parseInt(e.target.value) || 1)}
                                                        onBlur={e => {
                                                            const v = Math.max(1, Math.min(5, parseInt(e.target.value) || 3))
                                                            setCoverageRetries(v)
                                                            localStorage.setItem("config_coverage_retries", v.toString())
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Dynamic Retry Strategy (动态重试策略) - 仅在术语覆盖率检测启用时显示 */}
                                {enableCoverageCheck && (
                                    <div className="space-y-3 border-l-2 border-primary/30 pl-4 ml-2 mt-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">术语表重试策略</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            覆盖率不足时<span className="text-primary font-medium">降低</span>温度增强确定性，自动选择覆盖率最高的结果
                                        </p>

                                        <div className="grid grid-cols-2 gap-4 mt-2">
                                            <div className="space-y-1">
                                                <label className="text-xs text-muted-foreground">温度降低/次</label>
                                                <input
                                                    type="number"
                                                    step="0.05"
                                                    className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                    value={retryTempBoost}
                                                    onChange={e => setRetryTempBoost(parseFloat(e.target.value) || 0)}
                                                    onBlur={e => {
                                                        const v = Math.max(0, Math.min(0.5, parseFloat(e.target.value) || 0.1))
                                                        setRetryTempBoost(v)
                                                        localStorage.setItem("config_retry_temp_boost", v.toString())
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs text-muted-foreground">惩罚提升/次</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                                                    value={retryRepBoost}
                                                    onChange={e => setRetryRepBoost(parseFloat(e.target.value) || 0)}
                                                    onBlur={e => {
                                                        const v = Math.max(0, Math.min(0.3, parseFloat(e.target.value) || 0.1))
                                                        setRetryRepBoost(v)
                                                        localStorage.setItem("config_retry_rep_boost", v.toString())
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between mt-3">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm">Prompt 反馈注入</span>
                                            </div>
                                            <Switch
                                                checked={retryPromptFeedback}
                                                onCheckedChange={(v) => {
                                                    setRetryPromptFeedback(v)
                                                    localStorage.setItem("config_retry_prompt_feedback", v.toString())
                                                }}
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            重试时在提示词中明确告知模型遗漏了哪些术语
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>


                    {/* --- Workflow & Experimental Section (工作流与实验性功能) --- */}
                    <div className="space-y-4 pt-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
                            {t.advancedView.experimental}
                        </h3>

                        <Card>
                            <CardContent className="space-y-6 pt-6">
                                {/* Incremental Translation */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.advancedView.resume}</span>
                                            <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">{t.advancedView.resumeBadge}</span>
                                        </div>
                                        <Switch
                                            checked={enableResume}
                                            onCheckedChange={(v) => {
                                                setEnableResume(v)
                                                localStorage.setItem("config_resume", v.toString())
                                            }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t.advancedView.resumeDesc}
                                    </p>
                                </div>

                                {/* Text Protection */}
                                <div className="space-y-3 border-t pt-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.advancedView.textProtect}</span>
                                            <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">{t.advancedView.resumeBadge}</span>
                                        </div>
                                        <Switch
                                            checked={enableTextProtect}
                                            onCheckedChange={(v) => {
                                                setEnableTextProtect(v)
                                                localStorage.setItem("config_text_protect", v.toString())
                                            }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t.advancedView.textProtectDesc}
                                    </p>

                                    {enableTextProtect && (
                                        <div className="mt-4 space-y-2">
                                            <label className="text-xs font-medium text-foreground">{t.advancedView.customRegex}</label>
                                            <textarea
                                                className="w-full h-32 border rounded p-2 text-xs font-mono bg-secondary resize-none"
                                                placeholder={`^<[^>]+>$\n\\{.*?\\}\n(Name|Skill):`}
                                                value={protectPatterns}
                                                onChange={e => setProtectPatterns(e.target.value)}
                                            />
                                            <p className="text-[10px] text-muted-foreground">
                                                {t.advancedView.customRegexDesc}
                                                <br />{t.advancedView.customRegexExample} <code>&lt;Speaker&gt;</code> / <code>\[.*?\]</code>
                                            </p>
                                        </div>
                                    )}
                                </div>
                                {/* --- 预处理 (Pre-processing) --- */}
                                <div className="space-y-3 border-t pt-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t.advancedView.preTitle}</span>
                                        <span className="text-[10px] text-muted-foreground">{t.advancedView.preSub}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.processing.pre.ruby}</span>
                                            <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">{t.advancedView.resumeBadge}</span>
                                        </div>
                                        <Switch checked={fixRuby} onCheckedChange={setFixRuby} />
                                    </div>
                                    <p className="text-xs text-muted-foreground">{t.processing.pre.rubyDesc}</p>
                                </div>

                                {/* --- 后处理 (Post-processing) --- */}
                                <div className="space-y-3 border-t pt-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t.advancedView.postTitle}</span>
                                        <span className="text-[10px] text-muted-foreground">{t.advancedView.postSub}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.processing.post.punct}</span>
                                            <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">{t.advancedView.resumeBadge}</span>
                                        </div>
                                        <Switch checked={fixPunctuation} onCheckedChange={setFixPunctuation} />
                                    </div>
                                    <p className="text-xs text-muted-foreground">{t.processing.post.punctDesc}</p>

                                    <div className="flex items-center justify-between mt-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{t.processing.post.kana}</span>
                                            <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">{t.advancedView.resumeBadge}</span>
                                        </div>
                                        <Switch checked={fixKana} onCheckedChange={setFixKana} />
                                    </div>
                                    <p className="text-xs text-muted-foreground">{t.processing.post.kanaDesc}</p>
                                </div>

                                <div className="h-2" /> {/* Spacer */}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            {/* Floating Footer - Fixed Bottom */}
            <div className="p-8 pt-4 pb-8 border-t bg-background shrink-0 z-10 flex justify-end">
                <Button onClick={handleSave} className="gap-2 shadow-sm px-6">
                    <Save className="w-4 h-4" />
                    {saved ? t.saved : t.save}
                </Button>
            </div>
        </div >
    )
}

import { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import { Play, X, FolderOpen, FileText, BookOpen, Clock, Zap, Layers, Terminal, ChevronDown, Plus, FolderPlus, Trash2, FileCheck, ArrowRight, AlertTriangle, GripVertical, RefreshCw, AlignLeft } from "lucide-react"
import { Button, Card, Tooltip as UITooltip } from "./ui/core"
import { translations, Language } from "../lib/i18n"
import { getVariants } from "../lib/utils"
import { identifyModel } from "../lib/modelConfig"
import { addRecord, updateRecord, TranslationRecord, TriggerEvent } from "./HistoryView"

import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, Brush } from 'recharts'
import { HardwareMonitorBar, MonitorData } from "./HardwareMonitorBar"
import { AlertModal } from "./ui/AlertModal"
import { useAlertModal } from "../hooks/useAlertModal"

// Window.api type is defined in src/types/api.d.ts

interface DashboardProps {
    lang: Language
    active?: boolean
}

export const Dashboard = forwardRef<any, DashboardProps>(({ lang, active }, ref) => {
    const t = translations[lang]

    // Queue System (从 localStorage 恢复)
    const [fileQueue, setFileQueue] = useState<string[]>(() => {
        const saved = localStorage.getItem("file_queue")
        return saved ? JSON.parse(saved) : []
    })
    const [currentQueueIndex, setCurrentQueueIndex] = useState(-1)
    const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set()) // 追踪已完成的文件

    // Monitors
    const [monitorData, setMonitorData] = useState<MonitorData | null>(null)

    const [modelPath, setModelPath] = useState<string>("")
    const [glossaryPath, setGlossaryPath] = useState<string>("")
    const [models, setModels] = useState<string[]>([])
    const [modelsInfoMap, setModelsInfoMap] = useState<Record<string, { paramsB?: number, sizeGB?: number }>>({})

    const [modelInfo, setModelInfo] = useState<any>(null)
    const { alertProps, showAlert } = useAlertModal()

    const fetchData = async () => {
        const m = await window.api?.getModels()
        if (m) {
            setModels(m)
            const infoMap: Record<string, { paramsB?: number, sizeGB?: number }> = {}
            for (const model of m) {
                try {
                    const info = await window.api?.getModelInfo(model)
                    if (info) infoMap[model] = { paramsB: info.paramsB, sizeGB: info.sizeGB }
                } catch (e) { }
            }
            setModelsInfoMap(infoMap)
        }
        const g = await window.api?.getGlossaries()
        if (g) setGlossaries(g)
    }

    // Sync Model on Active - 每次进入页面时主动获取模型信息
    useEffect(() => {
        if (active) {
            fetchData()
            const path = localStorage.getItem("config_model")
            if (path) {
                const name = path.split(/[/\\]/).pop() || path
                setModelPath(path)
                // 每次进入时都主动获取模型详细信息
                window.api?.getModelInfo(path).then(info => {
                    if (info) {
                        setModelInfo({ ...info, name: name, path: path })
                    } else {
                        setModelInfo({ name: name, path: path })
                    }
                }).catch(() => {
                    setModelInfo({ name: name, path: path })
                })
            } else {
                setModelInfo(null)
                setModelPath("")
            }
        }
    }, [active])
    const [glossaries, setGlossaries] = useState<string[]>([])

    // Save Options
    const [saveCot, setSaveCot] = useState(() => localStorage.getItem("config_save_cot") === "true")
    const [alignmentMode, setAlignmentMode] = useState(() => localStorage.getItem("config_alignment_mode") === "true")

    const [isRunning, setIsRunning] = useState(false)
    const [logs, setLogs] = useState<string[]>([])


    // Collapsible Panels
    const [queueCollapsed, setQueueCollapsed] = useState(false)
    const [logsCollapsed, setLogsCollapsed] = useState(false)
    const logEndRef = useRef<HTMLDivElement>(null)
    const srcPreviewRef = useRef<HTMLDivElement>(null)
    const outPreviewRef = useRef<HTMLDivElement>(null)
    const isAutoScrolling = useRef(false)

    // Refs for stable IPC callbacks
    const currentQueueIndexRef = useRef(currentQueueIndex)
    const fileQueueRef = useRef(fileQueue)
    const currentRecordIdRef = useRef<string | null>(null)
    const logsBufferRef = useRef<string[]>([])
    const triggersBufferRef = useRef<TriggerEvent[]>([])
    // Buffer for assembling split log chunks (fixing JSON parse errors)
    const lineBufferRef = useRef("")
    const progressDataRef = useRef<{ total: number, current: number, lines: number, chars: number, sourceLines: number, sourceChars: number, outputPath: string, speeds: number[] }>({
        total: 0, current: 0, lines: 0, chars: 0, sourceLines: 0, sourceChars: 0, outputPath: '', speeds: []
    })

    // Ref to hold the fresh prepareAndCheck function (avoids closure stale state in handleProcessExit)
    const prepareAndCheckRef = useRef<(inputPath: string, index: number) => Promise<void>>(() => Promise.resolve())

    // Auto-scroll ref
    const activeQueueItemRef = useRef<HTMLDivElement>(null)

    // ...



    // Progress & Preview
    const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, elapsed: 0, remaining: 0, speedLines: 0, speedChars: 0, speedEval: 0, speedGen: 0, retries: 0 })
    const [displayElapsed, setDisplayElapsed] = useState(0) // 本地平滑计时（基于后端数据）
    const [displayRemaining, setDisplayRemaining] = useState(0) // 本地平滑倒计时
    const [chartData, setChartData] = useState<any[]>([])
    const [chartMode, setChartMode] = useState<'chars' | 'tokens' | 'vram' | 'gpu'>('chars')
    // Use Ref to access current chartMode inside onLogUpdate closure
    const chartModeRef = useRef(chartMode)
    useEffect(() => { chartModeRef.current = chartMode }, [chartMode])

    // Multi-metric chart histories
    const chartHistoriesRef = useRef<{
        chars: { time: number; value: number }[],
        tokens: { time: number; value: number }[],
        vram: { time: number; value: number }[],
        gpu: { time: number; value: number }[]
    }>({ chars: [], tokens: [], vram: [], gpu: [] })
    // New Block-Based Preview State
    const [previewBlocks, setPreviewBlocks] = useState<Record<number, { src: string, output: string }>>({})

    // Clear preview on mount (fresh start)
    useEffect(() => {
        localStorage.removeItem("last_preview")
    }, [])

    useEffect(() => {
        const savedModel = localStorage.getItem("config_model")
        if (savedModel) setModelPath(savedModel)
        const savedGlossary = localStorage.getItem("config_glossary_path")
        if (savedGlossary) setGlossaryPath(savedGlossary)
        fetchData()
    }, [])

    useEffect(() => {
        if (modelPath) {
            window.api?.getModelInfo(modelPath).then(info => setModelInfo(info))

            // 检查是否为官方模型，显示识别信息
            const config = identifyModel(modelPath)
            if (config) {
                console.log(`[Murasaki] 识别到官方模型: ${config.displayName}`)
            }
        }
    }, [modelPath])

    // 保存队列到 localStorage
    useEffect(() => {
        localStorage.setItem("file_queue", JSON.stringify(fileQueue))
        fileQueueRef.current = fileQueue
    }, [fileQueue])

    // Sync queue index ref
    useEffect(() => {
        currentQueueIndexRef.current = currentQueueIndex
        // Auto-scroll logic
        if (activeQueueItemRef.current) {
            // Short delay to ensure render
            setTimeout(() => {
                activeQueueItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }, 100)
        }
    }, [currentQueueIndex])



    const handleProcessExit = useCallback((code: number) => {
        setIsRunning(false)
        const success = code === 0
        setLogs(prev => [...prev, success ? '✅ Translation completed successfully!' : `❌ Process exited with code ${code}`]) // Keep English for logs for now or add keys later

        // Finalize history record
        if (currentRecordIdRef.current) {
            const startTime = new Date(parseInt(currentRecordIdRef.current))
            const duration = (Date.now() - startTime.getTime()) / 1000
            const avgSpeed = progressDataRef.current.speeds.length > 0
                ? Math.round(progressDataRef.current.speeds.reduce((a, b) => a + b, 0) / progressDataRef.current.speeds.length)
                : 0
            updateRecord(currentRecordIdRef.current, {
                endTime: new Date().toISOString(),
                duration: Math.round(duration),
                status: success ? 'completed' : 'interrupted',
                totalBlocks: progressDataRef.current.total,
                completedBlocks: progressDataRef.current.current,
                totalLines: progressDataRef.current.lines,
                totalChars: progressDataRef.current.chars,
                sourceLines: progressDataRef.current.sourceLines,
                sourceChars: progressDataRef.current.sourceChars,
                outputPath: progressDataRef.current.outputPath,
                avgSpeed: avgSpeed,
                logs: logsBufferRef.current.slice(-100), // Keep last 100 logs
                triggers: triggersBufferRef.current
            })
            currentRecordIdRef.current = null
            progressDataRef.current = { total: 0, current: 0, lines: 0, chars: 0, sourceLines: 0, sourceChars: 0, outputPath: '', speeds: [] }
        }

        // Don't clear preview - keep showing last translation result
        // setPreview(null) - REMOVED to preserve last result

        window.api?.showNotification('Murasaki Translator', success ? '翻译完成！' : '翻译已停止')

        // Use refs for stable access to current values
        const queueIndex = currentQueueIndexRef.current
        const queue = fileQueueRef.current

        if (success && queueIndex < queue.length - 1) {
            // Mark current file as completed
            setCompletedFiles(prev => new Set(prev).add(queue[queueIndex]))
            // Continue with next file in queue
            const nextIndex = queueIndex + 1

            // IMPORTANT: Use prepareAndCheckRef to perform existence check before overwriting!
            // Do not startTranslation directly. This avoids the stale closure bug and unintentional overwrites.
            setTimeout(() => {
                prepareAndCheckRef.current(queue[nextIndex], nextIndex)
            }, 1000)
        } else {
            // All done or stopped
            if (success && queueIndex >= 0 && queue[queueIndex]) {
                // Mark last file as completed
                setCompletedFiles(prev => new Set(prev).add(queue[queueIndex]))
            }
            setCurrentQueueIndex(-1)
            if (success && queue.length > 1) {
                window.api?.showNotification('Murasaki Translator', `全部 ${queue.length} 个文件翻译完成！`)
            }
            // Reset progress to show completion state
            if (success) {
                setProgress(prev => ({ ...prev, percent: 100 }))
            }
        }
    }, []) // Empty deps - uses refs for values

    useEffect(() => {
        window.api?.onLogUpdate((chunk: string) => {
            // Handle potentially buffered input with multiple lines (Stream Buffering Fix)
            lineBufferRef.current += chunk
            const lines = lineBufferRef.current.split('\n')
            // Keep the last segment (potential partial line) in buffer
            lineBufferRef.current = lines.pop() || ""

            lines.forEach(line => {
                const log = line.trim()
                if (!log) return

                if (log.startsWith("JSON_MONITOR:")) {
                    try {
                        const monitorPayload = JSON.parse(log.substring("JSON_MONITOR:".length))
                        setMonitorData(monitorPayload)
                        // Push to chart histories for VRAM and GPU
                        const now = Date.now()
                        if (typeof monitorPayload.vram_percent === 'number') {
                            chartHistoriesRef.current.vram = [...chartHistoriesRef.current.vram, { time: now, value: monitorPayload.vram_percent }].slice(-100000)
                        }
                        if (typeof monitorPayload.gpu_util === 'number') {
                            chartHistoriesRef.current.gpu = [...chartHistoriesRef.current.gpu, { time: now, value: monitorPayload.gpu_util }].slice(-100000)
                        }
                        // Use real-time speeds from monitor if available (0.5s update rate)
                        if (typeof monitorPayload.realtime_speed_chars === 'number') {
                            chartHistoriesRef.current.chars = [...chartHistoriesRef.current.chars, { time: now, value: monitorPayload.realtime_speed_chars }].slice(-100000)
                        }
                        if (typeof monitorPayload.realtime_speed_tokens === 'number') {
                            chartHistoriesRef.current.tokens = [...chartHistoriesRef.current.tokens, { time: now, value: monitorPayload.realtime_speed_tokens }].slice(-100000)
                        }
                        // Update chartData immediately if in relevant mode
                        const currentMode = chartModeRef.current
                        const activeHistory = chartHistoriesRef.current[currentMode]
                        // Downsample for performance (Max 1000 points visible)
                        const step = Math.ceil(activeHistory.length / 1000)
                        const dataset = step > 1 ? activeHistory.filter((_, i) => i % step === 0) : activeHistory
                        setChartData(dataset.map(h => ({ time: h.time, speed: h.value })))
                    } catch (e) { console.error("Monitor Parse Error:", e) }
                    return
                }

                if (log.startsWith("JSON_THINK_DELTA:")) {
                    return
                }

                if (log.startsWith("JSON_PROGRESS:")) {
                    try {
                        const data = JSON.parse(log.substring("JSON_PROGRESS:".length))
                        // 直接使用后端数据，不保留旧值（避免上一次运行的残留）
                        setProgress(prev => ({
                            current: data.current ?? 0,
                            total: data.total ?? 0,
                            percent: data.percent ?? 0,
                            elapsed: data.elapsed ?? 0,
                            remaining: data.remaining >= 0 ? data.remaining : 0,
                            speedLines: data.speed_lines > 0 ? data.speed_lines : 0,
                            speedChars: data.speed_chars > 0 ? data.speed_chars : 0,
                            speedEval: data.speed_eval ?? 0,
                            speedGen: data.speed_gen ?? 0,
                            // If block changed, reset retries
                            retries: data.current !== prev.current ? 0 : prev.retries
                        }))

                        // Track for history record
                        progressDataRef.current = {
                            total: data.total ?? 0,
                            current: data.current ?? 0,
                            lines: data.total_lines ?? progressDataRef.current.lines,
                            chars: data.total_chars ?? progressDataRef.current.chars,
                            sourceLines: data.source_lines ?? progressDataRef.current.sourceLines,
                            sourceChars: data.source_chars ?? progressDataRef.current.sourceChars,
                            outputPath: progressDataRef.current.outputPath, // 保留已设置的输出路径
                            speeds: data.speed_chars > 0
                                ? [...progressDataRef.current.speeds, data.speed_chars].slice(-20)
                                : progressDataRef.current.speeds
                        }

                        // Update legacy values only if chart history is empty (fallback)
                        // The primary chart driver is now JSON_MONITOR
                        const now = Date.now()
                        if (chartHistoriesRef.current.chars.length === 0 && data.speed_chars > 0) {
                            chartHistoriesRef.current.chars.push({ time: now, value: data.speed_chars })
                        }
                        // Update chartData based on current mode (Use Ref to avoid closure trap)
                        const currentMode = chartModeRef.current
                        const activeHistory = chartHistoriesRef.current[currentMode as keyof typeof chartHistoriesRef.current]
                        // Downsample for performance
                        const step = Math.ceil(activeHistory.length / 1000)
                        const dataset = step > 1 ? activeHistory.filter((_, i) => i % step === 0) : activeHistory
                        setChartData(dataset.map(h => ({ time: h.time, speed: h.value })))
                    } catch (e) { console.error(e) }
                } else if (log.startsWith("JSON_RETRY:")) {
                    try {
                        const data = JSON.parse(log.substring("JSON_RETRY:".length))
                        console.log("[Dashboard] Received JSON_RETRY:", data)
                        // Accumulate retries instead of just setting to attempt number
                        setProgress(prev => ({ ...prev, retries: prev.retries + 1 }))
                        // 添加到触发事件以便记录到历史
                        const retryType = data.type === 'repetition' ? 'rep_penalty_increase' :
                            data.type === 'glossary' ? 'glossary_missed' :
                                data.type === 'empty' ? 'empty_retry' : 'line_mismatch'
                        triggersBufferRef.current.push({
                            time: new Date().toISOString(),
                            type: retryType,
                            block: data.block || 0,
                            message: data.type === 'repetition'
                                ? `重复惩罚提升至 ${data.penalty}`
                                : data.type === 'glossary'
                                    ? `术语覆盖率 ${data.coverage?.toFixed(1)}% 不足，重试中`
                                    : data.type === 'empty'
                                        ? `区块 ${data.block} 输出为空，跳过/重试`
                                        : `区块 ${data.block} 行数差异 ${data.src_lines - data.dst_lines}，重试中`
                        })
                    } catch (e) { console.error("JSON_RETRY Parse Error:", e, log) }
                } else if (log.includes("JSON_PREVIEW_BLOCK:")) {
                    try {
                        const jsonStr = log.substring(log.indexOf("JSON_PREVIEW_BLOCK:") + "JSON_PREVIEW_BLOCK:".length)
                        const data = JSON.parse(jsonStr)
                        // Update specific block
                        setPreviewBlocks(prev => {
                            const next = { ...prev, [data.block]: { src: data.src, output: data.output } }
                            // Persist light-weight version? Or maybe persistence is less critical for realtime stream
                            // but if user reloads? 
                            // Let's persist full blocks map?
                            try { localStorage.setItem("last_preview_blocks", JSON.stringify(next)) } catch (e) { }
                            return next
                        })
                    } catch (e) { console.error(e) }
                } else if (log.startsWith("JSON_OUTPUT_PATH:")) {
                    // 接收输出文件路径
                    try {
                        const data = JSON.parse(log.substring("JSON_OUTPUT_PATH:".length))
                        progressDataRef.current.outputPath = data.path || ''
                    } catch (e) { console.error("Output Path Parse Error:", e) }
                    return
                } else if (log.startsWith("JSON_WARNING:")) {
                    // Quality check warnings from backend
                    try {
                        const data = JSON.parse(log.substring("JSON_WARNING:".length))
                        triggersBufferRef.current.push({
                            time: new Date().toISOString(),
                            type: (data.type ? `warning_${data.type}` : 'warning_quality') as any,
                            block: data.block || 0,
                            message: data.message || ''
                        })
                    } catch (e) { console.error("Warning Parse Error:", e) }
                    return
                } else if (log.startsWith("JSON_ERROR:")) {
                    // Critical error from backend - show internal alert
                    try {
                        const data = JSON.parse(log.substring("JSON_ERROR:".length))
                        showAlert({
                            title: data.title || "错误",
                            description: data.message || "发生未知错误",
                            variant: 'destructive'
                        })
                    } catch (e) { console.error("JSON_ERROR Parse Error:", e) }
                    return
                } else if (log.startsWith("JSON_FINAL:")) {
                    // Final stats from backend
                    try {
                        const data = JSON.parse(log.substring("JSON_FINAL:".length))

                        // Update progressDataRef so handleProcessExit uses these final values
                        // instead of overwriting them with stale data
                        progressDataRef.current = {
                            ...progressDataRef.current,
                            sourceLines: data.sourceLines,
                            sourceChars: data.sourceChars,
                            lines: data.outputLines,
                            chars: data.outputChars
                        }

                        // Update history record with final stats
                        if (currentRecordIdRef.current) {
                            updateRecord(currentRecordIdRef.current, {
                                sourceLines: data.sourceLines,
                                sourceChars: data.sourceChars,
                                totalLines: data.outputLines,
                                totalChars: data.outputChars,
                                avgSpeed: data.avgSpeed,
                                duration: data.totalTime
                            })
                        }
                    } catch (e) { console.error("Stats Parse Error:", e) }
                    return
                } else {
                    // Only add non-empty logs that aren't JSON events
                    setLogs(prev => [...prev.slice(-200), log])

                    // Buffer logs for history record
                    logsBufferRef.current.push(log)
                    if (logsBufferRef.current.length > 100) {
                        logsBufferRef.current = logsBufferRef.current.slice(-100)
                    }

                    // Detect trigger events - REMOVED to avoid duplication with JSON events
                    // Backend now sends JSON_RETRY and JSON_WARNING for all these events
                }
            })
        })
        window.api?.onProcessExit(handleProcessExit)
        return () => {
            window.api?.removeLogListener()
            window.api?.removeProcessExitListener()
        }
    }, [])

    // 快捷键监听 (带有依赖数组，防止闭包陷阱)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!active) return

            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault()
                if (!isRunning && fileQueue.length > 0) handleStartQueue()
            } else if (e.key === 'Escape') {
                e.preventDefault()
                if (isRunning) handleStop()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isRunning, fileQueue, active])

    // Expose methods to parent via ref
    useImperativeHandle(ref, () => ({
        startTranslation: () => {
            if (!isRunning && fileQueue.length > 0) handleStartQueue()
        },
        stopTranslation: () => {
            if (isRunning) handleStop()
        }
    }))

    // 日志自动滚动到底部
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" })
    }, [logs])

    // 预览区域自动滚动到底部
    useEffect(() => {
        // 当预览内容更新时，强制滚动到底部
        if (srcPreviewRef.current) {
            isAutoScrolling.current = true
            srcPreviewRef.current.scrollTop = srcPreviewRef.current.scrollHeight
        }
        if (outPreviewRef.current) {
            isAutoScrolling.current = true
            outPreviewRef.current.scrollTop = outPreviewRef.current.scrollHeight
        }
        // 重置标志位（稍微延迟以防事件触发）
        setTimeout(() => { isAutoScrolling.current = false }, 50)
    }, [previewBlocks])

    // 本地平滑计时器 - 基于后端 elapsed 数据插值更新
    const lastBackendElapsedRef = useRef<number>(0)
    const lastBackendUpdateRef = useRef<number>(0)
    const hasReceivedProgressRef = useRef(false)

    useEffect(() => {
        if (!isRunning) {
            // 翻译停止时不重置显示时间，保留最终结果
            // 但倒计时应清零，因为任务已结束
            lastBackendElapsedRef.current = 0
            lastBackendUpdateRef.current = 0
            hasReceivedProgressRef.current = false
            setDisplayRemaining(0)
            return
        }

        // 每 100ms 更新显示时间
        const timer = setInterval(() => {
            // 使用后端时间 + 本地插值
            if (lastBackendUpdateRef.current > 0 && lastBackendElapsedRef.current > 0) {
                const localDelta = (Date.now() - lastBackendUpdateRef.current) / 1000
                const interpolatedElapsed = lastBackendElapsedRef.current + localDelta
                setDisplayElapsed(Math.floor(interpolatedElapsed))

                // 倒计时插值 (Smoothing Remaining Time)
                if (progress.remaining > 0) {
                    const smoothRemaining = Math.max(0, progress.remaining - localDelta)
                    setDisplayRemaining(Math.round(smoothRemaining))
                } else {
                    setDisplayRemaining(0)
                }

            } else if (progress.elapsed > 0 && hasReceivedProgressRef.current) {
                // 首次收到后端数据前使用后端值 (仅当已收到新数据时)
                setDisplayElapsed(Math.floor(progress.elapsed))
                setDisplayRemaining(Math.floor(progress.remaining))
            }
        }, 100)

        return () => clearInterval(timer)
    }, [isRunning, progress.elapsed])

    // 更新后端时间参考点（每次收到 JSON_PROGRESS 时）
    // 更新后端时间参考点（每次收到 JSON_PROGRESS 时）
    useEffect(() => {
        if (progress.elapsed > 0) {
            lastBackendElapsedRef.current = progress.elapsed
            lastBackendUpdateRef.current = Date.now()
            hasReceivedProgressRef.current = true
        }
    }, [progress.elapsed])

    // Refresh chart data when mode changes
    useEffect(() => {
        const activeHistory = chartHistoriesRef.current[chartMode]
        const step = Math.ceil(activeHistory.length / 1000)
        const dataset = step > 1 ? activeHistory.filter((_, i) => i % step === 0) : activeHistory
        setChartData(dataset.map(h => ({ time: h.time, speed: h.value })))
    }, [chartMode])

    const handleAddFiles = async () => {
        const files = await window.api?.selectFiles()
        if (files?.length) setFileQueue(prev => [...prev, ...files.filter((f: string) => !prev.includes(f))])
    }

    const handleAddFolder = async () => {
        const files = await window.api?.selectFolderFiles()
        if (files?.length) setFileQueue(prev => [...prev, ...files.filter((f: string) => !prev.includes(f))])
    }

    const handleRemoveFile = (index: number) => setFileQueue(prev => prev.filter((_, i) => i !== index))
    const handleClearQueue = () => setFileQueue([])

    const startTranslation = (inputPath: string, forceResume?: boolean, glossaryOverride?: string) => {
        setIsRunning(true)
        setDisplayElapsed(0)
        setDisplayRemaining(0)
        // 重置 Ref 防止旧数据干扰
        lastBackendElapsedRef.current = 0
        lastBackendUpdateRef.current = 0
        hasReceivedProgressRef.current = false

        setChartData([])
        chartHistoriesRef.current = { chars: [], tokens: [], vram: [], gpu: [] }
        setProgress({ current: 0, total: 0, percent: 0, elapsed: 0, remaining: 0, speedLines: 0, speedChars: 0, speedEval: 0, speedGen: 0, retries: 0 })
        setPreviewBlocks({})
        localStorage.removeItem("last_preview_blocks") // Clear persisted preview
        localStorage.removeItem("last_preview_blocks") // Clear persisted preview

        // 根据 ctx 自动计算 chunk-size：公式 (ctx - 500) / 3.5 * 1.3 (Qwen Token Density)
        const ctxValue = parseInt(localStorage.getItem("config_ctx") || "4096")
        // 根据 ctx 自动计算 chunk-size：公式 (ctx - 500) / 3.5 * 1.3 (Qwen Token Density)
        const calculatedChunkSize = Math.max(200, Math.min(3072, Math.floor(((ctxValue - 500) / 3.5) * 1.3)))

        // Get Model Path
        const modelPath = localStorage.getItem("config_model")
        if (!modelPath) {
            // Use custom AlertModal
            showAlert({ title: "Error", description: "Please select a model in the Model Management page first.", variant: 'destructive' })
            window.api?.showNotification("Error", "Please select a model in the Model Management page first.")
            setIsRunning(false)
            return
        }

        const config = {
            gpuLayers: localStorage.getItem("config_gpu"),
            ctxSize: ctxValue.toString(),
            chunkSize: calculatedChunkSize.toString(),
            serverUrl: localStorage.getItem("config_server"),
            outputDir: localStorage.getItem("config_output_dir"),
            glossaryPath: glossaryOverride !== undefined ? glossaryOverride : glossaryPath,
            preset: localStorage.getItem("config_preset") || "training",
            rulesPre: JSON.parse(localStorage.getItem("config_rules_pre") || "[]"),
            rulesPost: JSON.parse(localStorage.getItem("config_rules_post") || "[]"),
            saveCot: saveCot,

            // Device Mode
            deviceMode: localStorage.getItem("config_device_mode") || "auto",

            // Just ensure no style overrides causing issues here, actual display is in the JSX
            gpuDeviceId: localStorage.getItem("config_gpu_device_id") || "",
            // Text Processing Options (from Settings)

            // Quality Control Settings
            temperature: parseFloat(localStorage.getItem("config_temperature") || "0.7"),

            // Storage
            cacheDir: localStorage.getItem("config_cache_dir") || "",

            // Config from UI
            lineCheck: localStorage.getItem("config_line_check") !== "false",
            lineToleranceAbs: parseInt(localStorage.getItem("config_line_tolerance_abs") || "10"),
            lineTolerancePct: parseInt(localStorage.getItem("config_line_tolerance_pct") || "20"),
            strictMode: (localStorage.getItem("config_line_check") !== "false")
                ? (localStorage.getItem("config_strict_mode") || "off")
                : "off",
            repPenaltyBase: parseFloat(localStorage.getItem("config_rep_penalty_base") || "1.0"),
            repPenaltyMax: parseFloat(localStorage.getItem("config_rep_penalty_max") || "1.5"),
            repPenaltyStep: parseFloat(localStorage.getItem("config_rep_penalty_step") || "0.1"),
            maxRetries: parseInt(localStorage.getItem("config_max_retries") || "3"),

            // Glossary Coverage Check (术语表覆盖率检测)
            coverageCheck: localStorage.getItem("config_coverage_check") !== "false", // 默认开启
            outputHitThreshold: parseInt(localStorage.getItem("config_output_hit_threshold") || "60"),
            cotCoverageThreshold: parseInt(localStorage.getItem("config_cot_coverage_threshold") || "80"),
            coverageRetries: parseInt(localStorage.getItem("config_coverage_retries") || "3"),

            // Incremental Translation (增量翻译)
            resume: forceResume !== undefined ? forceResume : (localStorage.getItem("config_resume") === "true"),

            // Dynamic Retry Strategy (动态重试策略)
            retryTempBoost: parseFloat(localStorage.getItem("config_retry_temp_boost") || "0.1"),
            retryPromptFeedback: localStorage.getItem("config_retry_prompt_feedback") !== "false",

            // Daemon Mode
            daemonMode: localStorage.getItem("config_daemon_mode") === "true",

            // Concurrency
            concurrency: parseInt(localStorage.getItem("config_concurrency") || "1"),
            flashAttn: localStorage.getItem("config_flash_attn") === "true",
            kvCacheType: localStorage.getItem("config_kv_cache_type") || "f16",
            useLargeBatch: localStorage.getItem("config_use_large_batch") === "true",
            physicalBatchSize: parseInt(localStorage.getItem("config_physical_batch_size") || "1024"),
            seed: localStorage.getItem("config_seed") ? parseInt(localStorage.getItem("config_seed")!) : undefined,

            // Chunk Balancing
            balanceEnable: localStorage.getItem("config_balance_enable") !== "false",
            balanceThreshold: parseFloat(localStorage.getItem("config_balance_threshold") || "0.6"),
            balanceCount: parseInt(localStorage.getItem("config_balance_count") || "3"),

            // Auxiliary Alignment Mode
            alignmentMode: alignmentMode
        }

        // Create history record
        const recordId = Date.now().toString()
        currentRecordIdRef.current = recordId
        logsBufferRef.current = []
        triggersBufferRef.current = []

        const newRecord: TranslationRecord = {
            id: recordId,
            fileName: inputPath.split(/[/\\]/).pop() || inputPath,
            filePath: inputPath,
            modelName: modelPath.split(/[/\\]/).pop() || modelPath,
            startTime: new Date().toISOString(),
            status: 'running',
            totalBlocks: 0,
            completedBlocks: 0,
            totalLines: 0,
            config: {
                temperature: config.temperature,
                lineCheck: config.lineCheck,
                repPenaltyBase: config.repPenaltyBase,
                maxRetries: config.maxRetries,
                concurrency: config.concurrency
            },
            triggers: [],
            logs: []
        }
        addRecord(newRecord)

        console.log("[DEBUG] Translation Config:", JSON.stringify({ ...config, highFidelity: undefined }, null, 2))
        window.api?.startTranslation(inputPath, modelPath, config)
    }

    // --- State for Confirmation Modal ---
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean
        file: string
        path: string
        onResume: () => void
        onOverwrite: () => void
        onCancel: () => void
    } | null>(null)


    const handleStartQueue = async () => {
        if (fileQueue.length === 0) return

        // Check first file (or current index if we support jumping)
        // Currently we always start from index 0 when clicking Play?
        // Logic: setCurrentQueueIndex(0); startTranslation(fileQueue[0])
        const targetIndex = 0
        const inputPath = fileQueue[targetIndex]

        await checkAndStart(inputPath, targetIndex)
    }

    const checkAndStart = async (inputPath: string, index: number) => {
        // Construct temp config to check path (reusing logic from startTranslation is hard because it's inside)
        // Better: Refactor startTranslation to accept 'forceResume' override, and split Check vs Start.
        // But for now, we can check basic default output path or use the config logic.
        // To be accurate, we should use the EXACT same logic as startTranslation.

        // Let's modify startTranslation to be async and handle the check?
        // But startTranslation triggers the run.

        // New Approach: Call prepareTranslationConfig first, then check, then start.
        prepareAndCheck(inputPath, index)
    }

    const prepareAndCheck = async (inputPath: string, index: number) => {
        // ... (Duplicate config logic? Or refactor?)
        // Refactoring is cleaner. 
        // But to minimize changes, I will implement a lightweight check using the same config loading.



        const config = {
            // Minimal config needed for checkOutputFileExists
            outputDir: localStorage.getItem("config_output_dir"),
            preset: localStorage.getItem("config_preset") || "training",
            // Other fields not needed for path resolution
        }

        const checkResult = await window.api?.checkOutputFileExists(inputPath, config)

        // --- Auto-Match Glossary Logic ---
        // Heuristic: Check if a glossary file exists with the same name as the input file (json or txt)
        // If so, automatically set it and notify the user.
        let matchedGlossary = ''
        try {
            const inputName = inputPath.split(/[/\\]/).pop()?.split('.').slice(0, -1).join('.')
            if (inputName && glossaries.length > 0) {
                // Find potential match (case-insensitive usually good, but let's stick to simple includes first)
                const match = glossaries.find(g => {
                    const gName = g.split('.').slice(0, -1).join('.')
                    return gName === inputName
                })

                if (match && match !== glossaryPath) {
                    matchedGlossary = match
                    setGlossaryPath(match)
                    window.api?.showNotification(t.glossaryView.autoMatchTitle, (t.glossaryView.autoMatchMsg || "").replace('{name}', match))
                }
            }
        } catch (e) { console.error("Auto-match glossary error", e) }

        if (checkResult?.exists && checkResult.path) {
            setConfirmModal({
                isOpen: true,
                file: inputPath.split(/[/\\]/).pop() || inputPath,
                path: checkResult.path,
                onResume: () => {
                    setConfirmModal(null)
                    setCurrentQueueIndex(index)
                    // Pass matchedGlossary to override stale state
                    startTranslation(inputPath, true, matchedGlossary || undefined)
                },
                onOverwrite: () => {
                    setConfirmModal(null)
                    setCurrentQueueIndex(index)
                    startTranslation(inputPath, false, matchedGlossary || undefined)
                },
                onCancel: () => {
                    setConfirmModal(null)
                }
            })
        } else {
            setCurrentQueueIndex(index)
            startTranslation(inputPath, undefined, matchedGlossary || undefined)
        }
    }

    // Keep prepareAndCheckRef in sync for use in stale-closure contexts
    useEffect(() => {
        prepareAndCheckRef.current = prepareAndCheck
    })

    const handleStop = () => {
        console.log('[Dashboard] User requested stop')
        window.api?.stopTranslation()
        // 立即更新 UI 状态（后端也会发送 process-exit 事件）
        setIsRunning(false)
        setCurrentQueueIndex(-1)
    }

    const formatTime = (sec: number) => {
        if (sec < 60) return `${Math.round(sec)}s`
        const m = Math.floor(sec / 60)
        const s = Math.round(sec % 60)
        return `${m}m ${s}s`
    }

    // 高亮同一行中左右对应的共同汉字
    const highlightLineCommonCJK = (text: string, compareText: string, isSource: boolean) => {
        // Strip backend warning tags from display text
        // These tags might be inserted by backend for debugging/warning purposes
        // Tags to strip: line_mismatch, high_similarity, kana_residue, etc.
        // Assuming they appear as plain text or wrapped in < > or similar in the log but here they seem to be just the text.
        // Based on screenshot, they are rendered as badges. Wait, if they are rendered as badges, SOMETHING is rendering them as badges.
        // If `highlightLineCommonCJK` returns <span>...</span>, then it's just text.
        // The badges in the screenshot look like separate React components or styled spans.
        // I will strip the raw text strings: "line_mismatch", "high_similarity", "kana_residue"
        // Regex: /\b(line_mismatch|high_similarity|kana_residue|glossary_missed)\b/g

        text = text.replace(/(\s*)[(\[]?\b(line_mismatch|high_similarity|kana_residue|glossary_missed|hangeul_residue)\b[)\]]?(\s*)/g, '')

        if (!compareText) return text

        const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/g

        // 构建比较字符集（包含异体字）
        const compareChars = new Set<string>()
        const matches = compareText.match(cjkRegex)
        if (matches) {
            for (const char of matches) {
                // 添加原始字符和所有异体字
                compareChars.add(char)
                const variants = getVariants(char)
                if (variants) {
                    variants.forEach((v: string) => compareChars.add(v))
                }
            }
        }

        if (compareChars.size === 0) return text

        const parts: { text: string; highlight: boolean }[] = []
        let current = ''
        let inHighlight = false

        for (const char of text) {
            // 检查字符是否在比较集中（包含异体字）
            const isCJK = cjkRegex.test(char)
            cjkRegex.lastIndex = 0

            let isCommonCJK = false
            if (isCJK) {
                if (compareChars.has(char)) {
                    isCommonCJK = true
                } else {
                    // 检查当前字符的异体字是否在比较集中
                    const charVariants = getVariants(char)
                    if (charVariants) {
                        for (const v of charVariants) {
                            if (compareChars.has(v)) {
                                isCommonCJK = true
                                break
                            }
                        }
                    }
                }
            }

            if (isCommonCJK !== inHighlight) {
                if (current) parts.push({ text: current, highlight: inHighlight })
                current = char
                inHighlight = isCommonCJK
            } else {
                current += char
            }
        }
        if (current) parts.push({ text: current, highlight: inHighlight })

        return (
            <>
                {parts.map((part, i) =>
                    part.highlight ? (
                        <span key={i} className={isSource
                            ? "bg-blue-500/30 text-blue-400 font-semibold"
                            : "bg-purple-500/30 text-purple-400 font-semibold"
                        }>
                            {part.text}
                        </span>
                    ) : (
                        <span key={i}>{part.text}</span>
                    )
                )}
            </>
        )
    }

    // 块级对齐预览渲染 (Block-Aligned)
    const renderBlockAlignedPreview = () => {
        const blocks = Object.entries(previewBlocks).sort((a, b) => Number(a[0]) - Number(b[0]))

        // 恢复总统计信息
        let totalSrcLines = 0
        let totalOutLines = 0
        blocks.forEach(([_, data]) => {
            totalSrcLines += (data.src || '').split(/\r?\n/).filter(l => l.trim()).length
            totalOutLines += (data.output || '').split(/\r?\n/).filter(l => l.trim()).length
        })
        const lineCountMismatch = totalSrcLines !== totalOutLines && totalOutLines > 0

        if (blocks.length === 0) {
            return (
                <div className="flex-1 flex items-center justify-center text-muted-foreground/50 italic">
                    {t.dashboard.waiting}
                </div>
            )
        }

        let globalLineCount = 0

        return (
            <div className="flex-1 overflow-hidden flex flex-col">
                {/* 表头 (恢复统计信息) */}
                <div className="flex border-b border-border shrink-0">
                    <div className="w-10 shrink-0 border-r border-border/20" />
                    <div className="flex-1 px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/10 border-r border-border/30 flex items-center gap-2">
                        {t.dashboard.source} <span className="text-[9px] font-normal opacity-60">({totalSrcLines} {t.dashboard.lines})</span>
                    </div>
                    <div className="flex-1 px-3 py-2 text-[10px] font-bold text-primary uppercase tracking-wider bg-primary/5 flex items-center gap-2">
                        {t.dashboard.target} <span className="text-[9px] font-normal opacity-60">({totalOutLines} {t.dashboard.lines})</span>
                        {lineCountMismatch && <span className="text-[8px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">行数不匹配</span>}
                    </div>
                </div>

                {/* 内容区 */}
                <div
                    ref={srcPreviewRef}
                    className="flex-1 overflow-y-auto"
                >
                    {blocks.map(([blockId, data]) => {
                        // 使用单换行分割，因为 raw text 这里的换行就是行分隔
                        const sLines = (data.src || '').split(/\r?\n/).filter(l => l.trim())
                        const oLines = (data.output || '').split(/\r?\n/).filter(l => l.trim())
                        const maxL = Math.max(sLines.length, oLines.length)

                        return (
                            <div key={blockId} className="border-b border-border/40 relative group/block">
                                {/* 显式 Block 编号标记 */}
                                <div className="sticky top-0 left-0 z-20 pointer-events-none opacity-50 group-hover/block:opacity-100 transition-opacity">
                                    <span className="inline-block bg-muted/80 backdrop-blur text-[9px] text-muted-foreground px-1.5 py-0.5 rounded-br border-r border-b border-border/30 font-mono">
                                        # {blockId}
                                    </span>
                                </div>
                                <div className="sticky top-0 left-0 right-0 h-px bg-primary/5 z-10" />
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/0 group-hover/block:bg-primary/20 transition-colors" />

                                {Array.from({ length: maxL }).map((_, i) => {
                                    globalLineCount++
                                    const srcLine = sLines[i] || ''
                                    const outLine = oLines[i] || ''

                                    // 警告检查
                                    let warning = null
                                    if (outLine.includes('line_mismatch')) warning = { msg: t.dashboard.lineMismatch || 'Line Mismatch' }
                                    if (outLine.includes('high_similarity')) warning = { msg: t.dashboard.similarityWarn || 'High Similarity' }
                                    if (outLine.includes('glossary_missed')) warning = { msg: 'Glossary Missed' }

                                    return (
                                        <div key={i} className={`flex border-b border-border/5 hover:bg-muted/5 transition-colors ${!srcLine ? 'bg-blue-500/5' : ''}`}>
                                            {/* 行号 */}
                                            <div className="w-10 shrink-0 text-[10px] text-right pr-2 py-3 select-none text-muted-foreground/30 font-mono relative">
                                                {globalLineCount}
                                                {warning && (
                                                    <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 cursor-help" title={warning.msg}>
                                                        <AlertTriangle className="w-3 h-3 text-amber-500 animate-pulse" />
                                                    </div>
                                                )}
                                            </div>
                                            {/* 原文 */}
                                            <div className="flex-1 px-4 py-3 text-sm leading-[1.75] border-r border-border/20 text-muted-foreground/80 break-words whitespace-pre-wrap">
                                                {srcLine ? highlightLineCommonCJK(srcLine, outLine, true) : <span className="text-muted-foreground/20">—</span>}
                                            </div>
                                            {/* 译文 (恢复原背景色) */}
                                            <div className="flex-1 px-4 py-3 text-sm leading-[1.75] font-medium text-foreground break-words whitespace-pre-wrap bg-primary/[0.03]">
                                                {outLine ? highlightLineCommonCJK(outLine, srcLine, false) : <span className="text-blue-500/30 italic text-xs">...</span>}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}
                    <div ref={outPreviewRef} />
                </div>
            </div>
        )
    }

    const needsModel = models.length === 0
    const canStart = fileQueue.length > 0 && !isRunning

    return (
        <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">


            <div className="flex-1 p-4 flex gap-4 overflow-hidden min-h-0">

                <div className={`${queueCollapsed ? 'w-[50px]' : 'w-[200px]'} shrink-0 flex flex-col bg-card rounded-2xl shadow-lg border border-border overflow-hidden transition-all duration-300`}>
                    <div className="p-3 border-b border-border bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors" onClick={() => setQueueCollapsed(!queueCollapsed)}>
                        <h3 className="font-bold text-foreground flex items-center gap-2 text-sm">
                            <Layers className="w-4 h-4 text-primary" />
                            {!queueCollapsed && <><span>{t.dashboard.queue}</span><span className="ml-auto text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium">{fileQueue.length}</span></>}
                        </h3>
                    </div>
                    {!queueCollapsed && (
                        <>
                            <div className="p-3 border-b border-border">
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" onClick={handleAddFiles} className="flex-1 text-xs h-9">
                                        <Plus className="w-3 h-3 mr-1" /> {t.dashboard.addFiles}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={handleAddFolder} className="flex-1 text-xs h-9">
                                        <FolderPlus className="w-3 h-3 mr-1" /> {t.dashboard.addFolder}
                                    </Button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                                {fileQueue.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm px-4 text-center">
                                        <FolderOpen className="w-12 h-12 mb-3 opacity-20" />
                                        <p className="font-medium text-muted-foreground">{t.dashboard.dragDrop}</p>
                                        <p className="text-xs mt-2 text-muted-foreground/70">{t.dashboard.supportedTypes}</p>
                                    </div>
                                ) : (
                                    fileQueue.map((file, i) => (
                                        <div
                                            key={file}
                                            ref={i === currentQueueIndex ? activeQueueItemRef : null}
                                            className={`flex items-center gap-2 p-2.5 rounded-lg text-xs group transition-all 
                                                ${i === currentQueueIndex ? 'bg-primary/20 text-primary shadow-sm ring-1 ring-primary/20' :
                                                    completedFiles.has(file) ? 'bg-secondary/30 text-muted-foreground opacity-60 hover:opacity-100' :
                                                        'hover:bg-secondary'}`}
                                            onDragOver={(e) => {
                                                e.preventDefault()
                                                e.dataTransfer.dropEffect = 'move'
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault()
                                                if (isRunning) return
                                                const sourceIndexStr = e.dataTransfer.getData('text/plain')
                                                if (!sourceIndexStr) return

                                                const sourceIndex = parseInt(sourceIndexStr)
                                                if (isNaN(sourceIndex) || sourceIndex === i) return

                                                const newQueue = [...fileQueue]
                                                const [removed] = newQueue.splice(sourceIndex, 1)
                                                newQueue.splice(i, 0, removed)
                                                setFileQueue(newQueue)
                                            }}
                                        >
                                            <div
                                                className={`cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground ${isRunning ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                draggable={!isRunning}
                                                onDragStart={(e) => {
                                                    if (isRunning) {
                                                        e.preventDefault()
                                                        return
                                                    }
                                                    e.dataTransfer.setData('text/plain', i.toString())
                                                    e.dataTransfer.effectAllowed = 'move'
                                                }}
                                            >
                                                <GripVertical className="w-3.5 h-3.5" />
                                            </div>
                                            {i === currentQueueIndex && isRunning ? (
                                                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin shrink-0" />
                                            ) : completedFiles.has(file) || (currentQueueIndex > 0 && i < currentQueueIndex) ? (
                                                <FileCheck className="w-4 h-4 text-green-500 shrink-0" />
                                            ) : (
                                                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                                <span className="truncate font-medium">{file.split(/[/\\]/).pop()}</span>
                                                <span className="truncate text-[10px] opacity-50" title={file}>{file}</span>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleRemoveFile(i)
                                                }}
                                                disabled={isRunning && i === currentQueueIndex}
                                            >
                                                <X className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </div>
                            {fileQueue.length > 0 && (
                                <div className="p-2 border-t border-border">
                                    <Button size="sm" variant="ghost" onClick={handleClearQueue} className="w-full text-xs text-muted-foreground h-8">
                                        <Trash2 className="w-3 h-3 mr-1" /> {t.dashboard.clear}
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* CENTER: Stats & Progress */}
                <div className="flex-1 flex flex-col gap-4 min-w-0">
                    {/* Hardware Monitor */}
                    <HardwareMonitorBar data={monitorData} lang={lang} />

                    {/* Model Warning */}
                    {needsModel && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-bold text-amber-500 text-sm">{t.dashboard.modelMissing}</p>
                                <p className="text-xs text-amber-400 mt-1">{t.dashboard.modelMissingMsg}</p>
                            </div>
                        </div>
                    )}

                    {/* Config Row - Compact Property Bar Style */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 shrink-0">
                        <div className={`bg-card/80 hover:bg-card px-3 py-2 rounded-lg border flex items-center gap-3 transition-all cursor-pointer ${!modelPath && models.length > 0 ? 'border-amber-500/50 ring-1 ring-amber-500/20' : 'border-border/50 hover:border-border'}`}>
                            <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white">
                                <FileText className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">{t.dashboard.modelLabel}</span>
                                    {modelInfo && (
                                        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                                            <span className="bg-secondary/50 px-1 py-0.5 rounded font-mono">{modelInfo.paramsB || '--'}B</span>
                                            <span className="bg-secondary/50 px-1 py-0.5 rounded font-mono">{modelInfo.quant || '--'}</span>
                                            <span className={`px-1 py-0.5 rounded font-mono ${modelInfo.estimatedVramGB > 8 ? "text-amber-500 bg-amber-500/10" : "text-emerald-500 bg-emerald-500/10"}`}>{modelInfo.estimatedVramGB || '--'}G</span>
                                        </div>
                                    )}
                                </div>
                                <select
                                    className="w-full bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer truncate -ml-0.5"
                                    value={modelPath}
                                    onChange={(e) => { setModelPath(e.target.value); localStorage.setItem("config_model", e.target.value) }}
                                >
                                    <option value="">{models.length > 0 ? t.dashboard.selectModel : t.dashboard.noModel}</option>
                                    {[...models]
                                        .sort((a, b) => {
                                            const paramsA = modelsInfoMap[a]?.paramsB ?? Infinity
                                            const paramsB = modelsInfoMap[b]?.paramsB ?? Infinity
                                            if (paramsA !== paramsB) return paramsA - paramsB
                                            const sizeA = modelsInfoMap[a]?.sizeGB ?? Infinity
                                            const sizeB = modelsInfoMap[b]?.sizeGB ?? Infinity
                                            return sizeA - sizeB
                                        })
                                        .map(m => <option key={m} value={m}>{m.replace('.gguf', '')}</option>)}
                                </select>
                            </div>
                            <div title={t.modelView.refresh || "Refresh"} onClick={(e) => { e.stopPropagation(); fetchData() }} className="p-1 hover:bg-muted rounded-full cursor-pointer transition-colors z-10 mr-1 group/refresh">
                                <RefreshCw className="w-3.5 h-3.5 text-muted-foreground group-hover/refresh:text-primary transition-colors" />
                            </div>
                            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-40" />
                        </div>
                        <div className="bg-card/80 hover:bg-card px-3 py-2 rounded-lg border border-border/50 hover:border-border flex items-center gap-3 transition-all cursor-pointer">
                            <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white">
                                <BookOpen className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">{t.dashboard.glossaryLabel}</span>
                                <select className="w-full bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer truncate -ml-0.5" value={glossaryPath} onChange={(e) => setGlossaryPath(e.target.value)}>
                                    <option value="">{t.none}</option>
                                    {glossaries.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                            </div>
                            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-40" />
                        </div>
                    </div>



                    {/* Monitor Dashboard - Professional LLM Style */}
                    <div className="flex flex-col lg:flex-row gap-3 shrink-0 bg-secondary/20 rounded-xl p-3 border border-border/30">
                        {/* Left: Stats Grid (35%) - 2x2 Layout */}
                        <div className="lg:w-[35%] grid grid-cols-2 gap-2.5">
                            {/* Time Module */}
                            <div className="bg-card rounded-lg border border-border/50 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <Clock className="w-4 h-4 text-amber-500" />
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t.dashboard.time}</span>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-sm text-muted-foreground font-semibold">{t.dashboard.elapsed}</span>
                                        <span className="text-lg font-black text-foreground font-mono">{formatTime(displayElapsed)}</span>
                                    </div>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-sm text-muted-foreground/70">{t.dashboard.remaining}</span>
                                        <span className="text-base font-bold text-muted-foreground font-mono">{formatTime(displayRemaining)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Progress Module */}
                            <div className="bg-card rounded-lg border border-border/50 p-3">
                                <div className="flex items-center gap-2 mb-2 min-w-0">
                                    <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide shrink-0">{t.dashboard.progress}</span>
                                    {progress.retries > 0 && (
                                        <span className="ml-auto text-[10px] font-bold text-amber-500 animate-pulse bg-amber-500/10 px-1 py-0.5 rounded whitespace-nowrap border border-amber-500/20">
                                            {t.dashboard.retries}: {progress.retries}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-baseline justify-between mb-1.5">
                                    <span className="text-lg font-black text-foreground font-mono">{progress.current}/{progress.total}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-base font-bold text-primary">{(progress.percent || 0).toFixed(1)}%</span>
                                    </div>
                                </div>
                                <div className="w-full bg-secondary/50 h-1.5 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300" style={{ width: `${progress.percent || 0}%` }} />
                                </div>
                            </div>

                            {/* Speed Module */}
                            <div className="bg-card rounded-lg border border-border/50 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <Zap className="w-4 h-4 text-purple-500" />
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t.dashboard.speed}</span>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-sm text-muted-foreground font-semibold">{t.dashboard.chars}</span>
                                        <span className="text-lg font-black text-foreground font-mono">{progress.speedChars || 0}<span className="text-xs text-muted-foreground ml-0.5">/s</span></span>
                                    </div>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-sm text-muted-foreground/70">{t.dashboard.lines}</span>
                                        <span className="text-base font-bold text-muted-foreground font-mono">{progress.speedLines || 0}<span className="text-xs text-muted-foreground/70 ml-0.5">/s</span></span>
                                    </div>
                                </div>
                            </div>

                            {/* Token Module */}
                            <div className="bg-card rounded-lg border border-border/50 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="w-4 h-4 text-sm font-black text-emerald-500 flex items-center justify-center">T</span>
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Token</span>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-sm text-muted-foreground font-semibold">{t.dashboard.generate}</span>
                                        <span className="text-lg font-black text-foreground font-mono">{progress.speedGen || 0}<span className="text-xs text-muted-foreground ml-0.5">t/s</span></span>
                                    </div>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-sm text-muted-foreground/70">{t.dashboard.evaluate}</span>
                                        <span className="text-base font-bold text-muted-foreground font-mono">
                                            {((progress.speedGen || 0) + (progress.speedEval || 0)).toFixed(1)}
                                            <span className="text-xs text-muted-foreground/70 ml-0.5">t/s</span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right: Enhanced Speed Chart (65%) */}
                        <div className="lg:w-[65%] bg-card rounded-lg border border-border/50 overflow-hidden flex flex-col">
                            <div className="py-1.5 px-3 border-b border-border/30 shrink-0 flex items-center justify-between">
                                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{t.dashboard.speedChart}</span>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <select
                                            value={chartMode}
                                            onChange={(e) => setChartMode(e.target.value as any)}
                                            className="appearance-none bg-accent/50 border border-border/50 rounded px-2 py-0.5 text-[9px] font-medium text-foreground pr-5 focus:outline-none hover:bg-accent cursor-pointer"
                                        >
                                            <option value="chars">{t.dashboard.charPerSec}</option>
                                            <option value="tokens">Tokens/s</option>
                                            <option value="vram">VRAM %</option>
                                            <option value="gpu">GPU %</option>
                                        </select>
                                        <ChevronDown className="w-2.5 h-2.5 absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                    </div>
                                </div>
                            </div>
                            {/* 固定高度容器，彻底解决 ResponsiveContainer 的 0 尺寸报错 */}
                            <div style={{ width: '100%', flex: 1, position: 'relative', minHeight: '180px' }}>
                                {chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorSpeedGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={chartMode === 'vram' || chartMode === 'gpu' ? '#f59e0b' : chartMode === 'tokens' ? '#10b981' : '#8b5cf6'} stopOpacity={0.4} />
                                                    <stop offset="50%" stopColor={chartMode === 'vram' || chartMode === 'gpu' ? '#fbbf24' : chartMode === 'tokens' ? '#34d399' : '#a78bfa'} stopOpacity={0.2} />
                                                    <stop offset="100%" stopColor={chartMode === 'vram' || chartMode === 'gpu' ? '#fde68a' : chartMode === 'tokens' ? '#6ee7b7' : '#c4b5fd'} stopOpacity={0.05} />
                                                </linearGradient>
                                            </defs>
                                            <XAxis dataKey="time" hide />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: 'rgba(37, 37, 53, 0.95)',
                                                    borderRadius: '10px',
                                                    border: `1px solid ${chartMode === 'vram' || chartMode === 'gpu' ? 'rgba(245, 158, 11, 0.3)' : chartMode === 'tokens' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`,
                                                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                                                    color: '#cdd6f4',
                                                    fontSize: '11px',
                                                    padding: '8px 12px'
                                                }}
                                                formatter={(value: any) => [
                                                    `${value} ${chartMode === 'vram' || chartMode === 'gpu' ? '%' : chartMode === 'tokens' ? 't/s' : t.dashboard.charPerSec}`,
                                                    chartMode === 'vram' ? 'VRAM' : chartMode === 'gpu' ? 'GPU' : chartMode === 'tokens' ? 'Token Speed' : t.dashboard.speed
                                                ]}
                                                labelFormatter={() => ''}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="speed"
                                                stroke={chartMode === 'vram' || chartMode === 'gpu' ? '#f59e0b' : chartMode === 'tokens' ? '#10b981' : '#8b5cf6'}
                                                strokeWidth={2}
                                                fill="url(#colorSpeedGradient)"
                                                isAnimationActive={false}
                                            />
                                            <Brush
                                                dataKey="time"
                                                height={12}
                                                stroke="rgba(120, 120, 120, 0.15)"
                                                fill="transparent"
                                                tickFormatter={() => ''}
                                                travellerWidth={6}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>

                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 text-[10px] space-y-1">
                                        <Zap className="w-5 h-5 opacity-20" />
                                        <span>Ready for Speed Tracking</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>


                    {/* Preview Area (Line-Aligned Mode) */}
                    <div className="flex-1 bg-card rounded-2xl border border-border overflow-hidden flex flex-col shadow-sm min-h-[300px]">
                        <div className="p-3 px-5 border-b border-border flex justify-between items-center bg-muted/20">
                            <h3 className="font-bold text-sm flex items-center gap-2">
                                <ArrowRight className="w-4 h-4 text-primary" /> {t.dashboard.previewTitle}
                            </h3>
                        </div>
                        {renderBlockAlignedPreview()}
                    </div>
                </div>
            </div >

            {/* BOTTOM: Control Bar + Logs Drawer */}
            < div className={`${logsCollapsed ? 'h-[50px]' : 'h-[180px]'} shrink-0 bg-card/95 backdrop-blur-md border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.1)] transition-all duration-300 flex flex-col`}>
                <div className="h-[50px] px-4 flex items-center justify-between shrink-0 border-b border-border/30">
                    <div className="flex items-center gap-3">
                        <Button size="icon" onClick={handleStartQueue} disabled={!canStart || needsModel} className={`rounded-full w-9 h-9 shadow-md transition-all ${!canStart || needsModel ? 'bg-muted text-muted-foreground' : 'bg-gradient-to-br from-purple-600 to-indigo-600 hover:scale-105'}`}>
                            <Play className={`w-4 h-4 ${canStart && !needsModel ? 'fill-white' : ''} ml-0.5`} />
                        </Button>
                        <Button size="icon" variant="outline" onClick={handleStop} disabled={!isRunning} className="rounded-full w-8 h-8 border-border hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400">
                            <X className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-xs text-muted-foreground font-medium ml-2">
                            {isRunning ? `${t.dashboard.processing} ${currentQueueIndex + 1}/${fileQueue.length}` : needsModel ? t.dashboard.selectModelWarn : t.dashboard.startHint}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <UITooltip content="TXT文件辅助对齐：适用于漫画和游戏文本，辅助输出按照行进行对齐。小说等连贯性文本不建议开启，会影响翻译效果。">
                            <div
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer text-[10px] font-medium shadow-sm active:scale-95 ${alignmentMode
                                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-500 dark:text-indigo-400'
                                    : 'bg-secondary/50 border-border/60 text-muted-foreground hover:bg-secondary/80 hover:border-border hover:text-foreground'
                                    }`}
                                onClick={() => {
                                    const nextValue = !alignmentMode;
                                    setAlignmentMode(nextValue);
                                    localStorage.setItem("config_alignment_mode", String(nextValue));
                                }}
                            >
                                <AlignLeft className={`w-3 h-3 ${alignmentMode ? 'text-indigo-500' : 'text-muted-foreground/70'}`} />
                                <span>辅助对齐</span>
                            </div>
                        </UITooltip>
                        <UITooltip content={<>CoT导出：另外保存一份带思考过程的翻译文本</>}>
                            <div
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer text-[10px] font-medium shadow-sm active:scale-95 ${saveCot
                                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-500 dark:text-amber-400'
                                    : 'bg-secondary/50 border-border/60 text-muted-foreground hover:bg-secondary/80 hover:border-border hover:text-foreground'
                                    }`}
                                onClick={() => { setSaveCot(!saveCot); localStorage.setItem("config_save_cot", String(!saveCot)) }}
                            >
                                <FileText className={`w-3 h-3 ${saveCot ? 'text-amber-500' : 'text-muted-foreground/70'}`} />
                                <span>CoT导出</span>
                            </div>
                        </UITooltip>
                        <div className="flex items-center gap-2 cursor-pointer hover:bg-secondary/50 px-3 py-1.5 rounded-lg transition-colors" onClick={() => setLogsCollapsed(!logsCollapsed)}>
                            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">{t.dashboard.terminal}</span>
                            <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded">{logs.length}</span>
                            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${logsCollapsed ? '' : 'rotate-180'}`} />
                        </div>
                    </div>
                </div>

                {
                    !logsCollapsed && (
                        <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[10px] text-muted-foreground bg-secondary/20">
                            {logs.length === 0 ? (
                                <span className="italic opacity-50">{t.dashboard.waitingLog}</span>
                            ) : (
                                logs
                                    .filter(log => !log.includes("STDERR") && !log.includes("ggml") && !log.includes("llama_"))
                                    .slice(-100)
                                    .map((log, i) => <div key={i} className="py-0.5 border-b border-border/5 last:border-0">{log}</div>)
                            )}
                            <div ref={logEndRef} />
                        </div>
                    )
                }
            </div >

            {/* Confirmation Modal for Overwrite/Resume */}
            {
                confirmModal && confirmModal.isOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                        <Card className="w-[400px] max-w-[90vw] shadow-lg border-border bg-background animate-in zoom-in-95 duration-200">
                            <div className="p-6">
                                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                                    {t.dashboard.fileExistTitle}
                                </h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                    {t.dashboard.fileExistMsg} <span className="font-mono text-xs bg-muted px-1 rounded">{confirmModal.file}</span>
                                </p>
                                <div className="flex flex-col gap-2">
                                    <Button onClick={confirmModal.onResume} className="w-full justify-center group h-auto py-2.5">
                                        <span className="font-medium">{t.dashboard.resume}</span>
                                    </Button>
                                    <Button onClick={confirmModal.onOverwrite} variant="secondary" className="w-full justify-center h-auto py-2.5 hover:bg-destructive/10 hover:text-destructive">
                                        <span className="font-medium">{t.dashboard.overwrite}</span>
                                    </Button>
                                    <Button onClick={confirmModal.onCancel} variant="ghost" className="w-full">
                                        {t.dashboard.cancel}
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    </div>
                )
            }

            <AlertModal {...alertProps} />
        </div >
    )
})

import { useState, useEffect } from "react"
import { Download, X, Loader2, CheckCircle2, AlertCircle, HardDrive, ChevronLeft, Package, Wifi, WifiOff, RotateCcw } from "lucide-react"
import { Button } from "./ui/core"
import { cn } from "../lib/utils"

interface HFRepo {
    id: string
    name: string
    downloads: number
}

interface HFFile {
    name: string
    size: number
    sizeFormatted: string
}

interface DownloadProgress {
    percent: number
    speed: string
    downloaded: string
    total: string
    status: string
}

interface HFDownloadModalProps {
    isOpen: boolean
    onClose: () => void
    orgName: string  // Organization name instead of repo ID
    onDownloadComplete: () => void
    lang: "zh" | "en" | "jp"
}

const t = {
    zh: {
        title: "从 HuggingFace 下载",
        loading: "正在获取...",
        selectRepo: "选择模型仓库",
        selectFile: "选择要下载的文件",
        noRepos: "未找到 GGUF 模型仓库",
        noFiles: "仓库中没有 GGUF 文件",
        download: "开始下载",
        cancel: "取消",
        back: "返回",
        downloading: "下载中...",
        resuming: "续传中...",
        checking: "检查文件...",
        skipped: "文件已存在，跳过",
        complete: "下载完成！",
        error: "下载失败",
        networkError: "网络错误，请检查代理设置",
        checkNetwork: "测试连接",
        networkOk: "连接正常",
        networkFailed: "无法连接",
        direct: "直连",
        mirror: "镜像",
        mirrorDesc: "国内用户如果直连较慢，可尝试切换到镜像源",
        downloadTip: "提示：模型文件较大，请耐心等待。支持断点续传。",
        vramTitle: "显存需求",
        model: "模型",
        minVram: "最低显存",
        recVram: "推荐显存",
    },
    en: {
        title: "Download from HuggingFace",
        loading: "Loading...",
        selectRepo: "Select Model Repository",
        selectFile: "Select file to download",
        noRepos: "No GGUF model repositories found",
        noFiles: "No GGUF files in repository",
        download: "Start Download",
        cancel: "Cancel",
        back: "Back",
        downloading: "Downloading...",
        resuming: "Resuming...",
        checking: "Checking file...",
        skipped: "File exists, skipped",
        complete: "Download Complete!",
        error: "Download Failed",
        networkError: "Network error, check proxy settings",
        checkNetwork: "Test Connection",
        networkOk: "Connected",
        networkFailed: "Connection Failed",
        direct: "Direct",
        mirror: "Mirror",
        mirrorDesc: "Switch to mirror if direct connection is slow",
        downloadTip: "Tip: Model files are large . Resume download supported.",
        vramTitle: "VRAM Requirements",
        model: "Model",
        minVram: "Min VRAM",
        recVram: "Rec. VRAM",
    },
    jp: {
        title: "HuggingFace からダウンロード",
        loading: "読み込み中...",
        selectRepo: "モデルリポジトリを選択",
        selectFile: "ダウンロードするファイルを選択",
        noRepos: "GGUF モデルリポジトリが見つかりません",
        noFiles: "リポジトリに GGUF ファイルがありません",
        download: "ダウンロード開始",
        cancel: "キャンセル",
        back: "戻る",
        downloading: "ダウンロード中...",
        resuming: "再開中...",
        checking: "ファイル確認中...",
        skipped: "ファイル存在、スキップ",
        complete: "ダウンロード完了！",
        error: "ダウンロード失敗",
        networkError: "ネットワークエラー、プロキシ設定を確認してください",
        checkNetwork: "接続テスト",
        networkOk: "接続成功",
        networkFailed: "接続失敗",
        direct: "直接",
        mirror: "ミラー",
        mirrorDesc: "直接接続が遅い場合はミラーに切り替え",
        downloadTip: "モデルファイルは大きい。レジュームダウンロード対応。",
        vramTitle: "VRAM 要件",
        model: "モデル",
        minVram: "最低 VRAM",
        recVram: "推奨 VRAM",
    }
}

// Mirror sources
const MIRRORS = {
    direct: { label: 'HuggingFace', url: 'https://huggingface.co' },
    hf_mirror: { label: 'hf-mirror.com', url: 'https://hf-mirror.com' },
}

export function HFDownloadModal({ isOpen, onClose, orgName, onDownloadComplete, lang }: HFDownloadModalProps) {
    const text = t[lang] || t.zh

    // Step management: 'repos' -> 'files' -> 'downloading' -> 'complete'
    const [step, setStep] = useState<'repos' | 'files' | 'downloading' | 'complete'>('repos')

    const [repos, setRepos] = useState<HFRepo[]>([])
    const [selectedRepo, setSelectedRepo] = useState<HFRepo | null>(null)

    const [files, setFiles] = useState<HFFile[]>([])
    const [selectedFile, setSelectedFile] = useState<string | null>(null)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [progress, setProgress] = useState<DownloadProgress | null>(null)

    // Network check state
    const [networkStatus, setNetworkStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
    const [networkMessage, setNetworkMessage] = useState('')

    // Mirror source state
    const [mirrorSource, setMirrorSource] = useState<'direct' | 'hf_mirror'>('direct')

    // Auto check network every 1 second when modal is open
    useEffect(() => {
        if (!isOpen) {
            setNetworkStatus('idle')
            setNetworkMessage('')
            return
        }

        const checkNetworkInternal = async () => {
            const startTime = Date.now()
            try {
                // @ts-ignore
                const result = await window.api?.hfCheckNetwork?.()
                const latency = Date.now() - startTime
                if (result?.status === 'ok') {
                    setNetworkStatus('ok')
                    setNetworkMessage(`${latency}ms`)
                } else {
                    setNetworkStatus('error')
                    setNetworkMessage(result?.message || text.networkFailed)
                }
            } catch (e) {
                setNetworkStatus('error')
                setNetworkMessage(String(e))
            }
        }

        checkNetworkInternal()
        const intervalId = setInterval(checkNetworkInternal, 1000)

        return () => {
            clearInterval(intervalId)
        }
    }, [isOpen, mirrorSource])

    // Fetch repos when modal opens
    useEffect(() => {
        if (isOpen && repos.length === 0) {
            fetchRepos()
        }
    }, [isOpen])

    // Listen for download progress
    useEffect(() => {
        if (step !== 'downloading') return

        const handleProgress = (data: DownloadProgress) => {
            if (!data) return  // Guard against undefined
            setProgress(data)
            if (data.status === "complete") {
                setStep('complete')
                onDownloadComplete()
            }
        }

        const handleError = (data: { message: string }) => {
            if (!data) return
            setError(data.message)
            setStep('files')
        }

        // @ts-ignore
        window.api?.onHfDownloadProgress?.(handleProgress)
        // @ts-ignore
        window.api?.onHfDownloadError?.(handleError)

        return () => {
            // @ts-ignore
            window.api?.offHfDownloadProgress?.()
            // @ts-ignore
            window.api?.offHfDownloadError?.()
        }
    }, [step, onDownloadComplete])

    const fetchRepos = async () => {
        setLoading(true)
        setError(null)
        try {
            // @ts-ignore
            const result = await window.api?.hfListRepos?.(orgName)
            if (result?.repos) {
                setRepos(result.repos)
            } else if (result?.error) {
                setError(result.error)
            }
        } catch (e) {
            setError(text.networkError)
        }
        setLoading(false)
    }

    const fetchFiles = async (repoId: string) => {
        setLoading(true)
        setError(null)
        try {
            // @ts-ignore
            const result = await window.api?.hfListFiles?.(repoId)
            if (result?.files) {
                setFiles(result.files)
                setStep('files')
            } else if (result?.error) {
                setError(result.error)
            }
        } catch (e) {
            setError(text.networkError)
        }
        setLoading(false)
    }

    const selectRepo = (repo: HFRepo) => {
        setSelectedRepo(repo)
        setSelectedFile(null)
        fetchFiles(repo.id)
    }

    const goBack = () => {
        setStep('repos')
        setSelectedRepo(null)
        setFiles([])
        setSelectedFile(null)
        setError(null)
    }

    const startDownload = async () => {
        if (!selectedRepo || !selectedFile) return

        setStep('downloading')
        setProgress({ percent: 0, speed: "", downloaded: "", total: "", status: "starting" })
        setError(null)

        try {
            // @ts-ignore
            await window.api?.hfDownloadStart?.(selectedRepo.id, selectedFile, mirrorSource)
        } catch (e) {

            setError(String(e))
            setStep('files')
        }
    }

    const cancelDownload = async () => {
        try {
            // @ts-ignore
            await window.api?.hfDownloadCancel?.()
        } catch (e) {
            console.error("Failed to cancel download:", e)
        }
        setStep('files')
        setProgress(null)
    }

    const handleClose = () => {
        if (step === 'downloading') {
            cancelDownload()
        }
        // Reset state
        setStep('repos')
        setRepos([])
        setSelectedRepo(null)
        setFiles([])
        setSelectedFile(null)
        setProgress(null)
        setError(null)
        setNetworkStatus('idle')
        setNetworkMessage('')
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

            {/* Modal - Much larger size like GlossaryView */}
            <div className="relative w-full max-w-5xl mx-4 bg-background rounded-2xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b bg-secondary/30">
                    <div className="flex items-center gap-3">
                        {step === 'files' && (
                            <button onClick={goBack} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                        )}
                        <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center text-2xl border border-yellow-500/20">
                            🤗
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-foreground">{text.title}</h3>
                            <p className="text-xs text-muted-foreground font-mono">
                                {selectedRepo ? selectedRepo.name : orgName}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-secondary rounded-lg transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Toolbar - Network Status & Mirror Switch */}
                <div className="flex items-center justify-between px-5 py-3 bg-secondary/10 border-b border-border/50">
                    {/* Mirror Source Switch */}
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">下载源:</span>
                        <div className="flex items-center bg-secondary/50 rounded-lg p-0.5">
                            <button
                                onClick={() => setMirrorSource('direct')}
                                className={cn(
                                    "px-3 py-1 text-xs rounded-md transition-all",
                                    mirrorSource === 'direct'
                                        ? "bg-background shadow-sm font-medium"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {MIRRORS.direct.label}
                            </button>
                            <button
                                onClick={() => setMirrorSource('hf_mirror')}
                                className={cn(
                                    "px-3 py-1 text-xs rounded-md transition-all",
                                    mirrorSource === 'hf_mirror'
                                        ? "bg-background shadow-sm font-medium"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {MIRRORS.hf_mirror.label}
                            </button>
                        </div>
                    </div>

                    {/* Network Status Indicator (Auto-updated every 1s) */}
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        networkStatus === 'checking' && "opacity-50 bg-secondary",
                        networkStatus === 'ok' && "bg-green-500/10 text-green-600 border border-green-500/20",
                        networkStatus === 'error' && "bg-red-500/10 text-red-600 border border-red-500/20",
                        networkStatus === 'idle' && "bg-secondary border border-border"
                    )}>
                        {networkStatus === 'checking' ? (
                            <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                        ) : networkStatus === 'ok' ? (
                            <Wifi className="w-3.5 h-3.5" />
                        ) : networkStatus === 'error' ? (
                            <WifiOff className="w-3.5 h-3.5" />
                        ) : (
                            <Wifi className="w-3.5 h-3.5" />
                        )}
                        <span>
                            {networkStatus === 'idle' ? '等待测速...' :
                                networkStatus === 'checking' ? text.loading :
                                    networkStatus === 'ok' ? `${text.networkOk} (${networkMessage})` :
                                        text.networkFailed}
                        </span>
                    </div>
                </div>

                {/* Info Bar - Simplified Minimalist Layout */}
                <div className="px-6 py-3 bg-background border-b border-border/40">
                    <div className="space-y-2">
                        {/* Tips Line */}
                        <div className="flex items-center gap-3 text-[11px] sm:text-xs">
                            <span className="bg-yellow-500/10 text-yellow-700 px-2 py-0.5 rounded font-medium flex-shrink-0">
                                下载提示
                            </span>
                            <span className="text-muted-foreground truncate">模型文件较大，请耐心等待下载完成。支持断点续传。国内用户若无法访问 HuggingFace，可以切换到镜像源进行下载。</span>
                        </div>
                        {/* VRAM Line */}
                        <div className="flex items-center gap-3 text-[11px] sm:text-xs">
                            <span className="bg-indigo-500/10 text-indigo-700 px-2 py-0.5 rounded font-medium flex-shrink-0">
                                显存需求
                            </span>
                            <div className="flex items-center gap-4 text-muted-foreground">
                                <span className="flex items-center gap-1.5">Murasaki-8B: <span className="text-foreground font-semibold">6G 最低 / 8G+ 推荐</span></span>
                                <span className="w-px h-3 bg-border" />
                                <span className="flex items-center gap-1.5">Murasaki-14B: <span className="text-foreground font-semibold">10G 最低 / 12G+ 推荐</span></span>
                            </div>
                        </div>
                    </div>
                </div>


                {/* Content */}
                <div className="p-6 max-h-[50vh] overflow-y-auto">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <span className="text-sm text-muted-foreground">{text.loading}</span>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <AlertCircle className="w-8 h-8 text-destructive" />
                            <span className="text-sm text-destructive text-center">{error}</span>
                            <Button variant="outline" size="sm" onClick={step === 'repos' ? fetchRepos : () => fetchFiles(selectedRepo!.id)}>
                                重试
                            </Button>
                        </div>
                    ) : step === 'complete' ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                                <CheckCircle2 className="w-8 h-8 text-green-500" />
                            </div>
                            <span className="text-lg font-bold text-green-600">{text.complete}</span>
                            <p className="text-sm text-muted-foreground">{selectedFile}</p>
                        </div>
                    ) : step === 'downloading' && progress ? (
                        <div className="space-y-4 py-4">
                            <div className="flex items-center gap-3">
                                <HardDrive className="w-5 h-5 text-primary animate-pulse" />
                                <span className="text-sm font-medium">{text.downloading}</span>
                            </div>

                            <div className="space-y-2">
                                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all duration-300"
                                        style={{ width: `${progress.percent}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{progress.downloaded} / {progress.total}</span>
                                    <span>{progress.speed}</span>
                                </div>
                                <div className="text-center text-2xl font-bold text-foreground">
                                    {progress.percent.toFixed(1)}%
                                </div>
                            </div>

                            <p className="text-xs text-muted-foreground text-center truncate">{selectedFile}</p>
                        </div>
                    ) : step === 'repos' ? (
                        // Step 1: Select Repository
                        repos.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3">
                                <span className="text-sm text-muted-foreground">{text.noRepos}</span>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground mb-3">{text.selectRepo}</p>
                                {repos.map((repo) => (
                                    <div
                                        key={repo.id}
                                        onClick={() => selectRepo(repo)}
                                        className="flex items-center justify-between p-3 rounded-lg border border-border cursor-pointer transition-all hover:border-primary/50 hover:bg-secondary/30"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <Package className="w-5 h-5 text-primary shrink-0" />
                                            <span className="text-sm font-medium truncate">{repo.name}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            {repo.downloads.toLocaleString()} downloads
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )
                    ) : (
                        // Step 2: Select File
                        files.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3">
                                <span className="text-sm text-muted-foreground">{text.noFiles}</span>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground mb-3">{text.selectFile}</p>
                                {files.map((file) => (
                                    <div
                                        key={file.name}
                                        onClick={() => setSelectedFile(file.name)}
                                        className={cn(
                                            "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all",
                                            selectedFile === file.name
                                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                : "border-border hover:border-primary/50 hover:bg-secondary/30"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={cn(
                                                "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                                                selectedFile === file.name ? "border-primary" : "border-muted-foreground/30"
                                            )}>
                                                {selectedFile === file.name && <div className="w-2 h-2 rounded-full bg-primary" />}
                                            </div>
                                            <span className="text-sm font-mono truncate">{file.name}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground shrink-0 ml-2">{file.sizeFormatted}</span>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>

                {/* Footer */}
                {!loading && !error && step === 'files' && files.length > 0 && (
                    <div className="flex gap-3 p-4 border-t bg-secondary/20">
                        <Button variant="outline" className="flex-1" onClick={goBack}>
                            {text.back}
                        </Button>
                        <Button
                            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                            disabled={!selectedFile}
                            onClick={startDownload}
                        >
                            <Download className="w-4 h-4 mr-2" />
                            {text.download}
                        </Button>
                    </div>
                )}

                {step === 'downloading' && (
                    <div className="flex gap-3 p-4 border-t bg-secondary/20">
                        <Button variant="outline" className="w-full" onClick={cancelDownload}>
                            {text.cancel}
                        </Button>
                    </div>
                )}

                {step === 'complete' && (
                    <div className="flex gap-3 p-4 border-t bg-secondary/20">
                        <Button className="w-full" onClick={handleClose}>
                            完成
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

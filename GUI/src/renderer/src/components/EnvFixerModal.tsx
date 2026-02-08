import { useState, useEffect, useRef } from 'react'
import {
    X, RefreshCw, CheckCircle2, XCircle, AlertCircle, Info,
    Terminal, Zap, Box, Server, Layers, ShieldCheck, Wrench,
    Download, ExternalLink, ChevronRight, Loader2, ChevronDown, Play
} from 'lucide-react'
import { Button, Card, CardHeader, CardTitle, CardContent } from './ui/core'
import { APP_CONFIG } from '../lib/config'

type ComponentName = 'Python' | 'CUDA' | 'Vulkan' | 'LlamaBackend' | 'Middleware' | 'Permissions'
type ComponentStatus = 'ok' | 'warning' | 'error' | 'pending' | 'checking'

interface ComponentResult {
    status: ComponentStatus
    issues: string[]
    fixes: string[]
    canAutoFix: boolean
    version?: string
    path?: string
}

interface EnvFixerModalProps {
    onClose: () => void
}

interface FixAction {
    component: ComponentName
    label: string
    description: string
    type: 'auto' | 'download' | 'link'
    url?: string
    primary?: boolean
}

export function EnvFixerModal({ onClose }: EnvFixerModalProps) {
    // 组件状态 - 初始为 pending
    const [results, setResults] = useState<Record<ComponentName, ComponentResult>>({
        Python: { status: 'pending', issues: [], fixes: [], canAutoFix: false },
        CUDA: { status: 'pending', issues: [], fixes: [], canAutoFix: false },
        Vulkan: { status: 'pending', issues: [], fixes: [], canAutoFix: false },
        LlamaBackend: { status: 'pending', issues: [], fixes: [], canAutoFix: false },
        Middleware: { status: 'pending', issues: [], fixes: [], canAutoFix: false },
        Permissions: { status: 'pending', issues: [], fixes: [], canAutoFix: false }
    })
    const [checkingComponent, setCheckingComponent] = useState<ComponentName | null>(null)
    const [checkLogs, setCheckLogs] = useState<string[]>([])
    const [showLogs, setShowLogs] = useState(false)

    // 修复状态
    const [fixingComponent, setFixingComponent] = useState<ComponentName | null>(null)
    const [fixProgress, setFixProgress] = useState(0)
    const [fixLogs, setFixLogs] = useState<string[]>([])
    const [showFixConfirm, setShowFixConfirm] = useState<FixAction | null>(null)
    const [fixResult, setFixResult] = useState<{ success: boolean; message: string } | null>(null)
    const [selectedComponent, setSelectedComponent] = useState<ComponentName | null>(null)

    const logContainerRef = useRef<HTMLDivElement>(null)
    // 防止组件卸载后更新 state 导致内存泄漏
    const isMountedRef = useRef(true)

    // 组件卸载时设置 isMountedRef 为 false
    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    // 组件配置 - 明确区分一键修复(auto/download)和手动修复(link)
    const components: Array<{
        name: ComponentName
        label: string
        icon: any
        description: string
        optional?: boolean
        fixActions: FixAction[]
    }> = [
            {
                name: 'Python',
                label: 'Python 环境',
                icon: Terminal,
                description: '内嵌解释器 ≥3.10',
                fixActions: [
                    { component: 'Python', label: '一键安装依赖', description: '自动运行 pip install 安装缺失的 Python 包', type: 'auto', primary: true },
                    { component: 'Python', label: '重新安装程序', description: '重新下载安装 Murasaki Translator', type: 'link', url: `${APP_CONFIG.officialRepo}/releases` }
                ]
            },
            {
                name: 'CUDA',
                label: 'CUDA 环境',
                icon: Zap,
                description: 'NVIDIA GPU 加速',
                optional: true,
                fixActions: [
                    { component: 'CUDA', label: '下载驱动', description: '跳转 NVIDIA 官网下载', type: 'link', url: 'https://www.nvidia.com/Download/index.aspx', primary: true }
                ]
            },
            {
                name: 'Vulkan',
                label: 'Vulkan 环境',
                icon: Box,
                description: '跨平台 GPU 加速',
                optional: true,
                fixActions: [
                    { component: 'Vulkan', label: '一键安装', description: '自动下载安装 Vulkan Runtime (~50MB)', type: 'download', primary: true },
                    { component: 'Vulkan', label: '手动下载', description: '跳转 LunarG 官网', type: 'link', url: 'https://vulkan.lunarg.com/sdk/home' }
                ]
            },
            {
                name: 'LlamaBackend',
                label: 'Llama 后端',
                icon: Server,
                description: '本地 LLM 推理',
                fixActions: [
                    { component: 'LlamaBackend', label: '启动服务', description: '启动 llama-server', type: 'auto', primary: true }
                ]
            },
            {
                name: 'Middleware',
                label: '中间件',
                icon: Layers,
                description: '翻译引擎核心',
                fixActions: [
                    { component: 'Middleware', label: '重新安装', description: '重新下载安装程序', type: 'link', url: `${APP_CONFIG.officialRepo}/releases`, primary: true }
                ]
            },
            {
                name: 'Permissions',
                label: '文件权限',
                icon: ShieldCheck,
                description: '目录访问权限',
                fixActions: [
                    { component: 'Permissions', label: '管理员运行', description: '右键以管理员身份运行', type: 'link', primary: true }
                ]
            }
        ]

    const statusConfig: Record<ComponentStatus, { color: string; bg: string; border: string; icon: any; label: string }> = {
        ok: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: CheckCircle2, label: '正常' },
        warning: { color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: AlertCircle, label: '可选' },
        error: { color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: XCircle, label: '异常' },
        pending: { color: 'text-muted-foreground', bg: 'bg-muted/50', border: 'border-border', icon: Info, label: '等待' },
        checking: { color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: Loader2, label: '检测中' }
    }

    // 检查所有组件 - 一次性调用，避免重复运行 Python 脚本
    const checkAllComponents = async () => {
        // 检查组件是否仍然挂载
        if (!isMountedRef.current) return

        setCheckLogs([`[${new Date().toLocaleTimeString()}] ▶ 开始环境检测...`])
        const componentNames: ComponentName[] = ['Python', 'CUDA', 'Vulkan', 'LlamaBackend', 'Middleware', 'Permissions']

        // 初始状态保持 pending，第一个组件设为 checking
        const initialState: Record<ComponentName, ComponentResult> = {} as any
        for (let i = 0; i < componentNames.length; i++) {
            initialState[componentNames[i]] = {
                status: i === 0 ? 'checking' : 'pending',
                issues: [],
                fixes: [],
                canAutoFix: false
            }
        }
        setResults(initialState)
        setCheckingComponent(componentNames[0])

        try {
            // 只调用一次 IPC，获取所有组件的检测结果
            // @ts-ignore
            const result = await window.api?.checkEnvComponent?.('Python') // 任意组件名，会返回完整 report

            if (result?.success && result?.report?.components) {
                const reportComponents = result.report.components as Array<{
                    name: string
                    status: ComponentStatus
                    version?: string
                    path?: string
                    issues: string[]
                    fixes: string[]
                    canAutoFix: boolean
                }>

                // 逐个更新卡片状态，产生动画效果
                for (let i = 0; i < componentNames.length; i++) {
                    const name = componentNames[i]
                    const nextName = componentNames[i + 1] || null

                    // 查找对应组件的结果
                    const compResult = reportComponents.find(c => c.name.toLowerCase() === name.toLowerCase())

                    // 短暂延迟产生动画效果
                    await new Promise(resolve => setTimeout(resolve, 200))

                    // 检查组件是否仍然挂载
                    if (!isMountedRef.current) return

                    if (compResult) {
                        setResults(prev => {
                            const newState = { ...prev }
                            // 当前组件显示结果
                            newState[name] = {
                                status: compResult.status,
                                issues: compResult.issues || [],
                                fixes: compResult.fixes || [],
                                canAutoFix: compResult.canAutoFix || false,
                                version: compResult.version,
                                path: compResult.path
                            }
                            // 下一个组件切换为 checking
                            if (nextName) {
                                newState[nextName] = { ...newState[nextName], status: 'checking' }
                            }
                            return newState
                        })
                        const icon = compResult.status === 'ok' ? '✓' : compResult.status === 'warning' ? '⚠' : '✗'
                        const versionText = compResult.version ? ` v${compResult.version}` : ''
                        setCheckLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${icon} ${name}${versionText}`])
                    } else {
                        setResults(prev => {
                            const newState = { ...prev }
                            newState[name] = { status: 'error', issues: ['未找到检测结果'], fixes: [], canAutoFix: false }
                            if (nextName) {
                                newState[nextName] = { ...newState[nextName], status: 'checking' }
                            }
                            return newState
                        })
                        setCheckLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✗ ${name} 未找到`])
                    }

                    // 更新当前检测的组件指示器
                    setCheckingComponent(nextName)
                }
            } else {
                // 检测失败，设置所有组件为错误状态
                const errorMsg = result?.error || '检测失败'
                setCheckLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✗ ${errorMsg}`])
                for (const name of componentNames) {
                    setResults(prev => ({
                        ...prev,
                        [name]: { status: 'error', issues: [errorMsg], fixes: [], canAutoFix: false }
                    }))
                }
            }
        } catch (e) {
            console.error('Failed to check components:', e)
            setCheckLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✗ 检测出错: ${e}`])
            for (const name of componentNames) {
                setResults(prev => ({
                    ...prev,
                    [name]: { status: 'error', issues: [`${e}`], fixes: [], canAutoFix: false }
                }))
            }
        }

        setCheckingComponent(null)
        setCheckLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ■ 检测完成`])
    }

    // 执行修复
    const executeFix = async (action: FixAction) => {
        setShowFixConfirm(null)
        setFixingComponent(action.component)
        setFixProgress(0)
        setFixLogs([`开始: ${action.label}...`])
        setFixResult(null)

        try {
            if (action.type === 'auto' || action.type === 'download') {
                // 设置真实进度监听器
                // @ts-ignore
                const progressHandler = (data: { component: string, stage: string, progress: number, message: string, totalBytes?: number, downloadedBytes?: number }) => {
                    if (!isMountedRef.current) return
                    if (data.component !== action.component) return

                    // 更新进度
                    if (data.progress >= 0) {
                        setFixProgress(data.progress)
                    }

                    // 添加日志（避免重复）
                    if (data.message) {
                        setFixLogs(prev => {
                            const lastLog = prev[prev.length - 1]
                            // 如果是下载进度，更新同一行而不是添加新行
                            if (data.stage.includes('download') && lastLog?.startsWith('↓')) {
                                return [...prev.slice(0, -1), `↓ ${data.message}`]
                            }
                            // 其他消息直接添加
                            const icon = data.progress < 0 ? '✗' : data.progress === 100 ? '✓' : '▶'
                            return [...prev, `${icon} ${data.message}`]
                        })
                    }
                }

                // @ts-ignore
                window.api?.onEnvFixProgress?.(progressHandler)

                // @ts-ignore
                const result = await window.api?.fixEnvComponent?.(action.component)

                // 清理监听器
                // @ts-ignore
                window.api?.removeEnvFixProgressListener?.()

                setFixProgress(100)

                if (result?.success) {
                    setFixLogs(prev => [...prev, `✓ ${result.message || '修复成功'}`])
                    setFixResult({ success: true, message: result.message || '修复成功' })
                    setTimeout(() => checkAllComponents(), 1000)
                } else {
                    const errorMsg = result?.message || (result as any)?.error || '修复失败'
                    setFixLogs(prev => [...prev, `✗ ${errorMsg}`])
                    setFixResult({ success: false, message: errorMsg })
                }
            } else if (action.type === 'link' && action.url) {
                // @ts-ignore
                await window.api?.openExternal?.(action.url)
                setFixProgress(100)
                setFixLogs(prev => [...prev, `✓ 已打开浏览器`])
                setFixResult({ success: true, message: '已打开浏览器' })
            } else if (action.type === 'link') {
                setFixProgress(100)
                setFixLogs(prev => [...prev, `ℹ 请手动操作`])
                setFixResult({ success: true, message: '请按提示手动操作' })
            }
        } catch (e: any) {
            // @ts-ignore
            window.api?.removeEnvFixProgressListener?.()
            setFixLogs(prev => [...prev, `✗ ${e.message}`])
            setFixResult({ success: false, message: e.message })
        }

        setTimeout(() => {
            setFixingComponent(null)
            setFixProgress(0)
        }, 2000)
    }

    // 初始化检测
    useEffect(() => {
        checkAllComponents()
    }, [])

    // 自动滚动日志
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
        }
    }, [checkLogs, fixLogs])

    // ESC 关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !showFixConfirm && !fixingComponent) onClose()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose, showFixConfirm, fixingComponent])

    // 统计
    const errorCount = Object.values(results).filter(r => r.status === 'error').length
    const warningCount = Object.values(results).filter(r => r.status === 'warning').length
    const okCount = Object.values(results).filter(r => r.status === 'ok').length
    const isChecking = checkingComponent !== null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => e.target === e.currentTarget && !fixingComponent && onClose()}
        >
            <Card className="w-[880px] max-h-[90vh] flex flex-col bg-card border-border/50 shadow-2xl rounded-2xl overflow-hidden">
                {/* Header */}
                <CardHeader className="py-3 px-5 border-b border-border/50 bg-muted/30 flex flex-row items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/10 rounded-xl">
                            <Wrench className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                            <CardTitle className="text-base font-bold">运行环境诊断</CardTitle>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                点击卡片查看详情和修复选项
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {!isChecking && (
                            <div className="flex items-center gap-3 mr-2 text-xs">
                                {okCount > 0 && (
                                    <span className="flex items-center gap-1 text-emerald-500">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> {okCount}
                                    </span>
                                )}
                                {warningCount > 0 && (
                                    <span className="flex items-center gap-1 text-amber-500">
                                        <AlertCircle className="w-3.5 h-3.5" /> {warningCount}
                                    </span>
                                )}
                                {errorCount > 0 && (
                                    <span className="flex items-center gap-1 text-red-500">
                                        <XCircle className="w-3.5 h-3.5" /> {errorCount}
                                    </span>
                                )}
                            </div>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={checkAllComponents}
                            disabled={isChecking || !!fixingComponent}
                            className="h-8 px-3 text-xs gap-1.5"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                            {isChecking ? '检测中' : '重新检测'}
                        </Button>
                        <div className="w-px h-5 bg-border mx-1" />
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            disabled={!!fixingComponent}
                            className="w-8 h-8"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </CardHeader>

                {/* Content */}
                <CardContent className="flex-1 p-4 overflow-y-auto space-y-4">
                    {/* 2x3 Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        {components.map(comp => {
                            const result = results[comp.name]
                            const config = statusConfig[result.status]
                            const StatusIcon = config.icon
                            const CompIcon = comp.icon
                            const isThisChecking = checkingComponent === comp.name
                            const isThisFixing = fixingComponent === comp.name
                            const isSelected = selectedComponent === comp.name
                            const hasIssues = result.status === 'error' || result.status === 'warning'

                            return (
                                <div
                                    key={comp.name}
                                    className={`border rounded-xl transition-all cursor-pointer hover:shadow-md
                                        ${config.border} ${isThisFixing ? 'ring-2 ring-indigo-500/50' : ''} 
                                        ${isSelected ? 'ring-2 ring-primary/50 shadow-lg' : ''}`}
                                    onClick={() => setSelectedComponent(isSelected ? null : comp.name)}
                                >
                                    {/* Card Header */}
                                    <div className="p-3 flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.bg}`}>
                                            {isThisChecking ? (
                                                <Loader2 className={`w-5 h-5 animate-spin ${config.color}`} />
                                            ) : (
                                                <CompIcon className={`w-5 h-5 ${config.color}`} />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-semibold truncate">{comp.label}</p>
                                                    {comp.optional && (
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">可选</span>
                                                    )}
                                                </div>
                                                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${config.bg} ${config.color}`}>
                                                    <StatusIcon className={`w-3 h-3 ${isThisChecking ? 'animate-spin' : ''}`} />
                                                    {config.label}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground truncate">{comp.description}</p>
                                            {result.version && (
                                                <p className="text-[10px] text-emerald-600 mt-0.5 font-medium">v{result.version}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    {isSelected && result.status !== 'pending' && result.status !== 'checking' && (
                                        <div className="px-3 pb-3 space-y-3 animate-in slide-in-from-top-2 duration-200">

                                            {/* Issues */}
                                            {result.issues.length > 0 && (
                                                <div className="p-2.5 bg-red-500/5 border border-red-500/20 rounded-lg space-y-1">
                                                    <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide">问题</p>
                                                    {result.issues.map((issue, idx) => (
                                                        <p key={idx} className="text-xs text-red-600">{issue}</p>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Fix Actions - 清晰分组 */}
                                            {hasIssues && comp.fixActions.length > 0 && (
                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">修复方案</p>
                                                    <div className="space-y-1.5">
                                                        {comp.fixActions.map((action, idx) => {
                                                            const isAuto = action.type === 'auto' || action.type === 'download'
                                                            return (
                                                                <button
                                                                    key={idx}
                                                                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left
                                                                        ${isAuto
                                                                            ? 'bg-indigo-500/5 border-indigo-500/20 hover:bg-indigo-500/10'
                                                                            : 'bg-muted/30 border-border/50 hover:bg-muted/50'
                                                                        }
                                                                        ${fixingComponent ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                                                                    `}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        if (!fixingComponent) setShowFixConfirm(action)
                                                                    }}
                                                                    disabled={!!fixingComponent}
                                                                >
                                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 
                                                                        ${isAuto ? 'bg-indigo-500/10' : 'bg-muted'}`}>
                                                                        {action.type === 'download' ? (
                                                                            <Download className={`w-4 h-4 ${isAuto ? 'text-indigo-500' : 'text-muted-foreground'}`} />
                                                                        ) : action.type === 'link' ? (
                                                                            <ExternalLink className="w-4 h-4 text-muted-foreground" />
                                                                        ) : (
                                                                            <Play className="w-4 h-4 text-indigo-500" />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <p className="text-xs font-medium">{action.label}</p>
                                                                            {isAuto && (
                                                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-medium">
                                                                                    一键
                                                                                </span>
                                                                            )}
                                                                            {!isAuto && (
                                                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                                                                    手动
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-[10px] text-muted-foreground truncate">{action.description}</p>
                                                                    </div>
                                                                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                                                </button>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* OK Status */}
                                            {result.status === 'ok' && (
                                                <div className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                                                    <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                        组件运行正常，无需修复
                                                    </p>
                                                </div>
                                            )}

                                            {/* Fix Progress */}
                                            {isThisFixing && (
                                                <div className="p-2.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                                                        <span className="text-xs font-medium">正在修复</span>
                                                        <span className="text-[10px] text-muted-foreground ml-auto">{fixProgress}%</span>
                                                    </div>
                                                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-indigo-500 transition-all duration-300"
                                                            style={{ width: `${fixProgress}%` }}
                                                        />
                                                    </div>
                                                    {fixLogs.map((log, i) => (
                                                        <p key={i} className="text-[10px] text-muted-foreground">{log}</p>
                                                    ))}
                                                    {fixResult && (
                                                        <p className={`text-xs font-medium flex items-center gap-1.5 ${fixResult.success ? 'text-emerald-500' : 'text-red-500'}`}>
                                                            {fixResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                                                            {fixResult.message}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* Logs Section */}
                    <div className="border border-border/50 rounded-xl overflow-hidden">
                        <button
                            className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
                            onClick={() => setShowLogs(!showLogs)}
                        >
                            <span className="text-xs font-medium flex items-center gap-2">
                                <Terminal className="w-3.5 h-3.5" />
                                检测日志
                            </span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${showLogs ? '' : '-rotate-90'}`} />
                        </button>
                        {showLogs && (
                            <div
                                ref={logContainerRef}
                                className="bg-slate-950 p-3 max-h-[150px] overflow-y-auto"
                            >
                                <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap">
                                    {checkLogs.map((log, i) => (
                                        <div
                                            key={i}
                                            className={`py-0.5 ${log.includes('✓') ? 'text-emerald-400' :
                                                log.includes('⚠') ? 'text-amber-400' :
                                                    log.includes('✗') ? 'text-red-400' :
                                                        log.includes('▶') || log.includes('■') ? 'text-blue-400' : ''
                                                }`}
                                        >
                                            {log}
                                        </div>
                                    ))}
                                </pre>
                            </div>
                        )}
                    </div>
                </CardContent>

                {/* Footer */}
                <div className="px-5 py-2.5 border-t border-border/50 bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>ESC 关闭 · 点击卡片展开</span>
                    <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> 一键修复</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground" /> 手动修复</span>
                    </span>
                </div>
            </Card>

            {/* Fix Confirmation Dialog */}
            {showFixConfirm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
                    <Card className="w-[420px] bg-card border-border/50 shadow-2xl rounded-xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <CardHeader className="py-3 px-4 border-b border-border/50 bg-muted/30">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                {showFixConfirm.type === 'auto' || showFixConfirm.type === 'download' ? (
                                    <Play className="w-4 h-4 text-indigo-500" />
                                ) : (
                                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                                )}
                                确认操作
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 space-y-4">
                            <div className="space-y-1">
                                <p className="text-sm font-medium">{showFixConfirm.label}</p>
                                <p className="text-xs text-muted-foreground">{showFixConfirm.description}</p>
                            </div>

                            {showFixConfirm.type === 'download' && (
                                <div className="space-y-2">
                                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                        <p className="text-xs text-amber-600 flex items-start gap-2">
                                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                            <span>
                                                此操作将下载并安装组件，可能需要几分钟。<br />
                                                <span className="font-bold">注意：安装过程可能需求管理员权限</span>
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            )}

                            {showFixConfirm.type === 'link' && (
                                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                                    <p className="text-xs text-blue-600 flex items-start gap-2">
                                        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                        {showFixConfirm.url ? '将在浏览器中打开链接' : '请按照提示手动操作'}
                                    </p>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => setShowFixConfirm(null)}
                                >
                                    取消
                                </Button>
                                <Button
                                    size="sm"
                                    className="flex-1 gap-1.5"
                                    onClick={() => executeFix(showFixConfirm)}
                                >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                    {showFixConfirm.type === 'link' ? '确认' : '开始修复'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}

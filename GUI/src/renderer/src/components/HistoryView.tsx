import { useState, useEffect } from "react"
import { Clock, Trash2, ChevronDown, ChevronRight, FileText, AlertCircle, CheckCircle, XCircle, Download, FolderOpen, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/core"
import { Button } from "./ui/core"
import { AlertModal } from "./ui/AlertModal"

// ============================================================================
// Types - Translation History Data Structures
// ============================================================================

/**
 * Trigger event recorded when quality control features activate during translation.
 * These events help diagnose translation quality issues.
 */
export interface TriggerEvent {
    /** ISO timestamp when the event occurred */
    time: string
    /** Type of trigger event */
    type: 'empty_retry' | 'rep_penalty_increase' | 'line_mismatch' | 'parse_fallback' |
    'kana_residue' | 'hangeul_residue' | 'high_similarity' | 'glossary_missed' |
    'warning_line_mismatch' | 'warning_kana_residue' | 'warning_hangeul_residue' | 'warning_high_similarity' | 'warning_glossary_missed' | 'warning_quality'
    /** Block number where the event occurred (0 if not applicable) */
    block: number
    /** Human-readable message describing the event */
    message: string
}

/**
 * Complete record of a translation task, including configuration, statistics, and logs.
 * Stored in localStorage and displayed in the History view.
 */
export interface TranslationRecord {
    /** Unique identifier (timestamp-based) */
    id: string
    /** Input file name (without path) */
    fileName: string
    /** Full path to input file */
    filePath: string
    /** Output file path (if available) */
    outputPath?: string
    /** Model name used for translation */
    modelName?: string
    /** ISO timestamp when translation started */
    startTime: string
    /** ISO timestamp when translation ended */
    endTime?: string
    /** Duration in seconds */
    duration?: number
    /** Translation status */
    status: 'completed' | 'failed' | 'interrupted' | 'running'
    /** Total number of blocks to translate */
    totalBlocks: number
    /** Number of completed blocks */
    completedBlocks: number
    /** Total lines translated */
    totalLines: number
    /** Total characters processed */
    totalChars?: number
    /** Source text line count */
    sourceLines?: number
    /** Source text character count */
    sourceChars?: number
    /** Average translation speed (chars/sec) */
    avgSpeed?: number
    /** Configuration used for this translation */
    config: {
        temperature: number
        lineCheck: boolean
        repPenaltyBase: number
        maxRetries: number
    }
    /** Trigger events recorded during translation */
    triggers: TriggerEvent[]
    /** Log lines (last 100 kept) */
    logs: string[]
}

// ============================================================================
// Storage Functions - localStorage-based history management
// ============================================================================

/** Maximum number of history records to keep */
const MAX_HISTORY_RECORDS = 50

/**
 * Retrieves all translation history records from localStorage.
 * @returns Array of TranslationRecord objects, empty array if none or on error
 */
export const getHistory = (): TranslationRecord[] => {
    try {
        const data = localStorage.getItem("translation_history")
        return data ? JSON.parse(data) : []
    } catch {
        return []
    }
}

/**
 * Saves translation history to localStorage, keeping only the most recent records.
 * @param records - Array of records to save (will be trimmed to last MAX_HISTORY_RECORDS)
 */
export const saveHistory = (records: TranslationRecord[]) => {
    const trimmed = records.slice(-MAX_HISTORY_RECORDS)
    localStorage.setItem("translation_history", JSON.stringify(trimmed))
}

/**
 * Adds a new record to translation history.
 * @param record - The new translation record to add
 */
export const addRecord = (record: TranslationRecord) => {
    const history = getHistory()
    history.push(record)
    saveHistory(history)
}

/**
 * Updates an existing record by ID with partial data.
 * @param id - Record ID to update
 * @param updates - Partial record data to merge
 */
export const updateRecord = (id: string, updates: Partial<TranslationRecord>) => {
    const history = getHistory()
    const index = history.findIndex(r => r.id === id)
    if (index >= 0) {
        history[index] = { ...history[index], ...updates }
        saveHistory(history)
    }
}

/**
 * Deletes a record by ID.
 * @param id - Record ID to delete
 */
export const deleteRecord = (id: string) => {
    const history = getHistory().filter(r => r.id !== id)
    saveHistory(history)
}

/**
 * Clears all translation history from localStorage.
 */
export const clearHistory = () => {
    localStorage.removeItem("translation_history")
}

// ============================================================================
// Component - Translation History View
// ============================================================================

/**
 * History view component displaying all past translation records.
 * Features: expandable cards, detailed logs, trigger events, statistics.
 */
export function HistoryView({ lang: _lang }: { lang: string }) {
    const [records, setRecords] = useState<TranslationRecord[]>([])
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [alertOpen, setAlertOpen] = useState(false)

    useEffect(() => {
        setRecords(getHistory().reverse()) // Show newest first
    }, [])

    const handleDelete = (id: string) => {
        deleteRecord(id)
        setRecords(records.filter(r => r.id !== id))
    }

    const handleClearAll = () => {
        setAlertOpen(true)
    }

    const handleConfirmClear = () => {
        clearHistory()
        setRecords([])
    }

    /**
     * Export detailed log for a specific record as text file
     */
    const handleExportLog = (record: TranslationRecord) => {
        const lines = [
            `# 翻译记录详细日志`,
            ``,
            `## 基本信息`,
            `- 文件名: ${record.fileName}`,
            `- 文件路径: ${record.filePath}`,
            `- 模型: ${record.modelName || '未记录'}`,
            `- 开始时间: ${record.startTime}`,
            `- 结束时间: ${record.endTime || '未完成'}`,
            `- 持续时间: ${formatDuration(record.duration)}`,
            `- 状态: ${record.status}`,
            ``,
            `## 统计数据`,
            ``,
            `### 源文本`,
            `- 行数: ${record.sourceLines || '未记录'}`,
            `- 字符数: ${record.sourceChars || '未记录'}`,
            ``,
            `### 输出`,
            `- 区块: ${record.completedBlocks}/${record.totalBlocks}`,
            `- 行数: ${record.totalLines || 0}`,
            `- 字符数: ${record.totalChars || 0}`,
            `- 平均速度: ${record.avgSpeed || 0} 字/秒`,
            ``,
            `## 配置参数`,
            `- 温度: ${record.config.temperature}`,
            `- 行数检查: ${record.config.lineCheck ? '开启' : '关闭'}`,
            `- 重复惩罚基础: ${record.config.repPenaltyBase}`,
            `- 最大重试: ${record.config.maxRetries}`,
            ``
        ]

        if (record.triggers.length > 0) {
            lines.push(`## 触发事件 (${record.triggers.length})`)
            record.triggers.forEach((t, i) => {
                lines.push(`${i + 1}. [Block ${t.block}] ${getTriggerTypeLabel(t.type)} - ${t.message}`)
            })
            lines.push(``)
        }

        if (record.logs.length > 0) {
            lines.push(`## 详细日志 (最近 ${record.logs.length} 条)`)
            lines.push('```')
            record.logs.forEach(log => lines.push(log))
            lines.push('```')
        }

        const content = lines.join('\n')
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${record.fileName}_log_${record.id}.md`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    const formatDate = (iso: string) => {
        const d = new Date(iso)
        return d.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const formatDuration = (sec?: number) => {
        if (!sec) return "-"
        if (sec < 60) return `${Math.round(sec)}s`
        const m = Math.floor(sec / 60)
        const s = Math.round(sec % 60)
        return `${m}m ${s}s`
    }

    const getStatusIcon = (status: TranslationRecord['status']) => {
        switch (status) {
            case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />
            case 'failed': return <XCircle className="w-4 h-4 text-red-500" />
            case 'interrupted': return <AlertCircle className="w-4 h-4 text-amber-500" />
            case 'running': return <Clock className="w-4 h-4 text-blue-500 animate-pulse" />
        }
    }

    const getTriggerTypeLabel = (type: TriggerEvent['type']) => {
        switch (type) {
            case 'empty_retry': return '空输出重试'
            case 'rep_penalty_increase': return '重复惩罚提高'
            case 'line_mismatch': return '行数不匹配 (重试)'
            case 'parse_fallback': return '解析回退'
            case 'kana_residue': return '假名残留 (重试)'
            case 'hangeul_residue': return '谚文残留 (重试)'
            case 'high_similarity': return '相似度过高 (重试)'
            case 'glossary_missed': return '术语未生效 (重试)'
            case 'warning_line_mismatch': return '行数不匹配 (警告)'
            case 'warning_kana_residue': return '假名残留 (警告)'
            case 'warning_hangeul_residue': return '谚文残留 (警告)'
            case 'warning_high_similarity': return '相似度过高 (警告)'
            case 'warning_glossary_missed': return '术语未生效 (警告)'
            case 'warning_quality': return '质量警告'
            default: return type
        }
    }

    return (
        <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                        <Clock className="w-6 h-6 text-primary" />
                        翻译历史
                    </h2>
                    {records.length > 0 && (
                        <Button variant="outline" size="sm" onClick={handleClearAll} className="text-red-500 hover:text-red-600">
                            <Trash2 className="w-4 h-4 mr-2" />
                            清空全部
                        </Button>
                    )}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                    查看过去的翻译记录，包括日志和设置触发事件。保留最近 50 条记录。
                </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 pb-8 scrollbar-thin scrollbar-thumb-border">
                {records.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                        <FileText className="w-12 h-12 mb-4 opacity-30" />
                        <p>暂无翻译历史</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {records.map(record => (
                            <Card key={record.id} className="overflow-hidden">
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {getStatusIcon(record.status)}
                                            <div>
                                                <CardTitle className="text-base font-medium">
                                                    {record.fileName}
                                                </CardTitle>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {formatDate(record.startTime)} · {formatDuration(record.duration)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {record.triggers.length > 0 && (
                                                <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded">
                                                    {record.triggers.length} 触发
                                                </span>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                                            >
                                                {expandedId === record.id ? (
                                                    <ChevronDown className="w-4 h-4" />
                                                ) : (
                                                    <ChevronRight className="w-4 h-4" />
                                                )}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleExportLog(record)}
                                                title="导出详细日志"
                                            >
                                                <Download className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDelete(record.id)}
                                                className="text-red-500 hover:text-red-600"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>

                                {expandedId === record.id && (
                                    <CardContent className="pt-0 border-t">
                                        <div className="space-y-4 pt-4">
                                            {/* Stats */}
                                            <div className="grid grid-cols-6 gap-3 text-sm">
                                                <div>
                                                    <p className="text-muted-foreground text-xs">区块</p>
                                                    <p className="font-medium">{record.completedBlocks}/{record.totalBlocks}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground text-xs">有效行数 (源/译)</p>
                                                    <p className="font-medium truncate" title={`源: ${record.sourceLines || '-'} / 译: ${record.totalLines || '-'}`}>
                                                        {record.sourceLines || '-'} <span className="text-muted-foreground">/</span> {record.totalLines || '-'}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground text-xs">字符数 (源/译)</p>
                                                    <p className="font-medium truncate" title={`源: ${record.sourceChars?.toLocaleString() || '-'} / 译: ${record.totalChars?.toLocaleString() || '-'}`}>
                                                        {record.sourceChars?.toLocaleString() || '-'} <span className="text-muted-foreground">/</span> {record.totalChars?.toLocaleString() || '-'}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground text-xs">速度</p>
                                                    <p className="font-medium">{record.avgSpeed ? `${record.avgSpeed} 字/秒` : '-'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground text-xs">温度</p>
                                                    <p className="font-medium">{record.config.temperature}</p>
                                                </div>
                                                <div>
                                                    <p className="text-muted-foreground text-xs">重试次数</p>
                                                    <p className="font-medium">
                                                        {record.triggers.filter(t =>
                                                            t.type === 'empty_retry' ||
                                                            t.type === 'line_mismatch' ||
                                                            t.type === 'rep_penalty_increase' ||
                                                            t.type === 'parse_fallback'
                                                        ).length}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Model Info */}
                                            {record.modelName && (
                                                <p className="text-xs text-muted-foreground">
                                                    模型: <span className="font-medium text-foreground">{record.modelName}</span>
                                                </p>
                                            )}

                                            {/* Triggers */}
                                            {record.triggers.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground mb-2">触发事件</p>
                                                    <div className="space-y-1">
                                                        {record.triggers.map((t, i) => (
                                                            <div key={i} className="flex items-center gap-2 text-xs bg-secondary/50 rounded px-2 py-1">
                                                                <span className="text-muted-foreground">[Block {t.block}]</span>
                                                                <span className="font-medium">{getTriggerTypeLabel(t.type)}</span>
                                                                <span className="text-muted-foreground truncate">{t.message}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Logs */}
                                            {record.logs.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground mb-2">日志 (共 {record.logs.length} 条)</p>
                                                    <div className="bg-black/90 rounded p-3 max-h-80 overflow-y-auto font-mono text-xs text-green-400 space-y-0.5 scrollbar-thin scrollbar-thumb-gray-600">
                                                        {record.logs.map((log, i) => (
                                                            <div key={i} className="whitespace-pre-wrap">{log}</div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* File Paths with Open Buttons */}
                                            <div className="space-y-1.5 text-xs">
                                                {/* Source File */}
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <span className="w-12 shrink-0">源文件:</span>
                                                    <span className="truncate flex-1">{record.filePath}</span>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 px-2"
                                                        onClick={() => window.api?.openPath?.(record.filePath)}
                                                        title="打开源文件"
                                                    >
                                                        <ExternalLink className="w-3 h-3" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 px-2"
                                                        onClick={() => {
                                                            const folderPath = record.filePath.substring(0, Math.max(record.filePath.lastIndexOf('\\'), record.filePath.lastIndexOf('/')))
                                                            window.api?.openFolder?.(folderPath)
                                                        }}
                                                        title="打开源文件夹"
                                                    >
                                                        <FolderOpen className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                                {/* Output File */}
                                                {record.outputPath && (
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <span className="w-12 shrink-0">输出:</span>
                                                        <span className="truncate flex-1">{record.outputPath}</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 px-2"
                                                            onClick={() => window.api?.openPath?.(record.outputPath!)}
                                                            title="打开输出文件"
                                                        >
                                                            <ExternalLink className="w-3 h-3" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 px-2"
                                                            onClick={() => {
                                                                const folderPath = record.outputPath!.substring(0, Math.max(record.outputPath!.lastIndexOf('\\'), record.outputPath!.lastIndexOf('/')))
                                                                window.api?.openFolder?.(folderPath)
                                                            }}
                                                            title="打开输出文件夹"
                                                        >
                                                            <FolderOpen className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        ))}
                    </div>
                )}
            </div>
            <AlertModal
                open={alertOpen}
                onOpenChange={setAlertOpen}
                title="确认清空"
                description="确定要清空所有翻译历史吗？此操作无法撤销。"
                variant="destructive"
                onConfirm={handleConfirmClear}
                showCancel={true}
            />
        </div>
    )
}

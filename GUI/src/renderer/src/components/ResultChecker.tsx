/**
 * ResultChecker - 翻译质量检查组件
 * 用于检测和展示翻译结果中的潜在问题
 */

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/core'
import { Button } from './ui/core'
import {
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Search,
    FileText,
    ChevronDown,
    ChevronUp,
    AlertCircle
} from 'lucide-react'
import { Language } from '../lib/i18n'
import { calculateSimilarity, findHighSimilarityLines, detectKanaResidue } from '../lib/quality-check'

// 问题类型定义
interface QualityIssue {
    blockIndex: number
    type: 'kana_residue' | 'glossary_miss' | 'high_similarity' | 'line_mismatch' | 'empty_output'
    severity: 'warning' | 'error' | 'info'
    message: string
    srcPreview: string
    dstPreview: string
    suggestion?: string
}

// 缓存数据类型
interface CacheBlock {
    index: number
    src: string
    dst: string
    srcLines: number
    dstLines: number
    cot?: string
}

interface CacheData {
    blocks: CacheBlock[]
    glossaryPath?: string
}

interface ResultCheckerProps {
    lang: Language
    cacheData?: CacheData
    glossary?: Record<string, string>
    onNavigateToBlock?: (index: number) => void
}

// 检测术语表覆盖率
// 检测术语表未生效 (严格模式：列出所有在原文出现但在译文丢失的术语)
// 可选：检查 CoT 是否提及，作为辅助信息
function detectGlossaryMiss(
    src: string,
    dst: string,
    glossary: Record<string, string>,
    cot: string = ''
): { missed: string[]; cotFound: string[] } {
    const missed: string[] = []
    const cotFound: string[] = []

    // DEBUG: Only log first check to avoid spam
    const debug = (window as any)._glossary_debug_once !== true;
    if (debug) {
        console.log(`[ResultChecker] Checking glossary against src (len=${src.length})`)
        console.log(`[ResultChecker] Glossary keys:`, Object.keys(glossary))
            ; (window as any)._glossary_debug_once = true;
    }

    for (const [jp, zh] of Object.entries(glossary)) {
        if (src.includes(jp)) {
            // 原文包含该术语
            if (!dst.includes(zh)) {
                // 译文未包含该术语 -> 缺失
                missed.push(`${jp} → ${zh}`)
                console.warn(`[ResultChecker] Missed: ${jp} -> ${zh}`)

                // 检查 CoT 是否提及 (辅助信息)
                if (cot && cot.includes(jp)) {
                    cotFound.push(jp)
                }
            } else {
                if (debug) console.log(`[ResultChecker] Matched: ${jp} -> ${zh}`)
            }
        } else {
            // Debug why not matching src?
            // if (debug) console.log(`[ResultChecker] Src does not contain: ${jp}`)
        }
    }
    return { missed, cotFound }
}



export function ResultChecker({
    lang: _lang,
    cacheData,
    glossary,
    onNavigateToBlock
}: ResultCheckerProps) {
    const [filterType, setFilterType] = useState<string>('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedIssues, setExpandedIssues] = useState<Set<number>>(new Set())
    const [localCacheData, setLocalCacheData] = useState<CacheData | null>(null)
    const [localCachePath, setLocalCachePath] = useState<string | null>(null)

    // 优先使用传入的 cacheData，如果没有则使用本地加载的 localCacheData
    const displayData = cacheData || localCacheData

    const handleLoadCache = async () => {
        try {
            const path = await window.api?.selectFile({
                title: '打开翻译缓存',
                filters: [{ name: 'JSON Cache', extensions: ['json'] }]
            })
            if (path && window.api?.loadCache) {
                const data = await window.api.loadCache(path)
                if (data) {
                    setLocalCacheData(data)
                    setLocalCachePath(path)
                }
            }
        } catch (e) {
            console.error(e)
        }
    }

    // 分析缓存数据，检测问题
    const issues = useMemo<QualityIssue[]>(() => {
        if (!displayData?.blocks) return []

        const result: QualityIssue[] = []

        for (const block of displayData.blocks) {
            const srcText = block.src || ''
            const dstText = block.dst || ''

            // 1. 检测空输出
            if (!dstText.trim() && srcText.trim()) {
                result.push({
                    blockIndex: block.index,
                    type: 'empty_output',
                    severity: 'error',
                    message: '译文为空',
                    srcPreview: srcText.substring(0, 100),
                    dstPreview: '(空)',
                    suggestion: '需要重新翻译此块'
                })
                continue
            }

            // 2. 检测假名残留 - 20个以上才警告
            const kanaCount = detectKanaResidue(dstText)
            if (kanaCount > 0) {
                const isMinor = kanaCount < 5
                result.push({
                    blockIndex: block.index,
                    type: 'kana_residue',
                    severity: isMinor ? 'info' : 'warning',
                    message: `发现${isMinor ? '少量' : '较多'}残留假名 (${kanaCount}个)`,
                    srcPreview: srcText.substring(0, 100),
                    dstPreview: dstText.substring(0, 100),
                    suggestion: '可能存在漏翻，建议检查或启用假名清理'
                })
            }

            // 3. 检测术语表未生效 (严格模式)
            if (glossary && Object.keys(glossary).length > 0) {
                const { missed, cotFound } = detectGlossaryMiss(srcText, dstText, glossary, block.cot)
                if (missed.length > 0) {
                    const count = missed.length
                    result.push({
                        blockIndex: block.index,
                        type: 'glossary_miss',
                        severity: 'warning',
                        message: `术语未生效 (${count}项): ${missed.slice(0, 3).join(', ')}${count > 3 ? '...' : ''}`,
                        srcPreview: srcText.substring(0, 100),
                        dstPreview: dstText.substring(0, 100),
                        suggestion: `建议手动修改。${cotFound.length > 0 ? `(其中 ${cotFound.length} 项在CoT中被提及)` : ''}`
                    })
                }
            }

            // 4. 检测高相似度 (可能是漏翻) - 阈值提高到90%，且原文长度需大于10
            const similarity = calculateSimilarity(srcText, dstText)
            const similarLines = findHighSimilarityLines(srcText, dstText)

            if (similarLines.length > 0) {
                //Found specific lines
                result.push({
                    blockIndex: block.index,
                    type: 'high_similarity',
                    severity: 'warning',
                    message: `发现 ${similarLines.length} 行高度相似 (第 ${similarLines.join(', ')} 行)`,
                    srcPreview: srcText.substring(0, 100),
                    dstPreview: dstText.substring(0, 100),
                    suggestion: '检测到原文与译文几乎一致，请检查是否漏翻'
                })
            } else if (similarity > 0.9 && srcText.length > 10) {
                // Fallback global check
                result.push({
                    blockIndex: block.index,
                    type: 'high_similarity',
                    severity: 'warning',
                    message: `原文/译文相似度极高 (${Math.round(similarity * 100)}%)`,
                    srcPreview: srcText.substring(0, 100),
                    dstPreview: dstText.substring(0, 100),
                    suggestion: '可能存在漏翻或复制原文的情况'
                })
            }

            // 5. 检测行数不匹配 - 分级处理 (阈值 10%)
            if (block.srcLines && block.dstLines) {
                const diff = Math.abs(block.srcLines - block.dstLines)
                const pct = diff / Math.max(block.srcLines, 1)

                if (diff > 0) {
                    if (pct < 0.1 && diff <= 5) {
                        result.push({
                            blockIndex: block.index,
                            type: 'line_mismatch',
                            severity: 'info',
                            message: `行数偏差轻微 (${block.srcLines} → ${block.dstLines})`,
                            srcPreview: srcText.substring(0, 100),
                            dstPreview: dstText.substring(0, 100),
                            suggestion: '无需严重关注，但可检查是否有合并'
                        })
                    } else if (diff > 10 || pct > 0.4) {
                        result.push({
                            blockIndex: block.index,
                            type: 'line_mismatch',
                            severity: 'warning',
                            message: `行数差异较大 (${block.srcLines} → ${block.dstLines}, 差${diff}行)`,
                            srcPreview: srcText.substring(0, 100),
                            dstPreview: dstText.substring(0, 100),
                            suggestion: '可能存在合并或拆分行的情况'
                        })
                    }
                }
            }

            // 6. 检测显式错误标签 (Explicit Error Tags from LLM/Backend)
            // 这些标签是后端检测到问题后插入到译文中的
            if (dstText.includes('<kana_residue>')) {
                result.push({
                    blockIndex: block.index,
                    type: 'kana_residue',
                    severity: 'error',
                    message: `模型标记了假名残留 (kana_residue)`,
                    srcPreview: srcText.substring(0, 100),
                    dstPreview: dstText,
                    suggestion: '请检查并移除原文中的假名，或手动修复译文'
                })
            }
            if (dstText.includes('<line_mismatch>')) {
                result.push({
                    blockIndex: block.index,
                    type: 'line_mismatch',
                    severity: 'error',
                    message: `模型标记了行数不匹配 (line_mismatch)`,
                    srcPreview: srcText.substring(0, 100),
                    dstPreview: dstText,
                    suggestion: '译文行数与原文严重不符，请核对'
                })
            }
            if (dstText.includes('<glossary_miss>')) {
                result.push({
                    blockIndex: block.index,
                    type: 'glossary_miss',
                    severity: 'warning',
                    message: `模型标记了术语缺失 (glossary_miss)`,
                    srcPreview: srcText.substring(0, 100),
                    dstPreview: dstText,
                    suggestion: '请补全缺失的术语'
                })
            }
            // Generic Error Tag Pattern: <error_...>
            const genericErrorMatch = dstText.match(/<error_([a-z_]+)>/)
            if (genericErrorMatch) {
                const errType = genericErrorMatch[1]
                if (!['kana_residue', 'line_mismatch', 'glossary_miss'].includes(errType)) {
                    result.push({
                        blockIndex: block.index,
                        type: 'empty_output',
                        severity: 'error',
                        message: `模型标记了未定义错误: ${errType}`,
                        srcPreview: srcText.substring(0, 100),
                        dstPreview: dstText,
                        suggestion: '请检查译文内容'
                    })
                }
            }

            // 7. Include Warnings from Cache (Backend detected)
            if ((block as any).warnings && Array.isArray((block as any).warnings)) {
                (block as any).warnings.forEach((wType: string) => {
                    // Check if we already have this type for this block from text scan
                    const alreadyHas = result.some(r => r.blockIndex === block.index && r.type === wType)
                    if (!alreadyHas) {
                        // Map backend type to issue
                        let severity: 'error' | 'warning' | 'info' = 'error'

                        // Handle both legacy and new warning_ prefixed types
                        const normalizedType = wType.replace('warning_', '')

                        if (['line_mismatch', 'kana_residue', 'hangeul_residue'].includes(normalizedType) ||
                            wType.includes('line_mismatch')) {
                            severity = 'info'
                        } else if (['high_similarity', 'glossary_miss', 'glossary_missed'].includes(normalizedType) ||
                            wType.includes('glossary')) {
                            severity = 'warning'
                        } else {
                            severity = 'error'
                        }

                        result.push({
                            blockIndex: block.index,
                            type: wType as any,
                            severity: severity,
                            message: `后端检测到风险: ${wType}`,
                            srcPreview: srcText.substring(0, 100),
                            dstPreview: dstText.substring(0, 100),
                            suggestion: '请检查该块内容'
                        })
                    }
                })
            }
        }

        return result
    }, [displayData, glossary])

    // 过滤后的问题列表
    const filteredIssues = useMemo(() => {
        let result = issues

        if (filterType !== 'all') {
            result = result.filter(i => i.type === filterType)
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase()
            result = result.filter(i =>
                i.message.toLowerCase().includes(query) ||
                i.srcPreview.toLowerCase().includes(query) ||
                i.dstPreview.toLowerCase().includes(query)
            )
        }

        return result
    }, [issues, filterType, searchQuery])

    // 统计信息
    const stats = useMemo(() => ({
        total: issues.length,
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        infos: issues.filter(i => i.severity === 'info').length,
        byType: {
            kana_residue: issues.filter(i => i.type.includes('kana_residue')).length,
            glossary_miss: issues.filter(i => i.type.includes('glossary_miss')).length,
            high_similarity: issues.filter(i => i.type.includes('high_similarity')).length,
            line_mismatch: issues.filter(i => i.type.includes('line_mismatch')).length,
            empty_output: issues.filter(i => i.type === 'empty_output').length
        }
    }), [issues])

    const toggleExpand = (index: number) => {
        setExpandedIssues(prev => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const getSeverityIcon = (severity: string) => {
        if (severity === 'error') return <XCircle className="w-5 h-5 text-red-500" />
        if (severity === 'info') return <AlertTriangle className="w-5 h-5 text-blue-500" />
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />
    }

    const getTypeLabel = (type: string) => {
        const labels: Record<string, string> = {
            kana_residue: '假名残留',
            glossary_miss: '术语未生效',
            high_similarity: '高相似度',
            line_mismatch: '行数不匹配',
            empty_output: '空输出'
        }
        return labels[type] || type
    }

    if (!displayData) {
        return (
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
                <Card className="flex-1 flex items-center justify-center">
                    <div className="text-center text-muted-foreground flex flex-col items-center gap-4">
                        <div>
                            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>请先加载翻译缓存文件</p>
                            <p className="text-sm mt-2 opacity-70">在校对界面选择缓存文件，或在此处直接打开</p>
                        </div>
                        <Button onClick={handleLoadCache} variant="outline" className="gap-2">
                            <FileText className="w-4 h-4" />
                            打开缓存文件
                        </Button>
                    </div>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col p-4 overflow-hidden gap-3">
            {/* Header with Path if available */}
            {localCachePath && (
                <div className="text-xs text-muted-foreground break-all px-1">
                    当前文件: {localCachePath}
                </div>
            )}

            {/* 统计卡片 - 响应式网格 */}
            <div className="grid grid-cols-2 gap-2">
                <Card className="p-3">
                    <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${stats.total === 0 ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
                            {stats.total === 0 ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                                <AlertCircle className="w-4 h-4 text-orange-500" />
                            )}
                        </div>
                        <div>
                            <p className="text-lg font-bold">{stats.total}</p>
                            <p className="text-[10px] text-muted-foreground">总问题</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-3">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-red-500/10">
                            <XCircle className="w-4 h-4 text-red-500" />
                        </div>
                        <div>
                            <p className="text-lg font-bold">{stats.errors}</p>
                            <p className="text-[10px] text-muted-foreground">错误</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-3">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-yellow-500/10">
                            <AlertTriangle className="w-4 h-4 text-yellow-500" />
                        </div>
                        <div>
                            <p className="text-lg font-bold">{stats.warnings}</p>
                            <p className="text-[10px] text-muted-foreground">警告</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-3">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-blue-500/10">
                            <FileText className="w-4 h-4 text-blue-500" />
                        </div>
                        <div>
                            <p className="text-lg font-bold">{displayData?.blocks?.length || 0}</p>
                            <p className="text-[10px] text-muted-foreground">块数</p>
                        </div>
                    </div>
                </Card>
            </div>

            {/* 过滤器和搜索 */}
            <div className="flex gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索问题..."
                        className="w-full pl-10 pr-4 py-2 bg-muted rounded-lg text-sm"
                    />
                </div>
                <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="px-4 py-2 bg-muted rounded-lg text-sm"
                >
                    <option value="all">全部类型</option>
                    <option value="kana_residue">假名残留 ({stats.byType.kana_residue})</option>
                    <option value="glossary_miss">术语未生效 ({stats.byType.glossary_miss})</option>
                    <option value="high_similarity">高相似度 ({stats.byType.high_similarity})</option>
                    <option value="line_mismatch">行数不匹配 ({stats.byType.line_mismatch})</option>
                    <option value="empty_output">空输出 ({stats.byType.empty_output})</option>
                </select>
            </div>

            {/* 问题列表 */}
            <Card className="flex-1 overflow-hidden">
                <CardHeader className="py-3 border-b border-border">
                    <CardTitle className="text-sm font-medium">
                        检测结果 ({filteredIssues.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-y-auto">
                    {filteredIssues.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            {issues.length === 0 ? (
                                <div className="text-center">
                                    <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
                                    <p>未检测到明显问题</p>
                                    <p className="text-sm mt-2">翻译质量良好!</p>
                                </div>
                            ) : (
                                <p>没有匹配的结果</p>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {filteredIssues.map((issue, idx) => (
                                <div key={idx} className="p-4 hover:bg-muted/50">
                                    <div
                                        className="flex items-start gap-3 cursor-pointer"
                                        onClick={() => toggleExpand(idx)}
                                    >
                                        {getSeverityIcon(issue.severity)}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs px-2 py-0.5 bg-muted rounded">
                                                    Block #{issue.blockIndex}
                                                </span>
                                                <span className="text-xs px-2 py-0.5 bg-muted rounded">
                                                    {getTypeLabel(issue.type)}
                                                </span>
                                            </div>
                                            <p className="text-sm font-medium">{issue.message}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {onNavigateToBlock && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        onNavigateToBlock(issue.blockIndex)
                                                    }}
                                                >
                                                    跳转
                                                </Button>
                                            )}
                                            {expandedIssues.has(idx) ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
                                        </div>
                                    </div>

                                    {expandedIssues.has(idx) && (
                                        <div className="mt-3 ml-8 space-y-2 text-sm">
                                            <div className="p-3 bg-muted rounded-lg">
                                                <p className="text-xs text-muted-foreground mb-1">原文预览:</p>
                                                <p className="text-foreground">{issue.srcPreview}...</p>
                                            </div>
                                            <div className="p-3 bg-muted rounded-lg">
                                                <p className="text-xs text-muted-foreground mb-1">译文预览:</p>
                                                <p className="text-foreground">{issue.dstPreview}...</p>
                                            </div>
                                            {issue.suggestion && (
                                                <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                                                    <p className="text-xs text-blue-400 mb-1">建议:</p>
                                                    <p className="text-blue-300">{issue.suggestion}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

export default ResultChecker

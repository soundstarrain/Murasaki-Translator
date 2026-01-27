/**
 * ProofreadView - 校对界面 (Redesigned)
 * 采用双栏联动布局 (Split View) + 内联编辑 (In-Place Edit)
 */

import { useState, useRef, useEffect } from 'react'
import { Button } from './ui/core'
import {
    FolderOpen,
    RefreshCw,
    Save,
    Download,
    Search,
    Filter,
    Check,
    Book,
    AlertTriangle,
    X,
    ChevronLeft,
    ChevronRight,
    ArrowRight,
    ChevronUp,
    ChevronDown,
    Regex,
    Replace,
    ReplaceAll,
    FileCheck,
    FileText,
    History,

} from 'lucide-react'
import { translations, defaultLang, Language } from '../lib/i18n'

// 缓存 Block 类型
interface CacheBlock {
    index: number
    src: string
    dst: string
    status: 'none' | 'processed' | 'edited'
    warnings: string[]
    cot: string
    srcLines: number
    dstLines: number
}

// 缓存文件类型
interface CacheData {
    version: string
    outputPath: string
    modelName: string
    glossaryPath: string
    stats: {
        blockCount: number
        srcLines: number
        dstLines: number
        srcChars: number
        dstChars: number
    }
    blocks: CacheBlock[]
}

interface ProofreadViewProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t: any
}

import { ResultChecker } from './ResultChecker'
import { findHighSimilarityLines } from '../lib/quality-check'

// ...

export default function ProofreadView({ }: ProofreadViewProps) {
    const language = (localStorage.getItem('language') as Language) || defaultLang
    const t = translations[language]

    // 状态
    const [cacheData, setCacheData] = useState<CacheData | null>(null)
    const [cachePath, setCachePath] = useState<string>('')
    const [loading, setLoading] = useState(false)

    // Quality Check Panel
    const [showQualityCheck, setShowQualityCheck] = useState(false)
    const [glossary, setGlossary] = useState<Record<string, string>>({})

    // 编辑状态
    const [editingBlockId, setEditingBlockId] = useState<number | null>(null)
    const [editingText, setEditingText] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // 搜索与过滤
    const [searchKeyword, setSearchKeyword] = useState('')
    const [filterWarnings, setFilterWarnings] = useState(false)

    const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)
    const [matchList, setMatchList] = useState<{ blockIndex: number, type: 'src' | 'dst' }[]>([])

    // Advanced Search & Replace
    const [isRegex, setIsRegex] = useState(false)
    const [showReplace, setShowReplace] = useState(false)
    const [replaceText, setReplaceText] = useState('')

    // History & Folder Browser
    const [showHistoryModal, setShowHistoryModal] = useState(false)


    // Initial Load
    useEffect(() => {
        // Any other initial load logic if needed
    }, [])

    // Search Effect
    useEffect(() => {
        if (!searchKeyword || !cacheData) {
            setMatchList([])
            setCurrentMatchIndex(-1)
            return
        }
        const matches: { blockIndex: number, type: 'src' | 'dst' }[] = []

        try {
            const flags = isRegex ? 'gi' : 'i'
            // Escape special chars if not regex mode
            const pattern = isRegex ? searchKeyword : searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(pattern, flags)

            cacheData.blocks.forEach(block => {
                // Determine if match exists using regex
                if (regex.test(block.src)) {
                    matches.push({ blockIndex: block.index, type: 'src' })
                    // Reset regex cursor
                    regex.lastIndex = 0
                }
                if (regex.test(block.dst)) {
                    matches.push({ blockIndex: block.index, type: 'dst' })
                    regex.lastIndex = 0
                }
            })
        } catch (e) {
            // Invalid regex, ignore
        }

        setMatchList(matches)
        if (matches.length > 0) {
            setCurrentMatchIndex(0)
            scrollToBlock(matches[0].blockIndex)
        } else {
            setCurrentMatchIndex(-1)
        }
    }, [searchKeyword, cacheData, isRegex])

    const scrollToBlock = (index: number) => {
        const el = document.getElementById(`block-${index}`)
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Ensure we are on the right page if specific pagination logic exists (currently assumed flat or auto-handled by scroll if elements exist)
            // But wait, we have pagination! We need to switch page.
            const page = Math.floor(index / pageSize) + 1
            if (page !== currentPage) setCurrentPage(page)
            // Need to wait for render if page changed...
            setTimeout(() => {
                const elRetry = document.getElementById(`block-${index}`)
                elRetry?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 100)
        } else {
            // Probably on another page
            const page = Math.floor(index / pageSize) + 1
            if (page !== currentPage) {
                setCurrentPage(page)
                setTimeout(() => {
                    const elRetry = document.getElementById(`block-${index}`)
                    elRetry?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 100)
            }
        }
    }

    const nextMatch = () => {
        if (matchList.length === 0) return
        const next = (currentMatchIndex + 1) % matchList.length
        setCurrentMatchIndex(next)
        scrollToBlock(matchList[next].blockIndex)
    }

    const prevMatch = () => {
        if (matchList.length === 0) return
        const prev = (currentMatchIndex - 1 + matchList.length) % matchList.length
        setCurrentMatchIndex(prev)
        scrollToBlock(matchList[prev].blockIndex)
    }

    // 分页
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 20

    // Shared logic to process loaded cache data and glossary
    const processLoadedData = async (data: any, path: string) => {
        // Clean tags from DST text immediately on load, but preserve them in warnings array
        if (data.blocks && Array.isArray(data.blocks)) {
            data.blocks = data.blocks.map((b: any) => {
                const dst = b.dst || ''
                const warnings = b.warnings || []

                // Extract tags to warnings array if not present
                const tags = ['line_mismatch', 'high_similarity', 'kana_residue', 'glossary_missed', 'hangeul_residue']
                tags.forEach(tag => {
                    if (dst.includes(tag) && !warnings.includes(tag)) {
                        warnings.push(tag)
                    }
                })

                // Strip tags
                const cleanDst = dst.replace(/(\s*)[(\[]?\b(line_mismatch|high_similarity|kana_residue|glossary_missed|hangeul_residue)\b[)\]]?(\s*)/g, '')

                return { ...b, dst: cleanDst, warnings }
            })
        }

        setCacheData(data)
        setCachePath(path)
        setCurrentPage(1)
        setEditingBlockId(null)

        if (data.glossaryPath) {
            try {
                console.log('Loading glossary from:', data.glossaryPath)
                let glossaryContent = await window.api?.readFile(data.glossaryPath)
                if (glossaryContent) {
                    // Strip BOM if present
                    glossaryContent = glossaryContent.replace(/^\uFEFF/, '')

                    let parsed: Record<string, string> = {}

                    try {
                        // Try JSON
                        const jsonRaw = JSON.parse(glossaryContent)
                        if (Array.isArray(jsonRaw)) {
                            // Handle List format [{"src": "key", "dst": "val"}]
                            jsonRaw.forEach(item => {
                                if (item.src && item.dst) parsed[item.src] = item.dst
                            })
                        } else if (typeof jsonRaw === 'object') {
                            // Handle Dict format
                            parsed = jsonRaw
                        }
                    } catch (e) {
                        console.warn('JSON parse failed, trying TXT format', e)
                        // Try TXT format (key=val or key:val)
                        const lines = glossaryContent.split('\n')
                        lines.forEach(line => {
                            line = line.trim()
                            if (!line || line.startsWith('#') || line.startsWith('//') || line === '{' || line === '}') return

                            let k = '', v = ''
                            // Remove trailing commas for JSON-like lines
                            if (line.endsWith(',')) line = line.slice(0, -1)

                            if (line.includes('=')) {
                                [k, v] = line.split('=', 2)
                            } else if (line.includes(':')) {
                                [k, v] = line.split(':', 2)
                            }

                            if (k && v) {
                                // Clean quotes if per-line parsing found them (e.g. "key": "val")
                                k = k.trim().replace(/^["']|["']$/g, '')
                                v = v.trim().replace(/^["']|["']$/g, '')
                                if (k && v) parsed[k] = v
                            }
                        })
                    }

                    const count = Object.keys(parsed).length
                    console.log(`Loaded ${count} glossary entries`)
                    setGlossary(parsed)
                }
            } catch (e) {
                console.warn('Failed to load glossary:', e)
                setGlossary({})
            }
        } else {
            console.log('No glossary path in cache data')
            setGlossary({})
        }
    }

    // Load Cache (File Dialog)
    const loadCache = async () => {
        try {
            const defaultPath = localStorage.getItem("config_cache_dir") || undefined
            const result = await window.api?.selectFile({
                title: '选择翻译缓存文件',
                defaultPath: defaultPath,
                filters: [{ name: 'Cache Files', extensions: ['cache.json'] }]
            } as any)
            if (result) {
                setLoading(true)
                const data = await window.api?.loadCache(result)
                if (data) {
                    await processLoadedData(data, result)
                }
                setLoading(false)
            }
        } catch (error) {
            console.error('Failed to load cache:', error)
            setLoading(false)
        }
    }

    // Save Cache
    const saveCache = async () => {
        if (!cacheData || !cachePath) return
        try {
            setLoading(true)
            await window.api?.saveCache(cachePath, cacheData)
            setLoading(false)
        } catch (error) {
            console.error('Failed to save cache:', error)
            setLoading(false)
        }
    }

    // Helper: Normalize to Light Novel Spacing (Double Newline)
    const normalizeLN = (text: string) => {
        if (!text) return ''
        return text.split(/\r?\n/).filter(l => l.trim()).join('\n\n')
    }

    // Export
    const exportTranslation = async () => {
        if (!cacheData) return
        try {
            const result = await window.api?.saveFile({
                title: '导出译文',
                defaultPath: cacheData.outputPath,
                filters: [{ name: 'Text Files', extensions: ['txt'] }]
            })
            if (result) {
                const text = cacheData.blocks
                    .sort((a, b) => a.index - b.index)
                    .map(b => normalizeLN(b.dst)) // Enforce formatting on export
                    .join('\n\n')
                await window.api?.writeFile(result, text)
            }
        } catch (error) {
            console.error('Failed to export:', error)
        }
    }

    // Update Block
    const updateBlockDst = (index: number, newDst: string) => {
        if (!cacheData) return
        const newBlocks = cacheData.blocks.map(b =>
            b.index === index ? { ...b, dst: newDst, status: 'edited' as const } : b
        )
        setCacheData({ ...cacheData, blocks: newBlocks })
    }

    // Retranslate
    const retranslateBlock = async (index: number) => {
        if (!cacheData) return
        const block = cacheData.blocks.find(b => b.index === index)
        if (!block) return

        const modelPath = localStorage.getItem("config_model")
        if (!modelPath) {
            alert('请先在模型管理页面选择一个模型！')
            return
        }

        try {
            setLoading(true)
            const config = {
                gpuLayers: localStorage.getItem("config_gpu"),
                ctxSize: localStorage.getItem("config_ctx") || "4096",
                preset: localStorage.getItem("config_preset") || "training",
                temperature: parseFloat(localStorage.getItem("config_temperature") || "0.7"),
                textProtect: localStorage.getItem("config_text_protect") === "true",
                glossaryPath: localStorage.getItem("config_glossary_path"),
                deviceMode: localStorage.getItem("config_device_mode") || "auto",
                rulesPre: JSON.parse(localStorage.getItem("config_rules_pre") || "[]"),
                rulesPost: JSON.parse(localStorage.getItem("config_rules_post") || "[]"),
                strictMode: localStorage.getItem("config_strict_mode") || "subs",
            }

            const result = await window.api?.retranslateBlock({
                src: block.src,
                index: block.index,
                modelPath: modelPath,
                config: config
            })

            if (result?.success) {
                updateBlockDst(index, result.dst)
            } else {
                alert(`重翻失败: ${result?.error || 'Unknown error'}`)
            }
        } catch (error) {
            console.error('Failed to retranslate:', error)
            alert(`重翻错误: ${error}`)
        } finally {
            setLoading(false)
        }
    }

    // --- Replace Logic ---

    // Replace One: Replace the FIRST occurrence in the CURRENT focused match (if it is a DST match)
    const replaceOne = () => {
        if (!cacheData || currentMatchIndex === -1 || matchList.length === 0 || !replaceText) return

        const match = matchList[currentMatchIndex]
        if (match.type !== 'dst') {
            // Skip if match is in source (read-only)
            nextMatch()
            return
        }

        const block = cacheData.blocks.find(b => b.index === match.blockIndex)
        if (!block) return

        try {
            const flags = isRegex ? 'gi' : 'i'
            const pattern = isRegex ? searchKeyword : searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

            // We need to replace only ONE instance in this block? 
            // Or if the block has multiple matches, which one?
            // Simplifying: Replace ALL occurrences in THIS block first, or just the first one?
            // "Replace" button usually replaces the *currently highlighted* match. 
            // Since our highlighting is visual and our search is regex global, locating the specific instance index is hard.
            // Compromise: Replace the First Match in the block string that matches.
            // Limitation: If multiple matches exist in one block, this strategy might replace the wrong one if not careful.
            // But for now, let's just use string.replace (which replaces first occurrence only if global flag not set, 
            // but we usually use global for highlight).

            // Let's use a non-global regex to replace just the first occurrence
            const singleRegex = new RegExp(pattern, flags.replace('g', ''))
            const newDst = block.dst.replace(singleRegex, replaceText)

            if (newDst !== block.dst) {
                updateBlockDst(block.index, newDst)
                // Move to next match after replace
                // Note: The match list will update via useEffect, potentially resetting index. 
                // We might lose position, but that's acceptable for v1.
            } else {
                nextMatch()
            }
        } catch (e) {
            console.error(e)
        }
    }

    // Replace All: Replace ALL occurrences in ALL DST blocks
    const replaceAll = () => {
        if (!cacheData || !searchKeyword) return
        if (!confirm(`${t.config.proofread.replace} ${matchList.filter(m => m.type === 'dst').length}?`)) return

        try {
            const flags = isRegex ? 'gi' : 'i'
            const pattern = isRegex ? searchKeyword : searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(pattern, flags)

            let replaceCount = 0
            const newBlocks = cacheData.blocks.map(block => {
                if (!regex.test(block.dst)) return block

                // Count matches for stats
                const matches = block.dst.match(regex)
                if (matches) replaceCount += matches.length

                const newDst = block.dst.replace(regex, replaceText)
                return { ...block, dst: newDst, status: 'edited' as const }
            })

            setCacheData({ ...cacheData, blocks: newBlocks })
            alert(t.config.proofread.replaced.replace('{count}', replaceCount.toString()))

        } catch (e) {
            console.error(e)
        }
    }

    // --- In-Place Edit Handlers ---

    const startEdit = (block: CacheBlock) => {
        setEditingBlockId(block.index)
        // Normalize text to Light Novel style for editing (Visual \n\n)
        setEditingText(normalizeLN(block.dst))
        // Auto-focus logic in useEffect below
    }

    const saveEdit = (index: number) => {
        // Enforce formatting on save
        updateBlockDst(index, normalizeLN(editingText))
        setEditingBlockId(null)
    }

    const cancelEdit = () => {
        setEditingBlockId(null)
    }

    // Auto-focus and resize textarea
    useEffect(() => {
        if (editingBlockId !== null && textareaRef.current) {
            textareaRef.current.focus()
            // Auto resize height
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
        }
    }, [editingBlockId])

    // --- Filtering & Pagination ---

    const filteredBlocks = cacheData?.blocks.filter(block => {
        if (searchKeyword) {
            const kw = searchKeyword.toLowerCase()
            if (!block.src.toLowerCase().includes(kw) &&
                !block.dst.toLowerCase().includes(kw)) {
                return false
            }
        }
        if (filterWarnings && block.warnings.length === 0) return false
        return true
    }) || []

    const totalPages = Math.ceil(filteredBlocks.length / pageSize)
    const paginatedBlocks = filteredBlocks.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    )

    // --- Helper UI ---

    // Status Indicator
    const StatusIndicator = ({ block }: { block: CacheBlock }) => {
        if (block.warnings.length > 0) return <div title={block.warnings.join('\n')}><AlertTriangle className="w-4 h-4 text-amber-500" /></div>
        if (block.status === 'edited') return <div className="w-2 h-2 rounded-full bg-blue-500" title="Edited" />
        if (block.status === 'processed') return <div title="Processed"><Check className="w-3 h-3 text-green-500/50" /></div>
        return null
    }

    // Get ALL cache files from translation history
    const getAllHistoryFiles = (): { path: string; name: string; date: string; inputPath?: string; model?: string }[] => {
        try {
            const historyStr = localStorage.getItem('translation_history')
            if (!historyStr) return []
            const history = JSON.parse(historyStr) as any[]
            const seen = new Set<string>()
            return history
                .reverse() // Show newest first
                .map(h => {
                    // Try to derive cache path
                    // Priority: Explicit cachePath > Output Path + .cache.json > Input Path + .cache.json
                    let cachePath = h.cachePath
                    if (!cachePath && h.outputPath) {
                        cachePath = h.outputPath + ".cache.json"
                    }
                    if (!cachePath && h.filePath) {
                        cachePath = h.filePath + ".cache.json"
                    }
                    return { ...h, cachePath }
                })
                .filter(h => h.cachePath && !seen.has(h.cachePath) && (seen.add(h.cachePath), true))
                .map(h => ({
                    path: h.cachePath!,
                    name: h.fileName || (h.cachePath!.split(/[/\\]/).pop() || h.cachePath!),
                    date: h.startTime ? new Date(h.startTime).toLocaleString() : (h.timestamp ? new Date(h.timestamp).toLocaleString() : ''),
                    inputPath: h.filePath || h.inputPath,
                    model: h.modelName || h.model
                }))
        } catch {
            return []
        }
    }

    // Get recent 5 for quick access
    const getRecentCacheFiles = () => getAllHistoryFiles().slice(0, 5)



    const recentFiles = getRecentCacheFiles()

    // Load specific cache file
    const loadCacheFromPath = async (path: string) => {
        setLoading(true)
        try {
            // @ts-ignore
            const data = await window.api.loadCache(path)
            if (data) {
                await processLoadedData(data, path)
            }
        } catch (e) {
            console.error('Failed to load cache:', e)
        } finally {
            setLoading(false)
        }
    }

    // If no data
    if (!cacheData) {
        const allHistory = getAllHistoryFiles()

        return (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-muted-foreground select-none">
                <div className="p-8 rounded-full bg-muted/30">
                    <FolderOpen className="w-12 h-12 opacity-50" />
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-xl font-semibold text-foreground">{t.config.proofread.title}</h2>
                    <p>{t.config.proofread.desc}</p>
                </div>

                {/* Main Actions */}
                <div className="flex items-center gap-3">
                    <Button onClick={loadCache} size="lg" className="gap-2">
                        <FolderOpen className="w-5 h-5" />
                        {t.config.proofread.open}
                    </Button>

                    {allHistory.length > 0 && (
                        <Button onClick={() => setShowHistoryModal(true)} variant="outline" size="lg" className="gap-2">
                            <History className="w-5 h-5" />
                            翻译历史 ({allHistory.length})
                        </Button>
                    )}
                </div>

                {/* Recent Files (Quick Access) */}
                {recentFiles.length > 0 && (
                    <div className="mt-4 w-full max-w-md">
                        <p className="text-xs text-muted-foreground/70 mb-2 text-center">{t.config.proofread.recentFiles}</p>
                        <div className="border rounded-lg divide-y bg-card/50">
                            {recentFiles.map((file, i) => (
                                <button
                                    key={i}
                                    onClick={() => loadCacheFromPath(file.path)}
                                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                                    disabled={loading}
                                >
                                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                                        <p className="text-[10px] text-muted-foreground truncate">{file.path}</p>
                                    </div>
                                    {file.date && <span className="text-[10px] text-muted-foreground/60 shrink-0">{file.date}</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-col items-center gap-1 mt-2 text-xs text-muted-foreground/60">
                    <span>{t.config.proofread.defaultKey}: {localStorage.getItem("config_cache_dir") || t.config.proofread.unset}</span>
                </div>

                {/* History Modal */}
                {showHistoryModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHistoryModal(false)}>
                        <div className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
                            <div className="px-6 py-4 border-b flex items-center justify-between">
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <History className="w-5 h-5 text-primary" />
                                    翻译历史
                                </h3>
                                <button onClick={() => setShowHistoryModal(false)} className="p-1.5 hover:bg-muted rounded-md">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto divide-y">
                                {allHistory.map((file, i) => (
                                    <button
                                        key={i}
                                        onClick={() => { loadCacheFromPath(file.path); setShowHistoryModal(false); }}
                                        className="w-full px-6 py-3 flex items-center gap-4 hover:bg-muted/50 transition-colors text-left"
                                    >
                                        <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                                            <p className="text-xs text-muted-foreground truncate">{file.inputPath || file.path}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            {file.date && <p className="text-xs text-muted-foreground">{file.date}</p>}
                                            {file.model && <p className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">{file.model}</p>}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}


            </div>
        )
    }

    // Helper to highlight text with search and line warnings
    const HighlightText = ({ text, keyword, warningLines, isDoubleSpace = true }: { text: string, keyword: string, warningLines?: Set<number>, isDoubleSpace?: boolean }) => {
        if (!text) return null

        const lines = text.split(/\r?\n/)

        return (
            <div className="flex flex-col w-full">
                {lines.map((line, idx) => {
                    // Check if this line is in warnings (1-based index in set)
                    const isWarning = warningLines?.has(idx + 1)
                    const isEmpty = !line.trim()

                    // Search highlight logic
                    const renderContent = () => {
                        if (!keyword || !line) return line || <br />
                        try {
                            const flags = isRegex ? 'gi' : 'i'
                            const pattern = isRegex ? keyword : keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                            const regex = new RegExp(`(${pattern})`, flags)
                            const parts = line.split(regex)
                            return (
                                <>
                                    {parts.map((part, i) => regex.test(part) ? <span key={i} className="bg-yellow-300 text-black rounded px-0.5">{part}</span> : part)}
                                </>
                            )
                        } catch { return line }
                    }

                    // Strict Light Novel Spacing:
                    // 1. Hide original empty lines (normalize format)
                    // 2. Add fixed spacing below text lines

                    if (isDoubleSpace && isEmpty) {
                        return <div key={idx} className="hidden" />
                    }

                    return (
                        <div
                            key={idx}
                            className={`
                                w-full break-words whitespace-pre-wrap min-h-[1.5em]
                                ${isWarning ? 'bg-amber-500/20 -mx-2 px-2 rounded' : ''}
                                ${isDoubleSpace ? 'mb-6' : ''}
                            `}
                        >
                            {renderContent()}
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="flex h-full bg-background">
            {/* Main Content Column */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* --- Toolbar --- */}
                <div className="px-4 py-2 border-b flex items-center gap-3 bg-card shrink-0">
                    {/* File Info */}
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="flex flex-col">
                            <span className="text-sm font-medium truncate max-w-[180px]" title={cachePath}>
                                {cachePath.split(/[/\\]/).pop()}
                            </span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-2">
                                <span>{cacheData.stats.blockCount} 块</span>
                                <span>{cacheData.stats.srcLines} 行</span>
                                {Object.keys(glossary).length > 0 ? (
                                    <span className="flex items-center gap-1 text-primary/80" title="已加载术语表">
                                        <Book className="w-3 h-3" /> {Object.keys(glossary).length}
                                    </span>
                                ) : (
                                    cacheData.glossaryPath && (
                                        <span className="flex items-center gap-1 text-amber-500" title="术语表未加载或为空">
                                            <AlertTriangle className="w-3 h-3" /> 0
                                        </span>
                                    )
                                )}
                            </span>
                        </div>
                    </div>

                    <div className="w-px h-6 bg-border" />

                    {/* Search Bar - Compact */}
                    <div className="flex items-center gap-1.5 flex-1 max-w-md">
                        <div className="relative flex-1">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="搜索..."
                                className="w-full pl-7 pr-3 py-1 text-sm bg-secondary/50 border rounded focus:bg-background transition-colors outline-none font-mono"
                                value={searchKeyword}
                                onChange={e => setSearchKeyword(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        if (e.shiftKey) prevMatch()
                                        else nextMatch()
                                    }
                                }}
                            />
                        </div>
                        {/* Search controls */}
                        {searchKeyword && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                                <span className="tabular-nums">{matchList.length > 0 ? currentMatchIndex + 1 : 0}/{matchList.length}</span>
                                <button onClick={prevMatch} className="p-0.5 hover:bg-secondary rounded" title="上一个">
                                    <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={nextMatch} className="p-0.5 hover:bg-secondary rounded" title="下一个">
                                    <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                        {/* Toggles */}
                        <button
                            onClick={() => setIsRegex(!isRegex)}
                            className={`p-1 rounded text-xs ${isRegex ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                            title="正则模式"
                        >
                            <Regex className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setShowReplace(!showReplace)}
                            className={`p-1 rounded text-xs ${showReplace ? 'bg-secondary' : 'text-muted-foreground hover:bg-muted'}`}
                            title="替换"
                        >
                            <Replace className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => { setFilterWarnings(!filterWarnings); setCurrentPage(1) }}
                            className={`p-1 rounded text-xs ${filterWarnings ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' : 'text-muted-foreground hover:bg-muted'}`}
                            title="只显示警告"
                        >
                            <Filter className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Right Actions */}
                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                        {/* Quality Check - Text Button */}
                        <Button
                            variant={showQualityCheck ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setShowQualityCheck(!showQualityCheck)}
                            className={`h-7 text-xs ${showQualityCheck ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : ''}`}
                        >
                            <FileCheck className="w-3.5 h-3.5 mr-1" />
                            {t.config.proofread.qualityCheck}
                        </Button>

                        <div className="w-px h-4 bg-border" />

                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadCache}>
                            <FolderOpen className="w-3.5 h-3.5 mr-1" /> {t.config.proofread.openBtn}
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={saveCache} disabled={loading}>
                            <Save className="w-3.5 h-3.5 mr-1" /> {t.config.proofread.saveBtn}
                        </Button>
                        <Button variant="default" size="sm" className="h-7 text-xs" onClick={exportTranslation} disabled={loading}>
                            <Download className="w-3.5 h-3.5 mr-1" /> {t.config.proofread.exportBtn}
                        </Button>
                    </div>
                </div>

                {/* --- Replace Bar (Optional) --- */}
                {showReplace && (
                    <div className="px-6 py-2 border-b bg-muted/30 flex items-center justify-center gap-4 animate-in slide-in-from-top-1 fade-in duration-200">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">{t.config.proofread.replace}</span>
                            <div className="relative">
                                <input
                                    type="text"
                                    className="w-64 px-3 py-1.5 text-sm bg-background border rounded-md outline-none focus:ring-1 focus:ring-primary"
                                    placeholder={t.config.proofread.replacePlaceholder}
                                    value={replaceText}
                                    onChange={e => setReplaceText(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={replaceOne} disabled={!searchKeyword || matchList.length === 0}>
                                <Replace className="w-3.5 h-3.5 mr-1" />
                                {t.config.proofread.replace}
                            </Button>
                            <Button size="sm" variant="outline" onClick={replaceAll} disabled={!searchKeyword || matchList.length === 0}>
                                <ReplaceAll className="w-3.5 h-3.5 mr-1" />
                                {t.config.proofread.replaceAll}
                            </Button>
                        </div>
                    </div>
                )}

                {/* --- Main Content: Grid Layout --- */}
                <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border">
                    {/* Header Row */}
                    <div className="sticky top-0 z-20 grid grid-cols-[1fr_40px_1fr] bg-muted/80 backdrop-blur border-b text-xs font-medium text-muted-foreground">
                        <div className="px-6 py-2">原文 (Source)</div>
                        <div className="flex items-center justify-center border-l border-r border-border/50">#</div>
                        <div className="px-6 py-2">译文 (Translation)</div>
                    </div>

                    {/* Blocks */}
                    <div className="divide-y divide-border/30">
                        {paginatedBlocks.map(block => {
                            // Calculate similarity lines for this block
                            const simLines = findHighSimilarityLines(block.src, block.dst)
                            const simSet = new Set(simLines)

                            return (
                                <div
                                    key={block.index}
                                    id={`block-${block.index}`}
                                    className={`group grid grid-cols-[1fr_40px_1fr] min-h-[80px] hover:bg-muted/30 transition-colors ${editingBlockId === block.index ? 'bg-muted/30' : ''}`}
                                >
                                    {/* Left: Source */}
                                    <div className="p-6 text-sm leading-relaxed whitespace-pre-wrap font-sans text-foreground/80 select-text">
                                        <HighlightText text={block.src} keyword={searchKeyword} warningLines={simSet} />
                                    </div>

                                    {/* Middle: Gutter */}
                                    <div className="flex flex-col items-center py-6 border-l border-r border-border/30 bg-muted/5 gap-2 select-none group-hover:bg-muted/10 transition-colors">
                                        <span className="text-xs font-mono text-muted-foreground/50">{block.index + 1}</span>
                                        <StatusIndicator block={block} />

                                        {/* Hover Actions */}
                                        <div className="mt-auto flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => retranslateBlock(block.index)}
                                                className="p-1 hover:text-blue-500 transition-colors"
                                                title="重新翻译此块"
                                                disabled={loading}
                                            >
                                                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Right: Translation */}
                                    <div className="relative p-6 text-sm leading-relaxed">
                                        {editingBlockId === block.index ? (
                                            <div className="relative">
                                                <textarea
                                                    ref={textareaRef}
                                                    className="w-full bg-background border rounded-md p-6 text-sm leading-relaxed outline-none ring-2 ring-primary/20 resize-none font-sans"
                                                    value={editingText}
                                                    onChange={e => {
                                                        setEditingText(e.target.value)
                                                        e.target.style.height = 'auto'
                                                        e.target.style.height = e.target.scrollHeight + 'px'
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                                            saveEdit(block.index)
                                                        }
                                                        if (e.key === 'Escape') {
                                                            cancelEdit()
                                                        }
                                                    }}
                                                />
                                                <div className="flex items-center justify-end gap-2 mt-2">
                                                    <span className="text-xs text-muted-foreground hidden sm:inline-block">Ctrl+Enter to save</span>
                                                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={cancelEdit}><X className="w-3 h-3" /></Button>
                                                    <Button size="sm" className="h-7 px-3" onClick={() => saveEdit(block.index)}><ArrowRight className="w-3 h-3 mr-1" /> Save</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div
                                                onClick={() => startEdit(block)}
                                                className="cursor-text min-h-[1.5em] outline-none rounded-sm -m-1 p-1 hover:ring-1 hover:ring-border transition-all"
                                                title="点击编辑"
                                            >
                                                <HighlightText text={block.dst} keyword={searchKeyword} warningLines={simSet} />
                                            </div>
                                        )}
                                        {/* Warns overlay removed to prevent duplication */}
                                        {null}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* --- Pagination Footer --- */}
                    {totalPages > 1 && (
                        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t p-2 flex items-center justify-center gap-4 z-20">
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => p - 1)}
                            >
                                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                            </Button>
                            <span className="text-sm font-medium text-muted-foreground">
                                Page {currentPage} of {totalPages}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(p => p + 1)}
                            >
                                Next <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* --- Quality Check Side Panel --- */}
            {showQualityCheck && cacheData && (
                <div className="w-[400px] shrink-0 border-l bg-background flex flex-col animate-in slide-in-from-right-2 duration-200">
                    <div className="p-3 border-b flex items-center justify-between bg-muted/30">
                        <h3 className="text-sm font-medium flex items-center gap-2">
                            <FileCheck className="w-4 h-4 text-amber-500" />
                            {t.config.proofread.qualityCheck}
                        </h3>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setShowQualityCheck(false)}
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <ResultChecker
                            lang={language}
                            cacheData={cacheData}
                            glossary={glossary}
                            onNavigateToBlock={(blockIndex) => {
                                // Navigate to block in main view
                                const page = Math.floor(blockIndex / pageSize) + 1
                                if (page !== currentPage) setCurrentPage(page)
                                setTimeout(() => {
                                    const el = document.getElementById(`block-${blockIndex}`)
                                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                }, 100)
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}

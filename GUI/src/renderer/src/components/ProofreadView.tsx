/**
 * ProofreadView - 校对界面 (Redesigned)
 * 采用双栏联动布局 (Split View) + 内联编辑 (In-Place Edit)
 */

import React, { useState, useRef, useEffect } from 'react'
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
    ChevronUp,
    ChevronDown,
    Regex,
    Replace,
    AlignJustify,
    ReplaceAll,
    FileCheck,
    FileText,
    History,
    Terminal,
    Clock,

} from 'lucide-react'
import { Language } from '../lib/i18n'

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
    lang: Language
    onUnsavedChangesChange?: (hasChanges: boolean) => void
}

import { ResultChecker } from './ResultChecker'
import { findHighSimilarityLines } from '../lib/quality-check'
import { AlertModal } from './ui/AlertModal'
import { useAlertModal } from '../hooks/useAlertModal'

// ...

export default function ProofreadView({ t, lang, onUnsavedChangesChange }: ProofreadViewProps) {

    const { alertProps, showAlert, showConfirm } = useAlertModal()

    // 状态
    const [cacheData, setCacheData] = useState<CacheData | null>(null)
    const [cachePath, setCachePath] = useState<string>('')
    const [loading, setLoading] = useState(false)

    // Log viewing state
    const [blockLogs, setBlockLogs] = useState<Record<number, string[]>>({})
    const [showLogModal, setShowLogModal] = useState<number | null>(null)
    const logScrollRef = useRef<HTMLDivElement>(null)

    // Quality Check Panel
    const [showQualityCheck, setShowQualityCheck] = useState(false)
    const [glossary, setGlossary] = useState<Record<string, string>>({})

    // 编辑状态
    const [editingBlockId, setEditingBlockId] = useState<number | null>(null)
    const [editingText, setEditingText] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [retranslatingBlocks, setRetranslatingBlocks] = useState<Set<number>>(new Set())

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

    // Line Mode - strict line-by-line alignment with line numbers
    const [lineMode, setLineMode] = useState(true) // Default to line mode
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

    // Sync with parent for navigation guard
    useEffect(() => {
        // Intercept navigation if active tasks (loading/retranslating) are running, or if there are unsaved changes
        const isBusy = hasUnsavedChanges || loading || retranslatingBlocks.size > 0
        onUnsavedChangesChange?.(isBusy)
    }, [hasUnsavedChanges, loading, retranslatingBlocks.size, onUnsavedChangesChange])


    // Initial Load - Setup Listeners
    useEffect(() => {
        const handler = (data: { index: number, text: string, isError?: boolean }) => {
            setBlockLogs(prev => ({
                ...prev,
                [data.index]: [...(prev[data.index] || []), data.text]
            }))
        }

        window.api?.onRetranslateLog(handler)
        return () => {
            window.api?.removeRetranslateLogListener()
        }
    }, [])

    // Auto-scroll log modal
    useEffect(() => {
        if (showLogModal !== null && logScrollRef.current) {
            logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
        }
    }, [blockLogs, showLogModal])

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
        // Clean tags and normalize indices to prevent duplicate key warnings
        if (data.blocks && Array.isArray(data.blocks)) {
            data.blocks = data.blocks.map((b: any, i: number) => {
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

                // Force sequential unique index if duplicate detected or missing
                const index = (typeof b.index === 'number') ? b.index : i

                return { ...b, index, dst: cleanDst, warnings }
            })

            // Additional safety: If we still have potential duplicates in the source, force them to be unique based on array position
            // This is the strongest protection against the "duplicate key 1" warning
            const seenIndices = new Set()
            data.blocks.forEach((b: any, i: number) => {
                if (seenIndices.has(b.index)) {
                    console.warn(`[Proofread] Duplicate index detected: ${b.index}. Reassigning to ${i}`)
                    b.index = i
                }
                seenIndices.add(b.index)
            })
        }

        setCacheData(data)
        setCachePath(path)
        setHasUnsavedChanges(false) // Reset on load
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
        const executeLoad = async () => {
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

        if (hasUnsavedChanges) {
            showConfirm({
                title: t.config.proofread.unsavedChanges.split('，')[0],
                description: t.config.proofread.unsavedChanges,
                onConfirm: executeLoad
            })
        } else {
            executeLoad()
        }
    }

    // Save Cache
    const saveCache = async () => {
        if (!cacheData || !cachePath) return
        try {
            setLoading(true)
            // 1. Save JSON Cache
            const cacheOk = await window.api?.saveCache(cachePath, cacheData)
            if (!cacheOk) throw new Error('Failed to save cache JSON')

            // 2. Sync to Translated File (EPUB/TXT/SRT/ASS)
            if (cacheData.outputPath) {
                const ext = cacheData.outputPath.split('.').pop()?.toLowerCase();

                // For complex formats, trigger Python rebuild
                if (['epub', 'srt', 'ass', 'ssa'].includes(ext || '')) {
                    const rebuildResult = await window.api?.rebuildDoc({ cachePath })
                    if (!rebuildResult?.success) {
                        throw new Error(`文档重建失败: ${rebuildResult?.error || '模型后端未正常返回结果'}`)
                    }
                } else if (ext === 'txt') {
                    // Direct write for TXT (matching Murasaki \n\n rule)
                    const content = cacheData.blocks
                        .sort((a, b) => a.index - b.index)
                        .map(b => b.dst.trim())
                        .join('\n\n') + '\n'
                    await window.api?.writeFile(cacheData.outputPath, content)
                }
            }

            setHasUnsavedChanges(false) // Reset on save
            setLoading(false)
            showAlert({
                title: '保存成功',
                description: '翻译缓存与输出文件已同步。',
                variant: 'success'
            })
        } catch (error) {
            console.error('Failed to save cache:', error)
            setLoading(false)
            showAlert({
                title: '保存失败',
                description: String(error),
                variant: 'destructive'
            })
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
        const newBlocks = [...cacheData.blocks]
        const blockIndex = newBlocks.findIndex(b => b.index === index)
        if (blockIndex !== -1) {
            // Also strip tags if model re-inserted them
            const cleanDst = newDst.replace(/(\s*)[(\[]?\b(line_mismatch|high_similarity|kana_residue|glossary_missed|hangeul_residue)\b[)\]]?(\s*)/g, '')

            newBlocks[blockIndex] = {
                ...newBlocks[blockIndex],
                dst: cleanDst,
                status: 'edited'
            }
            const newData = { ...cacheData, blocks: newBlocks }
            setCacheData(newData)
            setHasUnsavedChanges(true)
            // onUnsavedChangesChange?.(true) // This line was not in the original context, so I'm not adding it.
        }
    }

    // Retranslate
    const retranslateBlock = async (index: number) => {
        if (!cacheData) return
        const block = cacheData.blocks.find(b => b.index === index)
        if (!block) return

        // Global Lock: Enforce single-threading for manual re-translation
        if (retranslatingBlocks.size > 0 || loading) {
            showAlert({
                title: '请等待',
                description: '当前有正在进行的重翻或保存任务，请等待其完成。',
                variant: 'destructive'
            })
            return
        }

        const modelPath = localStorage.getItem("config_model")
        if (!modelPath) {
            showAlert({
                title: t.advancedFeatures,
                description: '请先在模型管理页面选择一个模型！',
                variant: 'destructive'
            })
            return
        }

        try {
            setLoading(true)
            setRetranslatingBlocks(prev => new Set(prev).add(index))
            // Clear previous logs for this block on start
            setBlockLogs(prev => ({ ...prev, [index]: [] }))

            const config = {
                gpuLayers: parseInt(localStorage.getItem("config_gpu") || "-1", 10) || -1,
                ctxSize: localStorage.getItem("config_ctx") || "4096",
                preset: localStorage.getItem("config_preset") || "novel",
                temperature: parseFloat(localStorage.getItem("config_temperature") || "0.7"),
                repPenaltyBase: parseFloat(localStorage.getItem("config_rep_penalty_base") || "1.0"),
                repPenaltyMax: parseFloat(localStorage.getItem("config_rep_penalty_max") || "1.5"),
                textProtect: localStorage.getItem("config_text_protect") === "true",
                glossaryPath: localStorage.getItem("config_glossary_path"),
                deviceMode: localStorage.getItem("config_device_mode") || "auto",
                rulesPre: JSON.parse(localStorage.getItem("config_rules_pre") || "[]"),
                rulesPost: JSON.parse(localStorage.getItem("config_rules_post") || "[]"),
                strictMode: localStorage.getItem("config_strict_mode") || "off", // Default to off for manual retry unless set
                flashAttn: localStorage.getItem("config_flash_attn") !== "false", // Most models support it now
                kvCacheType: localStorage.getItem("config_kv_cache_type") || "q8_0",
            }

            const result = await window.api?.retranslateBlock({
                src: block.src,
                index: block.index,
                modelPath: modelPath,
                config: config
            })

            if (result?.success) {
                updateBlockDst(index, result.dst)
                showAlert({
                    title: t.config.proofread.retranslateSuccess,
                    description: t.config.proofread.retranslateSuccessDesc.replace('{index}', (index + 1).toString()),
                    variant: 'success'
                })
            } else {
                showAlert({
                    title: '重翻失败',
                    description: result?.error || 'Unknown error',
                    variant: 'destructive'
                })
            }
        } catch (error) {
            console.error('Failed to retranslate:', error)
            showAlert({
                title: '重翻错误',
                description: String(error),
                variant: 'destructive'
            })
        } finally {
            setLoading(false)
            setRetranslatingBlocks(prev => {
                const next = new Set(prev)
                next.delete(index)
                return next
            })
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

        const executeReplace = () => {
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
                setHasUnsavedChanges(true)
                showAlert({
                    title: t.config.proofread.replaceAll,
                    description: t.config.proofread.replaced.replace('{count}', replaceCount.toString()),
                    variant: 'success'
                })

            } catch (e) {
                console.error(e)
            }
        }

        showConfirm({
            title: t.config.proofread.replaceAll,
            description: `${t.config.proofread.replace} ${matchList.filter(m => m.type === 'dst').length}?`,
            onConfirm: executeReplace
        })
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

    // Auto-scroll logs to bottom
    useEffect(() => {
        if (showLogModal !== null && logScrollRef.current) {
            logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
        }
    }, [blockLogs, showLogModal])

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

    // Container ref for scrolling
    const containerRef = useRef<HTMLDivElement>(null)

    // Grid template for synchronized columns (fixed 50:50 layout)
    const gridTemplate = '50% 50%'

    // Helper: trim leading empty lines from block text
    const trimLeadingEmptyLines = (text: string) => {
        const lines = text.split('\n')
        let startIdx = 0
        while (startIdx < lines.length && lines[startIdx].trim() === '') {
            startIdx++
        }
        return lines.slice(startIdx).join('\n')
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

    // Check for target file from LibraryView navigation (on mount)
    useEffect(() => {
        const targetFile = localStorage.getItem('proofread_target_file')
        if (targetFile) {
            localStorage.removeItem('proofread_target_file') // Clear to prevent re-loading
            loadCacheFromPath(targetFile)
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Load specific cache file
    const loadCacheFromPath = async (path: string) => {
        if (!path) return
        setLoading(true)
        try {
            console.log('[Proofread] Attempting to load cache:', path)
            // @ts-ignore
            const data = await window.api.loadCache(path)
            if (data && data.blocks) {
                await processLoadedData(data, path)
            } else {
                const msg = !data ? "文件不存在或已损坏" : "内容格式不正确 (缺少 blocks)"
                console.error(`[Proofread] ${msg}:`, path)
                throw new Error(msg)
            }
        } catch (e) {
            console.error('Failed to load cache:', e)
            showAlert({
                title: '无法加载校对文件',
                description: `读取文件失败: ${path}\n原因: ${e instanceof Error ? e.message : String(e)}`,
                variant: 'destructive'
            })
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
    const HighlightText = ({ text, keyword, warningLines, isDoubleSpace = true, showLineNumbers = false }: { text: string, keyword: string, warningLines?: Set<number>, isDoubleSpace?: boolean, showLineNumbers?: boolean }) => {
        if (!text) return null

        const lines = text.split(/\r?\n/)
        // In line mode, show all lines including empty ones for strict alignment
        const effectiveDoubleSpace = showLineNumbers ? false : isDoubleSpace

        return (
            <div className={`flex flex-col w-full ${showLineNumbers ? 'font-mono text-[13px]' : ''}`}>
                {lines.map((line, idx) => {
                    // Check if this line is in warnings (1-based index in set)
                    const isWarning = warningLines?.has(idx + 1)
                    const isEmpty = !line.trim()

                    // Search highlight logic
                    const renderContent = () => {
                        if (!keyword || !line) return line || (showLineNumbers ? '\u00A0' : <br />)
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

                    // In line mode, show all lines for strict alignment
                    // In block mode, hide empty lines and add spacing
                    if (effectiveDoubleSpace && isEmpty) {
                        return <div key={idx} className="hidden" />
                    }

                    return (
                        <div
                            key={idx}
                            className={`
                                flex items-start gap-2
                                ${isWarning ? 'bg-amber-500/20 rounded' : ''}
                                ${effectiveDoubleSpace ? 'mb-6' : 'min-h-[1.5em]'}
                            `}
                        >
                            {showLineNumbers && (
                                <span className="w-7 shrink-0 text-right text-[10px] text-muted-foreground/50 select-none pt-0.5">
                                    {idx + 1}
                                </span>
                            )}
                            <span className={`flex-1 break-words whitespace-pre-wrap text-foreground ${showLineNumbers ? '' : 'w-full'}`}>
                                {renderContent()}
                            </span>
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
                        <button
                            onClick={() => setLineMode(!lineMode)}
                            className={`p-1 rounded text-xs ${lineMode ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                            title={lineMode ? '行模式 (点击切换段落模式)' : '段落模式 (点击切换行模式)'}
                        >
                            <AlignJustify className="w-3.5 h-3.5" />
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
                        <Button
                            variant={hasUnsavedChanges ? "default" : "outline"}
                            size="sm"
                            className={`h-7 text-xs relative ${hasUnsavedChanges ? 'ring-1 ring-amber-500' : ''}`}
                            onClick={saveCache}
                            disabled={loading}
                        >
                            <Save className={`w-3.5 h-3.5 mr-1 ${hasUnsavedChanges ? 'animate-pulse' : ''}`} />
                            {t.config.proofread.saveBtn}
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
                <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border">
                    {/* Header Row */}
                    <div className="sticky top-0 z-20 grid bg-muted/80 backdrop-blur border-b text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
                        <div className="px-4 py-2 border-r border-border/50">原文 (Source)</div>
                        <div className="px-4 py-2">译文 (Translation)</div>
                    </div>

                    {/* Blocks */}
                    <div className="divide-y divide-border/30">
                        {paginatedBlocks.map(block => {
                            // Calculate similarity lines for this block
                            const simLines = findHighSimilarityLines(block.src, block.dst)
                            const simSet = new Set(simLines)

                            // In line mode, render line-by-line with synchronized heights
                            const srcLinesRaw = trimLeadingEmptyLines(block.src).split('\n')
                            const dstText = editingBlockId === block.index ? editingText : trimLeadingEmptyLines(block.dst)
                            const dstLinesRaw = dstText.split('\n')

                            // Align both sides: pad shorter side with empty lines
                            const maxLines = Math.max(srcLinesRaw.length, dstLinesRaw.length)
                            const srcLines = [...srcLinesRaw, ...Array(maxLines - srcLinesRaw.length).fill('')]
                            const dstLines = [...dstLinesRaw, ...Array(maxLines - dstLinesRaw.length).fill('')]

                            return (
                                <div
                                    key={block.index}
                                    id={`block-${block.index}`}
                                    className={`group hover:bg-muted/30 transition-colors ${editingBlockId === block.index ? 'bg-muted/30' : ''}`}
                                >
                                    {/* Block header with info and actions */}
                                    <div className="flex items-center gap-2 px-3 py-1 border-b border-border/10 bg-muted/20">
                                        <span className="text-[10px] text-muted-foreground/50 font-mono">#{block.index + 1}</span>
                                        <StatusIndicator block={block} />
                                        <button
                                            onClick={() => retranslateBlock(block.index)}
                                            className={`w-5 h-5 flex items-center justify-center rounded transition-all opacity-0 group-hover:opacity-100 ${loading ? 'text-muted-foreground' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`}
                                            title="重新翻译此块"
                                            disabled={loading}
                                        >
                                            <RefreshCw className={`w-3 h-3 ${retranslatingBlocks.has(block.index) ? 'animate-spin' : ''}`} />
                                        </button>
                                        {/* Log button - show when block has logs */}
                                        {blockLogs[block.index]?.length > 0 && (
                                            <button
                                                onClick={() => setShowLogModal(block.index)}
                                                className="w-5 h-5 flex items-center justify-center rounded transition-all text-blue-500/70 hover:text-blue-500 hover:bg-blue-500/10"
                                                title="查看翻译日志"
                                            >
                                                <Terminal className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>

                                    {/* Content area: 2-column grid */}
                                    {lineMode ? (
                                        // Line Mode: per-row grid for height sync, overlay textarea for editing
                                        <div className="relative">
                                            {/* Display layer: per-row grid */}
                                            <div
                                                className="grid"
                                                style={{ gridTemplateColumns: gridTemplate }}
                                                onClick={() => {
                                                    if (editingBlockId !== block.index) {
                                                        setEditingBlockId(block.index)
                                                        setEditingText(dstText)
                                                    }
                                                }}
                                            >
                                                {srcLines.map((srcLine, lineIdx) => {
                                                    const dstLine = dstLines[lineIdx] || ''
                                                    const isWarning = simSet.has(lineIdx + 1)
                                                    const cellStyle: React.CSSProperties = {
                                                        minHeight: '20px',
                                                        paddingLeft: '44px',
                                                        paddingRight: '12px',
                                                        lineHeight: '20px',
                                                        fontFamily: '"Cascadia Mono", Consolas, "Meiryo", "MS Gothic", "SimSun", "Courier New", monospace',
                                                        fontSize: '13px',
                                                        wordBreak: 'break-all',
                                                    }
                                                    return (
                                                        <React.Fragment key={lineIdx}>
                                                            {/* Source cell */}
                                                            <div className={`relative border-r border-border/20 ${isWarning ? 'bg-amber-500/20' : ''}`} style={cellStyle}>
                                                                <span style={{ position: 'absolute', left: '12px', width: '24px', textAlign: 'right', fontSize: '10px', color: 'hsl(var(--muted-foreground)/0.5)', userSelect: 'none', lineHeight: '20px' }}>{lineIdx + 1}</span>
                                                                <span className="whitespace-pre-wrap text-foreground select-text">{srcLine || '\u00A0'}</span>
                                                            </div>
                                                            {/* Translation cell */}
                                                            <div className={`relative cursor-text ${isWarning ? 'bg-amber-500/20' : ''}`} style={cellStyle}>
                                                                <span style={{ position: 'absolute', left: '12px', width: '24px', textAlign: 'right', fontSize: '10px', color: 'hsl(var(--muted-foreground)/0.5)', userSelect: 'none', lineHeight: '20px' }}>{lineIdx + 1}</span>
                                                                <span className={`whitespace-pre-wrap text-foreground select-text ${editingBlockId === block.index ? 'opacity-0' : ''}`}>{dstLine || '\u00A0'}</span>
                                                            </div>
                                                        </React.Fragment>
                                                    )
                                                })}
                                            </div>
                                            {/* Editing overlay: full-block textarea */}
                                            {editingBlockId === block.index && (
                                                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: gridTemplate }}>
                                                    {/* Left: transparent placeholder to maintain layout */}
                                                    <div className="border-r border-border/20" />
                                                    {/* Right: textarea */}
                                                    <div className="relative">
                                                        <textarea
                                                            autoFocus
                                                            className="w-full h-full outline-none resize-none border-none m-0 bg-transparent text-foreground"
                                                            style={{
                                                                paddingLeft: '44px',
                                                                paddingRight: '12px',
                                                                lineHeight: '20px',
                                                                fontFamily: '"Cascadia Mono", Consolas, "Meiryo", "MS Gothic", "SimSun", "Courier New", monospace',
                                                                fontSize: '13px',
                                                                wordBreak: 'break-all',
                                                                whiteSpace: 'pre-wrap',
                                                            }}
                                                            value={editingText}
                                                            onChange={e => {
                                                                setEditingText(e.target.value)
                                                                setHasUnsavedChanges(true)
                                                            }}
                                                            onBlur={e => {
                                                                const newValue = e.target.value
                                                                setCacheData(prev => {
                                                                    if (!prev) return prev
                                                                    const newBlocks = [...prev.blocks]
                                                                    const targetIdx = newBlocks.findIndex(b => b.index === block.index)
                                                                    if (targetIdx !== -1) {
                                                                        newBlocks[targetIdx] = { ...newBlocks[targetIdx], dst: newValue, status: 'edited' }
                                                                    }
                                                                    return { ...prev, blocks: newBlocks }
                                                                })
                                                                setHasUnsavedChanges(true)
                                                                setEditingBlockId(null)
                                                            }}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Escape') e.currentTarget.blur()
                                                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                                                    e.preventDefault()
                                                                    e.currentTarget.blur()
                                                                }
                                                            }}
                                                            spellCheck={false}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        // Block Mode: Original layout
                                        <div className="grid relative" style={{ gridTemplateColumns: gridTemplate }}>
                                            <div className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground select-text overflow-x-auto border-r border-border/20">
                                                <HighlightText text={trimLeadingEmptyLines(block.src)} keyword={searchKeyword} warningLines={simSet} showLineNumbers={false} />
                                            </div>
                                            <div className="relative px-3 py-2 text-sm leading-relaxed overflow-x-auto cursor-text">
                                                <HighlightText
                                                    text={dstText}
                                                    keyword={searchKeyword}
                                                    warningLines={simSet}
                                                    showLineNumbers={false}
                                                />
                                                {/* Transparent textarea overlay for seamless editing */}
                                                <textarea
                                                    className="absolute inset-0 px-3 py-2 bg-transparent border-none outline-none resize-none"
                                                    style={{
                                                        lineHeight: 'inherit',
                                                        color: 'transparent',
                                                        caretColor: 'hsl(var(--primary))'
                                                    }}
                                                    value={dstText}
                                                    onChange={e => {
                                                        if (editingBlockId === block.index) {
                                                            setEditingText(e.target.value)
                                                        }
                                                    }}
                                                    onFocus={() => {
                                                        setEditingBlockId(block.index)
                                                        setEditingText(trimLeadingEmptyLines(block.dst))
                                                    }}
                                                    onBlur={(e) => {
                                                        const newText = e.target.value
                                                        if (newText !== trimLeadingEmptyLines(block.dst)) {
                                                            setCacheData(prev => {
                                                                if (!prev) return prev
                                                                const newBlocks = [...prev.blocks]
                                                                const targetIdx = newBlocks.findIndex(b => b.index === block.index)
                                                                if (targetIdx !== -1) {
                                                                    newBlocks[targetIdx] = { ...newBlocks[targetIdx], dst: newText, status: 'edited' }
                                                                }
                                                                return { ...prev, blocks: newBlocks }
                                                            })
                                                            setHasUnsavedChanges(true)
                                                        }
                                                        setEditingBlockId(null)
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Escape') {
                                                            e.preventDefault()
                                                            e.currentTarget.blur()
                                                        }
                                                    }}
                                                    spellCheck={false}
                                                />
                                            </div>
                                        </div>
                                    )}
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
                            lang={lang}
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

            {/* --- Log Modal (Terminal) --- */}
            {showLogModal !== null && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowLogModal(null)} />
                    <div className="relative w-full max-w-3xl max-h-[80vh] bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-amber-500/10 rounded-lg">
                                    <Terminal className="w-5 h-5 text-amber-500" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-medium text-zinc-100">推理细节 - 区块 {showLogModal + 1}</h3>
                                    <p className="text-xs text-zinc-500">Manual Retranslation Virtual Log</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-400 hover:text-white" onClick={() => setShowLogModal(null)}>
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                        <div
                            ref={logScrollRef}
                            className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed text-zinc-300 scrollbar-thin scrollbar-thumb-zinc-700 bg-black/20"
                        >
                            {(blockLogs[showLogModal] || []).length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
                                    <Clock className="w-8 h-8 opacity-20" />
                                    <p>等待日志输出...</p>
                                </div>
                            ) : (
                                (blockLogs[showLogModal] || []).map((line, i) => (
                                    <div key={i} className="mb-1 last:mb-0 break-words whitespace-pre-wrap">
                                        {line}
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="p-3 border-t border-zinc-800 bg-zinc-900/80 flex justify-end">
                            <Button variant="ghost" size="sm" className="text-zinc-400" onClick={() => setShowLogModal(null)}>
                                关闭
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <AlertModal {...alertProps} />
        </div>
    )
}

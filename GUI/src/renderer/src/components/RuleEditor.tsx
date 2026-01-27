import { useState, useEffect } from "react"
import { Trash, Plus, GripVertical, CheckCircle2, Circle, Save, PlayCircle, Sparkles, AlertCircle, ArrowRight, Layers, History, ChevronRight, Eye, Loader2 } from "lucide-react"
import { Button } from "./ui/core"
import { translations, Language } from "../lib/i18n"
import { AlertModal } from "./ui/AlertModal"
import { useAlertModal } from "../hooks/useAlertModal"

export type RuleType = 'replace' | 'regex' | 'format'

export interface Rule {
    id: string
    type: RuleType
    active: boolean
    pattern: string
    replacement: string
    label?: string
    description?: string
    options?: Record<string, any>
}

interface RuleEditorProps {
    lang: Language
    mode: 'pre' | 'post'
}

const PATTERN_METADATA: Record<string, { label: string, description: string, isExperimental?: boolean, defaultOptions?: Record<string, any> }> = {
    'ruby_cleaner': {
        label: '假名注音清理',
        description: '物理移除文本中的日式注音标签。支持《》、<ruby> 以及 [ruby] 等五种主流采集格式。\n[可选] 开启“激进模式”可尝试识别并清理非标的括号式注音。\n示例：漢字《かんじ》 → 漢字',
        defaultOptions: { aggressive: false }
    },
    'clean_empty': {
        label: '删除所有空行',
        description: '移除文本中的所有空行。\n示例：段落A\\n\\n段落B → 段落A\\n段落B'
    },
    'smart_quotes': {
        label: '统一为日式引号',
        description: '将各类引号统一为日式直角引号。\n示例：“你好” / "你好" → 「你好」'
    },
    'ellipsis': {
        label: '规范省略号',
        description: '将不规范的省略号统一为标准格式。\n示例：... / 。。。 → ……'
    },
    'full_to_half_punct': {
        label: '全角符号转半角',
        description: '将全角标点强制转换为半角。\n示例：，。！？ → ,.!?'
    },
    'ensure_single_newline': {
        label: '强制单换行',
        description: '将多重换行合并为单个换行符。\n示例：段落A\\n\\n\\n段落B → 段落A\\n段落B'
    },
    'ensure_double_newline': {
        label: '强制双换行',
        description: '确保段落间有且仅有两个换行符，适合轻小说排版。\n示例：段落A\\n段落B → 段落A\\n\\n段落B'
    },
    'number_fixer': {
        label: '数字/特殊符号修复',
        description: '自动修复圆圈数字 ①②③ 和特殊数学符号，确保与原文一致。'
    },
    'traditional_chinese': {
        label: '繁体中文转换',
        description: '将简体中文转换为符合台湾习惯的繁体中文，含词汇级别转换。\n示例：软件 / 意识 → 軟體 / 意識'
    },
    'restore_protection': {
        label: '还原保护标签',
        isExperimental: true,
        description: '系统级核心规则。将占位符（如 <PROTECT_0>）还原为原始不变量文本。\n[重要] 此规则必须放置在所有翻译润色步骤的最后，以确保受保护术语不受干扰。\n示例：阅读 <PROTECT_0> → 阅读《圣经》',
        defaultOptions: { customPattern: '<PROTECT_(\\d+)>' }
    },
    'kana_fixer': {
        label: '孤立假名清理',
        isExperimental: true,
        description: '基于上下文启发式算法，自动移除译文中残留的单个性假名（如“翻译。の”），同时保护拟声词等连续假名块。\n示例：这是译文。の → 这是译文。'
    },
    'punctuation_fixer': {
        label: '标点符号对齐',
        isExperimental: true,
        description: '高阶算法：通过比对原文与译文的符号分布，自动补齐译文缺失的末尾标点或修正断句符号。\n[注意] 该功能在 GUI 测试环境下仅作基础演示。'
    }
}



const PRESET_TEMPLATES: { [key: string]: Rule[] } = {
    pre_novel: [],
    pre_general: [],
    post_novel: [
        { id: 'o1', type: 'format', active: true, pattern: 'ensure_double_newline', replacement: '', label: '强制双换行 (轻小说)', description: PATTERN_METADATA['ensure_double_newline'].description },
        { id: 'o2', type: 'format', active: true, pattern: 'smart_quotes', replacement: '', label: '统一引号格式', description: PATTERN_METADATA['smart_quotes'].description },
    ],
    post_general: [
        { id: 'o4', type: 'format', active: true, pattern: 'clean_empty', replacement: '', label: '移除空行', description: PATTERN_METADATA['clean_empty'].description },
        { id: 'o5', type: 'format', active: true, pattern: 'ensure_single_newline', replacement: '', label: '强制单换行', description: PATTERN_METADATA['ensure_single_newline'].description },
        { id: 'o6', type: 'format', active: true, pattern: 'smart_quotes', replacement: '', label: '统一引号格式', description: PATTERN_METADATA['smart_quotes'].description }
    ]
}

export function RuleEditor({ lang, mode }: RuleEditorProps) {
    const t = translations[lang]
    const [rules, setRules] = useState<Rule[]>([])
    const [saved, setSaved] = useState(false)
    const [testInput, setTestInput] = useState("")
    const [testOutput, setTestOutput] = useState("")
    const [testSteps, setTestSteps] = useState<{ label: string, text: string }[]>([])
    const [activeStep, setActiveStep] = useState<number>(-1)
    const [showPresets, setShowPresets] = useState(false)
    const [testing, setTesting] = useState(false)
    const { alertProps, showConfirm } = useAlertModal()

    const storageKey = `config_rules_${mode}`

    useEffect(() => {
        const savedRules = localStorage.getItem(storageKey)
        if (savedRules) {
            try {
                setRules(JSON.parse(savedRules))
            } catch (e) {
                console.error("Failed to parse rules:", e)
                setRules([])
            }
        } else {
            // Load defaults if no saved rules (Important for first load after reset)
            const defaultKey = mode === 'pre' ? 'pre_novel' : 'post_novel'
            const preset = PRESET_TEMPLATES[defaultKey]
            if (preset) {
                const newRules = preset.map(r => ({ ...r, id: Math.random().toString(36).substr(2, 9) }))
                setRules(newRules)
                localStorage.setItem(storageKey, JSON.stringify(newRules))
            }
        }
    }, [storageKey])

    const handleSave = () => {
        localStorage.setItem(storageKey, JSON.stringify(rules))
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    const addRule = () => {
        const newRule: Rule = { id: Math.random().toString(36).substr(2, 9), type: 'format', active: true, pattern: '', replacement: '' }
        setRules([...rules, newRule])
    }

    const removeRule = (id: string) => setRules(rules.filter(r => r.id !== id))
    const updateRule = (id: string, updates: Partial<Rule>) => setRules(rules.map(r => r.id === id ? { ...r, ...updates } : r))
    const toggleRule = (id: string) => setRules(rules.map(r => r.id === id ? { ...r, active: !r.active } : r))

    // Native Drag and Drop Logic
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
    const [dropIdx, setDropIdx] = useState<number | null>(null)
    const [dragHandleIdx, setDragHandleIdx] = useState<number | null>(null)

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIdx(index)
        e.dataTransfer.effectAllowed = 'move'
    }

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        if (draggedIdx === null || draggedIdx === index) return
        setDropIdx(index)
    }

    const handleDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        if (draggedIdx === null || draggedIdx === index) return

        const newRules = [...rules]
        const [movedRule] = newRules.splice(draggedIdx, 1)
        newRules.splice(index, 0, movedRule)

        setRules(newRules)
        setDraggedIdx(null)
        setDropIdx(null)
    }

    const handleDragEnd = () => {
        setDraggedIdx(null)
        setDropIdx(null)
    }

    const handleReset = () => {
        showConfirm({
            title: t.ruleEditor.resetTitle,
            description: t.ruleEditor.resetConfirm,
            variant: 'destructive',
            onConfirm: () => {
                const defaultKey = mode === 'pre' ? 'pre_novel' : 'post_novel'
                const preset = PRESET_TEMPLATES[defaultKey]
                if (preset) {
                    const newRules = preset.map(r => ({ ...r, id: Math.random().toString(36).substr(2, 9) }))
                    setRules(newRules)
                    localStorage.setItem(storageKey, JSON.stringify(newRules))
                }
            }
        })
    }

    const applyPreset = (key: string, replace: boolean = false) => {
        const preset = PRESET_TEMPLATES[key]
        if (preset) {
            const newRules = preset.map(r => ({ ...r, id: Math.random().toString(36).substr(2, 9) }))
            if (replace) {
                setRules(newRules)
                localStorage.setItem(storageKey, JSON.stringify(newRules))
            } else {
                const existingPatterns = new Set(rules.map(r => r.pattern))
                const uniqueNewRules = newRules.filter(r => !existingPatterns.has(r.pattern))
                const finalRules = [...rules, ...uniqueNewRules]
                setRules(finalRules)
                localStorage.setItem(storageKey, JSON.stringify(finalRules))
            }
        }
        setShowPresets(false)
    }

    const runTest = async () => {
        if (!testInput.trim()) return
        setTesting(true)
        try {
            const result = await window.api.testRules(testInput, rules)
            if (result.success) {
                setTestSteps(result.steps)
                if (result.steps.length > 0) {
                    setTestOutput(result.steps[result.steps.length - 1].text)
                    setActiveStep(result.steps.length - 1)
                }
            } else {
                console.error('Python Test Error:', result.error)
                setTestSteps([{ label: 'Error', text: result.error || 'Unknown error' }])
            }
        } catch (e) {
            console.error('IPC Test Error:', e)
        } finally {
            setTesting(false)
        }
    }

    const presetGroups = mode === 'pre'
        ? [{ key: 'pre_novel', label: '轻小说预处理', desc: '保留段落间距' }, { key: 'pre_general', label: '通用文本预处理', desc: '清理空行' }]
        : [{ key: 'post_novel', label: '轻小说后处理', desc: '双换行格式' }, { key: 'post_general', label: '通用文本后处理', desc: '单换行紧凑' }]

    const currentStepText = activeStep >= 0 && testSteps[activeStep] ? testSteps[activeStep].text : testOutput

    return (
        <div className="flex-1 h-screen flex flex-col bg-background text-foreground overflow-hidden">
            {/* Glossy Header */}
            <div className="px-8 py-6 border-b border-border bg-card/30 backdrop-blur-xl shrink-0 dark:bg-white/5 relative z-20">
                <div className="flex justify-between items-center">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold tracking-tight">
                                {mode === 'pre' ? '预处理规则' : '后处理规则'}
                            </h2>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 font-medium">
                            {mode === 'pre' ? '构建 AI 提示词之前的文本微调。' : '导出最终文档之前的润色与清理。'}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button variant="outline" onClick={addRule} className="bg-background border-input hover:bg-accent text-foreground">
                            <Plus className="w-4 h-4 mr-2" /> 新增规则
                        </Button>

                        <div className="relative group">
                            <Button variant="outline" onClick={() => setShowPresets(!showPresets)}
                                className="bg-background hover:bg-accent border-input hover:border-purple-500/50 transition-all duration-300">
                                <Sparkles className="w-4 h-4 mr-2 text-purple-500" /> 预设模板
                            </Button>
                            {showPresets && (
                                <div className="absolute right-0 mt-3 w-80 bg-popover/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-border z-50 p-4 animate-in fade-in zoom-in-95 duration-200">
                                    <div className="flex items-center gap-2 mb-4 px-1">
                                        <Layers className="w-4 h-4 text-purple-500" />
                                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">选择处理策略</span>
                                    </div>
                                    <div className="space-y-2">
                                        {presetGroups.map(p => (
                                            <div key={p.key} className="flex items-center gap-2 group/item">
                                                <button
                                                    onClick={() => applyPreset(p.key, true)}
                                                    className="flex-1 text-left px-4 py-3 rounded-xl bg-secondary/50 hover:bg-purple-500/10 border border-transparent hover:border-purple-500/30 transition-all duration-200"
                                                >
                                                    <div className="text-sm font-semibold text-foreground group-hover/item:text-purple-600 dark:group-hover/item:text-purple-400">{p.label}</div>
                                                    <div className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</div>
                                                </button>
                                                <button
                                                    onClick={() => applyPreset(p.key, false)}
                                                    className="p-3 rounded-xl bg-secondary/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
                                                    title="追加"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <Button variant="outline" onClick={handleReset} className="bg-background border-input hover:bg-accent text-muted-foreground hover:text-destructive transition-colors">
                            <History className="w-4 h-4 mr-2" /> 重置默认
                        </Button>
                        <div className="h-8 w-[1px] bg-border mx-1" />
                        <Button onClick={handleSave} className={`px-8 transition-all duration-500 font-bold shadow-[0_0_20px_rgba(168,85,247,0.1)] dark:shadow-[0_0_20px_rgba(168,85,247,0.2)] ${saved ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]'}`}>
                            <Save className="w-4 h-4 mr-2" /> {saved ? '已就绪' : '保存配置'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Main Workbench */}
            <div className="flex-1 flex overflow-hidden bg-gradient-to-b from-transparent to-purple-500/5 dark:to-purple-900/10">
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 custom-scrollbar">
                        {rules.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground animate-pulse">
                                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                    <Layers className="w-6 h-6 opacity-20" />
                                </div>
                                <p className="text-base font-medium">暂无活跃规则</p>
                                <p className="text-xs mt-1">点击右上方“新增规则”或从“预设模板”开始</p>
                            </div>
                        ) : (
                            rules.map((rule, idx) => (
                                <div
                                    key={rule.id}
                                    className={`group relative flex gap-4 p-4 rounded-2xl border transition-all duration-300 ${draggedIdx === idx ? 'opacity-20 scale-[0.98] border-dashed border-purple-500/50' : dropIdx === idx ? 'border-purple-500 shadow-lg shadow-purple-500/10' : !rule.active ? 'bg-muted/30 border-border/50 opacity-50 grayscale' : 'bg-card border-border hover:border-purple-500/40 hover:shadow-sm'}`}
                                    draggable={rule.active && dragHandleIdx === idx}
                                    onDragStart={(e) => handleDragStart(e, idx)}
                                    onDragOver={(e) => handleDragOver(e, idx)}
                                    onDrop={(e) => handleDrop(e, idx)}
                                    onDragEnd={handleDragEnd}
                                >
                                    {/* Numbering integrated into the card */}
                                    <div className="flex flex-col items-center gap-3 pt-1 shrink-0">
                                        <div className={`w-6 h-6 rounded-lg border flex items-center justify-center text-[10px] font-bold transition-colors ${rule.active ? 'bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400' : 'bg-muted border-border text-muted-foreground'}`}>
                                            {idx + 1}
                                        </div>
                                        <button onClick={() => toggleRule(rule.id)} className={`transition-all duration-300 transform hover:scale-110 ${rule.active ? 'text-purple-500' : 'text-muted-foreground'}`}>
                                            {rule.active ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                                        </button>
                                        <div
                                            className="cursor-grab active:cursor-grabbing p-1 -m-1"
                                            onMouseEnter={() => setDragHandleIdx(idx)}
                                            onMouseLeave={() => setDragHandleIdx(null)}
                                        >
                                            <GripVertical className="w-4 h-4 text-muted-foreground/20 hover:text-muted-foreground transition-colors" />
                                        </div>
                                    </div>

                                    <div className="flex-1 flex flex-col gap-4">
                                        {/* Top Row: Primary Selections */}
                                        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
                                            <div className="w-full lg:w-[180px]">
                                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">执行器类型</div>
                                                <div className="relative">
                                                    <select className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all appearance-none cursor-pointer" value={rule.type} onChange={e => {
                                                        const newType = e.target.value as RuleType
                                                        updateRule(rule.id, { type: newType, pattern: '', replacement: '', description: '', options: undefined })
                                                    }}>
                                                        <option value="format">内置处理器</option>
                                                        <option value="replace">文本替换</option>
                                                        <option value="regex">正则引擎</option>
                                                    </select>
                                                    <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground rotate-90 pointer-events-none" />
                                                </div>
                                            </div>

                                            <div className="flex-1 w-full lg:w-auto">
                                                {rule.type === 'format' ? (
                                                    <div>
                                                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">算法模板</div>
                                                        <div className="relative">
                                                            <select className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all appearance-none cursor-pointer" value={rule.pattern} onChange={e => {
                                                                const meta = PATTERN_METADATA[e.target.value]
                                                                updateRule(rule.id, { pattern: e.target.value, description: meta?.description || '', options: meta?.defaultOptions || undefined })
                                                            }}>
                                                                <option value="">选择预设算法...</option>
                                                                {Object.entries(PATTERN_METADATA).map(([key, meta]) => (
                                                                    <option key={key} value={key}>
                                                                        {meta.label} {meta.isExperimental ? ' (实验性)' : ''}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <Sparkles className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-500 pointer-events-none" />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-3">
                                                        <div className="flex-1">
                                                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">匹配目标</div>
                                                            <input type="text" className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all font-semibold" placeholder={rule.type === 'regex' ? "(\\d+)" : "查找文本"} value={rule.pattern} onChange={e => updateRule(rule.id, { pattern: e.target.value })} />
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">替换结果</div>
                                                            <input type="text" className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all font-semibold" placeholder="替换文本" value={rule.replacement} onChange={e => updateRule(rule.id, { replacement: e.target.value })} />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="pt-0 lg:pt-5">
                                                <button onClick={() => removeRule(rule.id)} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all" title="删除规则">
                                                    <Trash className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Bottom Row: Details/Options */}
                                        {rule.type === 'format' && rule.pattern && (
                                            <div className="p-3 rounded-xl bg-muted/20 border border-border/40 transition-all">
                                                <div className="flex gap-3">
                                                    <AlertCircle className="w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5 opacity-60" />
                                                    <div className="flex-1 space-y-2">
                                                        <div className="flex justify-between items-start gap-4">
                                                            <div className="text-[11px] text-muted-foreground leading-relaxed font-medium flex-1">
                                                                {rule.description?.split('\n').filter(l => !l.startsWith('示例：')).map((line, lIdx) => (
                                                                    <div key={lIdx} className="mb-0.5">{line}</div>
                                                                )) || "该算法无需额外参数，即点即用。"}
                                                            </div>
                                                            {rule.pattern === 'ruby_cleaner' && (
                                                                <label className="flex items-center gap-2 cursor-pointer group/opt shrink-0 mt-0.5">
                                                                    <div className="relative flex items-center justify-center w-3.5 h-3.5">
                                                                        <input type="checkbox" className="peer appearance-none w-full h-full rounded border border-border bg-background checked:bg-purple-600 checked:border-purple-500 transition-all cursor-pointer" checked={rule.options?.aggressive || false} onChange={e => updateRule(rule.id, { options: { ...rule.options, aggressive: e.target.checked } })} />
                                                                        <CheckCircle2 className="absolute w-2.5 h-2.5 text-white scale-0 peer-checked:scale-100 transition-all duration-300" />
                                                                    </div>
                                                                    <span className="text-[10px] font-bold text-muted-foreground group-hover/opt:text-foreground transition-colors uppercase tracking-tight">激进模式</span>
                                                                </label>
                                                            )}
                                                        </div>

                                                        {/* Examples and remaining specialized UI */}
                                                        {rule.description?.split('\n').filter(l => l.startsWith('示例：')).map((line, lIdx) => (
                                                            <div key={lIdx} className="mt-2 px-3 py-2 rounded-lg bg-background border border-border/30 font-mono text-[10px] text-foreground/70">
                                                                <span>
                                                                    {line.split(/(→|\\n)/g).map((part, pIdx) => (
                                                                        <span key={pIdx} className={part === '→' ? 'mx-1 text-purple-500' : part === '\\n' ? 'px-1 py-0.5 mx-0.5 rounded bg-muted text-purple-600 dark:text-purple-400 font-bold' : ''}>
                                                                            {part}
                                                                        </span>
                                                                    ))}
                                                                </span>
                                                            </div>
                                                        ))}

                                                        {rule.pattern === 'restore_protection' && (
                                                            <div className="pt-2 border-t border-border/30 space-y-1.5">
                                                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight ml-0.5">占位符匹配正则</div>
                                                                <input
                                                                    type="text"
                                                                    className="w-full h-8 bg-background border border-border rounded-lg px-2.5 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all"
                                                                    placeholder="例如: <PROTECT_(\d+)>"
                                                                    value={rule.options?.customPattern || ''}
                                                                    onChange={e => updateRule(rule.id, { options: { ...rule.options, customPattern: e.target.value } })}
                                                                />
                                                                <p className="text-[9px] text-muted-foreground/60 italic px-1">必须包含一个捕获组以提取索引。如需匹配多种模式，可添加多条此规则。</p>
                                                            </div>
                                                        )}

                                                        {PATTERN_METADATA[rule.pattern]?.isExperimental && (
                                                            <div className="pt-2 border-t border-border/30 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                                                <AlertCircle className="w-3 h-3" />
                                                                <span className="text-[10px] font-bold uppercase tracking-tight">实验性算法：处理逻辑可能存在副作用，请谨慎开启。</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="w-[380px] border-l border-border bg-muted/10 backdrop-blur-3xl flex flex-col group/sandbox">
                    <div className="px-5 py-4 border-b border-border bg-muted/20 transition-colors group-hover/sandbox:bg-muted/30">
                        <div className="flex items-center justify-between mb-1.5">
                            <h3 className="text-xs font-bold flex items-center gap-2 text-foreground">
                                <PlayCircle className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 group-hover/sandbox:scale-110 transition-transform" />
                                交互式沙盒
                            </h3>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[9px] text-muted-foreground/80 leading-relaxed">
                                由 Python 后端驱动，测试结果与实际翻译引擎完全一致。
                            </p>
                            <p className="text-[9px] text-muted-foreground/50 leading-relaxed italic">
                                即时预览所有活跃规则对文本的阶梯式作用效果。
                            </p>
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col p-5 space-y-4 overflow-hidden">
                        <div className="flex-[2] flex flex-col min-h-0">
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[9px] font-bold text-muted-foreground uppercase ml-0.5 flex items-center gap-1"><History className="w-3 h-3" /> 测试文本输入</label>
                                <span className="text-[9px] text-muted-foreground/60 font-mono">{testInput.length} chars</span>
                            </div>
                            <textarea className="flex-1 w-full bg-background border border-border rounded-xl p-3 text-[11px] font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-all custom-scrollbar" placeholder="输入测试文本..." value={testInput} onChange={e => setTestInput(e.target.value)} />
                            <Button onClick={runTest} disabled={testing} variant="secondary" className="mt-2 w-full h-10 border border-border hover:border-purple-500/20 rounded-xl group transition-all">
                                {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin text-purple-500" /> : <PlayCircle className="w-4 h-4 mr-2 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform" />}
                                <span className="font-bold tracking-tight uppercase text-[10px]">{testing ? '正在执行 Python 逻辑...' : '同步至 Python 执行'}</span>
                            </Button>
                        </div>
                        <div className="flex-[3] flex flex-col min-h-0 pt-2 border-t border-border/40">
                            <div className="flex items-center gap-1.5 mb-3">
                                <div className={`flex-1 min-h-[32px] flex items-center justify-center rounded-lg text-center cursor-pointer transition-all border ${activeStep === -1 ? 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-white' : 'bg-background border-border text-muted-foreground hover:text-foreground'}`} onClick={() => setActiveStep(-1)}><div className="text-[9px] font-bold uppercase tracking-tight">Source</div></div>
                                <ArrowRight className="w-3 h-3 text-border/60" />
                                <div className={`flex-1 min-h-[32px] flex items-center justify-center rounded-lg text-center cursor-pointer transition-all border ${activeStep === testSteps.length - 1 ? 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-white' : 'bg-background border-border text-muted-foreground hover:text-foreground'}`} onClick={() => setActiveStep(testSteps.length - 1)}><div className="text-[9px] font-bold uppercase tracking-tight">Final Result</div></div>
                            </div>
                            {testSteps.length > 0 ? (
                                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                    <div className="flex items-center gap-1.5 mb-1.5 px-0.5"><History className="w-2.5 h-2.5 text-emerald-500/70" /><span className="text-[9px] font-bold uppercase text-muted-foreground/60">运行链路追踪</span></div>
                                    <div className="flex-1 bg-background border border-border rounded-xl overflow-hidden flex flex-col shadow-inner">
                                        <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap select-text custom-scrollbar">{currentStepText || <span className="text-muted-foreground/40 italic">等待执行引擎...</span>}</div>
                                        <div className="px-3 py-1.5 bg-muted/10 border-t border-border/40 flex gap-1 overflow-x-auto scroller-hide">{testSteps.map((_, sIdx) => <button key={sIdx} onClick={() => setActiveStep(sIdx)} className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold transition-all ${activeStep === sIdx ? 'bg-purple-500 text-white shadow-sm' : 'bg-background border border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`}>{sIdx}</button>)}</div>
                                        <div className="px-3 py-1.5 bg-purple-500/5 flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-purple-500 animate-pulse" /><span className="text-[9px] font-bold text-purple-600 dark:text-purple-300 truncate tracking-tight uppercase">STEP {activeStep}: {testSteps[activeStep]?.label || 'INITIAL'}</span></div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center border border-dashed border-border/40 rounded-2xl opacity-40 bg-muted/5"><Eye className="w-6 h-6 mb-2 opacity-20" /><p className="text-[9px] font-bold uppercase tracking-tight">数据流可视化就绪</p></div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <AlertModal {...alertProps} />
        </div>
    )
}

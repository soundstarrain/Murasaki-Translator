import { useState, useEffect } from "react"
import { Trash, Plus, GripVertical, CheckCircle2, Circle, Save, PlayCircle, Settings2, Sparkles, AlertCircle, RotateCcw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/core"
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
}

interface RuleEditorProps {
    lang: Language
    mode: 'pre' | 'post'
}

// Preset Templates - 优化后的预设模板
// 注意：pre_clean 的 clean_empty 和 ensure_double_newline 是冲突的，已修复
const PRESET_TEMPLATES: { [key: string]: Rule[] } = {
    // 预处理 - 轻小说清理（不删空行，保留段落间距）
    pre_novel: [
        { id: 'p1', type: 'format', active: true, pattern: 'smart_quotes', replacement: '', label: '统一引号格式' },
    ],
    // 预处理 - 通用文本清理（删除空行，规范格式）
    pre_general: [
        { id: 'p2', type: 'format', active: true, pattern: 'clean_empty', replacement: '', label: '移除空行' },
        { id: 'p3', type: 'format', active: true, pattern: 'smart_quotes', replacement: '', label: '统一引号格式' },
    ],
    // 后处理 - 轻小说格式（双换行，标点修正）
    post_novel: [
        { id: 'o1', type: 'format', active: true, pattern: 'ensure_double_newline', replacement: '', label: '强制双换行 (轻小说)' },
        { id: 'o2', type: 'replace', active: true, pattern: '...', replacement: '……', label: '规范省略号' },
    ],
    // 后处理 - 通用格式（单换行，紧凑格式）
    post_general: [
        { id: 'o3', type: 'format', active: true, pattern: 'clean_empty', replacement: '', label: '移除空行' },
        { id: 'o4', type: 'format', active: true, pattern: 'ensure_single_newline', replacement: '', label: '强制单换行' },
        { id: 'o5', type: 'replace', active: true, pattern: '...', replacement: '……', label: '规范省略号' },
    ]
}

export function RuleEditor({ lang, mode }: RuleEditorProps) {
    const t = translations[lang]
    const [rules, setRules] = useState<Rule[]>([])
    const [saved, setSaved] = useState(false)
    const [testInput, setTestInput] = useState("")
    const [testOutput, setTestOutput] = useState("")
    const [showPresets, setShowPresets] = useState(false)
    const { alertProps, showConfirm } = useAlertModal()

    const storageKey = `config_rules_${mode}`

    useEffect(() => {
        const savedRules = localStorage.getItem(storageKey)
        if (savedRules) {
            try { setRules(JSON.parse(savedRules)) } catch (e) { console.error(e) }
        } else if (mode === 'post') {
            // Default rule for post-processing: Double Newline (Light Novel format)
            const defaultPostRule: Rule = {
                id: 'default_double_newline',
                type: 'format',
                active: true,
                pattern: 'ensure_double_newline',
                replacement: '',
                label: '强制双换行 (轻小说)'
            }
            setRules([defaultPostRule])
            // Also save to localStorage so Dashboard can read it immediately
            localStorage.setItem(storageKey, JSON.stringify([defaultPostRule]))
        }
    }, [mode])

    const handleSave = () => {
        localStorage.setItem(storageKey, JSON.stringify(rules))
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    const addRule = () => {
        const newRule: Rule = { id: Math.random().toString(36).substr(2, 9), type: 'replace', active: true, pattern: '', replacement: '' }
        setRules([...rules, newRule])
    }

    const removeRule = (id: string) => setRules(rules.filter(r => r.id !== id))
    const updateRule = (id: string, updates: Partial<Rule>) => setRules(rules.map(r => r.id === id ? { ...r, ...updates } : r))
    const toggleRule = (id: string) => setRules(rules.map(r => r.id === id ? { ...r, active: !r.active } : r))

    const handleReset = () => {
        showConfirm({
            title: t.resetSystem,
            description: t.resetConfirm,
            variant: 'destructive',
            onConfirm: () => {
                // 重置为推荐的默认预设
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
            // Assign new IDs to avoid duplicates
            const newRules = preset.map(r => ({ ...r, id: Math.random().toString(36).substr(2, 9) }))
            if (replace) {
                // 替换模式：清空现有规则
                setRules(newRules)
            } else {
                // 追加模式：添加到现有规则后面，但检查重复
                const existingPatterns = new Set(rules.map(r => r.pattern))
                const uniqueNewRules = newRules.filter(r => !existingPatterns.has(r.pattern))
                if (uniqueNewRules.length < newRules.length) {
                    // 有重复的规则被过滤
                    console.log(`[RuleEditor] Skipped ${newRules.length - uniqueNewRules.length} duplicate rules`)
                }
                setRules([...rules, ...uniqueNewRules])
            }
        }
        setShowPresets(false)
    }

    // Mock processing
    const runTest = () => {
        let result = testInput
        rules.forEach(rule => {
            if (!rule.active) return
            try {
                if (rule.type === 'replace' && rule.pattern) {
                    result = result.split(rule.pattern).join(rule.replacement)
                } else if (rule.type === 'regex' && rule.pattern) {
                    result = result.replace(new RegExp(rule.pattern, 'g'), rule.replacement)
                } else if (rule.type === 'format') {
                    if (rule.pattern === 'clean_empty') result = result.split('\n').filter(l => l.trim()).join('\n')
                    else if (rule.pattern === 'smart_quotes') result = result.replace(/[""]/g, '"').replace(/['']/g, "'")
                    else if (rule.pattern === 'full_to_half_punct') {
                        const t: any = { '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '（': '(', '）': ')' }
                        result = result.replace(/[，。！？：；（）]/g, m => t[m] || m)
                    }
                    else if (rule.pattern === 'ensure_single_newline') result = result.replace(/\n+/g, '\n')
                    else if (rule.pattern === 'ensure_double_newline') result = result.replace(/\n+/g, '\n\n')
                }
            } catch (e) { console.error(e) }
        })
        setTestOutput(result)
    }

    const presetGroups = mode === 'pre'
        ? [
            { key: 'pre_novel', label: '轻小说预处理', desc: '保留段落间距' },
            { key: 'pre_general', label: '通用文本预处理', desc: '清理空行' }
        ]
        : [
            { key: 'post_novel', label: '轻小说后处理', desc: '双换行格式' },
            { key: 'post_general', label: '通用文本后处理', desc: '单换行紧凑' }
        ]

    return (
        <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
            {/* Header */}
            <div className="p-6 pb-4 border-b border-border bg-card shrink-0">
                <div className="flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold text-foreground">{mode === 'pre' ? t.preTranslation : t.postTranslation}</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            {mode === 'pre' ? '在发送给 AI 之前，对源文本应用以下规则。' : '在保存结果之前，对翻译输出应用以下规则。'}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <div className="relative">
                            <Button variant="outline" onClick={() => setShowPresets(!showPresets)} className="gap-2">
                                <Sparkles className="w-4 h-4 text-amber-500" /> {t.ruleEditor.presets}
                            </Button>
                            {showPresets && (
                                <div className="absolute right-0 mt-2 w-72 bg-card rounded-xl shadow-2xl border border-border z-10 p-3 animate-in fade-in slide-in-from-top-2">
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2 px-1">选择预设模板</div>
                                    {presetGroups.map(p => (
                                        <div key={p.key} className="flex items-center gap-2 mb-1">
                                            <button
                                                onClick={() => applyPreset(p.key, true)}
                                                className="flex-1 text-left px-3 py-2 text-sm rounded-lg hover:bg-primary/10 text-foreground hover:text-primary transition-colors"
                                            >
                                                <span className="font-medium">{p.label}</span>
                                                <span className="text-xs text-muted-foreground ml-2">({p.desc})</span>
                                            </button>
                                            <button
                                                onClick={() => applyPreset(p.key, false)}
                                                className="px-2 py-1 text-[10px] rounded bg-secondary hover:bg-secondary/80 text-muted-foreground transition-colors"
                                                title="追加到现有规则"
                                            >
                                                +追加
                                            </button>
                                        </div>
                                    ))}
                                    <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
                                        点击预设名称替换现有规则，点击 "+追加" 添加到现有规则后面
                                    </div>
                                </div>
                            )}
                        </div>
                        <Button variant="outline" onClick={addRule} className="gap-2">
                            <Plus className="w-4 h-4" /> {t.ruleEditor.addRule}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleReset} title={t.resetSystem}>
                            <RotateCcw className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button onClick={handleSave} className={`gap-2 min-w-[100px] shadow-sm ${saved ? 'bg-green-500 hover:bg-green-600' : 'bg-gradient-to-r from-purple-600 to-indigo-600'}`}>
                            <Save className="w-4 h-4" /> {saved ? '已保存' : '保存'}
                        </Button>
                    </div>
                </div>

                {/* 执行顺序和规则说明 */}
                <div className="mt-4 p-3 bg-secondary/50 rounded-lg border border-border text-xs space-y-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="font-bold text-foreground">执行顺序:</span>
                        规则按<span className="font-mono bg-background px-1 rounded">从上到下</span>的顺序依次执行
                    </div>
                    <div className="flex items-start gap-6 mt-2">
                        <div className="space-y-1">
                            <span className="font-bold text-amber-600">⚠️ 常见冲突:</span>
                            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                                <li><span className="text-red-500">删除空行</span> 与 <span className="text-green-500">强制双换行</span> 冲突</li>
                                <li><span className="text-red-500">强制单换行</span> 与 <span className="text-green-500">强制双换行</span> 冲突</li>
                            </ul>
                        </div>
                        <div className="space-y-1">
                            <span className="font-bold text-muted-foreground">使用建议:</span>
                            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                                <li>轻小说: 后处理用<span className="text-green-500">强制双换行</span></li>
                                <li>通用文本: 后处理用<span className="text-muted-foreground">删除空行 + 单换行</span></li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex gap-6 p-6 overflow-hidden">
                {/* Rule List */}
                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                    {rules.length === 0 ? (
                        <div className="h-60 border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center text-muted-foreground bg-card/50">
                            <Settings2 className="w-10 h-10 mb-3 opacity-30" />
                            <p className="font-medium">{t.ruleEditor.emptyState.title}</p>
                            <p className="text-sm mt-1">{t.ruleEditor.emptyState.desc}</p>
                        </div>
                    ) : (
                        rules.map((rule) => (
                            <Card key={rule.id} className={`border shadow-sm transition-all ${!rule.active ? 'opacity-50 bg-muted' : 'bg-card hover:shadow-md'}`}>
                                <CardContent className="p-4 flex gap-4 items-start">
                                    <div className="flex flex-col gap-2 pt-1">
                                        <button onClick={() => toggleRule(rule.id)} className="text-muted-foreground hover:text-primary transition-colors">
                                            {rule.active ? <CheckCircle2 className="w-5 h-5 text-purple-600" /> : <Circle className="w-5 h-5" />}
                                        </button>
                                        <div className="opacity-20 cursor-grab"><GripVertical className="w-4 h-4" /></div>
                                    </div>

                                    <div className="flex-1 grid grid-cols-12 gap-4 items-start">
                                        <div className="col-span-3">
                                            <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 block">{t.ruleEditor.type}</label>
                                            <select className="w-full border border-border p-2.5 rounded-lg text-sm bg-secondary text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" value={rule.type} onChange={e => updateRule(rule.id, { type: e.target.value as RuleType })}>
                                                <option value="replace">{t.ruleEditor.types.replace}</option>
                                                <option value="regex">{t.ruleEditor.types.regex}</option>
                                                <option value="format">{t.ruleEditor.types.format}</option>
                                            </select>
                                        </div>

                                        {rule.type === 'format' ? (
                                            <div className="col-span-8">
                                                <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 block">格式化规则</label>
                                                <select className="w-full border border-border p-2.5 rounded-lg text-sm bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" value={rule.pattern} onChange={e => updateRule(rule.id, { pattern: e.target.value })}>
                                                    <option value="">选择规则...</option>
                                                    <option value="clean_empty">删除空行 — 移除所有空白行</option>
                                                    <option value="smart_quotes">统一引号 — 中英引号 → 直角引号「」</option>
                                                    <option value="full_to_half_punct">全角→半角 — ，。！？ → , . ! ?</option>
                                                    <option value="ensure_single_newline">强制单换行 — 合并多个换行为一个</option>
                                                    <option value="ensure_double_newline">强制双换行 — 段落间双换行 (轻小说)</option>
                                                </select>
                                                {/* 规则说明 */}
                                                {rule.pattern && (
                                                    <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                                                        {rule.pattern === 'clean_empty' && '⚠️ 会删除所有空行，不适合需要保留段落间距的轻小说格式'}
                                                        {rule.pattern === 'smart_quotes' && '将 "文字" 统一为直角引号「文字」格式'}
                                                        {rule.pattern === 'full_to_half_punct' && '全角中文标点转为半角英文标点'}
                                                        {rule.pattern === 'ensure_single_newline' && '将多个连续换行合并为单个换行，适合通用文档'}
                                                        {rule.pattern === 'ensure_double_newline' && '每段之间保持双换行，阅读体验更佳'}
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                                <div className="col-span-4">
                                                    <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 block flex items-center gap-1">
                                                        {rule.type === 'regex' && <AlertCircle className="w-3 h-3 text-amber-500" />}
                                                        {t.ruleEditor.match} {rule.type === 'regex' ? '(Regex)' : '(Text)'}
                                                    </label>
                                                    <input type="text" className="w-full border border-border p-2.5 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none bg-card" placeholder={rule.type === 'regex' ? "\\s+" : t.ruleEditor.placeholder.search} value={rule.pattern} onChange={e => updateRule(rule.id, { pattern: e.target.value })} />
                                                </div>
                                                <div className="col-span-4">
                                                    <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 block">{t.ruleEditor.replace}</label>
                                                    <input type="text" className="w-full border border-border p-2.5 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none bg-card" placeholder={t.ruleEditor.placeholder.replace} value={rule.replacement} onChange={e => updateRule(rule.id, { replacement: e.target.value })} />
                                                </div>
                                            </>
                                        )}

                                        <div className="col-span-1 pt-7 text-right">
                                            <button onClick={() => removeRule(rule.id)} className="text-muted-foreground hover:text-red-500 p-1 transition-colors">
                                                <Trash className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>

                {/* Tester Sidebar */}
                <div className="w-[320px] flex flex-col gap-4 shrink-0">
                    <Card className="border-none shadow-lg bg-card flex-1 flex flex-col">
                        <CardHeader className="pb-2 border-b border-border">
                            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                                <PlayCircle className="w-4 h-4 text-primary" /> {t.ruleEditor.sandbox}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col gap-3 p-4">
                            <div className="flex-1 flex flex-col">
                                <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5">{t.ruleEditor.input}</label>
                                <textarea className="flex-1 border border-border p-3 rounded-lg text-sm font-mono resize-none bg-secondary text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" placeholder={t.ruleEditor.placeholder.input} value={testInput} onChange={e => setTestInput(e.target.value)} />
                            </div>
                            <Button onClick={runTest} variant="secondary" className="w-full">
                                {t.ruleEditor.run}
                            </Button>
                            <div className="flex-1 flex flex-col">
                                <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5">{t.ruleEditor.output}</label>
                                <div className="flex-1 border border-border bg-secondary p-3 rounded-lg text-sm font-mono overflow-y-auto whitespace-pre-wrap text-foreground">
                                    {testOutput || <span className="text-muted-foreground italic">{t.ruleEditor.placeholder.empty}</span>}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
            <AlertModal {...alertProps} />
        </div>
    )
}

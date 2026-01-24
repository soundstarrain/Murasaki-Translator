import { useState, useEffect } from "react"
import { Box, Check, FolderOpen, RefreshCw, HardDrive, Cpu, Zap, ExternalLink, Sparkles, Download, ArrowRight, Layers, Layout, Github } from "lucide-react"
import { Button } from "./ui/core"
import { translations, Language } from "../lib/i18n"
import { APP_CONFIG } from "../lib/config"

interface ModelInfo {
    sizeGB: number
    estimatedVramGB: number
    paramsB: number | null
    quant: string
}

export function ModelView({ lang }: { lang: Language }) {
    const t = translations[lang]
    const [models, setModels] = useState<string[]>([])
    const [modelInfoMap, setModelInfoMap] = useState<Record<string, ModelInfo>>({})
    const [selectedModel, setSelectedModel] = useState<string>("")
    const [loading, setLoading] = useState(false)
    const [downloadTab, setDownloadTab] = useState<'ms' | 'hf' | 'bd'>('hf')
    const [showGuide, setShowGuide] = useState(false)

    const fetchModels = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const files = await window.api.getModels()
            setModels(files)

            // Fetch info for each model
            const infoMap: Record<string, ModelInfo> = {}
            for (const model of files) {
                try {
                    // @ts-ignore
                    const info = await window.api.getModelInfo(model)
                    if (info) infoMap[model] = info
                } catch (e) { }
            }
            setModelInfoMap(infoMap)
        } catch (e) {
            console.error(e)
        }
        setLoading(false)
    }

    useEffect(() => {
        fetchModels()
        const saved = localStorage.getItem("config_model")
        if (saved) setSelectedModel(saved)
    }, [])

    const handleSelect = (model: string) => {
        if (selectedModel === model) {
            setSelectedModel("")
            localStorage.removeItem("config_model")
        } else {
            setSelectedModel(model)
            localStorage.setItem("config_model", model)
        }
    }

    const isMurasakiModel = (name: string) => name.toLowerCase().includes('murasaki')
    const hasModels = models.length > 0
    const isGuideVisible = !hasModels || showGuide

    // Helper for visual step guide
    const StepCard = ({ number, title, desc, icon: Icon, action, actionLabel }: any) => (
        <div className="flex-1 bg-secondary/20 border border-border/50 rounded-xl p-4 flex flex-col items-center text-center group hover:bg-secondary/40 transition-colors relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <Icon className="w-16 h-16" />
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm mb-3 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                {number}
            </div>
            <h4 className="font-semibold text-sm mb-1">{title}</h4>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{desc}</p>
            {action && (
                <Button variant="outline" size="sm" className="mt-auto h-7 text-xs w-full" onClick={action}>
                    {actionLabel}
                </Button>
            )}
        </div>
    )

    return (
        <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden relative">
            {/* Scrollable Container */}
            <div className="flex-1 overflow-y-auto p-6 lg:p-10 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-8">

                    {/* Header */}
                    <div className="space-y-4 text-center">
                        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-purple-500 to-indigo-600 bg-clip-text text-transparent">
                            {t.modelManagement}
                        </h2>
                        <p className="text-muted-foreground max-w-2xl mx-auto">
                            {t.modelView.desc}
                        </p>
                    </div>

                    {/* Compact Toggle Banner (Show when hidden) */}
                    {hasModels && !showGuide && (
                        <div
                            onClick={() => setShowGuide(true)}
                            className="group relative overflow-hidden rounded-xl border border-purple-500/20 bg-gradient-to-r from-purple-500/5 to-indigo-500/5 p-1 cursor-pointer hover:border-purple-500/40 transition-all duration-300"
                        >
                            <div className="absolute inset-0 bg-secondary/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="relative flex items-center justify-between px-4 py-3 bg-background/50 rounded-lg backdrop-blur-sm">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500/10 to-indigo-500/10 flex items-center justify-center border border-purple-500/10 group-hover:scale-105 transition-transform">
                                        <Download className="w-5 h-5 text-purple-600" />
                                    </div>
                                    <div className="text-left">
                                        <h3 className="text-sm font-bold text-foreground group-hover:text-purple-600 transition-colors">
                                            {t.modelView.heroTitle || "Murasaki-8B v0.1"}
                                        </h3>
                                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            {t.modelView.heroTag || "Official Base Model"}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors pr-2">
                                    {t.modelView.heroSpecs || "View Recommendations"}
                                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* HERO SECTION: Visible if no models or manually toggled */}
                    {isGuideVisible && (
                        <div className="relative rounded-2xl overflow-hidden border border-purple-500/20 shadow-2xl bg-gradient-to-br from-purple-500/5 via-background to-indigo-500/5 animate-in fade-in slide-in-from-top-4 duration-500">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />

                            {/* Close Button for Guide */}
                            {hasModels && (
                                <button onClick={() => setShowGuide(false)} className="absolute top-2 right-2 p-2 hover:bg-secondary rounded-full text-muted-foreground z-10 transition-colors">
                                    <div className="w-5 h-5 flex items-center justify-center font-bold">×</div>
                                </button>
                            )}

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:divide-x divide-border/50">

                                {/* Left: Model Specs */}
                                <div className="p-8 lg:col-span-2 space-y-6">
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <div className="px-2 py-1 rounded bg-purple-500/10 text-purple-600 text-xs font-bold uppercase tracking-wider border border-purple-500/20">
                                                {t.modelView.heroTag || "Official Base"}
                                            </div>
                                            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                                                <Check className="w-3 h-3" /> Certified
                                            </div>
                                        </div>

                                        <h3 className="text-3xl font-bold text-foreground">
                                            {t.modelView.heroTitle || "Murasaki 8B"}
                                        </h3>

                                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground/80">
                                            <div className="flex items-center gap-2">
                                                <Cpu className="w-4 h-4 text-indigo-500" />
                                                <span>8B Params</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Layout className="w-4 h-4 text-indigo-500" />
                                                <span>GGUF</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Layers className="w-4 h-4 text-indigo-500" />
                                                <span>Long Context</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Zap className="w-4 h-4 text-amber-500" />
                                                <span>Native CoT</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Visual Installation Guide */}
                                    <div className="pt-6 border-t border-border/40">
                                        <div className="flex flex-col md:flex-row gap-4">
                                            <StepCard
                                                number="1"
                                                title={t.modelView.guideStep1 || "Download"}
                                                desc={t.modelView.guideStep1Desc || "Use ModelScope for high speed in CN"}
                                                icon={Download}
                                            />
                                            <ArrowRight className="hidden md:block w-6 h-6 text-muted-foreground/30 self-center shrink-0" />
                                            <StepCard
                                                number="2"
                                                title={t.modelView.guideStep2 || "Move File"}
                                                desc={t.modelView.guideStep2Desc || "Place in middleware/models"}
                                                icon={FolderOpen}
                                                action={() => window.api?.openFolder?.('middleware/models')}
                                                actionLabel={t.modelView.openFolder || "Open Folder"}
                                            />
                                            <ArrowRight className="hidden md:block w-6 h-6 text-muted-foreground/30 self-center shrink-0" />
                                            <StepCard
                                                number="3"
                                                title={t.modelView.guideStep3 || "Refresh"}
                                                desc={t.modelView.guideStep3Desc || "Reload list to select"}
                                                icon={RefreshCw}
                                                action={fetchModels}
                                                actionLabel={t.modelView.refresh || "Refresh"}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Right: Download Area */}
                                <div className="p-0 bg-secondary/10 flex flex-col">
                                    <div className="p-4 bg-secondary/30 border-b border-border/50 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center">
                                        {t.modelView.guideStep1 || "Download Sources"}
                                    </div>

                                    <div className="flex-1 p-6 space-y-4">
                                        {/* Download Tabs - Simplified */}
                                        <div className="flex p-1 rounded-lg bg-secondary/50 border border-border/50">
                                            <button
                                                onClick={() => setDownloadTab('hf')}
                                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${downloadTab === 'hf' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                            >
                                                HuggingFace
                                            </button>
                                            <button
                                                onClick={() => setDownloadTab('ms')}
                                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${downloadTab === 'ms' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                            >
                                                GitHub Project
                                            </button>
                                        </div>

                                        {/* Tab Content */}
                                        <div className="bg-background rounded-xl border border-border/50 p-4 shadow-sm flex-1 flex flex-col items-center justify-center text-center space-y-4">
                                            {downloadTab === 'hf' && (
                                                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 w-full flex flex-col items-center">
                                                    <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center text-2xl mb-2 border border-yellow-500/20">
                                                        🤗
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-foreground">HuggingFace</h4>
                                                        <p className="text-xs text-muted-foreground mt-1">Official Model Repository</p>
                                                    </div>
                                                    <Button size="sm" className="w-full mt-4 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold" onClick={() => window.open(APP_CONFIG.modelDownload.huggingface, '_blank')}>
                                                        <ExternalLink className="w-4 h-4 mr-2" /> Open Repository
                                                    </Button>
                                                </div>
                                            )}
                                            {downloadTab === 'ms' && (
                                                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 w-full flex flex-col items-center">
                                                    <div className="w-12 h-12 rounded-xl bg-gray-600/10 flex items-center justify-center text-gray-600 font-bold text-2xl mb-2 border border-gray-600/20">
                                                        <Github className="w-6 h-6" />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-foreground">Murasaki Project</h4>
                                                        <p className="text-xs text-muted-foreground mt-1">Project Homepage</p>
                                                    </div>
                                                    <Button size="sm" className="w-full mt-2 bg-gray-800 hover:bg-gray-900 text-white" onClick={() => window.open(APP_CONFIG.projectRepo, '_blank')}>
                                                        <ExternalLink className="w-4 h-4 mr-2" /> Go to GitHub
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Installed Models List */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between border-b pb-2">
                            <div className="flex items-center gap-4">
                                <h3 className="font-bold text-lg flex items-center gap-2">
                                    <HardDrive className="w-5 h-5 text-muted-foreground" />
                                    {t.nav.model} ({models.length})
                                </h3>
                                <div
                                    className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-xs text-muted-foreground cursor-pointer transition-colors border border-transparent hover:border-border"
                                    onClick={() => window.api?.openFolder?.('middleware/models')}
                                    title={t.modelView.openFolder}
                                >
                                    <FolderOpen className="w-3 h-3" />
                                    <span className="font-mono">middleware/models</span>
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={fetchModels} disabled={loading} className="h-8">
                                <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                                {t.modelView.refresh}
                            </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 pb-10">
                            {models.length === 0 ? (
                                <div className="col-span-full flex flex-col items-center justify-center py-16 border-2 border-dashed border-border/50 rounded-xl bg-secondary/5">
                                    <FolderOpen className="w-12 h-12 text-muted-foreground/30 mb-4" />
                                    <p className="font-medium text-muted-foreground">
                                        {t.modelView.noModels}
                                    </p>
                                    <p className="text-xs text-muted-foreground/60 mt-1">{t.modelView.noModelsSub || "middleware/models is empty"}</p>
                                    <Button variant="outline" size="sm" className="mt-4" onClick={() => window.api?.openFolder?.('middleware/models')}>
                                        {t.modelView.openFolder}
                                    </Button>
                                </div>
                            ) : (
                                [...models]
                                    .sort((a, b) => { // Sort recommended first, then by params
                                        const isRecA = isMurasakiModel(a)
                                        const isRecB = isMurasakiModel(b)
                                        if (isRecA !== isRecB) return isRecA ? -1 : 1

                                        const paramsA = modelInfoMap[a]?.paramsB ?? Infinity
                                        const paramsB = modelInfoMap[b]?.paramsB ?? Infinity
                                        return paramsA - paramsB
                                    })
                                    .map((model) => {
                                        const info = modelInfoMap[model]
                                        const isRecommended = isMurasakiModel(model)
                                        const isSelected = selectedModel === model

                                        return (
                                            <div
                                                key={model}
                                                onClick={() => handleSelect(model)}
                                                className={`
                                                group relative flex flex-col p-5 rounded-xl border cursor-pointer transition-all duration-300 ease-out select-none
                                                ${isSelected
                                                        ? 'bg-purple-500/5 border-purple-500/50 shadow-[0_0_0_1px_rgba(168,85,247,0.4)]'
                                                        : 'bg-card border-border/60 hover:border-purple-500/30 hover:shadow-lg hover:-translate-y-0.5'
                                                    }
                                            `}
                                            >
                                                {/* Selection Checkmark */}
                                                <div className={`absolute top-4 right-4 transition-all duration-300 z-10 ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
                                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase bg-purple-500 text-white shadow-sm">
                                                        <Check className="w-3 h-3" strokeWidth={3} />
                                                        <span>{t.selected}</span>
                                                    </div>
                                                </div>

                                                {/* Header */}
                                                <div className="flex items-start gap-4 mb-6">
                                                    <div className={`p-3 rounded-xl shrink-0 transition-colors duration-300 ${isSelected ? 'bg-purple-500 text-white shadow-md' : 'bg-secondary text-muted-foreground group-hover:text-purple-600 group-hover:bg-purple-500/10'}`}>
                                                        <Box className="w-5 h-5" />
                                                    </div>
                                                    <div className="flex-1 min-w-0 pr-16">
                                                        <h3 className={`font-semibold text-sm truncate transition-colors ${isSelected ? 'text-purple-700 dark:text-purple-300' : 'text-foreground'}`}>
                                                            {model}
                                                        </h3>
                                                        {isRecommended && (
                                                            <div className="mt-1 flex items-center gap-1.5">
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gradient-to-r from-purple-500/10 to-pink-500/10 text-purple-600 border border-purple-500/20">
                                                                    <Sparkles className="w-2.5 h-2.5" />
                                                                    {t.modelView.recommended}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Badges */}
                                                <div className="mt-auto grid grid-cols-2 gap-2">
                                                    {info?.paramsB && (
                                                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-border/50">
                                                            <Cpu className="w-3.5 h-3.5 text-blue-500/80" />
                                                            <div className="flex flex-col leading-none gap-0.5">
                                                                <span className="text-[9px] text-muted-foreground/60 uppercase font-bold">Params</span>
                                                                <span className="text-xs font-mono font-medium">{info.paramsB}B</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {info?.estimatedVramGB && (
                                                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 ${info.estimatedVramGB > 8 ? 'bg-red-500/5' : 'bg-secondary/30'}`}>
                                                            <Zap className={`w-3.5 h-3.5 ${info.estimatedVramGB > 8 ? 'text-red-500' : 'text-green-500'}`} />
                                                            <div className="flex flex-col leading-none gap-0.5">
                                                                <span className="text-[9px] text-muted-foreground/60 uppercase font-bold">VRAM</span>
                                                                <span className="text-xs font-mono font-medium">~{info.estimatedVramGB.toFixed(1)}GB</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {info?.quant && (
                                                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-border/50">
                                                            <Layout className="w-3.5 h-3.5 text-amber-500/80" />
                                                            <div className="flex flex-col leading-none gap-0.5">
                                                                <span className="text-[9px] text-muted-foreground/60 uppercase font-bold">Quant</span>
                                                                <span className="text-xs font-mono font-medium">{info.quant}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {info?.sizeGB && (
                                                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-border/50">
                                                            <HardDrive className="w-3.5 h-3.5 text-indigo-500/80" />
                                                            <div className="flex flex-col leading-none gap-0.5">
                                                                <span className="text-[9px] text-muted-foreground/60 uppercase font-bold">Size</span>
                                                                <span className="text-xs font-mono font-medium">{info.sizeGB.toFixed(1)}GB</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

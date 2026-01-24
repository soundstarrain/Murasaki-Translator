import { Database, Cpu } from 'lucide-react'
import { translations, Language } from '../lib/i18n'

export interface MonitorData {
    name: string
    vram_used_gb: number
    vram_total_gb: number
    vram_percent: number
    gpu_util: number
    mem_util: number
}

interface HardwareMonitorBarProps {
    data: MonitorData | null
    lang: Language
}

export function HardwareMonitorBar({ data, lang }: HardwareMonitorBarProps) {
    const t = translations[lang]
    // if (!data) return null -> Show placeholder instead

    // Default placeholder data
    const displayData = data || {
        name: t.monitor.title,
        vram_used_gb: 0,
        vram_total_gb: 0,
        vram_percent: 0,
        gpu_util: 0,
        mem_util: 0
    }

    const isOffline = !data

    // Color logic with gradient effect
    const getVramColor = (percent: number) => {
        if (isOffline) return "bg-secondary"
        if (percent > 90) return "bg-gradient-to-r from-red-500 to-red-600 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
        if (percent > 75) return "bg-gradient-to-r from-amber-500 to-orange-500"
        if (percent > 50) return "bg-gradient-to-r from-yellow-500 to-amber-500"
        return "bg-gradient-to-r from-green-500 to-emerald-500"
    }


    const getUtilColor = (percent: number) => {
        if (isOffline) return "text-muted-foreground"
        if (percent > 90) return "text-red-400"
        if (percent > 50) return "text-amber-400"
        return "text-emerald-400"
    }

    return (
        <div className={`w-full bg-card border-b border-border px-3 py-2.5 flex items-center justify-between text-xs font-mono select-none transition-colors dark:bg-card/90 ${isOffline ? 'bg-muted/30 dark:bg-muted/20' : ''}`}>
            {/* GPU Name - 允许收缩 */}
            <div className="flex items-center gap-2 text-muted-foreground min-w-0 shrink flex-1 mr-2 overflow-hidden">
                <Cpu className="w-3.5 h-3.5 shrink-0" />
                <span className={`truncate font-medium ${isOffline ? "opacity-70" : ""}`} title={displayData.name}>
                    {isOffline ? t.monitor.waiting : displayData.name.replace("NVIDIA GeForce", "").trim()}
                </span>
            </div>

            {/* VRAM Bar - 核心显示区域 */}
            <div className="flex items-center gap-2 flex-[2] min-w-[140px] max-w-[300px]">
                <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
                    <Database className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">VRAM</span>
                </div>
                <div className="flex-1 h-2.5 bg-secondary/50 rounded-full overflow-hidden relative border border-border/50">
                    <div
                        className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out ${getVramColor(displayData.vram_percent)}`}
                        style={{ width: `${displayData.vram_percent}%` }}
                    />
                </div>
                <div className="shrink-0 text-right whitespace-nowrap font-mono">
                    <span className={displayData.vram_percent > 90 ? "text-red-400 font-bold" : "text-foreground font-semibold"}>
                        {displayData.vram_used_gb.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground">/{Math.round(displayData.vram_total_gb)}G</span>
                </div>
            </div>

            {/* GPU Stats - 紧凑显示 */}
            <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-3">
                <div className="w-px h-3.5 bg-border" />
                <div className="flex items-center gap-1.5" title={t.monitor.gpuLoad}>
                    <span>GPU</span>
                    <span className={`font-bold font-mono ${getUtilColor(displayData.gpu_util)}`}>{displayData.gpu_util}%</span>
                </div>
                <div className="flex items-center gap-1.5" title={t.monitor.vramLoad}>
                    <span>V-IO</span>
                    <span className="font-mono">{displayData.mem_util}%</span>
                </div>
            </div>
        </div>
    )
}


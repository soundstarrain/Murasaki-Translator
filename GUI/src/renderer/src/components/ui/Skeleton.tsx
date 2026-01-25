/**
 * Skeleton - 骨架屏组件
 * 用于长时间加载时的占位显示
 */

import { translations, Language } from '../../lib/i18n'
import { cn } from '../../lib/utils'

interface SkeletonProps {
    className?: string
    variant?: 'text' | 'circular' | 'rectangular' | 'card'
    width?: string | number
    height?: string | number
    animation?: 'pulse' | 'wave' | 'none'
}

/**
 * 基础骨架屏组件
 */
export function Skeleton({
    className,
    variant = 'text',
    width,
    height,
    animation = 'pulse'
}: SkeletonProps) {
    const baseClasses = 'bg-muted'

    const animationClasses = {
        pulse: 'animate-pulse',
        wave: 'animate-shimmer bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]',
        none: ''
    }

    const variantClasses = {
        text: 'h-4 rounded',
        circular: 'rounded-full',
        rectangular: 'rounded-lg',
        card: 'rounded-xl'
    }

    const style: React.CSSProperties = {}
    if (width) style.width = typeof width === 'number' ? `${width}px` : width
    if (height) style.height = typeof height === 'number' ? `${height}px` : height

    return (
        <div
            className={cn(
                baseClasses,
                animationClasses[animation],
                variantClasses[variant],
                className
            )}
            style={style}
        />
    )
}

/**
 * 文本行骨架屏
 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
    return (
        <div className={cn('space-y-2', className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    variant="text"
                    width={i === lines - 1 ? '60%' : '100%'}
                />
            ))}
        </div>
    )
}

/**
 * 卡片骨架屏
 */
export function SkeletonCard({ className }: { className?: string }) {
    return (
        <div className={cn('p-4 rounded-xl bg-card border border-border', className)}>
            <div className="flex items-center gap-3 mb-4">
                <Skeleton variant="circular" width={40} height={40} />
                <div className="flex-1">
                    <Skeleton variant="text" width="60%" className="mb-2" />
                    <Skeleton variant="text" width="40%" height={12} />
                </div>
            </div>
            <SkeletonText lines={2} />
        </div>
    )
}

/**
 * 列表项骨架屏
 */
export function SkeletonListItem({ className }: { className?: string }) {
    return (
        <div className={cn('flex items-center gap-3 p-3', className)}>
            <Skeleton variant="rectangular" width={48} height={48} />
            <div className="flex-1">
                <Skeleton variant="text" width="70%" className="mb-2" />
                <Skeleton variant="text" width="50%" height={12} />
            </div>
        </div>
    )
}

/**
 * 统计卡片骨架屏
 */
export function SkeletonStatCard({ className }: { className?: string }) {
    return (
        <div className={cn('p-4 rounded-xl bg-card border border-border', className)}>
            <div className="flex items-center gap-3">
                <Skeleton variant="rectangular" width={40} height={40} className="rounded-lg" />
                <div>
                    <Skeleton variant="text" width={60} height={28} className="mb-1" />
                    <Skeleton variant="text" width={80} height={12} />
                </div>
            </div>
        </div>
    )
}

/**
 * Dashboard 加载骨架屏
 */
export function SkeletonDashboard() {
    return (
        <div className="flex-1 p-6 space-y-6">
            {/* 顶部统计卡片 */}
            <div className="grid grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <SkeletonStatCard key={i} />
                ))}
            </div>

            {/* 主要内容区 */}
            <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                    <Skeleton variant="text" width={120} height={20} />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
                <div className="space-y-4">
                    <Skeleton variant="text" width={100} height={20} />
                    <Skeleton variant="rectangular" height={300} className="w-full" />
                </div>
            </div>
        </div>
    )
}

/**
 * 模型加载进度组件
 */
export function ModelLoadingProgress({
    progress = 0,
    status,
    modelName = '',
    lang = 'zh'
}: {
    progress?: number
    status?: string
    modelName?: string
    lang?: Language
}) {
    const t = translations[lang]
    const displayStatus = status || t.dashboard.processing
    return (
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
            {/* 圆形进度指示器 */}
            <div className="relative w-24 h-24">
                <svg className="w-full h-full transform -rotate-90">
                    <circle
                        cx="48"
                        cy="48"
                        r="40"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="8"
                        className="text-muted"
                    />
                    <circle
                        cx="48"
                        cy="48"
                        r="40"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="8"
                        strokeDasharray={`${progress * 2.51} 251`}
                        strokeLinecap="round"
                        className="text-primary transition-all duration-300"
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold">{Math.round(progress)}%</span>
                </div>
            </div>

            {/* 状态文本 */}
            <div className="text-center">
                <p className="text-sm font-medium text-foreground">{displayStatus}</p>
                {modelName && (
                    <p className="text-xs text-muted-foreground mt-1">{modelName}</p>
                )}
            </div>

            {/* 进度条 */}
            <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
                <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    )
}

export default Skeleton

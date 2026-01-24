import React from 'react'
import { Card, Button } from './core'
import { AlertTriangle, Info, CheckCircle2, X } from 'lucide-react'

interface AlertModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    variant?: 'default' | 'destructive' | 'info' | 'success'
    onConfirm?: () => void
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
}

export function AlertModal({
    open,
    onOpenChange,
    title,
    description,
    variant = 'default',
    onConfirm,
    confirmText = '确定',
    cancelText = '取消',
    showCancel = false
}: AlertModalProps) {
    if (!open) return null

    const getIcon = () => {
        switch (variant) {
            case 'destructive': return <AlertTriangle className="w-6 h-6 text-red-500" />
            case 'success': return <CheckCircle2 className="w-6 h-6 text-green-500" />
            case 'info': return <Info className="w-6 h-6 text-blue-500" />
            default: return <AlertTriangle className="w-6 h-6 text-yellow-500" />
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <Card className="w-[400px] max-w-[90vw] shadow-lg border-border bg-background animate-in zoom-in-95 duration-200">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="shrink-0 mt-1">
                            {getIcon()}
                        </div>
                        <div className="flex-1 space-y-2">
                            <h3 className="font-semibold text-lg leading-none tracking-tight">
                                {title}
                            </h3>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                {description}
                            </p>
                        </div>
                        <button
                            onClick={() => onOpenChange(false)}
                            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
                        >
                            <X className="w-4 h-4" />
                            <span className="sr-only">Close</span>
                        </button>
                    </div>
                </div>
                <div className="p-6 pt-0 flex justify-end gap-2">
                    {showCancel && (
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            {cancelText}
                        </Button>
                    )}
                    <Button
                        variant={variant === 'destructive' ? 'destructive' : 'default'}
                        onClick={() => {
                            if (onConfirm) onConfirm()
                            onOpenChange(false)
                        }}
                    >
                        {confirmText}
                    </Button>
                </div>
            </Card>
        </div>
    )
}

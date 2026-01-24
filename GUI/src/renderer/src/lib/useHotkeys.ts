/**
 * useHotkeys - 全局快捷键 Hook
 * 提供统一的快捷键管理
 */

import { useEffect, useCallback, useRef } from 'react'

// 快捷键配置类型
interface HotkeyConfig {
    key: string              // 按键 (小写)
    ctrl?: boolean           // 是否需要 Ctrl
    shift?: boolean          // 是否需要 Shift
    alt?: boolean            // 是否需要 Alt
    handler: () => void      // 处理函数
    enabled?: boolean        // 是否启用
    preventDefault?: boolean // 是否阻止默认行为
}

/**
 * 全局快捷键 Hook
 * @param hotkeys 快捷键配置数组
 */
export function useHotkeys(hotkeys: HotkeyConfig[]) {
    const hotkeysRef = useRef(hotkeys)
    hotkeysRef.current = hotkeys

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        // 如果焦点在输入框内，忽略大部分快捷键（除 Escape）
        const target = event.target as HTMLElement
        const isInput = target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable

        for (const hotkey of hotkeysRef.current) {
            // 检查是否启用
            if (hotkey.enabled === false) continue

            // 如果在输入框中，只响应 Escape
            if (isInput && hotkey.key !== 'escape') continue

            // 检查按键匹配
            const keyMatch = event.key.toLowerCase() === hotkey.key.toLowerCase()
            const ctrlMatch = hotkey.ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey
            const shiftMatch = hotkey.shift ? event.shiftKey : !event.shiftKey
            const altMatch = hotkey.alt ? event.altKey : !event.altKey

            if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
                if (hotkey.preventDefault !== false) {
                    event.preventDefault()
                }
                hotkey.handler()
                break
            }
        }
    }, [])

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])
}

/**
 * 预定义的应用快捷键
 */
export interface AppHotkeyHandlers {
    onStartTranslation?: () => void
    onStopTranslation?: () => void
    onSaveConfig?: () => void
    onSwitchView?: (view: string) => void
}

/**
 * 应用级快捷键 Hook
 * 预设常用快捷键
 */
export function useAppHotkeys({
    onStartTranslation,
    onStopTranslation,
    onSaveConfig,
    onSwitchView
}: AppHotkeyHandlers) {
    const hotkeys: HotkeyConfig[] = [
        // Ctrl+Enter: 开始翻译
        {
            key: 'Enter',
            ctrl: true,
            handler: () => onStartTranslation?.(),
            enabled: !!onStartTranslation
        },
        // Escape: 停止翻译
        {
            key: 'Escape',
            handler: () => onStopTranslation?.(),
            enabled: !!onStopTranslation
        },
        // Ctrl+S: 保存配置
        {
            key: 's',
            ctrl: true,
            handler: () => onSaveConfig?.(),
            enabled: !!onSaveConfig
        },
        // Ctrl+1: Dashboard
        {
            key: '1',
            ctrl: true,
            handler: () => onSwitchView?.('dashboard'),
            enabled: !!onSwitchView
        },
        // Ctrl+2: Settings
        {
            key: '2',
            ctrl: true,
            handler: () => onSwitchView?.('settings'),
            enabled: !!onSwitchView
        },
        // Ctrl+3: Advanced
        {
            key: '3',
            ctrl: true,
            handler: () => onSwitchView?.('advanced'),
            enabled: !!onSwitchView
        },
        // Ctrl+4: Glossary
        {
            key: '4',
            ctrl: true,
            handler: () => onSwitchView?.('glossary'),
            enabled: !!onSwitchView
        },
        // Ctrl+5: Proofread
        {
            key: '5',
            ctrl: true,
            handler: () => onSwitchView?.('proofread'),
            enabled: !!onSwitchView
        },
        // Ctrl+6: History
        {
            key: '6',
            ctrl: true,
            handler: () => onSwitchView?.('history'),
            enabled: !!onSwitchView
        }
    ]

    useHotkeys(hotkeys)
}

export default useHotkeys

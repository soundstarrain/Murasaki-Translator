import { useState, useRef, useCallback } from "react"
import { Sidebar } from "./components/Sidebar"
import { Dashboard } from "./components/Dashboard"
import { SettingsView } from "./components/SettingsView"
import { AdvancedView } from "./components/AdvancedView"
import { ModelView } from "./components/ModelView"
import { GlossaryView } from "./components/GlossaryView"
import { HistoryView } from "./components/HistoryView"
import ProofreadView from "./components/ProofreadView"

import { Language, translations } from "./lib/i18n"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { useAppHotkeys } from "./lib/useHotkeys"

import { RuleEditor } from "./components/RuleEditor"

export type View = 'dashboard' | 'settings' | 'model' | 'glossary' | 'pre' | 'post' | 'advanced' | 'history' | 'proofread'

function AppContent() {
    const [lang, setLang] = useState<Language>('zh')
    const [view, setView] = useState<View>('dashboard')

    // Dashboard ref for triggering translation
    const dashboardRef = useRef<{ startTranslation?: () => void; stopTranslation?: () => void }>(null)

    // 快捷键处理
    const handleSwitchView = useCallback((newView: string) => {
        if (['dashboard', 'settings', 'advanced', 'glossary', 'proofread', 'history'].includes(newView)) {
            setView(newView as View)
        }
    }, [])

    // 注册全局快捷键
    useAppHotkeys({
        onStartTranslation: () => dashboardRef.current?.startTranslation?.(),
        onStopTranslation: () => dashboardRef.current?.stopTranslation?.(),
        onSwitchView: handleSwitchView
    })

    return (
        <div className="flex h-screen w-screen bg-background font-sans text-foreground overflow-hidden">
            <Sidebar lang={lang} setLang={setLang} view={view} setView={setView} />
            {/* Keep Dashboard mounted to preserve translation state (logs, process listeners) */}
            <div className={`flex-1 ${view === 'dashboard' ? 'flex' : 'hidden'}`}>
                <Dashboard lang={lang} active={view === 'dashboard'} />
            </div>
            {view === 'settings' && <SettingsView lang={lang} />}
            {view === 'model' && <ModelView lang={lang} />}
            {view === 'glossary' && <GlossaryView lang={lang} />}
            {view === 'pre' && <RuleEditor lang={lang} mode="pre" />}
            {view === 'post' && <RuleEditor lang={lang} mode="post" />}
            {view === 'advanced' && <AdvancedView lang={lang} />}
            {view === 'history' && <HistoryView lang={lang} />}
            {view === 'proofread' && (
                <div className="flex-1 overflow-hidden">
                    <ProofreadView t={translations[lang]} />
                </div>
            )}

        </div>
    )
}

function App() {
    return (
        <ErrorBoundary>
            <AppContent />
        </ErrorBoundary>
    )
}

export default App

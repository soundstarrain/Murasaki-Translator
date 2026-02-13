import { useState, useRef, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { SettingsView } from "./components/SettingsView";
import { AdvancedView } from "./components/AdvancedView";
import { ServiceView } from "./components/ServiceView";
import { ModelView } from "./components/ModelView";
import { GlossaryView } from "./components/GlossaryView";
import { HistoryView } from "./components/HistoryView";
import { LibraryView } from "./components/LibraryView";
import ProofreadView from "./components/ProofreadView";

import { Language, translations } from "./lib/i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAppHotkeys } from "./lib/useHotkeys";

import { RuleEditor } from "./components/RuleEditor";
import { AlertModal } from "./components/ui/AlertModal";
import { useAlertModal } from "./hooks/useAlertModal";
import { useRemoteRuntime } from "./hooks/useRemoteRuntime";
import { RemoteStatusBar } from "./components/RemoteStatusBar";

export type View =
  | "dashboard"
  | "library"
  | "settings"
  | "model"
  | "glossary"
  | "pre"
  | "post"
  | "service"
  | "advanced"
  | "history"
  | "proofread";

function AppContent() {
  const [lang, setLang] = useState<Language>("zh");
  const [view, setView] = useState<View>("dashboard");
  const [proofreadHasChanges, setProofreadHasChanges] = useState(false);
  const { alertProps, showConfirm } = useAlertModal();
  const [isRunning, setIsRunning] = useState(false);
  const remoteRuntime = useRemoteRuntime();

  // Dashboard ref for triggering translation
  const dashboardRef = useRef<{
    startTranslation?: () => void;
    stopTranslation?: () => void;
  }>(null);

  // 快捷键处理
  const handleSwitchView = useCallback(
    (newView: string) => {
      const validViews: View[] = [
        "dashboard",
        "library",
        "settings",
        "model",
        "service",
        "advanced",
        "glossary",
        "proofread",
        "history",
        "pre",
        "post",
      ];

      if (validViews.includes(newView as View)) {
        const executeSwitch = () => {
          setView(newView as View);
        };

        if (
          view === "proofread" &&
          proofreadHasChanges &&
          newView !== "proofread"
        ) {
          const t = translations[lang];
          showConfirm({
            title: t.config.proofread.unsavedChanges.split("，")[0], // "当前有未保存的更改"
            description: t.config.proofread.unsavedChanges,
            onConfirm: executeSwitch,
          });
        } else {
          executeSwitch();
        }
      }
    },
    [view, proofreadHasChanges, lang, showConfirm],
  );

  // 注册全局快捷键
  useAppHotkeys({
    onStartTranslation: () => dashboardRef.current?.startTranslation?.(),
    onStopTranslation: () => dashboardRef.current?.stopTranslation?.(),
    onSwitchView: handleSwitchView,
  });

  return (
    <div className="flex h-screen w-screen bg-background font-sans text-foreground overflow-hidden">
      <Sidebar
        lang={lang}
        setLang={setLang}
        view={view}
        setView={handleSwitchView}
      />
      {/* Keep Dashboard mounted to preserve translation state (logs, process listeners) */}
      <div
        className={`flex-1 min-w-0 ${view === "dashboard" ? "flex" : "hidden"}`}
      >
        <Dashboard
          ref={dashboardRef}
          lang={lang}
          active={view === "dashboard"}
          onRunningChange={setIsRunning}
          remoteRuntime={remoteRuntime}
        />
      </div>
      {view === "settings" && <SettingsView lang={lang} />}
      {view === "library" && (
        <LibraryView
          lang={lang}
          isRunning={isRunning}
          remoteRuntime={remoteRuntime}
          onNavigate={(v) => handleSwitchView(v)}
          onProofreadFile={(cachePath) => {
            localStorage.setItem("proofread_target_file", cachePath);
            handleSwitchView("proofread");
          }}
        />
      )}
      {view === "model" && <ModelView lang={lang} remoteRuntime={remoteRuntime} />}
      {view === "glossary" && <GlossaryView lang={lang} />}
      {view === "service" && (
        <ServiceView lang={lang} remoteRuntime={remoteRuntime} />
      )}
      {view === "pre" && <RuleEditor lang={lang} mode="pre" />}
      {view === "post" && <RuleEditor lang={lang} mode="post" />}
      {view === "advanced" && <AdvancedView lang={lang} />}
      {view === "history" && <HistoryView lang={lang} />}
      {view === "proofread" && (
        <div className="flex-1 min-w-0 overflow-hidden">
          <ProofreadView
            t={translations[lang]}
            lang={lang}
            onUnsavedChangesChange={setProofreadHasChanges}
          />
        </div>
      )}

      <RemoteStatusBar remote={remoteRuntime} />
      <AlertModal {...alertProps} />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;

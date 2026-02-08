import { useState, useEffect } from "react";
import {
  Bot,
  Play,
  Settings,
  BookOpen,
  FileInput,
  FileOutput,
  Sparkles,
  Sun,
  Moon,
  Clock,
  ClipboardCheck,
  Layers,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Tooltip } from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { View } from "../App";
import { APP_CONFIG } from "../lib/config";

interface SidebarProps {
  lang: Language;
  setLang: (lang: Language) => void;
  view: View;
  setView: (view: View) => void;
}

export function Sidebar({ lang, setLang, view, setView }: SidebarProps) {
  const t = translations[lang];

  // Theme state management
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved ? saved === "dark" : false; // Default to light
  });

  useEffect(() => {
    const html = document.documentElement;
    if (isDark) {
      html.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      html.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    // Sync with Windows title bar
    (window as any).api?.setTheme?.(isDark ? "dark" : "light");
  }, [isDark]);

  // Navigation order: Main → Config → Processing → Advanced → Utility
  const menuItems = [
    // 主功能
    { icon: Play, label: t.nav.start, id: "dashboard" },
    {
      icon: Layers,
      label:
        lang === "zh"
          ? "翻译队列"
          : lang === "jp"
            ? "ワークベンチ"
            : "Workbench",
      id: "library",
    },
    { icon: Clock, label: t.nav.history, id: "history" },
    { icon: ClipboardCheck, label: t.nav.proofread, id: "proofread" },
    // 配置
    { icon: Bot, label: t.nav.model, id: "model" },
    { icon: BookOpen, label: t.nav.glossary, id: "glossary" },
    // 文本处理
    { icon: FileInput, label: t.nav.pre, id: "pre" },
    { icon: FileOutput, label: t.nav.post, id: "post" },
    // 高级与设置
    { icon: Sparkles, label: t.nav.advanced, id: "advanced" },
    { icon: Settings, label: t.nav.setting, id: "settings" },
  ];

  return (
    <div className="w-[200px] bg-card border-r border-border h-screen flex flex-col">
      <div className="p-4 pb-3">
        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">
          Murasaki
        </h1>
        <p className="text-xs text-muted-foreground mt-1">{t.title}</p>
      </div>

      <nav className="flex-1 px-4 space-y-2">
        {menuItems.map((item, index) => {
          const isActive = view === item.id;
          return (
            <button
              key={index}
              onClick={() => {
                setView(item.id as View);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200",
                isActive
                  ? "bg-primary/20 text-primary shadow-sm border border-primary/30"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <item.icon
                className={cn(
                  "w-4 h-4",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex justify-center items-center gap-2 mb-4">
          {(["zh", "en", "jp"] as Language[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={cn(
                "text-xs px-2 py-1 rounded transition-colors",
                lang === l
                  ? "bg-primary/20 text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.toUpperCase()}
            </button>
          ))}

          {/* Theme Toggle */}
          <div className="w-px h-4 bg-border mx-1"></div>
          <Tooltip content={isDark ? t.nav.toggleLight : t.nav.toggleDark}>
            <button
              onClick={() => {
                const html = document.documentElement;
                const newIsDark = !isDark;

                // Directly manipulate DOM
                if (newIsDark) {
                  html.classList.add("dark");
                } else {
                  html.classList.remove("dark");
                }

                // Update state and localStorage
                localStorage.setItem("theme", newIsDark ? "dark" : "light");
                setIsDark(newIsDark);
                console.log("[Theme]", newIsDark ? "dark" : "light");
              }}
              className="p-1.5 rounded-lg bg-secondary hover:bg-primary/20 transition-colors group"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400 group-hover:text-amber-300" />
              ) : (
                <Moon className="w-4 h-4 text-primary group-hover:text-primary/80" />
              )}
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2 px-2">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-[10px] shrink-0">
            v1
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            Murasaki v{APP_CONFIG.version}
          </span>
        </div>
      </div>
    </div>
  );
}

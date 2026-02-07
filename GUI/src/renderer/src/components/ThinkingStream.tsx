import { useState, useEffect, useRef } from "react";
import { ChevronDown, Brain } from "lucide-react";
import { translations, Language } from "../lib/i18n";

interface ThinkingStreamProps {
  content: string; // Raw text that may contain <think>...</think> tags
  isStreaming: boolean;
  lang?: Language;
}

/**
 * ThinkingStream Component
 * Renders CoT (Chain of Thought) content from <think> tags with:
 * - Collapsible card design
 * - Typewriter animation during streaming
 * - Auto-expand while streaming, auto-collapse when done
 */
export function ThinkingStream({
  content,
  isStreaming,
  lang = "zh",
}: ThinkingStreamProps) {
  const t = translations[lang];
  const [isExpanded, setIsExpanded] = useState(false);
  const [displayedText, setDisplayedText] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  // Extract thinking content from <think> tags
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  const thinkingContent = thinkMatch ? thinkMatch[1].trim() : "";

  // Auto-expand while streaming, auto-collapse when done
  useEffect(() => {
    if (isStreaming && thinkingContent) {
      setIsExpanded(true);
    }
  }, [isStreaming, thinkingContent]);

  // Typewriter effect during streaming
  useEffect(() => {
    if (isStreaming && thinkingContent) {
      // Show content progressively
      const targetLength = thinkingContent.length;
      if (displayedText.length < targetLength) {
        const timer = setTimeout(() => {
          setDisplayedText(thinkingContent.slice(0, displayedText.length + 5));
        }, 20);
        return () => clearTimeout(timer);
      }
    } else {
      setDisplayedText(thinkingContent);
    }
    return undefined;
  }, [thinkingContent, displayedText, isStreaming]);

  // Scroll to bottom during streaming
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedText, isStreaming]);

  // Highlight keywords [Term]
  const renderContent = (text: string) => {
    const parts = text.split(/(\[.*?\])/g);
    return parts.map((part, i) => {
      if (part.startsWith("[") && part.endsWith("]")) {
        return (
          <span key={i} className="text-amber-300 font-bold tracking-wide">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  if (!thinkingContent) return null;

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-950/30 overflow-hidden transition-all duration-300 my-2">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-2.5 px-3 hover:bg-purple-900/20 transition-colors group"
      >
        <div className="flex items-center gap-2 text-purple-300 shrink-0">
          <Brain className="w-3.5 h-3.5 group-hover:text-purple-200 transition-colors" />
          <span className="text-xs font-bold uppercase tracking-wider">
            {t.dashboard.reasoning}
          </span>
          {isStreaming && (
            <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded animate-pulse">
              {t.dashboard.thinking}
            </span>
          )}
        </div>

        {/* Summary Loop when collapsed */}
        {!isExpanded && (
          <div className="flex-1 mx-4 text-xs text-purple-200/40 truncate font-mono text-left">
            {thinkingContent.slice(0, 100).replace(/\n/g, " ")}...
          </div>
        )}

        <ChevronDown
          className={`w-4 h-4 text-purple-400/50 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Content */}
      {isExpanded && (
        <div
          ref={contentRef}
          className="p-3 pt-0 max-h-60 overflow-y-auto custom-scrollbar"
        >
          <div className="text-xs text-purple-100/80 leading-relaxed whitespace-pre-wrap font-mono py-2 pl-1 border-l-2 border-purple-500/20">
            {renderContent(displayedText)}
            {isStreaming && displayedText.length < thinkingContent.length && (
              <span className="inline-block w-1.5 h-3 bg-purple-400 ml-0.5 align-middle animate-pulse" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

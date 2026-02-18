import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FileText, Search, X } from "lucide-react";
import { Button, Input } from "../../ui/core";
import { cn } from "../../../lib/utils";

type TemplateSelectorItem = {
  id: string;
  title: string;
  desc: string;
  group: string;
  yaml: string;
  isCore?: boolean;
  custom?: boolean;
};

type TemplateSelectorStrings = {
  title: string;
  searchPlaceholder: string;
  empty: string;
  close: string;
  coreBadge: string;
  customBadge: string;
  groups: Record<string, string>;
  footerHint: string;
  manageShow: string;
  manageHide: string;
};

type TemplateSelectorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: TemplateSelectorItem[];
  groupOrder: string[];
  strings: TemplateSelectorStrings;
  onSelect: (item: TemplateSelectorItem) => void;
  managerOpen?: boolean;
  onToggleManager?: () => void;
  managerContent?: ReactNode;
};

export function TemplateSelector({
  open,
  onOpenChange,
  items,
  groupOrder,
  strings,
  onSelect,
  managerOpen,
  onToggleManager,
  managerContent,
}: TemplateSelectorProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      `${item.title} ${item.desc} ${item.id}`.toLowerCase().includes(keyword),
    );
  }, [items, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, TemplateSelectorItem[]>();
    for (const item of filtered) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    const order = groupOrder.length
      ? groupOrder
      : Array.from(map.keys());
    return order
      .map((key) => ({
        key,
        label: strings.groups[key] || key,
        items: map.get(key) || [],
      }))
      .filter((group) => group.items.length > 0);
  }, [filtered, groupOrder, strings.groups]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-3xl h-[80vh] bg-background/95 border border-border/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-4 border-b border-border/40 bg-muted/20">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold">{strings.title}</div>
            <div className="flex items-center gap-2">
              {onToggleManager && (
                <Button variant="ghost" size="sm" onClick={onToggleManager}>
                  {managerOpen ? strings.manageHide : strings.manageShow}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{strings.close}</span>
              </Button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={strings.searchPlaceholder}
              className="pl-9 bg-background/80"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Search className="h-8 w-8 opacity-30 mb-2" />
              <span className="text-sm">{strings.empty}</span>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "w-full text-left flex items-start gap-3 rounded-lg border border-transparent p-3 transition-all",
                        "hover:bg-muted/40 hover:border-border/60",
                      )}
                      onClick={() => {
                        onSelect(item);
                        onOpenChange(false);
                      }}
                    >
                      <div className="mt-0.5 h-8 w-8 rounded-md bg-muted/40 flex items-center justify-center">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {item.title}
                          </span>
                          {item.isCore && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                              {strings.coreBadge}
                            </span>
                          )}
                          {item.custom && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {strings.customBadge}
                            </span>
                          )}
                        </div>
                        {item.desc && (
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {item.desc}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}

          {managerOpen && managerContent && (
            <div className="mt-4 rounded-xl border border-border/60 bg-background/70 p-4 space-y-3">
              {managerContent}
            </div>
          )}
        </div>

        <div className="p-2 text-[10px] text-muted-foreground border-t border-border/40 text-center bg-muted/10">
          {strings.footerHint}
        </div>
      </div>
    </div>,
    document.body,
  );
}

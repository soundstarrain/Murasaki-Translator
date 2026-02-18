import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { Button, Label } from "../../ui/core";
import { emitToast } from "../../../lib/toast";

type KVPair = { key: string; value: string };

type KVEditorStrings = {
  keyLabel: string;
  valueLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  add: string;
  remove: string;
  hint: string;
  smartPaste: string;
  smartPasteEmpty: string;
  smartPasteJson: string;
  smartPasteLines: string;
  smartPasteFail: string;
};

type KVEditorProps = {
  label: string;
  pairs: KVPair[];
  onChange: (pairs: KVPair[]) => void;
  strings: KVEditorStrings;
  showHint?: boolean;
  showNote?: boolean;
  noteText?: string;
};

const ensurePairs = (pairs: KVPair[]) =>
  pairs.length ? pairs : [{ key: "", value: "" }];

const parsePairsFromText = (raw: string): KVPair[] => {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, value]) => ({
        key: String(key),
        value: String(value),
      }));
    }
  } catch {
    // ignore
  }
  const lines = text.split(/\r?\n/);
  const result: KVPair[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(":");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!key) continue;
    result.push({ key, value });
  }
  return result;
};

export function KVEditor({
  label,
  pairs,
  onChange,
  strings,
  showHint = true,
  showNote = false,
  noteText = "",
}: KVEditorProps) {
  const handleChange = (index: number, field: "key" | "value", value: string) => {
    const next = pairs.map((pair, idx) =>
      idx === index ? { ...pair, [field]: value } : pair,
    );
    onChange(ensurePairs(next));
  };

  const handleDelete = (index: number) => {
    const next = pairs.filter((_, idx) => idx !== index);
    onChange(ensurePairs(next));
  };

  const handleAdd = () => {
    onChange([...pairs, { key: "", value: "" }]);
  };

  const handleSmartPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        emitToast({
          title: strings.smartPaste,
          description: strings.smartPasteEmpty,
          variant: "warning",
        });
        return;
      }
      const parsedPairs = parsePairsFromText(text);
      if (!parsedPairs.length) {
        emitToast({
          title: strings.smartPaste,
          description: strings.smartPasteFail,
          variant: "warning",
        });
        return;
      }
      const isEmpty =
        pairs.length === 0 ||
        pairs.every((pair) => !pair.key.trim() && !pair.value.trim());
      const next = isEmpty ? parsedPairs : [...pairs, ...parsedPairs];
      onChange(ensurePairs(next));
      emitToast({
        title: strings.smartPaste,
        description:
          parsedPairs.length === 1
            ? strings.smartPasteJson
            : strings.smartPasteLines.replace(
                "{count}",
                String(parsedPairs.length),
              ),
        variant: "success",
      });
    } catch {
      emitToast({
        title: strings.smartPaste,
        description: strings.smartPasteFail,
        variant: "error",
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">
          {label}
        </Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs"
          onClick={handleSmartPaste}
        >
          <ClipboardList className="h-3 w-3" />
          {strings.smartPaste}
        </Button>
      </div>

      <div className="space-y-2">
        {pairs.map((pair, index) => (
          <div key={`${label}_${index}`} className="group flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-md border border-input bg-muted/10 px-2 py-1 shadow-sm focus-within:ring-1 focus-within:ring-ring">
              <span className="text-[10px] uppercase text-muted-foreground">
                {strings.keyLabel}
              </span>
              <input
                value={pair.key}
                onChange={(e) => handleChange(index, "key", e.target.value)}
                placeholder={strings.keyPlaceholder}
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
            <div className="flex-[1.2] flex items-center gap-2 rounded-md border border-input bg-muted/10 px-2 py-1 shadow-sm focus-within:ring-1 focus-within:ring-ring">
              <span className="text-[10px] uppercase text-muted-foreground">
                {strings.valueLabel}
              </span>
              <input
                value={pair.value}
                onChange={(e) => handleChange(index, "value", e.target.value)}
                placeholder={strings.valuePlaceholder}
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(index)}
              title={strings.remove}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          className="border-dashed border-border/60 text-muted-foreground hover:text-foreground"
          onClick={handleAdd}
        >
          <Plus className="h-3 w-3 mr-2" />
          {strings.add}
        </Button>
        {showHint && (
          <span className="text-[11px] text-muted-foreground">
            {strings.hint}
          </span>
        )}
      </div>

      {showNote && noteText && (
        <p className="text-xs text-muted-foreground">{noteText}</p>
      )}
    </div>
  );
}

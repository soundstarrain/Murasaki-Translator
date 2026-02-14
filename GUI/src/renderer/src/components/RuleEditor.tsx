import { useState, useEffect, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { EditorView, placeholder } from "@codemirror/view";
import {
  Trash,
  Plus,
  GripVertical,
  CheckCircle2,
  Circle,
  Save,
  PlayCircle,
  Sparkles,
  AlertCircle,
  ArrowRight,
  Layers,
  History,
  ChevronRight,
  Eye,
  Loader2,
  PenLine,
  Upload,
  Download,
  Settings2,
} from "lucide-react";
import { Button, Tooltip, Switch } from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";

export type RuleType = "replace" | "regex" | "format" | "python" | "protect";

export interface Rule {
  id: string;
  type: RuleType;
  active: boolean;
  pattern: string;
  replacement: string;
  label?: string;
  description?: string;
  options?: Record<string, any>;
  script?: string;
}

interface RuleProfile {
  id: string;
  name: string;
  rules: Rule[];
  updatedAt?: number;
}

interface RuleEditorProps {
  lang: Language;
  mode: "pre" | "post";
}

type RuleEditorI18n = (typeof translations)[Language]["ruleEditor"];

type PatternMeta = {
  label: string;
  description: string;
  isExperimental?: boolean;
  defaultOptions?: Record<string, any>;
};

const buildPatternMetadata = (
  re: RuleEditorI18n,
): Record<string, PatternMeta> => ({
  ruby_cleaner: {
    label: re.patterns.rubyCleaner.label,
    description: re.patterns.rubyCleaner.desc,
    defaultOptions: { aggressive: false },
  },
  clean_empty: {
    label: re.patterns.cleanEmpty.label,
    description: re.patterns.cleanEmpty.desc,
  },
  smart_quotes: {
    label: re.patterns.smartQuotes.label,
    description: re.patterns.smartQuotes.desc,
  },
  ellipsis: {
    label: re.patterns.ellipsis.label,
    description: re.patterns.ellipsis.desc,
  },
  full_to_half_punct: {
    label: re.patterns.fullToHalfPunct.label,
    description: re.patterns.fullToHalfPunct.desc,
  },
  ensure_single_newline: {
    label: re.patterns.ensureSingleNewline.label,
    description: re.patterns.ensureSingleNewline.desc,
  },
  ensure_double_newline: {
    label: re.patterns.ensureDoubleNewline.label,
    description: re.patterns.ensureDoubleNewline.desc,
  },
  number_fixer: {
    label: re.patterns.numberFixer.label,
    description: re.patterns.numberFixer.desc,
  },
  traditional_chinese: {
    label: re.patterns.traditionalChinese.label,
    description: re.patterns.traditionalChinese.desc,
  },
  kana_fixer: {
    label: re.patterns.kanaFixer.label,
    isExperimental: true,
    description: re.patterns.kanaFixer.desc,
  },
  punctuation_fixer: {
    label: re.patterns.punctuationFixer.label,
    isExperimental: true,
    description: re.patterns.punctuationFixer.desc,
  },
});

const buildPresetTemplates = (
  patternMetadata: Record<string, PatternMeta>,
  re: RuleEditorI18n,
): { [key: string]: Rule[] } => ({
  pre_novel: [],
  pre_general: [],
  post_novel: [
    {
      id: "o1",
      type: "format",
      active: true,
      pattern: "ensure_double_newline",
      replacement: "",
      label: re.presetRuleLabels.doubleNewlineNovel,
      description: patternMetadata["ensure_double_newline"].description,
    },
    {
      id: "o2",
      type: "format",
      active: true,
      pattern: "smart_quotes",
      replacement: "",
      label: re.presetRuleLabels.smartQuotes,
      description: patternMetadata["smart_quotes"].description,
    },
  ],
  post_general: [
    {
      id: "o4",
      type: "format",
      active: true,
      pattern: "clean_empty",
      replacement: "",
      label: re.presetRuleLabels.removeEmpty,
      description: patternMetadata["clean_empty"].description,
    },
    {
      id: "o5",
      type: "format",
      active: true,
      pattern: "ensure_single_newline",
      replacement: "",
      label: re.presetRuleLabels.singleNewline,
      description: patternMetadata["ensure_single_newline"].description,
    },
    {
      id: "o6",
      type: "format",
      active: true,
      pattern: "smart_quotes",
      replacement: "",
      label: re.presetRuleLabels.smartQuotes,
      description: patternMetadata["smart_quotes"].description,
    },
  ],
});
const generateId = () => Math.random().toString(36).substr(2, 9);

const buildProtectRule = (
  re: RuleEditorI18n,
  patterns: string = "",
): Rule => ({
  id: generateId(),
  type: "protect",
  active: true,
  pattern: "text_protect",
  replacement: "",
  description: re.textProtectDesc,
  options: { patterns },
});

const isHiddenRule = (rule: Rule) =>
  rule.type === "protect" || rule.pattern === "restore_protection";

const normalizeProtectPatterns = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "string") return value;
  return "";
};

const normalizePythonScript = (script: string) => {
  if (!script) return script;
  // Convert legacy "\n" used as line separators (outside string literals)
  const normalized = script.replace(
    /\\n(?=\s*(?:import|from|output|return|if|for|while|def|class|try|except|finally|with|lines\s*=))/g,
    "\n",
  );
  const blocks = normalized.split(/\n{2,}/);
  const deduped: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (deduped.length && deduped[deduped.length - 1] === trimmed) continue;
    deduped.push(trimmed);
  }
  return deduped.join("\n\n");
};

const normalizePythonRule = (rule: Rule) => {
  if (rule.type !== "python") return rule;
  const script = rule.script || "";
  const normalized = normalizePythonScript(script);
  if (normalized === script) return rule;
  return { ...rule, script: normalized };
};

const cloneRules = (items: Rule[]) =>
  items.map((rule) => {
    const normalizedRule = normalizePythonRule(rule);
    return {
      ...normalizedRule,
      options: normalizedRule.options ? { ...normalizedRule.options } : undefined,
    };
  });

const ensureRuleIds = (items: Rule[]) =>
  items.map((rule) => {
    const normalizedRule = normalizePythonRule(rule);
    return {
      ...normalizedRule,
      id: normalizedRule.id || generateId(),
      options: normalizedRule.options ? { ...normalizedRule.options } : undefined,
    };
  });

const buildPythonTemplates = (re: RuleEditorI18n) => [
  {
    key: "line_number",
    label: re.pythonTemplates.lineNumber.label,
    snippet: re.pythonTemplates.lineNumber.snippet,
  },
  {
    key: "bullet",
    label: re.pythonTemplates.bullet.label,
    snippet: re.pythonTemplates.bullet.snippet,
  },
  {
    key: "html",
    label: re.pythonTemplates.html.label,
    snippet: re.pythonTemplates.html.snippet,
  },
  {
    key: "brackets",
    label: re.pythonTemplates.brackets.label,
    snippet: re.pythonTemplates.brackets.snippet,
  },
  {
    key: "dup_punct",
    label: re.pythonTemplates.dupPunct.label,
    snippet: re.pythonTemplates.dupPunct.snippet,
  },
  {
    key: "punct",
    label: re.pythonTemplates.punct.label,
    snippet: re.pythonTemplates.punct.snippet,
  },
];
export function RuleEditor({ lang, mode }: RuleEditorProps) {
  const t = translations[lang];
  const re = t.ruleEditor;
  const patternMetadata = useMemo(() => buildPatternMetadata(re), [re]);
  const presetTemplates = useMemo(
    () => buildPresetTemplates(patternMetadata, re),
    [patternMetadata, re],
  );
  const pythonTemplates = useMemo(() => buildPythonTemplates(re), [re]);
  const pythonEditorExtensions = useMemo(
    () => [
      python(),
      placeholder(re.python.placeholder),
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "12px",
          lineHeight: "1.6",
          fontFamily:
            '"JetBrains Mono", "Fira Code", "Cascadia Mono", "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", "Monaco", "Noto Sans Mono CJK SC", "Microsoft YaHei UI", "PingFang SC", monospace',
          backgroundColor: "transparent",
          color: "hsl(var(--foreground))",
        },
        ".cm-content": {
          padding: "10px 12px",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          color: "hsl(var(--muted-foreground))",
          borderRight: "1px solid hsl(var(--border))",
        },
        ".cm-lineNumbers": {
          minWidth: "26px",
        },
        ".cm-activeLine": {
          backgroundColor: "hsl(var(--muted) / 0.25)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "hsl(var(--muted) / 0.25)",
        },
        ".cm-selectionBackground": {
          backgroundColor: "hsl(var(--primary) / 0.16)",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "hsl(var(--primary))",
        },
        ".cm-placeholder": {
          color: "hsl(var(--muted-foreground))",
          fontFamily:
            '"Inter", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
        },
      }),
    ],
    [re.python.placeholder],
  );

  const buildPresetRules = (presetKey: string) => {
    const preset = presetTemplates[presetKey];
    if (!preset) return [];
    return preset.map((rule) => ({
      ...rule,
      id: generateId(),
      options: rule.options ? { ...rule.options } : undefined,
    }));
  };
  const [rules, setRules] = useState<Rule[]>([]);
  const [profiles, setProfiles] = useState<RuleProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [renameProfileName, setRenameProfileName] = useState("");
  const [saved, setSaved] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [testSteps, setTestSteps] = useState<
    { label: string; text: string; changed?: boolean; error?: string }[]
  >([]);
  const [activeStep, setActiveStep] = useState<number>(-1);
  const [showPresets, setShowPresets] = useState(false);
  const [showProfileActions, setShowProfileActions] = useState(false);
  const [showPythonTemplates, setShowPythonTemplates] = useState<string | null>(
    null,
  );
  const [showProtectPresets, setShowProtectPresets] = useState(false);
  const [protectInfoOpen, setProtectInfoOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const { alertProps, showAlert, showConfirm } = useAlertModal();

  const storageKey = `config_rules_${mode}`;
  const profilesKey = `config_rules_${mode}_profiles`;
  const activeProfileKey = `config_rules_${mode}_active_profile`;
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) || profiles[0];

  useEffect(() => {
    const savedProfilesRaw = localStorage.getItem(profilesKey);
    const savedActiveId = localStorage.getItem(activeProfileKey);
    let nextProfiles: RuleProfile[] = [];

    if (savedProfilesRaw) {
      try {
        const parsed = JSON.parse(savedProfilesRaw);
        if (Array.isArray(parsed)) {
          nextProfiles = parsed.map((profile) => ({
            ...profile,
            rules: ensureRuleIds(
              Array.isArray(profile.rules) ? profile.rules : [],
            ),
          }));
        }
      } catch (e) {
        console.error("Failed to parse rule profiles:", e);
      }
    }

    if (nextProfiles.length === 0) {
      let baseRules: Rule[] = [];
      const legacyRulesRaw = localStorage.getItem(storageKey);
      if (legacyRulesRaw) {
        try {
          baseRules = ensureRuleIds(JSON.parse(legacyRulesRaw));
        } catch (e) {
          console.error("Failed to parse legacy rules:", e);
        }
      }
      if (baseRules.length === 0) {
        const defaultKey = mode === "pre" ? "pre_novel" : "post_novel";
        baseRules = buildPresetRules(defaultKey);
      }

      nextProfiles = [
        {
          id: generateId(),
          name: re.profile.defaultName,
          rules: baseRules,
          updatedAt: Date.now(),
        },
      ];
    }

    const nextActiveId =
      savedActiveId &&
      nextProfiles.some((profile) => profile.id === savedActiveId)
        ? savedActiveId
        : nextProfiles[0]?.id || "";
    const nextActiveProfile =
      nextProfiles.find((profile) => profile.id === nextActiveId) ||
      nextProfiles[0];

    setProfiles(nextProfiles);
    setActiveProfileId(nextActiveProfile?.id || "");
    setRules(cloneRules(nextActiveProfile?.rules || []));
    if (nextActiveProfile?.id) {
      localStorage.setItem(activeProfileKey, nextActiveProfile.id);
    }
    localStorage.setItem(profilesKey, JSON.stringify(nextProfiles));
    localStorage.setItem(
      storageKey,
      JSON.stringify(cloneRules(nextActiveProfile?.rules || [])),
    );
  }, [mode, profilesKey, activeProfileKey, storageKey]);

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const persistActiveProfileRules = (nextRules: Rule[]) => {
    localStorage.setItem(storageKey, JSON.stringify(nextRules));
    if (activeProfileId) {
      setProfiles((prev) => {
        const updated = prev.map((profile) =>
          profile.id === activeProfileId
            ? {
                ...profile,
                rules: cloneRules(nextRules),
                updatedAt: Date.now(),
              }
            : profile,
        );
        localStorage.setItem(profilesKey, JSON.stringify(updated));
        return updated;
      });
    }
  };

  const commitRules = (
    updater: (prev: Rule[]) => Rule[],
    options?: { flash?: boolean },
  ) => {
    setRules((prev) => {
      const nextRules = updater(prev);
      persistActiveProfileRules(nextRules);
      return nextRules;
    });
    if (options?.flash) {
      flashSaved();
    } else {
      setSaved(false);
    }
  };

  const handleSave = () => {
    commitRules((prev) => prev, { flash: true });
  };

  const insertPythonTemplate = (ruleId: string, templateKey: string) => {
    const template = pythonTemplates.find((item) => item.key === templateKey);
    if (!template) return;
    commitRules((prev) =>
      prev.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const current = normalizePythonScript(rule.script?.trim() || "");
        const normalizedTemplate = normalizePythonScript(template.snippet);
        const nextScript = current.includes(normalizedTemplate)
          ? current
          : current
            ? `${current}\n\n${normalizedTemplate}`
            : normalizedTemplate;
        return { ...rule, script: nextScript };
      }),
    );
  };

  const applyImportedProfiles = (
    importedProfiles: RuleProfile[],
    importedActiveId?: string,
  ) => {
    if (importedProfiles.length === 0) return;
    const normalizedProfiles = importedProfiles.map((profile, idx) => ({
      id: profile.id || generateId(),
      name:
        profile.name ||
        re.profile.importedName.replace("{index}", String(idx + 1)),
      rules: ensureRuleIds(Array.isArray(profile.rules) ? profile.rules : []),
      updatedAt: profile.updatedAt || Date.now(),
    }));
    const nextActiveId =
      importedActiveId &&
      normalizedProfiles.some((profile) => profile.id === importedActiveId)
        ? importedActiveId
        : normalizedProfiles[0].id;
    const nextActiveProfile =
      normalizedProfiles.find((profile) => profile.id === nextActiveId) ||
      normalizedProfiles[0];

    setProfiles(normalizedProfiles);
    setActiveProfileId(nextActiveId);
    setRules(cloneRules(nextActiveProfile.rules));
    localStorage.setItem(profilesKey, JSON.stringify(normalizedProfiles));
    localStorage.setItem(activeProfileKey, nextActiveId);
    localStorage.setItem(
      storageKey,
      JSON.stringify(cloneRules(nextActiveProfile.rules)),
    );
    setSaved(false);
  };

  const handleExportProfiles = async () => {
    try {
      const defaultName = `${mode}_rules_profiles_${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      const filePath = await window.api?.saveFile?.({
        title: re.export.title,
        defaultPath: defaultName,
        filters: [{ name: "Rule Profiles", extensions: ["json"] }],
      });
      if (!filePath) return;
      const payload = {
        version: 1,
        mode,
        exportedAt: new Date().toISOString(),
        activeProfileId,
        profiles,
      };
      const ok = await window.api?.writeFile?.(
        filePath,
        JSON.stringify(payload, null, 2),
      );
      showAlert({
        title: ok ? re.export.successTitle : re.export.failTitle,
        description: ok
          ? re.export.successDesc.replace("{path}", filePath)
          : re.export.failDesc,
        variant: ok ? "success" : "warning",
      });
    } catch (e) {
      showAlert({
        title: re.export.failTitle,
        description: String(e),
        variant: "warning",
      });
    }
  };

  const handleImportProfiles = async () => {
    try {
      const filePath = await window.api?.selectFile?.({
        title: re.import.title,
        filters: [{ name: "Rule Profiles", extensions: ["json"] }],
      });
      if (!filePath) return;
      const raw = await window.api?.readFile?.(filePath);
      if (!raw) {
        showAlert({
          title: re.import.failTitle,
          description: re.import.readFail,
          variant: "warning",
        });
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        showAlert({
          title: re.import.failTitle,
          description: re.import.parseFail,
          variant: "warning",
        });
        return;
      }

      const normalizeImport = (input: any) => {
        if (input && Array.isArray(input.profiles)) {
          return {
            profiles: input.profiles as RuleProfile[],
            activeProfileId: input.activeProfileId as string | undefined,
          };
        }
        if (Array.isArray(input)) {
          if (input.length > 0 && input[0]?.rules) {
            return { profiles: input as RuleProfile[], activeProfileId: "" };
          }
          return {
            profiles: [
              {
                id: generateId(),
                name: re.profile.importName,
                rules: ensureRuleIds(input as Rule[]),
              },
            ],
            activeProfileId: "",
          };
        }
        return null;
      };

      const normalized = normalizeImport(parsed);
      if (!normalized) {
        showAlert({
          title: re.import.failTitle,
          description: re.import.unknownFormat,
          variant: "warning",
        });
        return;
      }

      showConfirm({
        title: re.import.title,
        description: re.import.confirmDesc,
        onConfirm: () => {
          applyImportedProfiles(
            normalized.profiles,
            normalized.activeProfileId,
          );
          showAlert({
            title: re.import.successTitle,
            description: re.import.successDesc,
            variant: "success",
          });
        },
        variant: "warning",
      });
    } catch (e) {
      showAlert({
        title: re.import.failTitle,
        description: String(e),
        variant: "warning",
      });
    }
  };

  const addRule = () => {
    const newRule: Rule = {
      id: generateId(),
      type: "format",
      active: true,
      pattern: "",
      replacement: "",
    };
    commitRules((prev) => [...prev, newRule]);
  };

  const handleSelectProfile = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    setActiveProfileId(profileId);
    setRules(cloneRules(profile.rules));
    localStorage.setItem(activeProfileKey, profileId);
    localStorage.setItem(
      storageKey,
      JSON.stringify(cloneRules(profile.rules)),
    );
    setSaved(false);
    setCreatingProfile(false);
    setRenamingProfileId(null);
  };

  const handleCreateProfile = () => {
    const name =
      newProfileName.trim() ||
      re.profile.autoName.replace(
        "{index}",
        String(Math.max(1, profiles.length + 1)),
      );
    const newProfile: RuleProfile = {
      id: generateId(),
      name,
      rules: cloneRules(rules),
      updatedAt: Date.now(),
    };
    const nextProfiles = [...profiles, newProfile];
    setProfiles(nextProfiles);
    localStorage.setItem(profilesKey, JSON.stringify(nextProfiles));
    setActiveProfileId(newProfile.id);
    localStorage.setItem(activeProfileKey, newProfile.id);
    setRules(newProfile.rules);
    localStorage.setItem(storageKey, JSON.stringify(newProfile.rules));
    setCreatingProfile(false);
    setNewProfileName("");
    setSaved(false);
  };

  const handleRenameProfile = () => {
    if (!renamingProfileId) return;
    const name = renameProfileName.trim();
    if (!name) return;
    const nextProfiles = profiles.map((profile) =>
      profile.id === renamingProfileId
        ? { ...profile, name, updatedAt: Date.now() }
        : profile,
    );
    setProfiles(nextProfiles);
    localStorage.setItem(profilesKey, JSON.stringify(nextProfiles));
    setRenamingProfileId(null);
    setRenameProfileName("");
  };

  const handleDeleteProfile = () => {
    if (!activeProfile || profiles.length <= 1) return;
    showConfirm({
      title: re.profile.deleteTitle,
      description: re.profile.deleteDesc.replace("{name}", activeProfile.name),
      variant: "destructive",
      onConfirm: () => {
        const remainingProfiles = profiles.filter(
          (profile) => profile.id !== activeProfile.id,
        );
        const nextActive = remainingProfiles[0];
        setProfiles(remainingProfiles);
        localStorage.setItem(profilesKey, JSON.stringify(remainingProfiles));
        if (nextActive) {
          setActiveProfileId(nextActive.id);
          localStorage.setItem(activeProfileKey, nextActive.id);
          setRules(cloneRules(nextActive.rules));
          localStorage.setItem(
            storageKey,
            JSON.stringify(cloneRules(nextActive.rules)),
          );
        }
        setSaved(false);
      },
    });
  };

  const removeRule = (id: string) =>
    commitRules((prev) => prev.filter((r) => r.id !== id));
  const updateRule = (id: string, updates: Partial<Rule>) =>
    commitRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  const toggleRule = (id: string) =>
    commitRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r)),
    );
  const toggleProtectRule = (nextValue: boolean) =>
    commitRules((prev) => {
      const index = prev.findIndex(
        (rule) => rule.type === "protect" || rule.pattern === "text_protect",
      );
      if (nextValue) {
        if (index >= 0) {
          const current = prev[index];
          const nextRule = {
            ...current,
            type: "protect" as RuleType,
            pattern: "text_protect",
            active: true,
            description: current.description || re.textProtectDesc,
            options: {
              ...(current.options || {}),
              patterns: normalizeProtectPatterns(current.options?.patterns),
            },
          };
          const next = [...prev];
          next[index] = nextRule;
          return next;
        }
        return [...prev, buildProtectRule(re)];
      }
      if (index < 0) return prev;
      const next = [...prev];
      next[index] = { ...next[index], active: false };
      return next;
    });
  const updateProtectPatterns = (nextPatterns: string) =>
    commitRules((prev) => {
      const index = prev.findIndex(
        (rule) => rule.type === "protect" || rule.pattern === "text_protect",
      );
      if (index < 0) {
        return [...prev, buildProtectRule(re, nextPatterns)];
      }
      const current = prev[index];
      const nextRule = {
        ...current,
        type: "protect" as RuleType,
        pattern: "text_protect",
        active: true,
        description: current.description || re.textProtectDesc,
        options: {
          ...(current.options || {}),
          patterns: nextPatterns,
        },
      };
      const next = [...prev];
      next[index] = nextRule;
      return next;
    });

  // Native Drag and Drop Logic
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [dragHandleIdx, setDragHandleIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === index) return;
    setDropIdx(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === index) return;

    commitRules((prev) => {
      const next = [...prev];
      const [movedRule] = next.splice(draggedIdx, 1);
      next.splice(index, 0, movedRule);
      return next;
    });
    setDraggedIdx(null);
    setDropIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDropIdx(null);
  };

  const handleReset = () => {
    showConfirm({
      title: t.ruleEditor.resetTitle,
      description: t.ruleEditor.resetConfirm,
      variant: "destructive",
      onConfirm: () => {
        const defaultKey = mode === "pre" ? "pre_novel" : "post_novel";
        const newRules = buildPresetRules(defaultKey);
        commitRules(() => newRules, { flash: true });
      },
    });
  };

  const applyPreset = (key: string, replace: boolean = false) => {
    const preset = presetTemplates[key];
    if (preset) {
      const newRules = buildPresetRules(key);
      if (replace) {
        commitRules(() => newRules, { flash: true });
      } else {
        const existingPatterns = new Set(rules.map((r) => r.pattern));
        const uniqueNewRules = newRules.filter(
          (r) => !existingPatterns.has(r.pattern),
        );
        const finalRules = [...rules, ...uniqueNewRules];
        commitRules(() => finalRules, { flash: true });
      }
    }
    setShowPresets(false);
  };

  const runTest = async () => {
    if (!testInput.trim()) {
      showAlert({
        title: re.sandbox.testInputRequired,
        description: re.sandbox.testInputPlaceholder,
        variant: "warning",
      });
      return;
    }
    setTesting(true);
    try {
      if (!window.api?.testRules) {
        const errMsg = re.testErrors.unavailable;
        console.error("IPC Test Error:", errMsg);
        setTestSteps([{ label: re.errorLabel, text: errMsg }]);
        setTestOutput(errMsg);
        setActiveStep(0);
        return;
      }

      const normalizedRules = rules.map((rule) => {
        if (rule.type !== "python") return rule;
        const script = normalizePythonScript(rule.script || "");
        return script === (rule.script || "")
          ? rule
          : { ...rule, script };
      });
      const hasNormalization = normalizedRules.some(
        (rule, idx) => (rule.script || "") !== (rules[idx]?.script || ""),
      );
      if (hasNormalization) {
        commitRules(() => normalizedRules);
      }
      const result = await window.api.testRules(testInput, normalizedRules);
      if (!result) {
        const errMsg = re.testErrors.noResult;
        console.error("Python Test Error:", errMsg);
        setTestSteps([{ label: re.errorLabel, text: errMsg }]);
        setTestOutput(errMsg);
        setActiveStep(0);
        return;
      }
      if (result.success) {
        const steps = Array.isArray(result.steps) ? result.steps : [];
        setTestSteps(steps);
        if (steps.length > 0) {
          const errorIndex = steps.findIndex((step) => step?.error);
          setTestOutput(steps[steps.length - 1].text);
          setActiveStep(errorIndex >= 0 ? errorIndex : steps.length - 1);
        } else {
          setTestOutput("");
          setActiveStep(-1);
        }
      } else {
        const errMsg = result.error || re.unknownError;
        console.error("Python Test Error:", errMsg);
        setTestSteps([{ label: re.errorLabel, text: errMsg }]);
        setTestOutput(errMsg);
        setActiveStep(0);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("IPC Test Error:", e);
      setTestSteps([{ label: re.errorLabel, text: errMsg }]);
      setTestOutput(errMsg);
      setActiveStep(0);
    } finally {
      setTesting(false);
    }
  };

  const presetGroups =
    mode === "pre"
      ? [
          {
            key: "pre_novel",
            label: re.presetGroups.preNovel.label,
            desc: re.presetGroups.preNovel.desc,
          },
          {
            key: "pre_general",
            label: re.presetGroups.preGeneral.label,
            desc: re.presetGroups.preGeneral.desc,
          },
        ]
      : [
          {
            key: "post_novel",
            label: re.presetGroups.postNovel.label,
            desc: re.presetGroups.postNovel.desc,
          },
          {
            key: "post_general",
            label: re.presetGroups.postGeneral.label,
            desc: re.presetGroups.postGeneral.desc,
          },
        ];

  const protectPresets = useMemo(
    () => [
      {
        key: "name_tags",
        label: re.textProtectPresetNameTags,
        lines: "\\[\\[.+?\\]\\]",
      },
      {
        key: "html_tags",
        label: re.textProtectPresetHtmlTags,
        lines: "<[^>]+>",
      },
      {
        key: "dollar_vars",
        label: re.textProtectPresetDollarVars,
        lines: "\\$\\{[^}]+\\}",
      },
      {
        key: "double_braces",
        label: re.textProtectPresetDoubleBraces,
        lines: "\\{\\{.+?\\}\\}",
      },
      {
        key: "percent_placeholders",
        label: re.textProtectPresetPercent,
        lines: "%[a-zA-Z0-9_]+",
      },
      {
        key: "square_brackets",
        label: re.textProtectPresetSquareBrackets,
        lines: "\\[[^\\]]+\\]",
      },
      {
        key: "fullwidth_brackets",
        label: re.textProtectPresetFullwidthBrackets,
        lines: "【[^】]+】",
      },
      {
        key: "single_braces",
        label: re.textProtectPresetSingleBraces,
        lines: "\\{[^}]+\\}",
      },
    ],
    [re],
  );

  const currentStepText =
    activeStep >= 0 && testSteps[activeStep]
      ? testSteps[activeStep].text
      : testOutput;
  const currentStepError =
    activeStep >= 0 && testSteps[activeStep]?.error
      ? testSteps[activeStep]?.error
      : "";
  const protectRule =
    mode === "pre"
      ? rules.find(
          (rule) =>
            rule.type === "protect" || rule.pattern === "text_protect",
        )
      : null;
  const protectEnabled = Boolean(protectRule?.active);
  const protectPatterns =
    normalizeProtectPatterns(protectRule?.options?.patterns);
  useEffect(() => {
    if (protectEnabled) {
      setProtectInfoOpen(false);
    }
  }, [protectEnabled]);
  const applyProtectPreset = (presetLines: string) => {
    const nextLines = presetLines
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const existing = protectPatterns
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const merged = [...existing];
    nextLines.forEach((line) => {
      if (!merged.includes(line)) merged.push(line);
    });
    updateProtectPatterns(merged.join("\n"));
  };
  const visibleRules = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !isHiddenRule(rule));

  return (
    <div className="flex-1 h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Glossy Header */}
      <div className="px-8 py-6 border-b border-border bg-card/30 backdrop-blur-xl shrink-0 dark:bg-white/5 relative z-20">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1 min-w-0 max-w-[560px]">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight">
                  {mode === "pre" ? re.modePreTitle : re.modePostTitle}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mt-2 font-medium">
                {mode === "pre" ? re.modePreDesc : re.modePostDesc}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-nowrap shrink-0">
              <div className="flex items-center gap-2">
                <Tooltip content={re.profile.currentTooltip}>
                  <div className="flex items-center text-muted-foreground">
                    <Layers className="w-4 h-4 text-purple-500" />
                  </div>
                </Tooltip>
                <div className="relative">
                  <select
                    className="h-9 min-w-[120px] bg-background border border-border/70 rounded-lg px-3 pr-8 text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all appearance-none cursor-pointer"
                    value={activeProfileId}
                    onChange={(e) => handleSelectProfile(e.target.value)}
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground rotate-90 pointer-events-none" />
                </div>
                <div className="relative">
                  <Tooltip content={re.profile.manageTooltip}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        setShowProfileActions(!showProfileActions);
                        setShowPresets(false);
                      }}
                      className="bg-background border-input hover:bg-accent text-foreground"
                    >
                      <Settings2 className="w-4 h-4" />
                    </Button>
                  </Tooltip>
                  {showProfileActions && (
                    <div className="absolute right-0 mt-2 w-56 bg-popover/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-border z-50 p-2 animate-in fade-in zoom-in-95 duration-200">
                      <div className="space-y-1">
                        <button
                          onClick={() => {
                            setCreatingProfile(true);
                            setRenamingProfileId(null);
                            setNewProfileName("");
                            setShowProfileActions(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent text-sm font-medium text-foreground"
                        >
                          <Plus className="w-4 h-4 text-purple-500" />
                          {re.profile.createAction}
                        </button>
                        <button
                          onClick={() => {
                            if (!activeProfile) return;
                            setRenamingProfileId(activeProfile.id);
                            setRenameProfileName(activeProfile.name);
                            setCreatingProfile(false);
                            setShowProfileActions(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent text-sm font-medium text-foreground"
                        >
                          <PenLine className="w-4 h-4 text-purple-500" />
                          {re.profile.renameAction}
                        </button>
                        <button
                          onClick={() => {
                            setShowProfileActions(false);
                            handleDeleteProfile();
                          }}
                          disabled={profiles.length <= 1}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-destructive/10 text-sm font-medium text-destructive disabled:text-muted-foreground disabled:hover:bg-transparent"
                        >
                          <Trash className="w-4 h-4" />
                          {re.profile.deleteAction}
                        </button>
                      </div>
                      <div className="h-px bg-border my-2" />
                      <div className="space-y-1">
                        <button
                          onClick={() => {
                            setShowProfileActions(false);
                            handleImportProfiles();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent text-sm font-medium text-foreground"
                        >
                          <Upload className="w-4 h-4 text-purple-500" />
                          {re.profile.importAction}
                        </button>
                        <button
                          onClick={() => {
                            setShowProfileActions(false);
                            handleExportProfiles();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent text-sm font-medium text-foreground"
                        >
                          <Download className="w-4 h-4 text-purple-500" />
                          {re.profile.exportAction}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="h-8 w-[1px] bg-border" />

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={addRule}
                  className="bg-background border-input hover:bg-accent text-foreground"
                >
                  <Plus className="w-4 h-4 mr-2" /> {re.addRule}
                </Button>

                <div className="relative group">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowPresets(!showPresets);
                      setShowProfileActions(false);
                    }}
                    className="bg-background hover:bg-accent border-input hover:border-purple-500/50 transition-all duration-300"
                  >
                    <Sparkles className="w-4 h-4 mr-2 text-purple-500" /> {re.presets}
                  </Button>
                  {showPresets && (
                    <div className="absolute right-0 mt-3 w-80 bg-popover/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-border z-50 p-4 animate-in fade-in zoom-in-95 duration-200">
                      <div className="flex items-center gap-2 mb-4 px-1">
                        <Layers className="w-4 h-4 text-purple-500" />
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {re.selectStrategy}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {presetGroups.map((p) => (
                          <div
                            key={p.key}
                            className="flex items-center gap-2 group/item"
                          >
                            <button
                              onClick={() => applyPreset(p.key, true)}
                              className="flex-1 text-left px-4 py-3 rounded-xl bg-secondary/50 hover:bg-purple-500/10 border border-transparent hover:border-purple-500/30 transition-all duration-200"
                            >
                              <div className="text-sm font-semibold text-foreground group-hover/item:text-purple-600 dark:group-hover/item:text-purple-400">
                                {p.label}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {p.desc}
                              </div>
                            </button>
                            <Tooltip content={re.appendRule}>
                              <button
                                onClick={() => applyPreset(p.key, false)}
                                className="p-3 rounded-xl bg-secondary/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </Tooltip>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="bg-background border-input hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
                >
                  <History className="w-4 h-4 mr-2" /> {re.resetDefault}
                </Button>
              </div>

              <div className="h-8 w-[1px] bg-border" />
              <Button
                onClick={handleSave}
                className={`h-10 px-7 text-sm transition-all duration-500 font-bold shadow-[0_0_20px_rgba(168,85,247,0.1)] dark:shadow-[0_0_20px_rgba(168,85,247,0.2)] ${saved ? "bg-emerald-500 hover:bg-emerald-600" : "bg-gradient-to-r from-purple-600 to-indigo-600 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]"}`}
              >
                <Save className="w-4 h-4 mr-2" /> {saved ? re.saveReady : re.saveConfig}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {creatingProfile && (
        <div className="px-8 py-3 border-b border-border bg-secondary/40">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-tight">
              {re.profile.createTitle}
            </span>
            <input
              className="bg-background border border-border px-3 py-1.5 rounded-lg text-xs w-60 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
              placeholder={re.profile.createPlaceholder}
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleCreateProfile}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {re.profile.createAction}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreatingProfile(false);
                  setNewProfileName("");
                }}
              >
                {re.profile.cancelAction}
              </Button>
            </div>
            <span className="text-[10px] text-muted-foreground/60 italic">
              {re.profile.copyHint}
            </span>
          </div>
        </div>
      )}

      {renamingProfileId && (
        <div className="px-8 py-3 border-b border-border bg-amber-500/10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-amber-600 flex items-center gap-2">
              <PenLine className="w-3.5 h-3.5" />
              {re.profile.renameTitle}
            </span>
            <input
              className="bg-background border border-amber-500/30 px-3 py-1.5 rounded-lg text-xs w-60 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
              value={renameProfileName}
              onChange={(e) => setRenameProfileName(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleRenameProfile}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {re.profile.saveAction}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenamingProfileId(null);
                  setRenameProfileName("");
                }}
              >
                {re.profile.cancelAction}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workbench */}
      <div className="flex-1 flex overflow-hidden bg-gradient-to-b from-transparent to-purple-500/5 dark:to-purple-900/10">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 custom-scrollbar">
            {mode === "pre" && (
              <div className="rounded-2xl border border-border/60 bg-card/80 p-3 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-1.5">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {re.textProtectLabel}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-relaxed mt-0.5">
                      {re.textProtectDesc}
                      {" "}
                      <span className="whitespace-nowrap">
                        {re.textProtectSupportNote}
                      </span>
                    </p>
                    {!protectEnabled && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {re.textProtectCollapsedHint}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={protectEnabled}
                      onCheckedChange={toggleProtectRule}
                      aria-label={re.textProtectLabel}
                    />
                  </div>
                </div>
                {protectEnabled && (
                  <div className="mt-2 space-y-2.5">
                    <div className="space-y-1.5">
                      <textarea
                        className="w-full min-h-[72px] rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all"
                        placeholder={re.textProtectPlaceholder}
                        value={protectPatterns}
                        onChange={(e) =>
                          updateProtectPatterns(e.target.value)
                        }
                        spellCheck={false}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <div className="relative inline-flex">
                          <button
                            type="button"
                            onClick={() =>
                              setShowProtectPresets((prev) => !prev)
                            }
                            className="h-7 px-2 text-[10px] font-semibold rounded-lg border border-border/60 bg-background text-foreground/80 hover:border-purple-500/40 hover:text-purple-600 dark:hover:text-purple-300 transition-all inline-flex items-center gap-1"
                          >
                            {re.textProtectPresetsTitle}
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground rotate-90" />
                          </button>
                          {showProtectPresets && (
                            <div className="absolute right-0 mt-2 w-56 bg-popover/95 backdrop-blur-2xl rounded-xl shadow-xl border border-border z-50 p-2 animate-in fade-in zoom-in-95 duration-200">
                              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1">
                                {re.textProtectPresetsTitle}
                              </div>
                              <div className="space-y-1">
                                {protectPresets.map((preset) => (
                                  <button
                                    key={preset.key}
                                    type="button"
                                    onClick={() => {
                                      applyProtectPreset(preset.lines);
                                      setShowProtectPresets(false);
                                    }}
                                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-[11px] font-semibold text-foreground"
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border/30 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-foreground/80">
                          {re.textProtectInfoTitle}
                        </div>
                        <button
                          type="button"
                          onClick={() => setProtectInfoOpen((prev) => !prev)}
                          className="text-[11px] font-semibold text-purple-600 hover:text-purple-500"
                        >
                          {protectInfoOpen
                            ? re.textProtectInfoCollapse
                            : re.textProtectInfoExpand}
                        </button>
                      </div>
                      <div className="text-[12px] text-muted-foreground leading-relaxed">
                        {re.textProtectInfoSummary}
                      </div>
                      {protectInfoOpen && (
                        <div className="space-y-2.5">
                          <div className="space-y-1">
                            <div className="text-[12px] font-semibold text-muted-foreground">
                              {re.textProtectInfoRuleTitle}
                            </div>
                            <div className="space-y-0.5 text-[12px] text-muted-foreground/80 leading-relaxed">
                              <div>{re.textProtectInfoRuleLine1}</div>
                              <div>{re.textProtectInfoRuleLine2}</div>
                              <div>{re.textProtectInfoRuleLine3}</div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[12px] font-semibold text-muted-foreground">
                              {re.textProtectInfoAlgorithmTitle}
                            </div>
                            <div className="space-y-1 text-[12px] text-muted-foreground/80 leading-relaxed">
                              <div className="flex items-start gap-2">
                                <span className="text-muted-foreground/60">•</span>
                                <span>{re.textProtectInfoStep1}</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <span className="text-muted-foreground/60">•</span>
                                <span>{re.textProtectInfoStep2}</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <span className="text-muted-foreground/60">•</span>
                                <span>{re.textProtectInfoStep3}</span>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[12px] font-semibold text-muted-foreground">
                              {re.textProtectInfoExampleTitle}
                            </div>
                            <div className="space-y-0.5 text-[12px] text-muted-foreground/80 leading-relaxed">
                              <div>
                                <span className="text-muted-foreground">
                                  {re.textProtectInfoExampleRuleLabel}
                                </span>{" "}
                                {re.textProtectInfoExampleRule}
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  {re.textProtectInfoExampleInputLabel}
                                </span>{" "}
                                {re.textProtectInfoExampleInput}
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  {re.textProtectInfoExampleProtectedLabel}
                                </span>{" "}
                                {re.textProtectInfoExampleProtected}
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  {re.textProtectInfoExampleOutputLabel}
                                </span>{" "}
                                {re.textProtectInfoExampleOutput}
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[12px] font-semibold text-muted-foreground">
                              {re.textProtectInfoEffectTitle}
                            </div>
                            <div className="space-y-0.5 text-[12px] text-muted-foreground/80 leading-relaxed">
                              <div>{re.textProtectInfoEffectLine1}</div>
                              <div>{re.textProtectInfoEffectLine2}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {visibleRules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-2">
                <div className="w-5 h-5 rounded-md border border-border/60 bg-background flex items-center justify-center">
                  <Layers className="w-3 h-3 text-muted-foreground/70" />
                </div>
                <span>{re.emptyStateCompact}</span>
              </div>
            ) : (
              visibleRules.map(({ rule, index }, visibleIndex) => (
                <div
                  key={rule.id}
                  className={`group relative flex gap-4 p-4 rounded-2xl border transition-all duration-300 ${draggedIdx === index ? "opacity-20 scale-[0.98] border-dashed border-purple-500/50" : dropIdx === index ? "border-purple-500 shadow-lg shadow-purple-500/10" : !rule.active ? "bg-muted/30 border-border/50 opacity-50 grayscale" : "bg-card border-border hover:border-purple-500/40 hover:shadow-sm"}`}
                  draggable={rule.active && dragHandleIdx === index}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  {/* Numbering integrated into the card */}
                  <div className="flex flex-col items-center gap-3 pt-1 shrink-0">
                    <div
                      className={`w-6 h-6 rounded-lg border flex items-center justify-center text-[10px] font-bold transition-colors ${rule.active ? "bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400" : "bg-muted border-border text-muted-foreground"}`}
                    >
                      {visibleIndex + 1}
                    </div>
                    <button
                      onClick={() => toggleRule(rule.id)}
                      className={`transition-all duration-300 transform hover:scale-110 ${rule.active ? "text-purple-500" : "text-muted-foreground"}`}
                    >
                      {rule.active ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <Circle className="w-5 h-5" />
                      )}
                    </button>
                    <div
                      className="cursor-grab active:cursor-grabbing p-1 -m-1"
                      onMouseEnter={() => setDragHandleIdx(index)}
                      onMouseLeave={() => setDragHandleIdx(null)}
                    >
                      <GripVertical className="w-4 h-4 text-muted-foreground/20 hover:text-muted-foreground transition-colors" />
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col gap-4">
                    {/* Top Row: Primary Selections */}
                    <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-start">
                      <div className="w-full lg:w-[180px]">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">
                          {re.executor.typeLabel}
                        </div>
                        <div className="relative">
                          <select
                            className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all appearance-none cursor-pointer"
                            value={rule.type}
                            onChange={(e) => {
                              const newType = e.target.value as RuleType;
                              updateRule(rule.id, {
                                type: newType,
                                pattern: "",
                                replacement: "",
                                description: "",
                                options: undefined,
                                script: "",
                              });
                            }}
                          >
                            <option value="format">{re.executor.options.format}</option>
                            <option value="replace">{re.executor.options.replace}</option>
                            <option value="regex">{re.executor.options.regex}</option>
                            <option value="python">{re.executor.options.python}</option>
                          </select>
                          <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground rotate-90 pointer-events-none" />
                        </div>
                      </div>

                      <div className="flex-1 w-full lg:w-auto min-w-0">
                        {rule.type === "format" ? (
                          <div>
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">
                              {re.executor.templateLabel}
                            </div>
                            <div className="relative">
                              <select
                                className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all appearance-none cursor-pointer"
                                value={rule.pattern}
                                onChange={(e) => {
                                  const meta = patternMetadata[e.target.value];
                                  updateRule(rule.id, {
                                    pattern: e.target.value,
                                    description: meta?.description || "",
                                    options: meta?.defaultOptions || undefined,
                                  });
                                }}
                              >
                                <option value="">{re.executor.templatePlaceholder}</option>
                                {Object.entries(patternMetadata).map(
                                  ([key, meta]) => (
                                    <option key={key} value={key}>
                                      {meta.label}
                                      {meta.isExperimental
                                        ? re.experimentalSuffix
                                        : ""}
                                    </option>
                                  ),
                                )}
                              </select>
                              <Sparkles className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-500 pointer-events-none" />
                            </div>
                          </div>
                        ) : rule.type === "python" ? (
                          <div className="space-y-2 w-full min-w-0 max-w-full">
                            <div className="flex items-center justify-between gap-3 w-full max-w-full relative">
                              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-0.5 ml-0.5 shrink-0">
                                {re.executor.options.python}
                              </div>
                              <div className="relative">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setShowPythonTemplates((prev) =>
                                      prev === rule.id ? null : rule.id,
                                    )
                                  }
                                  className="h-7 px-2 text-[10px] font-semibold"
                                >
                                  <Sparkles className="w-3.5 h-3.5 mr-1 text-purple-500" />
                                  {re.python.templateLibrary}
                                  <ChevronRight className="w-3.5 h-3.5 ml-1 rotate-90 text-muted-foreground" />
                                </Button>
                                {showPythonTemplates === rule.id && (
                                  <div className="absolute left-0 mt-2 w-56 bg-popover/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-border z-50 p-2 animate-in fade-in zoom-in-95 duration-200">
                                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1">
                                      {re.python.insertTemplate}
                                    </div>
                                    <div className="space-y-1">
                                      {pythonTemplates.map((template) => (
                                        <button
                                          key={template.key}
                                          onClick={() => {
                                            insertPythonTemplate(
                                              rule.id,
                                              template.key,
                                            );
                                            setShowPythonTemplates(null);
                                          }}
                                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-[11px] font-semibold text-foreground"
                                        >
                                          {template.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="w-full min-h-[160px] rounded-lg border border-border bg-background/50 focus-within:ring-1 focus-within:ring-purple-500/40 transition-all">
                              <CodeMirror
                                value={rule.script || ""}
                                minHeight="160px"
                                basicSetup={{
                                  lineNumbers: false,
                                  foldGutter: false,
                                  highlightActiveLineGutter: false,
                                }}
                                extensions={pythonEditorExtensions}
                                onChange={(value) =>
                                  updateRule(rule.id, { script: value })
                                }
                              />
                            </div>
                            <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 text-[10px] text-muted-foreground/80">
                              <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1 items-start">
                                <div className="text-muted-foreground/70 font-semibold text-right">
                                  {re.python.help.variables}
                                </div>
                                <div className="font-mono text-foreground/80 break-words">
                                  transform(text, src_text=None, protector=None)
                                </div>
                                <div className="text-muted-foreground/70 font-semibold text-right">
                                  {re.python.help.returns}
                                </div>
                                <div className="font-mono text-foreground/80 break-words">
                                  {"return <string>"}
                                </div>
                                <div className="text-muted-foreground/70 font-semibold text-right">
                                  {re.python.help.modules}
                                </div>
                                <div className="font-mono text-foreground/80 break-words">
                                  re
                                </div>
                                <div className="text-muted-foreground/70 font-semibold text-right">
                                  {re.python.help.builtins}
                                </div>
                                <div className="font-mono text-foreground/80 break-words">
                                  len / range / min / max / sum / sorted
                                </div>
                                <div className="text-muted-foreground/70 font-semibold text-right">
                                  {re.python.help.limitsLabel}
                                </div>
                                <div className="font-mono text-foreground/80 break-words">
                                  {re.python.help.limits}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">
                                {re.replace.matchLabel}
                              </div>
                              <input
                                type="text"
                                className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all font-semibold"
                                placeholder={
                                  rule.type === "regex"
                                    ? "(\\d+)"
                                    : re.replace.matchPlaceholder
                                }
                                value={rule.pattern}
                                onChange={(e) =>
                                  updateRule(rule.id, {
                                    pattern: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="flex-1">
                              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight mb-1.5 ml-0.5">
                                {re.replace.replaceLabel}
                              </div>
                              <input
                                type="text"
                                className="w-full h-9 bg-background border border-border rounded-lg px-3 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-all font-semibold"
                                placeholder={re.replace.replacePlaceholder}
                                value={rule.replacement}
                                onChange={(e) =>
                                  updateRule(rule.id, {
                                    replacement: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="pt-0 lg:pt-1">
                        <Tooltip content={re.tooltips.deleteRule}>
                          <button
                            onClick={() => removeRule(rule.id)}
                            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Bottom Row: Details/Options */}
                    {rule.type === "format" && rule.pattern && (
                      <div className="p-3 rounded-xl bg-muted/20 border border-border/40 transition-all">
                        <div className="flex gap-3">
                          <AlertCircle className="w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5 opacity-60" />
                          <div className="flex-1 space-y-2">
                            <div className="flex justify-between items-start gap-4">
                              <div className="text-[11px] text-muted-foreground leading-relaxed font-medium flex-1">
                                {rule.description
                                  ?.split("\n")
                                  .filter((l) => !l.startsWith(re.examplePrefix))
                                  .map((line, lIdx) => (
                                    <div key={lIdx} className="mb-0.5">
                                      {line}
                                    </div>
                                  )) || re.noExtraParams}
                              </div>
                              {rule.pattern === "ruby_cleaner" && (
                                <label className="flex items-center gap-2 cursor-pointer group/opt shrink-0 mt-0.5">
                                  <div className="relative flex items-center justify-center w-3.5 h-3.5">
                                    <input
                                      type="checkbox"
                                      className="peer appearance-none w-full h-full rounded border border-border bg-background checked:bg-purple-600 checked:border-purple-500 transition-all cursor-pointer"
                                      checked={
                                        rule.options?.aggressive || false
                                      }
                                      onChange={(e) =>
                                        updateRule(rule.id, {
                                          options: {
                                            ...rule.options,
                                            aggressive: e.target.checked,
                                          },
                                        })
                                      }
                                    />
                                    <CheckCircle2 className="absolute w-2.5 h-2.5 text-white scale-0 peer-checked:scale-100 transition-all duration-300" />
                                  </div>
                                  <span className="text-[10px] font-bold text-muted-foreground group-hover/opt:text-foreground transition-colors uppercase tracking-tight">
                                    {re.aggressiveMode}
                                  </span>
                                </label>
                              )}
                            </div>

                            {/* Examples and remaining specialized UI */}
                            {rule.description
                              ?.split("\n")
                              .filter((l) => l.startsWith(re.examplePrefix))
                              .map((line, lIdx) => (
                                <div
                                  key={lIdx}
                                  className="mt-2 px-3 py-2 rounded-lg bg-background border border-border/30 font-mono text-[10px] text-foreground/70"
                                >
                                  <span>
                                    {line
                                      .split(/(→|\\n)/g)
                                      .map((part, pIdx) => (
                                        <span
                                          key={pIdx}
                                          className={
                                            part === "→"
                                              ? "mx-1 text-purple-500"
                                              : part === "\\n"
                                                ? "px-1 py-0.5 mx-0.5 rounded bg-muted text-purple-600 dark:text-purple-400 font-bold"
                                                : ""
                                          }
                                        >
                                          {part}
                                        </span>
                                      ))}
                                  </span>
                                </div>
                              ))}

                            {patternMetadata[rule.pattern]?.isExperimental && (
                              <div className="pt-2 border-t border-border/30 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                <AlertCircle className="w-3 h-3" />
                                <span className="text-[10px] font-bold uppercase tracking-tight">
                                  {re.experimentalWarning}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="w-[380px] border-l border-border bg-muted/10 backdrop-blur-3xl flex flex-col group/sandbox">
          <div className="px-5 py-4 border-b border-border bg-muted/20 transition-colors group-hover/sandbox:bg-muted/30">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-bold flex items-center gap-2 text-foreground">
                <PlayCircle className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 group-hover/sandbox:scale-110 transition-transform" />
                {re.sandbox.title}
              </h3>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] text-muted-foreground/80 leading-relaxed">
                {re.sandbox.desc}
              </p>
              <p className="text-[9px] text-muted-foreground/50 leading-relaxed italic">
                {re.sandbox.subDesc}
              </p>
            </div>
          </div>
          <div className="flex-1 flex flex-col p-5 space-y-4 overflow-hidden">
            <div className="flex-[2] flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[9px] font-bold text-muted-foreground uppercase ml-0.5 flex items-center gap-1">
                  <History className="w-3 h-3" /> {re.sandbox.testInputLabel}
                </label>
                <span className="text-[9px] text-muted-foreground/60 font-mono">
                  {testInput.length} chars
                </span>
              </div>
              <textarea
                className="flex-1 w-full bg-background border border-border rounded-xl p-3 text-[11px] font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-purple-500/30 transition-all custom-scrollbar"
                placeholder={re.sandbox.testInputPlaceholder}
                spellCheck={false}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
              />
              <Button
                onClick={runTest}
                disabled={testing}
                variant="secondary"
                className="mt-2 w-full h-10 border border-border hover:border-purple-500/20 rounded-xl group transition-all"
                title={!testInput.trim() ? re.sandbox.testInputRequired : ""}
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin text-purple-500" />
                ) : (
                  <PlayCircle className="w-4 h-4 mr-2 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform" />
                )}
                <span className="font-bold tracking-tight uppercase text-[10px]">
                  {testing ? re.sandbox.testing : re.sandbox.run}
                </span>
              </Button>
            </div>
            <div className="flex-[3] flex flex-col min-h-0 pt-2 border-t border-border/40">
              <div className="flex items-center gap-1.5 mb-3">
                <div
                  className={`flex-1 min-h-[32px] flex items-center justify-center rounded-lg text-center cursor-pointer transition-all border ${activeStep === 0 ? "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-white" : "bg-background border-border text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setActiveStep(0)}
                >
                  <div className="text-[9px] font-bold uppercase tracking-tight">
                    {re.sandbox.sourceLabel}
                  </div>
                </div>
                <ArrowRight className="w-3 h-3 text-border/60" />
                <div
                  className={`flex-1 min-h-[32px] flex items-center justify-center rounded-lg text-center cursor-pointer transition-all border ${activeStep === testSteps.length - 1 ? "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-white" : "bg-background border-border text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setActiveStep(testSteps.length - 1)}
                >
                  <div className="text-[9px] font-bold uppercase tracking-tight">
                    {re.sandbox.finalLabel}
                  </div>
                </div>
              </div>
              {testSteps.length > 0 ? (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                    <History className="w-2.5 h-2.5 text-emerald-500/70" />
                    <span className="text-[9px] font-bold uppercase text-muted-foreground/60">
                      {re.sandbox.traceTitle}
                    </span>
                  </div>
                  <div className="flex-1 bg-background border border-border rounded-xl overflow-hidden flex flex-col shadow-inner">
                    <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap select-text custom-scrollbar">
                      {currentStepError && (
                        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
                          {re.errorLabel}: {currentStepError}
                        </div>
                      )}
                      {currentStepText || (
                        <span className="text-muted-foreground/40 italic">
                          {re.sandbox.traceWaiting}
                        </span>
                      )}
                    </div>
                    <div className="px-3 py-1.5 bg-muted/10 border-t border-border/40 flex gap-1 overflow-x-auto scroller-hide">
                      {testSteps.map((step, sIdx) => {
                        const hasError = Boolean(step?.error);
                        return (
                          <button
                            key={sIdx}
                            onClick={() => setActiveStep(sIdx)}
                            className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold transition-all ${activeStep === sIdx ? "bg-purple-500 text-white shadow-sm" : hasError ? "bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20" : "bg-background border border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                          >
                            {sIdx}
                          </button>
                        );
                      })}
                    </div>
                    <div className="px-3 py-1.5 bg-purple-500/5 flex items-center gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-purple-500 animate-pulse" />
                      <span className="text-[9px] font-bold text-purple-600 dark:text-purple-300 truncate tracking-tight uppercase">
                        {re.sandbox.stepPrefix} {activeStep}:{" "}
                        {testSteps[activeStep]?.label || re.sandbox.stepInitial}
                        {testSteps[activeStep]?.error ? ` (${re.errorLabel})` : ""}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center border border-dashed border-border/40 rounded-2xl opacity-40 bg-muted/5">
                  <Eye className="w-6 h-6 mb-2 opacity-20" />
                  <p className="text-[9px] font-bold uppercase tracking-tight">
                    {re.sandbox.flowReady}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <AlertModal {...alertProps} />
    </div>
  );
}




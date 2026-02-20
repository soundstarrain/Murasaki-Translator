import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import yaml from "js-yaml";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import {
  Button,
  Input as BaseInput,
  Label,
  Tooltip,
  Card,
} from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { emitToast } from "../lib/toast";
import {
  RefreshCw,
  Save,
  Trash2,
  Plus,
  Activity,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Server,
  FolderOpen,
  Workflow,
  MessageSquare,
  FileJson,
  Search,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Code2,
  Zap,
  Cpu,
  Gauge,
  Clock,
  Thermometer,
  Percent,
  Hash,
  Repeat,
  Scissors,
  Loader2,
  ArrowRight,
  Check,
} from "lucide-react";
import { Switch } from "./ui/core";
import { cn } from "../lib/utils";
import { createUniqueProfileId, slugifyProfileId } from "../lib/profileId";
import { isParserProfileBlank } from "../lib/parserProfile";
import { buildApiPresetProfileId, normalizePresetUrl } from "../lib/apiManagerUtils";
import { normalizeChunkType } from "../lib/chunkProfile";
import {
  buildPipelineSummary,
  prunePipelineSummaryIndex,
  type PipelineSummary,
  resolvePipelineTranslationMode,
} from "../lib/pipelineProfile";
import {
  buildPromptLegacyParts,
  shouldPreserveLegacyPromptParts,
  type PromptLegacyParts,
} from "../lib/promptProfile";
import {
  parseJsonlPreviewLines,
  parseJsonPreviewValue,
  parseTaggedLinePreviewLines,
  stripThinkTags,
} from "../lib/parserPreview";
import { KVEditor } from "./api-manager/shared/KVEditor";
import { FormSection } from "./api-manager/shared/FormSection";
import { TemplateSelector } from "./api-manager/shared/TemplateSelector";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";
import deepseekLogo from "../assets/brands/deepseek.ico";
import googleLogo from "../assets/brands/google.ico";
import qwenLogo from "../assets/brands/qwen.png";
import moonshotLogo from "../assets/brands/moonshot.ico";
import zhipuLogo from "../assets/brands/zhipu.png";
import siliconflowLogo from "../assets/brands/siliconflow.png";
import openrouterLogo from "../assets/brands/openrouter.ico";
import mistralLogo from "../assets/brands/mistral.ico";
import openaiLogo from "../assets/brands/openai.ico";
import anthropicLogo from "../assets/brands/anthropic.ico";
import grokLogo from "../assets/brands/grok.png";

const Input = (props: ComponentProps<typeof BaseInput>) => (
  <BaseInput spellCheck={false} {...props} />
);

const safeLoadYaml = (raw: string) => {
  try {
    return yaml.load(raw) as any;
  } catch {
    return null;
  }
};

const SelectField = ({
  className,
  children,
  ...props
}: ComponentProps<"select">) => (
  <div className="relative">
    <select
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm shadow-sm transition-colors hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
  </div>
);

type InputAffixProps = Omit<ComponentProps<typeof BaseInput>, "prefix"> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
};

const InputAffix = ({
  prefix,
  suffix,
  className,
  containerClassName,
  ...props
}: InputAffixProps) => (
  <div className={cn("relative", containerClassName)}>
    {prefix && (
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        {prefix}
      </div>
    )}
    <Input
      className={cn(prefix && "pl-9", suffix && "pr-11", className)}
      {...props}
    />
    {suffix && (
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase text-muted-foreground">
        {suffix}
      </div>
    )}
  </div>
);

type KeyValuePair = { key: string; value: string; valueKind?: "string" };

type PoolEndpointForm = {
  baseUrl: string;
  apiKeys: string;
  model: string;
  weight: string;
};

const createEmptyPair = (): KeyValuePair => ({ key: "", value: "" });
const createPoolEndpoint = (): PoolEndpointForm => ({
  baseUrl: "",
  apiKeys: "",
  model: "",
  weight: "1",
});

const toPairValue = (
  value: unknown,
): Pick<KeyValuePair, "value" | "valueKind"> => {
  if (typeof value === "string") {
    return { value, valueKind: "string" };
  }
  if (value === undefined) return { value: "" };
  if (value && typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      if (json !== undefined) return { value: json };
    } catch {
      // ignore
    }
  }
  return { value: String(value) };
};

const parseKeyValuePairs = (text: string): KeyValuePair[] => {
  const trimmed = text.trim();
  if (!trimmed) return [createEmptyPair()];
  try {
    const data = JSON.parse(trimmed);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const entries = Object.entries(data);
      if (!entries.length) return [createEmptyPair()];
      return entries.map(([key, value]) => ({
        key: String(key),
        ...toPairValue(value),
      }));
    }
  } catch { }
  return [createEmptyPair()];
};

const parseJsonValueMaybe = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const looksJson =
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("\"") ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed);
  if (!looksJson) return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
};

const pairsToJson = (pairs: KeyValuePair[]) => {
  const payload: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key) continue;
    payload[key] = pair.value;
  }
  return Object.keys(payload).length ? JSON.stringify(payload) : "";
};

const pairsToJsonWithTypes = (pairs: KeyValuePair[]) => {
  const payload: Record<string, unknown> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key) continue;
    payload[key] =
      pair.valueKind === "string" ? pair.value : parseJsonValueMaybe(pair.value);
  }
  return Object.keys(payload).length ? JSON.stringify(payload) : "";
};

type ProfileKind =
  | "api"
  | "pipeline"
  | "prompt"
  | "parser"
  | "policy"
  | "chunk";

type ApiFormState = {
  id: string;
  name: string;
  apiType: "openai_compat" | "pool";
  baseUrl: string;
  apiKey: string;
  model: string;
  group: string;
  poolEndpoints: PoolEndpointForm[];
  headers: string;
  params: string;
  timeout: string;
  concurrency: string;
  rpm: string;
  temperature: string;
  topP: string;
  maxTokens: string;
  presencePenalty: string;
  frequencyPenalty: string;
  seed: string;
  stop: string;
};

type ApiTestState = {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
  latencyMs?: number;
  statusCode?: number;
  url?: string;
};

type ApiConcurrencyState = {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
  latencyMs?: number;
  maxConcurrency?: number;
  statusCounts?: Record<string, number>;
  url?: string;
};

type PipelineComposerState = {
  id: string;
  name: string;
  provider: string;
  prompt: string;
  parser: string;
  translationMode: "line" | "block";
  applyLinePolicy: boolean;
  linePolicy: string;
  chunkPolicy: string;
  temperature: string;
  maxRetries: string;
  concurrency: string;
  maxTokens: string;
  modelOverride: string;
  timeout: string;
  headers: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
  seed: string;
  stop: string;
  extraParams: string;
};

type PromptFormState = {
  id: string;
  name: string;
  systemTemplate: string;
  userTemplate: string;
  beforeLines: string;
  afterLines: string;
  joiner: string;
  sourceFormat: string;
  sourceLines: string;
};

type PromptPreviewState = {
  source: string;
  glossary: string;
  contextBefore: string;
  contextAfter: string;
  lineIndex: string;
  showContext: boolean;
};

type PolicyFormState = {
  id: string;
  name: string;
  policyType: "strict" | "tolerant";
  onMismatch: "retry" | "error" | "pad" | "truncate" | "align";
  trim: boolean;
  emptyLine: boolean;
  similarity: boolean;
  kanaTrace: boolean;
  similarityThreshold: string;
  sourceLang: string;
};

type ChunkFormState = {
  id: string;
  name: string;
  targetChars: string;
  maxChars: string;
  enableBalance: boolean;
  balanceThreshold: string;
  balanceCount: string;
};

type ParserRuleType =
  | "plain"
  | "line_strict"
  | "json_object"
  | "json_array"
  | "jsonl"
  | "tagged_line"
  | "regex"
  | "python";

type ParserRuleForm = {
  id: string;
  type: ParserRuleType;
  path: string;
  pattern: string;
  sortById: boolean;
  sortByKey: "id" | "line_number" | "";
  multiLine: "join" | "first" | "error";
  regexGroup: string;
  regexFlags: {
    multiline: boolean;
    dotall: boolean;
    ignorecase: boolean;
  };
  scriptPath: string;
  functionName: string;
  extraOptions: string;
  advancedOpen: boolean;
};

type ParserFormState = {
  id: string;
  name: string;
  mode: "single" | "cascade";
  rules: ParserRuleForm[];
};

const PROFILE_KINDS: ProfileKind[] = [
  "api",
  "prompt",
  "parser",
  "policy",
  "chunk",
  "pipeline",
];

const HIDDEN_PROFILE_IDS: Partial<Record<ProfileKind, Set<string>>> = {
  pipeline: new Set([
    "pipeline_api_doc",
    "pipeline_api_line_strict",
    "pipeline_api_tagged_line",
    "pipeline_line_strict",
    "pipeline_plain_line",
    "pipeline_line_tolerant",
    "pipeline_tagged_bracket",
    "pipeline_line_any",
    "pipeline_json_object",
    "pipeline_json_array",
    "pipeline_jsonl_line",
    "pipeline_doc_any",
  ]),
  prompt: new Set(["prompt_tagged_line"]),
  policy: new Set([
    "line_quality",
    "line_strict",
    "line_strict_pad",
    "line_strict_align",
  ]),
  chunk: new Set([
    "chunk_line_strict",
    "chunk_line_loose",
    "chunk_line_keep",
    "chunk_line_default",
  ]),
};

const DEFAULT_TAGGED_PATTERN = "^@@(?P<id>\\d+)@@(?P<text>.*)$";
const DEFAULT_POLICY_ID = "line_tolerant";
const DEFAULT_CHUNK_ID = "chunk_legacy_doc";
const HIDE_ALL_PROFILE_IDS = false;
const HIDE_PROFILE_ID_DISPLAY = new Set([DEFAULT_POLICY_ID, DEFAULT_CHUNK_ID]);
const DEFAULT_PROTECTED_PROFILE_IDS = new Set([
  DEFAULT_POLICY_ID,
  DEFAULT_CHUNK_ID,
  "prompt_default",
  "parser_any_default",
]);
const PIPELINE_SUMMARY_BATCH_SIZE = 12;

const parserRuleTypes: ParserRuleType[] = [
  "jsonl",
  "json_object",
  "json_array",
  "tagged_line",
  "regex",
  "line_strict",
  "plain",
  "python",
];

const DEFAULT_PROFILE_NAME_ALIASES: Record<string, string[]> = {
  prompt_default: ["Default Prompt"],
  prompt_tagged_line: ["Tagged Line Prompt"],
  prompt_plain_line: ["Plain Line Prompt"],
  prompt_json_object: ["JSON Object Prompt"],
  prompt_json_array: ["JSON Array Prompt"],
  prompt_jsonl_line: ["JSONL Line Prompt"],
  prompt_glossary_focus: ["Glossary Focus Prompt"],
  parser_plain: ["Plain Parser", "Plain Text Parser"],
  parser_any_default: [
    "Parser Cascade",
    "Parser Cascade Default",
    "Any Parser",
    "多解析级联",
    "多解析级联（JSONL优先）",
  ],
  parser_line_strict: ["Line Strict Parser"],
  parser_line_strict_first: ["Line Strict (First)"],
  parser_line_strict_error: ["Line Strict (Error)"],
  parser_tagged_line: ["Tagged Line Parser"],
  parser_tagged_line_sorted: ["Tagged Line Parser (Sorted)"],
  parser_tagged_line_bracket: ["Bracket Tagged Parser"],
  parser_json_array: ["JSON Array Parser"],
  parser_json_object: ["Json Object Parser", "JSON Object Parser"],
  parser_jsonl_object: ["JSONL Parser", "JSONL 多行解析"],
  parser_regex_extract: ["Regex Extract Parser"],
  parser_regex_json_key: ["Regex JSON Key Parser"],
  parser_regex_codeblock: ["Regex Codeblock Parser"],
  parser_regex_xml_tag: ["Regex XML Tag Parser"],
  parser_regex_custom: ["Custom Regex Parser"],
  line_tolerant: [
    "Default Line Strategy",
    "Default Line Config",
    "Default Line Policy",
    "Tolerant Line Policy",
    "默认分行策略",
    "默认行配置",
  ],
  chunk_line_default: ["Default Line Chunk"],
  chunk_legacy_doc: ["默认分块策略", "Default Chunk Strategy", "Default Chunk"],
};

const DEFAULT_TEMPLATES: Record<ProfileKind, string> = {
  api: `id: new_api
name: New API
type: openai_compat
base_url: https://api.openai.com/v1
api_key: ""
model: ""
timeout: 600
concurrency: 0
rpm: 3600
headers: {}
params: {}`,
  pipeline: `id: new_pipeline
name: New Pipeline
provider: ""
prompt: ""
parser: ""
translation_mode: block
chunk_policy: ""
settings: {}`,
  prompt: `id: new_prompt
name: New Prompt
system_template: |
  你是一位精通二次元文化的资深轻小说翻译家，请将日文翻译成流畅、优美的中文。
  1、严格按照输入行数进行输出，不得拆分或合并行。
  2、原文中的各类控制代码须在译文中原样保留。
  3、完整翻译除控制字符外的所有文本，翻译需符合中文轻小说的阅读习惯。

  采用JSONL的输出格式，无需额外解释或说明:jsonline{"<序号>":"<译文文本>"}
user_template: |
  参考术语表:{{glossary}}
  参考上文(无需翻译):{{context_before}}
  请翻译:{{source}}
  参考下文(无需翻译):{{context_after}}
context:
  before_lines: 3
  after_lines: 0
  joiner: "\\n"
  source_format: jsonl
  source_lines: 5`,
  parser: `id: new_parser
name: New Parser`,
  policy: `id: new_line_policy
name: 默认分行策略
type: strict
options:
  on_mismatch: retry
  trim: true
  similarity_threshold: 0.8
  checks:
    - similarity`,
  chunk: `id: new_chunk_policy
name: 默认分块策略
chunk_type: block
options:
  target_chars: 1000
  max_chars: 2000`,
};

const DEFAULT_API_FORM: ApiFormState = {
  id: "",
  name: "",
  apiType: "openai_compat",
  baseUrl: "",
  apiKey: "",
  model: "",
  group: "",
  poolEndpoints: [createPoolEndpoint()],
  headers: "",
  params: "",
  timeout: "",
  concurrency: "0",
  rpm: "3600",
  temperature: "",
  topP: "0.95",
  maxTokens: "4096",
  presencePenalty: "",
  frequencyPenalty: "",
  seed: "",
  stop: "",
};

const DEFAULT_PIPELINE_COMPOSER: PipelineComposerState = {
  id: "",
  name: "",
  provider: "",
  prompt: "",
  parser: "",
  translationMode: "block",
  applyLinePolicy: false,
  linePolicy: "",
  chunkPolicy: "",
  temperature: "",
  maxRetries: "",
  concurrency: "",
  maxTokens: "",
  modelOverride: "",
  timeout: "",
  headers: "",
  topP: "",
  presencePenalty: "",
  frequencyPenalty: "",
  seed: "",
  stop: "",
  extraParams: "",
};

const DEFAULT_PROMPT_FORM: PromptFormState = {
  id: "",
  name: "",
  systemTemplate: "",
  userTemplate: "",
  beforeLines: "3",
  afterLines: "0",
  joiner: "\\n",
  sourceFormat: "jsonl",
  sourceLines: "5",
};

const DEFAULT_PROMPT_PREVIEW: PromptPreviewState = {
  source: "",
  glossary: "",
  contextBefore: "",
  contextAfter: "",
  lineIndex: "0",
  showContext: false,
};

const DEFAULT_POLICY_FORM: PolicyFormState = {
  id: "",
  name: "",
  policyType: "strict",
  onMismatch: "retry",
  trim: true,
  emptyLine: false,
  similarity: true,
  kanaTrace: false,
  similarityThreshold: "0.8",
  sourceLang: "",
};

const DEFAULT_CHUNK_FORM: ChunkFormState = {
  id: "",
  name: "",
  targetChars: "1000",
  maxChars: "2000",
  enableBalance: true,
  balanceThreshold: "0.6",
  balanceCount: "3",
};

const createParserRuleTemplate = (
  type: ParserRuleType,
  id: string,
): ParserRuleForm => ({
  id,
  type,
  path: type === "json_object" || type === "jsonl" ? "translation" : "",
  pattern: type === "tagged_line" ? DEFAULT_TAGGED_PATTERN : "",
  sortById: false,
  sortByKey: "",
  multiLine: "join",
  regexGroup: "0",
  regexFlags: {
    multiline: false,
    dotall: false,
    ignorecase: false,
  },
  scriptPath: "",
  functionName: "parse",
  extraOptions: "",
  advancedOpen: false,
});

// --- Presets Data ---

type PresetId = keyof (typeof translations)["zh"]["apiManager"]["presets"];
type TemplateEntry = {
  id: string;
  yaml: string;
  meta?: { title?: string; desc?: string };
  custom?: boolean;
};

type ProfileListItem = {
  id: string;
  name: string;
  kind: ProfileKind;
};

type PresetChannel = {
  id: string;
  baseUrl: string;
  model?: string;
  label?: string;
  desc?: string;
  custom?: boolean;
};

type ApiPreset = {
  id: PresetId;
  baseUrl?: string;
  model?: string;
  icon: ComponentType<{ className?: string }>;
  iconName?: string;
  color?: string;
  channels?: PresetChannel[];
  defaultChannel?: string;
  supportsModelList?: boolean;
};

const DeepSeekIcon = ({ className }: { className?: string }) => (
  <img
    src={deepseekLogo}
    className={cn(className, "object-contain")}
    alt="DeepSeek"
  />
);

const GoogleIcon = ({ className }: { className?: string }) => (
  <img
    src={googleLogo}
    className={cn(className, "object-contain")}
    alt="Google"
  />
);

const QwenIcon = ({ className }: { className?: string }) => (
  <img src={qwenLogo} className={cn(className, "object-contain")} alt="Qwen" />
);

const MoonshotIcon = ({ className }: { className?: string }) => (
  <img
    src={moonshotLogo}
    className={cn(className, "object-contain")}
    alt="Moonshot"
  />
);

const ZhipuIcon = ({ className }: { className?: string }) => (
  <img
    src={zhipuLogo}
    className={cn(className, "object-contain")}
    alt="Zhipu"
  />
);

const SiliconFlowIcon = ({ className }: { className?: string }) => (
  <img
    src={siliconflowLogo}
    className={cn(className, "object-contain")}
    alt="SiliconFlow"
  />
);

const OpenRouterIcon = ({ className }: { className?: string }) => (
  <img
    src={openrouterLogo}
    className={cn(className, "object-contain")}
    alt="OpenRouter"
  />
);

const MistralIcon = ({ className }: { className?: string }) => (
  <img
    src={mistralLogo}
    className={cn(className, "object-contain")}
    alt="Mistral"
  />
);

const OpenAIFaviconIcon = ({ className }: { className?: string }) => (
  <img
    src={openaiLogo}
    className={cn(className, "object-contain")}
    alt="OpenAI"
  />
);

const AnthropicFaviconIcon = ({ className }: { className?: string }) => (
  <img
    src={anthropicLogo}
    className={cn(className, "object-contain")}
    alt="Anthropic"
  />
);

const GrokFaviconIcon = ({ className }: { className?: string }) => (
  <img
    src={grokLogo}
    className={cn(className, "object-contain")}
    alt="Grok"
  />
);

const TEMPLATE_CUSTOM_KEY = "murasaki.v2.custom_templates";
const TEMPLATE_HIDDEN_KEY = "murasaki.v2.hidden_templates";
const ACTIVE_PIPELINE_KEY = "murasaki.v2.active_pipeline_id";
const PARSER_RECOMMEND_KEY = "murasaki.v2.parser_recommend_visible";
const PROFILE_ORDER_KEY = "murasaki.v2.profile_order";
const SHOW_ID_FIELDS_KEY = "murasaki.v2.show_id_fields";
const PIPELINE_GUIDE_KEY = "murasaki.v2.pipeline_guide_visible";

const API_PRESETS_DATA: ApiPreset[] = [
  {
    id: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    channels: [
      {
        id: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-2.5-flash",
      },
      {
        id: "vertex",
        baseUrl:
          "https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
        model: "gemini-2.5-flash",
      },
    ],
    defaultChannel: "gemini",
    icon: GoogleIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    icon: OpenAIFaviconIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    icon: AnthropicFaviconIcon,
    color: "text-muted-foreground/70 dark:text-primary",
  },
  {
    id: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    icon: DeepSeekIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "grok",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4",
    icon: GrokFaviconIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
    icon: MistralIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "alibaba",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus-latest",
    channels: [
      {
        id: "cn",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus-latest",
      },
      {
        id: "intl",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus-latest",
      },
      {
        id: "us",
        baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus-latest",
      },
    ],
    defaultChannel: "cn",
    icon: QwenIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-k2-thinking",
    channels: [
      {
        id: "global",
        baseUrl: "https://api.moonshot.ai/v1",
        model: "kimi-k2-thinking",
      },
      {
        id: "cn",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2-thinking",
      },
    ],
    defaultChannel: "global",
    icon: MoonshotIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5",
    channels: [
      {
        id: "bigmodel",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-5",
      },
    ],
    defaultChannel: "bigmodel",
    icon: ZhipuIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "silicon",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    icon: SiliconFlowIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
  {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    icon: OpenRouterIcon,
    color: "text-muted-foreground/70 dark:text-primary",
    supportsModelList: true,
  },
];

const TEMPLATE_LIBRARY: Record<ProfileKind, TemplateEntry[]> = {
  api: [],
  pipeline: [],
  prompt: [
    {
      id: "prompt_jsonl_line",
      yaml: `id: prompt_jsonl_line
 name: 分行模式·JSONL
system_template: |
  你是一位精通二次元文化的资深轻小说翻译家，请将日文翻译成流畅、优美的中文。
  1、严格按照输入行数进行输出，不得拆分或合并行。
  2、原文中的控制代码须在译文中原样保留。
  3、只翻译 {{source}} 中的内容，上下文仅用于理解。

  请使用 JSONL 输出，不要附加解释或多余文本:
  jsonline{"<序号>":"<译文文本>"}
user_template: |
  参考术语表:{{glossary}}
  参考上文(无需翻译):{{context_before}}
  请翻译:{{source}}
  参考下文(无需翻译):{{context_after}}
context:
  before_lines: 3
  after_lines: 0
  joiner: "\\n"
  source_format: jsonl
  source_lines: 5`,
    },
    {
      id: "prompt_plain_line",
      yaml: `id: prompt_plain_line
 name: 分行模式·纯文本
system_template: |
  你是一名专业翻译，请逐行翻译日文为中文。
  保持行数一致，不要添加行号或额外说明。
  只输出译文，顺序与输入保持一致。
user_template: |
  参考术语表:{{glossary}}
  参考上文(无需翻译):{{context_before}}
  请逐行翻译:
  {{source}}
  参考下文(无需翻译):{{context_after}}
context:
  before_lines: 3
  after_lines: 0
  joiner: "\\n"
  source_format: plain`,
    },
    {
      id: "prompt_glossary_focus",
      yaml: `id: prompt_glossary_focus
 name: 分行模式·术语优先
system_template: |
  你是一名术语敏感的翻译，请严格优先使用术语表中的译法。
  输出需逐行对齐，不得合并或拆分行。
  使用 JSONL 输出，不要附加解释或多余文本:
  jsonline{"<序号>":"<译文文本>"}
user_template: |
  术语表(优先使用):{{glossary}}
  参考上文(无需翻译):{{context_before}}
  请翻译:{{source}}
  参考下文(无需翻译):{{context_after}}
context:
  before_lines: 3
  after_lines: 0
  joiner: "\\n"
  source_format: jsonl
  source_lines: 5`,
    },
  ],
  parser: [
    {
      id: "parser_jsonl_object",
      yaml: `id: parser_jsonl_object
name: JSONL 行解析
type: jsonl
options:
  path: translation`,
    },
    {
      id: "parser_plain",
      yaml: `id: parser_plain
name: 纯文本解析
type: plain`,
    },
    {
      id: "parser_any_default",
      yaml: `id: parser_any_default
name: 智能级联解析
type: any
options:
  parsers:
    - type: jsonl
      options:
        path: translation
    - type: json_object
      options:
        path: translation
    - type: json_array
    - type: tagged_line
      options:
        pattern: "^@@(?P<id>\\\\d+)@@(?P<text>.*)$"
    - type: plain`,
    },
    {
      id: "parser_regex_custom",
      yaml: `id: parser_regex_custom
name: 自定义正则解析
type: regex
options:
  pattern: "(?s)TRANSLATION:\\\\s*(?P<content>.*)$"
  group: content
  flags:
    - dotall`,
    },
  ],
  policy: [],
  chunk: [],
};

const TEMPLATE_LIBRARY_ENABLED: Record<ProfileKind, boolean> = {
  api: false,
  pipeline: false,
  prompt: true,
  parser: true,
  policy: false,
  chunk: false,
};

// --- Validation Logic ---

type ValidationResult = { errors: string[]; warnings: string[] };

type ParserPreviewResult = {
  text: string;
  lines: string[];
  error?: string;
};

const splitLinesKeepEmpty = (text: string) => {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized === "") return [""];
  return normalized.split("\n");
};

const formatGlossaryPreview = (raw: string) => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) {
      const lines: string[] = [];
      for (const item of data) {
        if (item && typeof item === "object") {
          const src = String(item.src ?? item.source ?? "").trim();
          const dst = String(item.dst ?? item.target ?? "").trim();
          if (src || dst) {
            lines.push(`${src}: ${dst}`.trim());
            continue;
          }
        }
        lines.push(String(item));
      }
      return lines.join("\n").trim();
    }
    if (data && typeof data === "object") {
      return Object.entries(data)
        .map(([key, value]) => `${key}: ${String(value)}`.trim())
        .join("\n")
        .trim();
    }
    return trimmed;
  } catch {
    return trimmed;
  }
};

const applyTemplate = (template: string, mapping: Record<string, string>) => {
  let result = template || "";
  for (const [key, value] of Object.entries(mapping)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
};

const getByPath = (data: any, path: string) => {
  let current = data;
  const parts = path.split(".");
  for (const part of parts) {
    if (!part) continue;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) {
        throw new Error("list_index_invalid");
      }
      current = current[index];
    } else if (current && typeof current === "object") {
      if (!(part in current)) {
        throw new Error("key_not_found");
      }
      current = current[part];
    } else {
      throw new Error("invalid_path");
    }
  }
  return current;
};

const parseWithRegexFlags = (pattern: string, options: any) => {
  let flags = "";
  const rawFlags = options?.flags;
  const flagList = Array.isArray(rawFlags)
    ? rawFlags
    : typeof rawFlags === "string"
      ? rawFlags.split(",").map((item) => item.trim())
      : [];
  if (
    flagList.some((item) => String(item).toLowerCase() === "dotall") ||
    options?.dotall
  ) {
    flags += "s";
  }
  if (
    flagList.some((item) => String(item).toLowerCase() === "multiline") ||
    options?.multiline
  ) {
    flags += "m";
  }
  if (
    flagList.some((item) => String(item).toLowerCase() === "ignorecase") ||
    options?.ignorecase
  ) {
    flags += "i";
  }
  const normalizedPattern = pattern.replace(/\(\?P</g, "(?<");
  return new RegExp(normalizedPattern, flags);
};

const formatErrorCode = (code: string, texts: any) => {
  if (code === "invalid_yaml") return texts.validationInvalidYaml;
  if (code === "invalid_id") return texts.validationInvalidId;
  if (code === "missing_id") return texts.missingId;
  if (code.startsWith("missing_field:")) {
    const field = code.split(":")[1] || "";
    return texts.validationMissingField.replace("{field}", field);
  }
  if (code === "missing_base_url") return texts.validationMissingBaseUrl;
  if (code === "missing_model") return texts.validationMissingModel;
  if (code === "missing_pool_endpoints")
    return texts.validationMissingPoolEndpoints;
  if (code === "missing_pool_model") return texts.validationMissingPoolModel;
  if (code === "pool_members_unsupported")
    return texts.validationPoolMembersUnsupported;
  if (code === "missing_pattern") return texts.validationMissingPattern;
  if (code === "missing_json_path") return texts.validationMissingJsonPath;
  if (code === "missing_script") return texts.validationMissingScript;
  if (code === "missing_any_parsers") return texts.validationMissingParsers;
  if (code === "invalid_concurrency") return texts.validationInvalidConcurrency;
  if (code === "invalid_max_retries") return texts.validationInvalidMaxRetries;
  if (code === "invalid_rpm") return texts.validationInvalidRpm;
  if (code === "invalid_timeout") return texts.validationInvalidTimeout;
  if (code === "invalid_target_chars") return texts.validationInvalidTargetChars;
  if (code === "invalid_max_chars") return texts.validationInvalidMaxChars;
  if (code === "invalid_balance_threshold")
    return texts.validationInvalidBalanceThreshold;
  if (code === "invalid_balance_count")
    return texts.validationInvalidBalanceCount;
  if (code === "invalid_similarity_threshold")
    return texts.validationInvalidSimilarityThreshold;
  if (code.startsWith("profile_exists")) {
    const id = code.split(":")[1] || "";
    if (id) return texts.validationProfileExists.replace("{id}", id);
    return texts.validationProfileExists
      .replace("{id}", "")
      .replace(/[:：]\s*$/, "")
      .trim();
  }
  if (code === "concurrency_test_auth")
    return texts.concurrencyAutoTestAuth;
  if (code === "concurrency_test_rate_limited")
    return texts.concurrencyAutoTestRateLimited;
  if (code === "concurrency_test_not_found")
    return texts.concurrencyAutoTestNotFound;
  if (code === "concurrency_test_bad_request")
    return texts.concurrencyAutoTestBadRequest;
  if (code === "concurrency_test_timeout")
    return texts.concurrencyAutoTestTimeout;
  if (code === "concurrency_test_server_error")
    return texts.concurrencyAutoTestServerError;
  if (code === "concurrency_test_network")
    return texts.concurrencyAutoTestNetwork;
  if (code === "concurrency_test_failed")
    return texts.concurrencyAutoTestFail;
  if (code === "line_policy_requires_line_chunk") {
    return texts.validationLinePolicyRequiresLineChunk;
  }
  if (code === "line_chunk_missing_line_policy") {
    return texts.validationLineChunkNoPolicy;
  }
  if (code === "prompt_missing_source") {
    return texts.validationPromptMissingSource;
  }
  if (code === "parser_requires_tagged_prompt") {
    return texts.validationParserTaggedMismatch;
  }
  if (code === "parser_requires_json_prompt") {
    return texts.validationParserJsonMismatch;
  }
  if (code === "parser_requires_jsonl_prompt") {
    return texts.validationParserJsonlMismatch;
  }
  if (code.startsWith("unsupported_type:")) {
    const type = code.split(":")[1] || "";
    return texts.validationInvalidType.replace("{type}", type);
  }
  if (code.startsWith("missing_reference:")) {
    const parts = code.split(":");
    const kind = parts[1] || "";
    const id = parts[2] || "";
    return texts.validationUnknownReference
      .replace("{kind}", kind)
      .replace("{id}", id);
  }
  return code;
};

const formatServerError = (error: any, fallback: string, texts: any) => {
  if (!error) return fallback;
  if (typeof error === "string") return formatErrorCode(error, texts);
  if (Array.isArray(error?.errors)) {
    return error.errors
      .map((code: string) => formatErrorCode(code, texts))
      .join("\n");
  }
  if (Array.isArray(error?.detail)) {
    return error.detail
      .map((code: string) => formatErrorCode(code, texts))
      .join("\n");
  }
  if (typeof error?.detail === "string")
    return formatErrorCode(error.detail, texts);
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

const SAFE_PROFILE_ID = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

const isSafeProfileId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("..")) return false;
  if (/[\\/]/.test(trimmed)) return false;
  return SAFE_PROFILE_ID.test(trimmed);
};

const validateProfile = (
  kind: ProfileKind,
  data: any,
  index: Record<ProfileKind, string[]>,
  texts: any,
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const missingField = (field: string) =>
    texts.validationMissingField.replace("{field}", field);
  const invalidType = (type: string) =>
    texts.validationInvalidType.replace("{type}", type);
  const unknownRef = (refKind: string, id: string) =>
    texts.validationUnknownReference
      .replace("{kind}", refKind)
      .replace("{id}", id);
  const hasSourcePlaceholder = (prompt: any) => {
    const userTemplate = String(prompt?.user_template || "");
    if (!userTemplate.trim()) return true;
    return userTemplate.includes("{{source}}");
  };

  if (!data || typeof data !== "object") {
    errors.push(texts.validationInvalidYaml);
    return { errors, warnings };
  }
  if (!data.id) {
    errors.push(texts.missingId);
  } else if (!isSafeProfileId(String(data.id))) {
    errors.push(texts.validationInvalidId);
  }

  if (kind === "prompt") {
    if (!hasSourcePlaceholder(data)) {
      errors.push(texts.validationPromptMissingSource);
    }
  }

  if (kind === "api") {
    const apiType = String(data.type || data.provider || "openai_compat");
    if (apiType === "openai_compat") {
      if (!data.base_url) errors.push(texts.validationMissingBaseUrl);
      if (!data.model) errors.push(texts.validationMissingModel);
    } else if (apiType === "pool") {
      const endpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
      const hasEndpoints = endpoints.some(
        (item: any) =>
          item &&
          typeof item === "object" &&
          (item.base_url || item.baseUrl),
      );
      const hasMembers = Boolean(
        (Array.isArray(data.members) && data.members.length > 0) ||
          (data.members !== undefined &&
            data.members !== null &&
            !Array.isArray(data.members) &&
            String(data.members).trim()),
      );
      if (!hasEndpoints) {
        errors.push(texts.validationMissingPoolEndpoints);
      }
      if (hasEndpoints) {
        const missingModel = endpoints.some(
          (item: any) =>
            item &&
            typeof item === "object" &&
            (item.base_url || item.baseUrl) &&
            !item.model,
        );
        if (missingModel) {
          errors.push(texts.validationMissingPoolModel);
        }
      }
      if (hasMembers) {
        errors.push(texts.validationPoolMembersUnsupported);
      }
      if (data.concurrency !== undefined) {
        const raw = Number.parseInt(String(data.concurrency), 10);
        if (!Number.isFinite(raw) || raw < 0) {
          errors.push(texts.validationInvalidConcurrency);
        }
      }
    } else {
      warnings.push(invalidType(apiType));
    }
    if (data.rpm !== undefined && data.rpm !== null && data.rpm !== "") {
      const rpmValue = Number.parseInt(String(data.rpm), 10);
      if (!Number.isFinite(rpmValue) || rpmValue < 1) {
        errors.push(texts.validationInvalidRpm);
      }
    }
    if (data.timeout !== undefined && data.timeout !== null && data.timeout !== "") {
      const timeoutValue = Number(data.timeout);
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        errors.push(texts.validationInvalidTimeout);
      }
    }
  }

  if (kind === "parser") {
    const parserType = String(data.type || "");
    if (!parserType) errors.push(missingField("type"));
    if (parserType === "regex") {
      if (!data.options?.pattern) {
        errors.push(texts.validationMissingPattern);
      }
    }
    if (parserType === "json_object") {
      if (!data.options?.path && !data.options?.key) {
        errors.push(texts.validationMissingJsonPath);
      }
    }
    if (parserType === "jsonl") {
      if (data.options && !data.options.path && !data.options.key) {
        warnings.push(texts.validationMissingJsonPath);
      }
    }
    if (parserType === "any") {
      const parsers = data.options?.parsers || data.options?.candidates;
      if (!Array.isArray(parsers) || parsers.length === 0) {
        errors.push(texts.validationMissingParsers);
      }
    }
    if (parserType === "python") {
      if (!data.options?.script && !data.options?.path) {
        errors.push(texts.validationMissingScript);
      }
    }
  }

  if (kind === "policy") {
    const policyType = String(data.type || "");
    if (!policyType) errors.push(missingField("type"));
    if (policyType && !["strict", "tolerant"].includes(policyType)) {
      warnings.push(invalidType(policyType));
    }
    const options = data.options || {};
    const similarityRaw =
      options.similarity_threshold ?? options.similarity ?? options.similarityThreshold;
    if (similarityRaw !== undefined && similarityRaw !== null && similarityRaw !== "") {
      const similarityValue = Number(similarityRaw);
      if (!Number.isFinite(similarityValue) || similarityValue <= 0 || similarityValue > 1) {
        errors.push(texts.validationInvalidSimilarityThreshold);
      }
    }
  }

  if (kind === "chunk") {
    const rawChunkType = String(data.chunk_type || data.type || "");
    const normalizedChunkType = normalizeChunkType(rawChunkType);
    if (!rawChunkType.trim()) errors.push(missingField("chunk_type"));
    if (rawChunkType.trim() && !normalizedChunkType) {
      warnings.push(invalidType(rawChunkType));
    }
    const options = data.options || {};
    const targetRaw = options.target_chars ?? options.targetChars;
    if (targetRaw !== undefined && targetRaw !== null && targetRaw !== "") {
      const targetValue = Number(targetRaw);
      if (!Number.isFinite(targetValue) || targetValue <= 0) {
        errors.push(texts.validationInvalidTargetChars);
      }
    }
    const maxRaw = options.max_chars ?? options.maxChars;
    if (maxRaw !== undefined && maxRaw !== null && maxRaw !== "") {
      const maxValue = Number(maxRaw);
      if (!Number.isFinite(maxValue) || maxValue <= 0) {
        errors.push(texts.validationInvalidMaxChars);
      } else if (
        targetRaw !== undefined &&
        targetRaw !== null &&
        targetRaw !== "" &&
        Number.isFinite(Number(targetRaw)) &&
        maxValue < Number(targetRaw)
      ) {
        errors.push(texts.validationInvalidMaxChars);
      }
    }
    const balanceThresholdRaw =
      options.balance_threshold ?? options.balanceThreshold;
    if (
      balanceThresholdRaw !== undefined &&
      balanceThresholdRaw !== null &&
      balanceThresholdRaw !== ""
    ) {
      const balanceValue = Number(balanceThresholdRaw);
      if (!Number.isFinite(balanceValue) || balanceValue <= 0 || balanceValue > 1) {
        errors.push(texts.validationInvalidBalanceThreshold);
      }
    }
    const balanceCountRaw = options.balance_count ?? options.balanceCount;
    if (
      balanceCountRaw !== undefined &&
      balanceCountRaw !== null &&
      balanceCountRaw !== ""
    ) {
      const balanceCount = Number.parseInt(String(balanceCountRaw), 10);
      if (!Number.isFinite(balanceCount) || balanceCount < 1) {
        errors.push(texts.validationInvalidBalanceCount);
      }
    }
  }

  if (kind === "pipeline") {
    const required = ["provider", "prompt", "parser", "chunk_policy"];
    required.forEach((field) => {
      if (!data[field])
        errors.push(texts.validationMissingPipeline.replace("{field}", field));
    });
    const rawMode = String(
      data.translation_mode || data.translationMode || data.mode || "",
    );
    const normalizedMode = rawMode.trim().toLowerCase();
    const translationMode =
      normalizedMode === "line" || normalizedMode === "block"
        ? normalizedMode
        : "";
    if (rawMode && !translationMode) {
      errors.push(invalidType(rawMode));
    }
    if (data.apply_line_policy && !data.line_policy) {
      errors.push(texts.validationLineChunkNoPolicy);
    }
    if (data.apply_line_policy && translationMode === "block") {
      errors.push(texts.validationLinePolicyRequiresLineChunk);
    }
    const refMap: Record<string, ProfileKind> = {
      provider: "api",
      prompt: "prompt",
      parser: "parser",
      line_policy: "policy",
      chunk_policy: "chunk",
    };
    Object.entries(refMap).forEach(([field, refKind]) => {
      const refId = data[field];
      if (!refId || !index[refKind]?.length) return;
      if (!index[refKind].includes(refId)) {
        errors.push(unknownRef(refKind, refId));
      }
    });
  }

  const uniqueErrors = Array.from(new Set(errors));
  const uniqueWarnings = Array.from(new Set(warnings));
  return { errors: uniqueErrors, warnings: uniqueWarnings };
};

interface ApiManagerViewProps {
  lang: Language;
}

export function ApiManagerView({ lang }: ApiManagerViewProps) {
  const t = translations[lang];
  const texts = t.apiManager;
  const fallbackTexts = translations.zh.apiManager;
  const { alertProps, showAlert, showConfirm } = useAlertModal();

  const isStrategyKind = (targetKind: ProfileKind) =>
    targetKind === "policy" || targetKind === "chunk";

  const isHiddenProfile = useCallback((targetKind: ProfileKind, id?: string) => {
    if (!id) return false;
    const set = HIDDEN_PROFILE_IDS[targetKind];
    return set ? set.has(String(id)) : false;
  }, []);

  const getKindLabel = (targetKind: ProfileKind) =>
    isStrategyKind(targetKind)
      ? texts.strategyKindTitle
      : texts.kinds[targetKind] || targetKind;

  const getNewCardCopy = (
    scope: "pipeline" | "prompt" | "strategy" | "parser" | "policy" | "chunk",
  ) => {
    const labels = texts.newProfileLabels || {};
    const descs = texts.newProfileDescs || {};
    const fallbackScope =
      scope === "policy" || scope === "chunk" ? "strategy" : scope;
    return {
      title: labels[scope] || labels[fallbackScope] || texts.newProfile,
      desc:
        descs[scope] ||
        descs[fallbackScope] ||
        texts.newProfileDesc ||
        "",
    };
  };

  const loadJson = <T,>(key: string, fallback: T): T => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as T;
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  };

  const loadOptionalJson = <T,>(key: string): T | null => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as T;
      return parsed ?? null;
    } catch {
      return null;
    }
  };

  const persistJson = (key: string, value: unknown) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  };

  const getPresetLabel = (preset: ApiPreset) =>
    texts.presets?.[preset.id]?.label ||
    fallbackTexts.presets?.[preset.id]?.label ||
    preset.id;

  const getTemplateMeta = (
    templateId: string,
    fallback?: { title?: string; desc?: string },
  ) => {
    const map: Record<string, { title?: string; desc?: string }> | undefined =
      (texts.templateItems as
        | Record<string, { title?: string; desc?: string }>
        | undefined) ??
      (fallbackTexts.templateItems as
        | Record<string, { title?: string; desc?: string }>
        | undefined);
    return map?.[templateId] || fallback;
  };

  const getTemplateGroupKey = (templateId: string, profileKind: ProfileKind) => {
    const id = templateId.toLowerCase();
    if (profileKind === "api") return "general";
    if (profileKind === "pipeline") return "general";
    if (id.includes("json")) return "json";
    if (id.includes("tagged") || id.includes("bracket")) return "tagged";
    if (id.includes("regex")) return "regex";
    if (id.includes("line")) return "line";
    return "general";
  };

  const normalizeDefaultProfileName = useCallback(
    (id: string, name?: string) => {
      const trimmed = String(name || "").trim();
      const aliases =
        (DEFAULT_PROFILE_NAME_ALIASES as Record<string, string[]>)[id] || [];
      const presetNames = fallbackTexts.profileNames as
        | Record<string, string>
        | undefined;
      const textNames = texts.profileNames as
        | Record<string, string>
        | undefined;
      const localized = textNames?.[id] || presetNames?.[id];
      const isAliasMatch = aliases.some(
        (alias) => alias.toLowerCase() === trimmed.toLowerCase(),
      );
      if (localized && (!trimmed || isAliasMatch)) return localized;
      return trimmed || id;
    },
    [fallbackTexts, texts],
  );

  const createParserRuleId = () =>
    `parser_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const createParserRule = (type: ParserRuleType) =>
    createParserRuleTemplate(type, createParserRuleId());

  const getPresetChannelText = (preset: ApiPreset, channelId: string) => {
    const presetText = (texts.presets?.[preset.id] ||
      fallbackTexts.presets?.[preset.id]) as
      | {
        channels?: Record<string, { label?: string; desc?: string }>;
      }
      | undefined;
    const channelText = presetText?.channels?.[channelId];
    if (channelText && typeof channelText === "object") {
      return {
        label: channelText.label || channelId,
        desc: channelText.desc || "",
      };
    }
    return { label: channelId, desc: "" };
  };

  const getPresetChannels = (preset: ApiPreset) => preset.channels || [];

  const resolvePresetOption = (
    preset: ApiPreset,
    channelId?: string,
  ): { baseUrl: string; model: string; channelId?: string } => {
    const channels = getPresetChannels(preset);
    if (channels.length) {
      const channel =
        (channelId && channels.find((item) => item.id === channelId)) ||
        (preset.defaultChannel &&
          channels.find((item) => item.id === preset.defaultChannel)) ||
        channels[0];
      return {
        baseUrl: channel?.baseUrl ?? preset.baseUrl ?? "",
        model: channel?.model ?? preset.model ?? "",
        channelId: channel?.id,
      };
    }
    return {
      baseUrl: preset.baseUrl || "",
      model: preset.model || "",
    };
  };

  const [kind, setKind] = useState<ProfileKind>("pipeline");
  const [strategyKind, setStrategyKind] = useState<"policy" | "chunk">(
    "policy",
  );
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [baselineYaml, setBaselineYaml] = useState("");
  const [hasUserEdits, setHasUserEdits] = useState(false);
  const [profileIndex, setProfileIndex] = useState<
    Record<ProfileKind, string[]>
  >({
    api: [],
    pipeline: [],
    prompt: [],
    parser: [],
    policy: [],
    chunk: [],
  });
  const [profileMeta, setProfileMeta] = useState<
    Record<ProfileKind, Record<string, string>>
  >({
    api: {},
    pipeline: {},
    prompt: {},
    parser: {},
    policy: {},
    chunk: {},
  });
  const lastProfileDataRef = useRef<
    Record<ProfileKind, Record<string, any> | null>
  >({
    api: null,
    pipeline: null,
    prompt: null,
    parser: null,
    policy: null,
    chunk: null,
  });
  const [chunkTypeIndex, setChunkTypeIndex] = useState<
    Record<string, "line" | "block" | "">
  >({});
  const [pipelineSummaryIndex, setPipelineSummaryIndex] = useState<
    Record<string, PipelineSummary>
  >({});
  const [pipelineIndexReady, setPipelineIndexReady] = useState(false);
  const [pipelineIndexLoading, setPipelineIndexLoading] = useState(false);
  const [isPipelineSummaryLoading, setIsPipelineSummaryLoading] = useState(false);
  const [pipelineView, setPipelineView] = useState<"overview" | "editor">(
    "overview",
  );
  const [showApiSetup, setShowApiSetup] = useState(false);
  const [showIdField, setShowIdField] = useState<Record<ProfileKind, boolean>>(
    () =>
      loadJson(SHOW_ID_FIELDS_KEY, {
        api: false,
        pipeline: false,
        prompt: false,
        parser: false,
        policy: false,
        chunk: false,
      }),
  );
  const [autoIdEnabled, setAutoIdEnabled] = useState<
    Record<ProfileKind, boolean>
  >({
    api: true,
    pipeline: true,
    prompt: true,
    parser: true,
    policy: true,
    chunk: true,
  });
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [activePresetId, setActivePresetId] = useState<PresetId | null>(null);
  const [activePresetChannel, setActivePresetChannel] = useState("");
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelListError, setModelListError] = useState("");
  const [modelListRequested, setModelListRequested] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const yamlUpdateTimer = useRef<number | null>(null);
  const pendingYamlPayload = useRef<any | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    id: string;
    kind: ProfileKind;
  } | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{
    kind: ProfileKind;
    yaml?: string;
    preset?: ApiPreset | null;
    channelId?: string;
  } | null>(null);
  const [profileOrder, setProfileOrder] = useState<Record<ProfileKind, string[]>>(
    () =>
      loadJson(PROFILE_ORDER_KEY, {
        api: [],
        pipeline: [],
        prompt: [],
        parser: [],
        policy: [],
        chunk: [],
      }),
  );
  const normalizeYamlText = useCallback(
    (value: string) => value.replace(/\r\n/g, "\n").trim(),
    [],
  );
  const markUserEdits = useCallback(() => setHasUserEdits(true), []);
  const resetUserEdits = useCallback(() => setHasUserEdits(false), []);
  const clearPendingYamlUpdate = useCallback(() => {
    if (yamlUpdateTimer.current !== null) {
      window.clearTimeout(yamlUpdateTimer.current);
      yamlUpdateTimer.current = null;
    }
    pendingYamlPayload.current = null;
  }, []);
  const commitYamlText = useCallback(
    (
      nextYaml: string,
      options?: { baseline?: boolean; markDirty?: boolean },
    ) => {
      clearPendingYamlUpdate();
      setYamlText(nextYaml);
      if (options?.baseline) {
        setBaselineYaml(nextYaml);
        resetUserEdits();
        return;
      }
      if (options?.markDirty !== false) {
        markUserEdits();
      }
    },
    [clearPendingYamlUpdate, markUserEdits, resetUserEdits],
  );
  const queueYamlDump = useCallback(
    (payload: any, options?: { markDirty?: boolean }) => {
      if (options?.markDirty !== false) {
        markUserEdits();
      }
      pendingYamlPayload.current = payload;
      if (yamlUpdateTimer.current !== null) return;
      yamlUpdateTimer.current = window.setTimeout(() => {
        yamlUpdateTimer.current = null;
        const pending = pendingYamlPayload.current;
        pendingYamlPayload.current = null;
        if (!pending) return;
        setYamlText(yaml.dump(pending));
      }, 120);
    },
    [markUserEdits],
  );
  const flushYamlUpdate = useCallback(() => {
    const pending = pendingYamlPayload.current;
    if (!pending) return yamlText;
    if (yamlUpdateTimer.current !== null) {
      window.clearTimeout(yamlUpdateTimer.current);
      yamlUpdateTimer.current = null;
    }
    pendingYamlPayload.current = null;
    const nextYaml = yaml.dump(pending);
    setYamlText(nextYaml);
    return nextYaml;
  }, [yamlText]);
  const hasUnsavedChanges = useCallback(
    (current?: string) => {
      if (!hasUserEdits) return false;
      return (
        normalizeYamlText(current ?? yamlText) !==
        normalizeYamlText(baselineYaml)
      );
    },
    [baselineYaml, hasUserEdits, normalizeYamlText, yamlText],
  );
  const guardUnsaved = useCallback(
    (action: () => void) => {
      const latestYaml = flushYamlUpdate();
      if (!hasUnsavedChanges(latestYaml)) {
        action();
        return;
      }
      showConfirm({
        title: t.apiManager.unsavedChangesTitle,
        description: t.apiManager.unsavedChangesDesc,
        variant: "warning",
        onConfirm: () => {
          clearPendingYamlUpdate();
          action();
        },
      });
    },
    [
      clearPendingYamlUpdate,
      flushYamlUpdate,
      hasUnsavedChanges,
      showConfirm,
      t.apiManager.unsavedChangesDesc,
      t.apiManager.unsavedChangesTitle,
    ],
  );
  const jsonParseErrorFlags = useRef({
    apiHeaders: false,
    apiParams: false,
    pipelineHeaders: false,
    pipelineExtraParams: false,
  });
  const lastValidJsonRef = useRef({
    apiHeaders: {} as Record<string, any>,
    apiParams: {} as Record<string, any>,
    pipelineHeaders: {} as Record<string, any>,
    pipelineExtraParams: {} as Record<string, any>,
  });
  const parseJsonObjectField = useCallback(
    (
      raw: string,
      fieldKey: keyof typeof jsonParseErrorFlags.current,
      fieldLabel: string,
    ) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        jsonParseErrorFlags.current[fieldKey] = false;
        lastValidJsonRef.current[fieldKey] = {};
        return {};
      }
      try {
        const parsed = JSON.parse(raw);
        const isPlainObject =
          parsed && typeof parsed === "object" && !Array.isArray(parsed);
        if (isPlainObject) {
          jsonParseErrorFlags.current[fieldKey] = false;
          lastValidJsonRef.current[fieldKey] = parsed;
          return parsed as Record<string, any>;
        }
      } catch {
        // handled below
      }
      if (!jsonParseErrorFlags.current[fieldKey]) {
        emitToast({
          title: texts.jsonParseErrorTitle,
          description: texts.jsonParseErrorDesc.replace("{field}", fieldLabel),
          variant: "warning",
        });
        jsonParseErrorFlags.current[fieldKey] = true;
      }
      return { ...lastValidJsonRef.current[fieldKey] };
    },
    [emitToast, texts.jsonParseErrorDesc, texts.jsonParseErrorTitle],
  );
  const resolveCachedJsonField = useCallback(
    (
      raw: string,
      prevRaw: string,
      fieldKey: keyof typeof jsonParseErrorFlags.current,
      fieldLabel: string,
    ) => {
      if (raw === prevRaw) return lastValidJsonRef.current[fieldKey];
      return parseJsonObjectField(raw, fieldKey, fieldLabel);
    },
    [parseJsonObjectField],
  );
  const orderProfileIds = useCallback(
    (targetKind: ProfileKind, ids: string[]) => {
      const order = profileOrder[targetKind] || [];
      if (!order.length) return ids;
      const orderSet = new Set(order);
      const ordered = order.filter((id) => ids.includes(id));
      const tail = ids.filter((id) => !orderSet.has(id));
      return [...ordered, ...tail];
    },
    [profileOrder],
  );
  const visiblePipelineIds = useMemo(
    () =>
      orderProfileIds(
        "pipeline",
        profileIndex.pipeline.filter((id) => !isHiddenProfile("pipeline", id)),
      ),
    [profileIndex.pipeline, isHiddenProfile, orderProfileIds],
  );

  // Interaction states
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Operation states
  const [apiForm, setApiForm] = useState<ApiFormState>(DEFAULT_API_FORM);
  const [headerPairs, setHeaderPairs] = useState<KeyValuePair[]>(() =>
    parseKeyValuePairs(DEFAULT_API_FORM.headers),
  );
  const [paramPairs, setParamPairs] = useState<KeyValuePair[]>(() =>
    parseKeyValuePairs(DEFAULT_API_FORM.params),
  );
  const activePreset = useMemo(
    () =>
      activePresetId
        ? API_PRESETS_DATA.find((preset) => preset.id === activePresetId) || null
        : null,
    [activePresetId],
  );
  const supportsModelList = useMemo(() => {
    if (apiForm.apiType !== "openai_compat") return false;
    if (!activePreset) return true;
    return Boolean(activePreset.supportsModelList);
  }, [apiForm.apiType, activePreset]);
  const [pipelineComposer, setPipelineComposer] =
    useState<PipelineComposerState>(DEFAULT_PIPELINE_COMPOSER);
  const [promptForm, setPromptForm] =
    useState<PromptFormState>(DEFAULT_PROMPT_FORM);
  const [promptLegacyParts, setPromptLegacyParts] =
    useState<PromptLegacyParts | null>(null);
  const [promptPreview, setPromptPreview] = useState<PromptPreviewState>(
    DEFAULT_PROMPT_PREVIEW,
  );
  const [glossaryFiles, setGlossaryFiles] = useState<string[]>([]);
  const [glossarySelected, setGlossarySelected] = useState("");
  const [glossaryLoadError, setGlossaryLoadError] = useState("");
  const [glossaryLoading, setGlossaryLoading] = useState(false);
  const createDefaultParserForm = (): ParserFormState => ({
    id: "",
    name: "",
    mode: "single",
    rules: [createParserRule("plain")],
  });
  const [parserForm, setParserForm] = useState<ParserFormState>(() =>
    createDefaultParserForm(),
  );
  const [policyForm, setPolicyForm] =
    useState<PolicyFormState>(DEFAULT_POLICY_FORM);
  const [chunkForm, setChunkForm] =
    useState<ChunkFormState>(DEFAULT_CHUNK_FORM);
  const [apiTest, setApiTest] = useState<ApiTestState>({ status: "idle" });
  const [apiConcurrency, setApiConcurrency] = useState<ApiConcurrencyState>({
    status: "idle",
  });
  const [lastValidation, setLastValidation] = useState<ValidationResult | null>(
    null,
  );
  const [apiAdvancedOpen, setApiAdvancedOpen] = useState(false);
  const [apiAdvancedTab, setApiAdvancedTab] = useState<
    "sampling" | "headers" | "extras"
  >("sampling");
  const [templateSelectorOpen, setTemplateSelectorOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templateDraftName, setTemplateDraftName] = useState("");
  const [templateDraftDesc, setTemplateDraftDesc] = useState("");
  const pipelineGuideStoredRef = useRef<boolean | null>(
    loadOptionalJson<boolean>(PIPELINE_GUIDE_KEY),
  );
  const [showPipelineGuide, setShowPipelineGuide] = useState(
    () => pipelineGuideStoredRef.current ?? true,
  );
  const [pipelineGuideTouched, setPipelineGuideTouched] = useState(
    () => pipelineGuideStoredRef.current !== null,
  );
  const [isProfilesLoading, setIsProfilesLoading] = useState(true);
  const [profilesLoadedKind, setProfilesLoadedKind] =
    useState<ProfileKind | null>(null);
  const [showParserRecommend, setShowParserRecommend] = useState(() =>
    loadJson(PARSER_RECOMMEND_KEY, true),
  );
  const hasAutoCollapsedGuide = useRef(false);
  const setPipelineGuideVisibility = (next: boolean) => {
    setShowPipelineGuide(next);
    setPipelineGuideTouched(true);
  };

  useEffect(() => {
    if (
      kind === "pipeline" &&
      profileIndex.pipeline.length > 0 &&
      !hasAutoCollapsedGuide.current &&
      !pipelineGuideTouched
    ) {
      setPipelineGuideVisibility(false);
      hasAutoCollapsedGuide.current = true;
    }
  }, [kind, profileIndex.pipeline.length, pipelineGuideTouched]);

  useEffect(() => {
    setProfileOrder((prev) => {
      let changed = false;
      const next = { ...prev };
      (Object.keys(profileIndex) as ProfileKind[]).forEach((targetKind) => {
        const rawIds = profileIndex[targetKind] || [];
        const ids: string[] = [];
        const idsSet = new Set<string>();
        rawIds.forEach((id) => {
          if (!idsSet.has(id)) {
            idsSet.add(id);
            ids.push(id);
          }
        });
        const existingRaw = prev[targetKind] || [];
        const existing: string[] = [];
        const existingSet = new Set<string>();
        existingRaw.forEach((id) => {
          if (!existingSet.has(id)) {
            existingSet.add(id);
            existing.push(id);
          }
        });
        if (!ids.length && !existing.length) return;
        const existsSet = new Set(ids);
        const trimmed = existing.filter((id) => existsSet.has(id));
        const trimmedSet = new Set(trimmed);
        const appended = ids.filter((id) => !trimmedSet.has(id));
        const merged = [...trimmed, ...appended];
        const hasChange =
          merged.length !== existing.length ||
          merged.some((id, idx) => id !== existing[idx]);
        if (hasChange) {
          next[targetKind] = merged;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [profileIndex]);

  const [customTemplates, setCustomTemplates] = useState<
    Record<ProfileKind, TemplateEntry[]>
  >(() => loadJson(TEMPLATE_CUSTOM_KEY, {} as Record<ProfileKind, TemplateEntry[]>));
  const [hiddenTemplates, setHiddenTemplates] = useState<
    Record<ProfileKind, string[]>
  >(() => loadJson(TEMPLATE_HIDDEN_KEY, {} as Record<ProfileKind, string[]>));
  const [parserSample, setParserSample] = useState("");
  const [parserPreview, setParserPreview] =
    useState<ParserPreviewResult | null>(null);
  const [editorTab, setEditorTab] = useState<"visual" | "yaml">("visual");
  const [activePipelineId, setActivePipelineId] = useState<string>(() =>
    loadJson(ACTIVE_PIPELINE_KEY, ""),
  );
  const [pendingPipelineLink, setPendingPipelineLink] = useState(false);
  const loadProfilesSeq = useRef(0);
  const pipelineIndexSeq = useRef(0);
  const pipelineSummarySeq = useRef(0);
  const loadDetailSeq = useRef(0);
  const apiTestSeq = useRef(0);
  const apiConcurrencySeq = useRef(0);
  const modelListSeq = useRef(0);

  useEffect(() => {
    persistJson(TEMPLATE_CUSTOM_KEY, customTemplates);
  }, [customTemplates]);

  useEffect(() => {
    persistJson(TEMPLATE_HIDDEN_KEY, hiddenTemplates);
  }, [hiddenTemplates]);

  useEffect(() => {
    apiTestSeq.current += 1;
    setApiTest({ status: "idle" });
    apiConcurrencySeq.current += 1;
    setApiConcurrency({ status: "idle" });
  }, [apiForm.baseUrl, apiForm.apiKey, apiForm.timeout, apiForm.apiType, apiForm.model]);

  useEffect(() => {
    persistJson(ACTIVE_PIPELINE_KEY, activePipelineId);
  }, [activePipelineId]);

  useEffect(() => {
    persistJson(PARSER_RECOMMEND_KEY, showParserRecommend);
  }, [showParserRecommend]);

  useEffect(() => {
    if (!pipelineGuideTouched) return;
    persistJson(PIPELINE_GUIDE_KEY, showPipelineGuide);
  }, [pipelineGuideTouched, showPipelineGuide]);

  useEffect(() => {
    persistJson(PROFILE_ORDER_KEY, profileOrder);
  }, [profileOrder]);

  useEffect(() => {
    persistJson(SHOW_ID_FIELDS_KEY, showIdField);
  }, [showIdField]);

  useEffect(() => {
    if (!visiblePipelineIds.length) return;
    if (!activePipelineId || !visiblePipelineIds.includes(activePipelineId)) {
      setActivePipelineId(visiblePipelineIds[0]);
    }
  }, [visiblePipelineIds, activePipelineId]);

  useEffect(() => {
    if (
      kind === "pipeline" &&
      selectedId &&
      selectedId !== activePipelineId
    ) {
      setActivePipelineId(selectedId);
    }
  }, [kind, selectedId, activePipelineId]);


  const resolveProfileName = (id?: string, name?: string) => {
    const safeId = id || "";
    const trimmed = String(name || "").trim();
    const aliases = safeId ? DEFAULT_PROFILE_NAME_ALIASES[safeId] : undefined;
    const isDefaultName =
      Boolean(trimmed) &&
      Array.isArray(aliases) &&
      aliases.some((alias) => alias.toLowerCase() === trimmed.toLowerCase());
    const profileNameMap =
      (texts.profileNames as Record<string, string> | undefined) ||
      (fallbackTexts.profileNames as Record<string, string> | undefined);
    const templateItemMap =
      (texts.templateItems as
        | Record<string, { title?: string }>
        | undefined) ||
      (fallbackTexts.templateItems as
        | Record<string, { title?: string }>
        | undefined);
    const localized = safeId ? profileNameMap?.[safeId] : undefined;
    const templateTitle = safeId ? templateItemMap?.[safeId]?.title : undefined;
    if (trimmed && trimmed !== safeId && !isDefaultName) return trimmed;
    if (localized) return localized;
    if (templateTitle) return templateTitle;
    if (trimmed) return trimmed;
    return safeId || texts.untitledProfile;
  };

  const visibleProfiles = useMemo(() => {
    if (kind === "policy" || kind === "chunk") {
      return profiles.filter(
        (item) => item.kind === kind && !isHiddenProfile(item.kind, item.id),
      );
    }
    return profiles.filter(
      (item) => item.kind === kind && !isHiddenProfile(kind, item.id),
    );
  }, [profiles, kind, isHiddenProfile]);

  const activeProfileName = useMemo(() => {
    switch (kind) {
      case "api":
        return apiForm.name;
      case "pipeline":
        return pipelineComposer.name;
      case "prompt":
        return promptForm.name;
      case "parser":
        return parserForm.name;
      case "policy":
        return policyForm.name;
      case "chunk":
        return chunkForm.name;
      default:
        return "";
    }
  }, [
    kind,
    apiForm.name,
    pipelineComposer.name,
    promptForm.name,
    parserForm.name,
    policyForm.name,
    chunkForm.name,
  ]);


  const visibleProfileIndex = useMemo(() => {
    const next: Record<ProfileKind, string[]> = { ...profileIndex };
    (Object.keys(next) as ProfileKind[]).forEach((targetKind) => {
      next[targetKind] = next[targetKind].filter(
        (id) => !isHiddenProfile(targetKind, id),
      );
    });
    return next;
  }, [profileIndex, isHiddenProfile]);

  const filteredProfiles = useMemo(() => {
    if (!deferredSearchTerm) return visibleProfiles;
    const lower = deferredSearchTerm.toLowerCase();
    return visibleProfiles.filter(
      (p) =>
        resolveProfileName(p.id, p.name).toLowerCase().includes(lower) ||
        p.id.toLowerCase().includes(lower),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveProfileName only depends on texts (in deps) and fallbackTexts (constant)
  }, [visibleProfiles, deferredSearchTerm, texts]);

  const getProfileLabel = (targetKind: ProfileKind, id?: string) => {
    if (!id) return "";
    const name = profileMeta[targetKind]?.[id];
    return resolveProfileName(id, name);
  };

  const formatOptionLabel = (targetKind: ProfileKind, id: string) => {
    const label = getProfileLabel(targetKind, id);
    return label || texts.untitledProfile;
  };

  const showLineChunkLabel = useMemo(() => {
    let count = 0;
    for (const id of profileIndex.chunk) {
      if (chunkTypeIndex[id] === "line") {
        count += 1;
        if (count > 1) return true;
      }
    }
    return false;
  }, [profileIndex.chunk, chunkTypeIndex]);

  const getStrategyLabel = (lineId: string, chunkId: string) => {
    const lineLabel = lineId ? getProfileLabel("policy", lineId) : "";
    const chunkLabel = chunkId ? getProfileLabel("chunk", chunkId) : "";
    const chunkType = chunkId ? chunkTypeIndex[chunkId] : "";
    if (chunkType === "line") {
      if (lineLabel && (!showLineChunkLabel || !chunkLabel)) return lineLabel;
      if (lineLabel && chunkLabel) return `${lineLabel} · ${chunkLabel}`;
      return lineLabel || chunkLabel || texts.untitledProfile;
    }
    if (chunkType === "block") {
      return chunkLabel || lineLabel || texts.untitledProfile;
    }
    if (lineLabel && chunkLabel) return `${lineLabel} · ${chunkLabel}`;
    return lineLabel || chunkLabel || texts.untitledProfile;
  };

  const getFallbackProfileId = (targetKind: ProfileKind, excludeId: string) => {
    const candidates = visibleProfileIndex[targetKind] || [];
    return candidates.find((id) => id !== excludeId) || "";
  };

  const updatePipelineReferences = async (
    refKind: ProfileKind,
    fromId: string,
    toId?: string,
  ) => {
    const fieldMap: Partial<Record<ProfileKind, string>> = {
      api: "provider",
      prompt: "prompt",
      parser: "parser",
      policy: "line_policy",
      chunk: "chunk_policy",
    };
    const field = fieldMap[refKind];
    if (!field) return { updated: 0, missingFallback: false };
    const list = await window.api?.pipelineV2ProfilesList?.("pipeline");
    if (!Array.isArray(list) || !list.length) {
      return { updated: 0, missingFallback: false };
    }
    const pipelineIds = list.map((item) => item.id).filter(Boolean);
    const fallbackId = toId || getFallbackProfileId(refKind, fromId);
    const missingFallback = !toId && !fallbackId;
    let updated = 0;
    try {
      const loaded = await loadProfilesBatch("pipeline", pipelineIds);
      for (const entry of loaded) {
        const result = entry.result;
        const data =
          result?.data ??
          (result?.yaml ? (safeLoadYaml(result.yaml) as any) : null);
        if (!data || typeof data !== "object") continue;
        if (String((data as any)[field] ?? "") !== fromId) continue;
        const nextData: any = { ...(data as any) };
        if (toId) {
          nextData[field] = toId;
        } else if (fallbackId) {
          nextData[field] = fallbackId;
        } else {
          delete nextData[field];
        }
        if (field === "line_policy" && !nextData.line_policy) {
          nextData.apply_line_policy = false;
        }
        const targetId = String(nextData.id || entry.id || "").trim();
        if (!targetId) continue;
        const nextYaml = yaml.dump(nextData);
        const saveResult = await window.api?.pipelineV2ProfilesSave?.(
          "pipeline",
          targetId,
          nextYaml,
          { allowOverwrite: true },
        );
        if (saveResult?.ok) updated += 1;
      }
    } catch (error) {
      console.error("Failed to update pipeline references:", error);
    }
    return { updated, missingFallback };
  };

  const getExistingIds = (targetKind: ProfileKind) => {
    const ids = new Set<string>();
    (profileIndex[targetKind] || []).forEach((id) => ids.add(id));
    const meta = profileMeta[targetKind];
    if (meta) {
      Object.keys(meta).forEach((id) => ids.add(id));
    }
    profiles.forEach((item) => {
      if (item.kind === targetKind) ids.add(item.id);
    });
    return Array.from(ids);
  };

  const buildValidationIndex = () => {
    const next: Record<ProfileKind, string[]> = { ...profileIndex };
    (Object.keys(next) as ProfileKind[]).forEach((targetKind) => {
      if (next[targetKind]?.length) return;
      const meta = profileMeta[targetKind];
      if (meta && Object.keys(meta).length) {
        next[targetKind] = Object.keys(meta);
      }
    });
    return next;
  };

  const isExistingProfileId = (
    targetKind: ProfileKind,
    id: string,
    currentId?: string | null,
  ) => {
    if (!id) return false;
    if (currentId && id === currentId) return false;
    const indexed = profileIndex[targetKind];
    if (Array.isArray(indexed) && indexed.includes(id)) return true;
    const meta = profileMeta[targetKind];
    if (meta && id in meta) return true;
    return profiles.some((item) => item.kind === targetKind && item.id === id);
  };

  const buildAutoProfileId = (
    targetKind: ProfileKind,
    name: string,
    currentId?: string,
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return currentId || "";
    const baseSeed = slugifyProfileId(trimmed) || `${targetKind}_profile`;
    return createUniqueProfileId(baseSeed, getExistingIds(targetKind), currentId);
  };

  const shouldAutoUpdateId = (targetKind: ProfileKind, name: string) =>
    autoIdEnabled[targetKind] && !selectedId && Boolean(name.trim());

  const markIdAsCustom = (targetKind: ProfileKind) => {
    setAutoIdEnabled((prev) => ({ ...prev, [targetKind]: false }));
  };

  const toggleIdField = (targetKind: ProfileKind) => {
    setShowIdField((prev) => ({
      ...prev,
      [targetKind]: !prev[targetKind],
    }));
  };

  const detectPresetByBaseUrl = (baseUrl: string) => {
    const normalized = normalizePresetUrl(baseUrl);
    if (!normalized) return null;
    for (const preset of API_PRESETS_DATA) {
      const channels = getPresetChannels(preset);
      for (const channel of channels) {
        if (normalizePresetUrl(channel.baseUrl) === normalized) {
          return { presetId: preset.id, channelId: channel.id };
        }
      }
      if (preset.baseUrl && normalizePresetUrl(preset.baseUrl) === normalized) {
        return { presetId: preset.id, channelId: preset.defaultChannel || "" };
      }
    }
    return null;
  };

  const loadProfilesBatch = async (
    targetKind: ProfileKind,
    ids: string[],
  ): Promise<Array<{ id: string; result: any | null }>> => {
    if (!ids.length) return [];
    if (window.api?.pipelineV2ProfilesLoadBatch) {
      const result = await window.api.pipelineV2ProfilesLoadBatch(
        targetKind,
        ids,
      );
      return Array.isArray(result) ? result : [];
    }
    const entries = await Promise.all(
      ids.map(async (id) => ({
        id,
        result: await window.api?.pipelineV2ProfilesLoad?.(targetKind, id),
      })),
    );
    return entries;
  };

  const loadChunkTypeIndex = async (
    chunkIds: string[],
    requestId?: number,
    preloadList?: Array<{ id?: string; chunk_type?: string; type?: string }>,
  ) => {
    if (!chunkIds.length) {
      if (!requestId || requestId === loadProfilesSeq.current) {
        setChunkTypeIndex({});
      }
      return;
    }
    const preloaded = new Map<string, "" | "line" | "block">();
    if (Array.isArray(preloadList)) {
      preloadList.forEach((item) => {
        const rawId = item?.id ? String(item.id) : "";
        if (!rawId) return;
        const rawType = String(item.chunk_type || item.type || "");
        const normalized = normalizeChunkType(rawType);
        if (normalized) preloaded.set(rawId, normalized);
      });
    }
    const directEntries: Array<[string, "" | "line" | "block"]> = [];
    const pendingIds: string[] = [];
    for (const id of chunkIds) {
      const cached = chunkTypeIndex[id];
      if (cached) {
        directEntries.push([id, cached]);
        continue;
      }
      const preloadedType = preloaded.get(id);
      if (preloadedType) {
        directEntries.push([id, preloadedType]);
        continue;
      }
      pendingIds.push(id);
    }
    const commitEntries = (
      entries: Array<[string, "" | "line" | "block"]>,
    ) => {
      if (requestId && requestId !== loadProfilesSeq.current) return;
      setChunkTypeIndex((prev) => {
        const next: Record<string, "" | "line" | "block"> = {};
        chunkIds.forEach((id) => {
          const existing = prev[id];
          if (existing) next[id] = existing;
        });
        entries.forEach(([id, type]) => {
          if (type) next[id] = type;
        });
        return next;
      });
    };
    if (!pendingIds.length) {
      commitEntries(directEntries);
      return;
    }
    try {
      const loaded = await loadProfilesBatch("chunk", pendingIds);
      const loadedMap = new Map(
        loaded.map((entry) => [entry.id, entry.result]),
      );
      const entries = pendingIds.map((id) => {
        try {
          const result = loadedMap.get(id);
          const data =
            result?.data ??
            (result?.yaml ? (safeLoadYaml(result.yaml) as any) : null);
          const raw = String(data?.chunk_type || data?.type || "");
          const normalized = normalizeChunkType(raw);
          return [id, normalized] as [string, "" | "line" | "block"];
        } catch {
          return [id, ""] as [string, "" | "line" | "block"];
        }
      });
      commitEntries([...directEntries, ...entries]);
    } catch {
      commitEntries(directEntries);
    }
  };

  const loadProfileIndex = async (
    requestId?: number,
    preload?: Partial<Record<ProfileKind, any[]>>,
    kinds: ProfileKind[] = PROFILE_KINDS,
  ) => {
    const nextIndex: Record<ProfileKind, string[]> = { ...profileIndex };
    const nextMeta: Record<ProfileKind, Record<string, string>> = {
      ...profileMeta,
    };
    let chunkList: Array<{ id?: string; chunk_type?: string; type?: string }> | null =
      Array.isArray(preload?.chunk) ? preload?.chunk || null : null;
    try {
      const results = await Promise.all(
        kinds.map(async (targetKind) => {
          const preloaded = preload?.[targetKind];
          if (Array.isArray(preloaded)) {
            return [targetKind, preloaded] as const;
          }
          const list = await window.api?.pipelineV2ProfilesList?.(targetKind);
          return [targetKind, list] as const;
        }),
      );
      for (const [targetKind, list] of results) {
        if (!Array.isArray(list)) continue;
        const ids: string[] = [];
        const metaEntries = new Map<string, string>();
        list.forEach((item) => {
          const rawId = item?.id ? String(item.id) : "";
          if (!rawId || metaEntries.has(rawId)) return;
          ids.push(rawId);
          metaEntries.set(
            rawId,
            normalizeDefaultProfileName(rawId, item.name || rawId),
          );
        });
        nextIndex[targetKind] = ids;
        nextMeta[targetKind] = Object.fromEntries(metaEntries);
        if (targetKind === "chunk") {
          chunkList = list;
        }
      }
    } catch {
      // ignore
    }
    if (!requestId || requestId === loadProfilesSeq.current) {
      setProfileIndex(nextIndex);
      setProfileMeta(nextMeta);
    }
    const shouldLoadChunkType =
      kind === "pipeline" || kind === "policy" || kind === "chunk";
    if (shouldLoadChunkType) {
      await loadChunkTypeIndex(nextIndex.chunk, requestId, chunkList || undefined);
    }
  };

  const warmPipelineIndex = async (
    requestId: number,
    preload?: Partial<Record<ProfileKind, any[]>>,
  ) => {
    if (pipelineIndexLoading) return;
    const indexRequest = ++pipelineIndexSeq.current;
    setPipelineIndexLoading(true);
    try {
      await loadProfileIndex(requestId, preload, PROFILE_KINDS);
    } finally {
      if (indexRequest === pipelineIndexSeq.current) {
        if (requestId === loadProfilesSeq.current) {
          setPipelineIndexReady(true);
        }
        setPipelineIndexLoading(false);
      }
    }
  };

  // Load profiles
  const loadProfiles = async () => {
    const requestId = ++loadProfilesSeq.current;
    setIsProfilesLoading(true);
    const shouldFastLoadPipeline =
      kind === "pipeline" &&
      pipelineView === "overview" &&
      (profilesLoadedKind !== "pipeline" || !pipelineIndexReady);

    if (shouldFastLoadPipeline) {
      const preload: Partial<Record<ProfileKind, any[]>> = {};
      try {
        const list = await window.api?.pipelineV2ProfilesList?.("pipeline", {
          preferLocal: true,
        });
        if (Array.isArray(list)) preload.pipeline = list;
        const filtered = Array.isArray(list)
          ? list.filter((item) => !isHiddenProfile("pipeline", item.id))
          : [];
        if (requestId !== loadProfilesSeq.current) return;
        setProfiles(
          filtered.map((item) => ({
            id: String(item.id),
            name: normalizeDefaultProfileName(item.id, item.name || item.id),
            kind: "pipeline" as const,
          })),
        );
        setProfileMeta((prev) => ({
          ...prev,
          pipeline: Object.fromEntries(
            filtered.map((item) => [
              item.id,
              normalizeDefaultProfileName(item.id, item.name || item.id),
            ]),
          ),
        }));
        setProfileIndex((prev) => ({
          ...prev,
          pipeline: filtered.map((item) => String(item.id)),
        }));
      } catch (e) {
        console.error("Failed to load pipeline list:", e);
        if (requestId === loadProfilesSeq.current) {
          setProfiles([]);
          setProfileIndex((prev) => ({ ...prev, pipeline: [] }));
          setProfileMeta((prev) => ({ ...prev, pipeline: {} }));
        }
      } finally {
        if (requestId === loadProfilesSeq.current) {
          setIsProfilesLoading(false);
          setProfilesLoadedKind(kind);
        }
      }
      if (
        requestId === loadProfilesSeq.current &&
        !pipelineIndexReady &&
        !pipelineIndexLoading
      ) {
        void warmPipelineIndex(requestId, preload);
      }
      return;
    }
    const preload: Partial<Record<ProfileKind, any[]>> = {};
    const indexKinds: ProfileKind[] =
      kind === "pipeline"
        ? PROFILE_KINDS
        : isStrategyKind(kind)
          ? ["policy", "chunk"]
          : [kind];
    try {
      if (isStrategyKind(kind)) {
        const [policyList, chunkList] = await Promise.all([
          window.api?.pipelineV2ProfilesList?.("policy"),
          window.api?.pipelineV2ProfilesList?.("chunk"),
        ]);
        if (Array.isArray(policyList)) preload.policy = policyList;
        if (Array.isArray(chunkList)) preload.chunk = chunkList;
        const policyItems = Array.isArray(policyList)
          ? policyList
            .filter((item) => !isHiddenProfile("policy", item.id))
            .map((item) => ({
              id: item.id,
              name: normalizeDefaultProfileName(item.id, item.name || item.id),
              kind: "policy" as const,
            }))
          : [];
        const chunkItems = Array.isArray(chunkList)
          ? chunkList
            .filter((item) => !isHiddenProfile("chunk", item.id))
            .map((item) => ({
              id: item.id,
              name: normalizeDefaultProfileName(item.id, item.name || item.id),
              kind: "chunk" as const,
            }))
          : [];
        if (requestId !== loadProfilesSeq.current) return;
        setProfiles([...policyItems, ...chunkItems]);
        const filteredPolicyList = Array.isArray(policyList)
          ? policyList.filter((item) => !isHiddenProfile("policy", item.id))
          : [];
        const filteredChunkList = Array.isArray(chunkList)
          ? chunkList.filter((item) => !isHiddenProfile("chunk", item.id))
          : [];
        if (requestId !== loadProfilesSeq.current) return;
        setProfileMeta((prev) => ({
          ...prev,
          policy: Object.fromEntries(
            filteredPolicyList.map((item: any) => [
              item.id,
              normalizeDefaultProfileName(item.id, item.name || item.id),
            ]),
          ),
          chunk: Object.fromEntries(
            filteredChunkList.map((item: any) => [
              item.id,
              normalizeDefaultProfileName(item.id, item.name || item.id),
            ]),
          ),
        }));
      } else {
        const list = await window.api?.pipelineV2ProfilesList?.(kind);
        if (Array.isArray(list)) preload[kind] = list;
        if (Array.isArray(list)) {
          const filtered = list.filter(
            (item) => !isHiddenProfile(kind, item.id),
          );
          if (requestId !== loadProfilesSeq.current) return;
          setProfiles(
            filtered.map((item) => ({
              id: item.id,
              name: normalizeDefaultProfileName(item.id, item.name || item.id),
              kind,
            })),
          );
          setProfileMeta((prev) => ({
            ...prev,
            [kind]: Object.fromEntries(
              filtered.map((item) => [
                item.id,
                normalizeDefaultProfileName(item.id, item.name || item.id),
              ]),
            ),
          }));
        } else {
          if (requestId !== loadProfilesSeq.current) return;
          setProfiles([]);
        }
      }
      if (requestId !== loadProfilesSeq.current) return;
      await loadProfileIndex(requestId, preload, indexKinds);
    } catch (e) {
      console.error("Failed to load profiles:", e);
      if (requestId === loadProfilesSeq.current) {
        setProfiles([]);
      }
    } finally {
      if (requestId === loadProfilesSeq.current) {
        setIsProfilesLoading(false);
        setProfilesLoadedKind(kind);
        if (kind === "pipeline") {
          setPipelineIndexReady(true);
          setPipelineIndexLoading(false);
        }
      }
    }
  };

  useEffect(() => {
    loadProfiles();
    setEditorTab("visual");
    setPromptPreview(DEFAULT_PROMPT_PREVIEW);
    setActivePresetId(null);
    setActivePresetChannel("");
    setModelList([]);
    setModelListRequested(false);
    setModelListError("");
    setModelListLoading(false);
    setTemplateSelectorOpen(false);
    setTemplateManagerOpen(false);
    setTemplateDraftName("");
    setTemplateDraftDesc("");
    setApiAdvancedTab("sampling");
    setShowApiSetup(false);
    if (kind === "pipeline") {
      setPipelineView("overview");
    }
    if (kind === "policy" || kind === "chunk") {
      setStrategyKind(kind);
    }
    if (pendingSelection && pendingSelection.kind === kind) {
      setSelectedId(pendingSelection.id);
      setPendingSelection(null);
    } else {
      setSelectedId(null);
      commitYamlText("", { baseline: true });
    }
  }, [kind]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- buildNewProfileYaml/handlePresetSelect are stable within the component render
  useEffect(() => {
    if (!pendingCreate || pendingCreate.kind !== kind) return;
    if (profilesLoadedKind !== kind) return;
    setSelectedId(null);
    setEditorTab("visual");
    resetFormState(kind);
    if ("preset" in pendingCreate) {
      handlePresetSelect(pendingCreate.preset ?? null, pendingCreate.channelId);
    } else {
      const nextYaml = buildNewProfileYaml(kind);
      commitYamlText(nextYaml);
      setBaselineYaml("");
      syncFormsFromYaml(nextYaml, kind);
    }
    setPendingCreate(null);
  }, [kind, pendingCreate, profilesLoadedKind]);

  useEffect(() => {
    if (kind !== "pipeline") return;
    if (pipelineView !== "overview") return;
    if (!pipelineIndexReady) return;
    setPipelineSummaryIndex((prev) =>
      prunePipelineSummaryIndex(prev, visiblePipelineIds),
    );
    if (!visiblePipelineIds.length) {
      setIsPipelineSummaryLoading(false);
      return;
    }
    const pendingIds = visiblePipelineIds.filter(
      (id) => !pipelineSummaryIndex[id],
    );
    const batchIds = pendingIds.slice(0, PIPELINE_SUMMARY_BATCH_SIZE);
    if (!batchIds.length) {
      setIsPipelineSummaryLoading(false);
      return;
    }
    const requestId = ++pipelineSummarySeq.current;
    setIsPipelineSummaryLoading(true);
    const loadSummaries = async () => {
      try {
        const loaded = await loadProfilesBatch("pipeline", batchIds);
        const loadedMap = new Map(
          loaded.map((entry) => [entry.id, entry.result]),
        );
        const entries = batchIds.map((id) => {
          try {
            const result = loadedMap.get(id);
            const data =
              result?.data ??
              (result?.yaml ? (safeLoadYaml(result.yaml) as any) : null);
            return [id, buildPipelineSummary(data, { id })] as const;
          } catch {
            return [id, buildPipelineSummary(null, { id })] as const;
          }
        });
        if (requestId !== pipelineSummarySeq.current) return;
        setPipelineSummaryIndex((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      } catch {
        if (requestId === pipelineSummarySeq.current) {
          setPipelineSummaryIndex((prev) => ({ ...prev }));
        }
      } finally {
        if (requestId === pipelineSummarySeq.current) {
          setIsPipelineSummaryLoading(false);
        }
      }
    };
    loadSummaries();
  }, [kind, pipelineView, pipelineIndexReady, visiblePipelineIds, pipelineSummaryIndex]);

  useEffect(() => {
    if (kind !== "pipeline") return;
    if (pipelineView !== "editor") return;
    if (pipelineIndexReady || pipelineIndexLoading) return;
    const requestId = loadProfilesSeq.current;
    void warmPipelineIndex(requestId);
  }, [kind, pipelineView, pipelineIndexReady, pipelineIndexLoading]);

  useEffect(() => {
    if (pendingSelection && pendingSelection.kind === kind) {
      setEditorTab("visual");
    }
  }, [kind, pendingSelection]);

  useEffect(() => {
    if (kind !== "api" || selectedId) {
      setPendingPipelineLink(false);
    }
  }, [kind, selectedId]);

  useEffect(() => {
    setHeaderPairs(parseKeyValuePairs(apiForm.headers));
  }, [apiForm.headers]);

  useEffect(() => {
    setParamPairs(parseKeyValuePairs(apiForm.params));
  }, [apiForm.params]);

  // Load specific profile
  const loadProfileDetail = async (
    id: string,
    targetKind: ProfileKind = kind,
  ) => {
    const requestId = ++loadDetailSeq.current;
    try {
      const result = await window.api?.pipelineV2ProfilesLoad?.(targetKind, id);
      if (result?.yaml) {
        if (requestId !== loadDetailSeq.current) return;
        if (selectedId !== id || kind !== targetKind) return;
        commitYamlText(result.yaml || "", { baseline: true });
        const data = result.data ?? (safeLoadYaml(result.yaml) as any);
        if (!data || typeof data !== "object") return;
        lastProfileDataRef.current[targetKind] = data;
        syncFormsFromData(targetKind, data);
        setAutoIdEnabled((prev) => ({ ...prev, [targetKind]: false }));
        if (targetKind === "api") setShowApiSetup(false);
      }
    } catch (e) {
      console.error("Failed to load profile details:", e);
    }
  };

  useEffect(() => {
    if (selectedId) {
      loadProfileDetail(selectedId, kind);
    }
  }, [selectedId, kind]);

  useEffect(() => {
    if (kind !== "api" || apiForm.apiType !== "openai_compat") {
      setActivePresetId(null);
      setActivePresetChannel("");
      return;
    }
    const match = detectPresetByBaseUrl(apiForm.baseUrl);
    if (match) {
      setActivePresetId(match.presetId);
      setActivePresetChannel(match.channelId || "");
    } else {
      setActivePresetId(null);
      setActivePresetChannel("");
    }
    setModelList([]);
    setModelListRequested(false);
    setModelListError("");
    modelListSeq.current += 1;
  }, [apiForm.baseUrl, apiForm.apiType, kind]);

  useEffect(() => {
    if (kind !== "prompt") return;
    refreshGlossaryFiles();
  }, [kind]);

  // Validation
  const parseYamlText = useCallback(
    (raw: string) => {
      if (!raw.trim()) return { data: null, error: "" };
      try {
        const data = safeLoadYaml(raw) as any;
        if (!data || typeof data !== "object") {
          return { data: null, error: texts.validationInvalidYaml };
        }
        return { data, error: "" };
      } catch (error: any) {
        return {
          data: null,
          error: error?.message || texts.validationInvalidYaml,
        };
      }
    },
    [texts.validationInvalidYaml],
  );
  const deferredYamlText = useDeferredValue(yamlText);
  const parsedResult = useMemo(
    () => parseYamlText(deferredYamlText),
    [deferredYamlText, parseYamlText],
  );

  useEffect(() => {
    setLastValidation(null);
  }, [yamlText]);

  const promptPreviewResult = useMemo(() => {
    const rawLineIndex = Number(promptPreview.lineIndex);
    const lineIndex = Number.isFinite(rawLineIndex) ? rawLineIndex : null;
    const mapping = {
      source: promptPreview.source || "",
      context_before: promptPreview.showContext
        ? promptPreview.contextBefore || ""
        : "",
      context_after: promptPreview.showContext
        ? promptPreview.contextAfter || ""
        : "",
      glossary: promptPreview.glossary || "",
      line_index: lineIndex === null ? "" : String(lineIndex),
      line_number: lineIndex === null ? "" : String(lineIndex + 1),
    };

    const system = promptForm.systemTemplate
      ? applyTemplate(promptForm.systemTemplate, mapping).trim()
      : "";
    const userTemplate = applyTemplate(
      promptForm.userTemplate || "",
      mapping,
    ).trim();
    const user = userTemplate || mapping.source;

    return {
      system,
      user,
    };
  }, [promptForm, promptPreview]);

  const refreshGlossaryFiles = async () => {
    if (!window.api?.getGlossaries) return;
    setGlossaryLoading(true);
    setGlossaryLoadError("");
    try {
      const result = await window.api.getGlossaries();
      const list = Array.isArray(result)
        ? result.map((item) => String(item)).filter(Boolean)
        : [];
      setGlossaryFiles(list);
      if (list.length && !list.includes(glossarySelected)) {
        setGlossarySelected(list[0]);
      }
    } catch (error) {
      setGlossaryLoadError(String(error));
    } finally {
      setGlossaryLoading(false);
    }
  };

  const handleLoadGlossary = async () => {
    if (!window.api?.readGlossaryFile) return;
    const target = glossarySelected || glossaryFiles[0] || "";
    if (!target) {
      setGlossaryLoadError(texts.promptPreviewGlossaryEmpty);
      return;
    }
    setGlossaryLoading(true);
    setGlossaryLoadError("");
    try {
      const raw = await window.api.readGlossaryFile(target);
      if (!raw) {
        setGlossaryLoadError(
          texts.promptPreviewGlossaryLoadFail.replace("{name}", target),
        );
        return;
      }
      const formatted = formatGlossaryPreview(raw);
      setPromptPreview((prev) => ({
        ...prev,
        glossary: formatted,
      }));
    } catch (error) {
      setGlossaryLoadError(String(error));
    } finally {
      setGlossaryLoading(false);
    }
  };

  // Actions
  const handleSyncFromYaml = () => {
    const latestYaml = flushYamlUpdate();
    const immediateParsed = parseYamlText(latestYaml);
    if (!latestYaml.trim()) {
      emitToast({
        title: texts.syncFromYaml,
        description: texts.emptyYaml,
        variant: "warning",
      });
      return;
    }
    if (!immediateParsed.data) {
      emitToast({
        title: texts.syncFromYaml,
        description: immediateParsed.error || texts.validationInvalidYaml,
        variant: "error",
      });
      return;
    }
    syncFormsFromData(kind, immediateParsed.data);
    setAutoIdEnabled((prev) => ({ ...prev, [kind]: false }));
    emitToast({
      title: texts.syncFromYaml,
      description: texts.syncFromYamlOk,
      variant: "success",
    });
    setEditorTab("visual");
  };

  const returnToKindHome = (targetKind: ProfileKind) => {
    if (targetKind === "pipeline") {
      setPipelineView("overview");
    }
    setSelectedId(null);
    commitYamlText("", { baseline: true });
    resetFormState(targetKind);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const latestYaml = flushYamlUpdate();
      const immediateParsed = parseYamlText(latestYaml);
      if (!latestYaml.trim()) {
        emitToast({
          title: texts.saveFail,
          description: texts.emptyYaml,
          variant: "error",
        });
        if (kind === "api") setShowApiSetup(true);
        return;
      }
      if (!immediateParsed.data) {
        emitToast({
          title: texts.saveFail,
          description: immediateParsed.error || texts.validationInvalidYaml,
          variant: "error",
        });
        if (kind === "api") setShowApiSetup(true);
        return;
      }
      const validationIndex = buildValidationIndex();
      const localValidation = validateProfile(
        kind,
        immediateParsed.data,
        validationIndex,
        texts,
      );
      setLastValidation(localValidation);
      if (localValidation.errors.length) {
        emitToast({
          title: texts.validationError,
          description: localValidation.errors.join("\n"),
          variant: "error",
        });
        if (kind === "api") setShowApiSetup(true);
        return;
      }
      const parsedData = immediateParsed.data as any;
      const parsedId = parsedData?.id ? String(parsedData.id).trim() : "";
      const existingId = selectedId;
      const isRename =
        Boolean(existingId) && Boolean(parsedId) && parsedId !== existingId;
      if (isRename && existingId && DEFAULT_PROTECTED_PROFILE_IDS.has(existingId)) {
        emitToast({
          title: texts.saveFail,
          description: texts.defaultPresetDeleteFail,
          variant: "error",
        });
        if (kind === "api") setShowApiSetup(true);
        return;
      }
      const saveId = parsedId || existingId;
      if (!saveId) {
        emitToast({
          title: texts.saveFail,
          description: texts.missingId,
          variant: "error",
        });
        if (kind === "api") setShowApiSetup(true);
        return;
      }
      if (isExistingProfileId(kind, saveId, existingId)) {
        emitToast({
          title: texts.saveFail,
          description: texts.validationProfileExists.replace("{id}", saveId),
          variant: "error",
        });
        if (kind === "api") setShowApiSetup(true);
        return;
      }
      let saveYamlText = latestYaml;
      if (parsedData && parsedId && parsedData.id !== parsedId) {
        const patched = { ...parsedData, id: parsedId };
        saveYamlText = yaml.dump(patched);
        commitYamlText(saveYamlText);
        syncFormsFromData(kind, patched);
      }

      const allowOverwrite = Boolean(existingId) && !isRename;
      const result = await window.api?.pipelineV2ProfilesSave?.(
        kind,
        saveId,
        saveYamlText,
        { allowOverwrite },
      );
      if (result?.ok) {
        emitToast({
          title: texts.saveOk,
          description: `${getKindLabel(kind)}: ${saveId}`,
          variant: "success",
        });
        if (kind === "api") setShowApiSetup(false);
        if (Array.isArray(result.warnings) && result.warnings.length) {
          emitToast({
            title: texts.validationWarn,
            description: result.warnings
              .map((code: string) => formatErrorCode(code, texts))
              .join("\n"),
            variant: "warning",
          });
        }
        if (isRename && existingId && existingId !== saveId && kind !== "pipeline") {
          const refUpdate = await updatePipelineReferences(
            kind,
            existingId,
            saveId,
          );
          if (refUpdate.updated) {
            emitToast({
              title: texts.referenceUpdateTitle,
              description: texts.referenceUpdateDesc.replace(
                "{count}",
                String(refUpdate.updated),
              ),
              variant: "success",
            });
          }
          if (refUpdate.missingFallback) {
            emitToast({
              title: texts.referenceUpdateMissingTitle,
              description: texts.referenceUpdateMissingDesc,
              variant: "warning",
            });
          }
        }
        const normalizedData =
          parsedData && parsedId && parsedData.id !== parsedId
            ? { ...parsedData, id: parsedId }
            : parsedData;
        if (normalizedData && typeof normalizedData === "object") {
          lastProfileDataRef.current[kind] = normalizedData as Record<string, any>;
        }
        await loadProfiles();
        if (kind === "api" && pendingPipelineLink) {
          await updateActivePipelineProvider(saveId);
          setPendingPipelineLink(false);
        }
        returnToKindHome(kind);
        if (isRename && existingId && existingId !== saveId) {
          const deleteResult = await window.api?.pipelineV2ProfilesDelete?.(
            kind,
            existingId,
          );
          if (!deleteResult?.ok) {
            emitToast({
              title: texts.deleteFail,
              description: formatServerError(
                deleteResult?.error,
                texts.deleteFail,
                texts,
              ),
              variant: "warning",
            });
          }
          setProfileOrder((prev) => {
            const next = { ...prev };
            const existing = next[kind] ? [...next[kind]] : [];
            next[kind] = existing.map((id) => (id === existingId ? saveId : id));
            return next;
          });
          if (kind === "pipeline" && activePipelineId === existingId) {
            setActivePipelineId(saveId);
          }
        }
        if (!existingId || isRename) {
          setProfileOrder((prev) => {
            const next = { ...prev };
            const existing = next[kind] ? [...next[kind]] : [];
            const filtered = existing.filter((id) => id !== saveId);
            next[kind] = [...filtered, saveId];
            return next;
          });
        }
      } else {
        emitToast({
          title: texts.saveFail,
          description: formatServerError(result?.error, texts.saveFail, texts),
          variant: "error",
        });
        if (kind === "api") setShowApiSetup(true);
      }
    } catch (e) {
      emitToast({
        title: texts.saveFail,
        description: String(e),
        variant: "error",
      });
      if (kind === "api") setShowApiSetup(true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (DEFAULT_PROTECTED_PROFILE_IDS.has(selectedId)) {
      showAlert({
        title: texts.deleteFail,
        description: texts.defaultPresetDeleteFail,
        variant: "warning",
      });
      return;
    }
    const deleteKind = kind;
    const deleteId = selectedId;
    const selectedName = resolveProfileName(
      deleteId,
      profiles.find((item) => item.id === deleteId && item.kind === deleteKind)
        ?.name,
    );
    showConfirm({
      title: texts.actionDelete,
      description: texts.deleteConfirm.replace("{name}", selectedName),
      variant: "destructive",
      onConfirm: async () => {
        try {
          const result = await window.api?.pipelineV2ProfilesDelete?.(
            deleteKind,
            deleteId,
          );
          if (result?.ok) {
            emitToast({ title: texts.deleteOk, variant: "success" });
            await loadProfiles();
            const refUpdate = await updatePipelineReferences(
              deleteKind,
              deleteId,
            );
            if (refUpdate.updated) {
              emitToast({
                title: texts.referenceUpdateTitle,
                description: texts.referenceUpdateDesc.replace(
                  "{count}",
                  String(refUpdate.updated),
                ),
                variant: "success",
              });
            }
            if (refUpdate.missingFallback) {
              emitToast({
                title: texts.referenceUpdateMissingTitle,
                description: texts.referenceUpdateMissingDesc,
                variant: "warning",
              });
            }
            setSelectedId(null);
            commitYamlText("", { baseline: true });
            if (deleteKind === "pipeline") {
              setPipelineView("overview");
              if (deleteId === activePipelineId) {
                setActivePipelineId("");
              }
            }
          } else {
            emitToast({
              title: texts.deleteFail,
              description: formatServerError(
                result?.error,
                texts.deleteFail,
                texts,
              ),
              variant: "error",
            });
          }
        } catch (e) {
          emitToast({
            title: texts.deleteFail,
            description: String(e),
            variant: "error",
          });
        }
      },
    });
  };

  // const resetApiToPresetMenu = () => {
  //   setSelectedId(null);
  //   setYamlText("");
  //   setEditorTab("visual");
  //   setApiForm(DEFAULT_API_FORM);
  //   setActivePresetId(null);
  //   setActivePresetChannel("");
  //   setModelList([]);
  //   setModelListError("");
  //   setModelListLoading(false);
  //   setApiTest({ status: "idle" });
  //   setAutoIdEnabled((prev) => ({ ...prev, api: true }));
  //   setShowApiSetup(false);
  // };

  const buildNewProfileYaml = (targetKind: ProfileKind) => {
    const template = DEFAULT_TEMPLATES[targetKind];
    const localizedYaml = localizeTemplateName(template, texts.untitledProfile);
    return ensureUniqueTemplateId(localizedYaml, targetKind);
  };

  const handleCreateByKind = (targetKind: ProfileKind) => {
    guardUnsaved(() => {
      if (targetKind === "pipeline") {
        setPipelineView("editor");
      }
      setAutoIdEnabled((prev) => ({ ...prev, [targetKind]: true }));
      setSelectedId(null);
      setEditorTab("visual");
      resetFormState(targetKind);
      if (targetKind === "api") setShowApiSetup(false);
      setBaselineYaml("");
      if (targetKind === "api") {
        if (kind !== targetKind) {
          setPendingCreate({ kind: targetKind, preset: null });
          setKind(targetKind);
          setSearchTerm("");
          return;
        }
        handlePresetSelect(null);
        return;
      }
      // For non-API kinds, pre-fill template immediately
      if (kind !== targetKind) {
        setPendingCreate({ kind: targetKind });
        setKind(targetKind);
        setSearchTerm("");
        return;
      }
      const nextYaml = buildNewProfileYaml(targetKind);
      commitYamlText(nextYaml);
      setBaselineYaml("");
      syncFormsFromYaml(nextYaml, targetKind);
    });
  };

  const handleCreate = () => handleCreateByKind(kind);

  const handleSelectProfile = (
    id: string,
    targetKind: ProfileKind = kind,
  ) => {
    guardUnsaved(() => {
      if (targetKind !== kind) {
        setPendingSelection({ id, kind: targetKind });
        commitYamlText("", { baseline: true });
        setEditorTab("visual");
        setKind(targetKind);
        setSearchTerm("");
        return;
      }
      if (targetKind === "pipeline") {
        setPipelineView("editor");
      }
      setSelectedId(id);
      setEditorTab("visual");
    });
  };

  const jumpToKindHome = (targetKind: ProfileKind) => {
    guardUnsaved(() => {
      if (targetKind !== kind) {
        setPendingSelection(null);
        setSelectedId(null);
        commitYamlText("", { baseline: true });
        setEditorTab("visual");
        setKind(targetKind);
        setSearchTerm("");
      } else {
        returnToKindHome(targetKind);
      }
      if (targetKind === "pipeline") {
        setPipelineView("overview");
      }
      if (targetKind === "api") {
        setShowApiSetup(false);
      }
    });
  };

  const handleTestApi = async () => {
    if (kind !== "api") return;
    if (apiForm.apiType === "pool") {
      emitToast({
        title: texts.testConnection,
        description: texts.testConnectionPoolHint,
        variant: "warning",
      });
      return;
    }
    const baseUrl = apiForm.baseUrl.trim();
    if (!baseUrl) {
      emitToast({
        title: texts.testConnection,
        description: texts.formMissing,
        variant: "warning",
      });
      return;
    }
    const apiKey =
      apiForm.apiKey
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean) || "";
    const timeoutValue = Number(apiForm.timeout);
    const timeoutMs =
      Number.isFinite(timeoutValue) && timeoutValue > 0
        ? timeoutValue * 1000
        : 8000;
    const requestId = ++apiTestSeq.current;
    setApiTest({ status: "testing" });
    try {
      const result = await window.api?.pipelineV2ApiTest?.({
        baseUrl,
        apiKey,
        timeoutMs,
        model: apiForm.model.trim(),
      });
      if (requestId !== apiTestSeq.current) return;
      if (result?.ok) {
        setApiTest({
          status: "success",
          latencyMs: result.latencyMs,
          statusCode: result.status,
          url: result.url,
        });
      } else {
        setApiTest({
          status: "error",
          message: formatServerError(
            result?.message,
            texts.testConnectionFailFallback,
            texts,
          ),
        });
      }
    } catch (e) {
      if (requestId !== apiTestSeq.current) return;
      setApiTest({ status: "error", message: String(e) });
    }
  };

  const handleTestConcurrency = async () => {
    if (kind !== "api") return;
    if (apiForm.apiType === "pool") {
      emitToast({
        title: texts.concurrencyAutoTest,
        description: texts.concurrencyAutoTestPoolHint,
        variant: "warning",
      });
      return;
    }
    const baseUrl = apiForm.baseUrl.trim();
    if (!baseUrl) {
      emitToast({
        title: texts.concurrencyAutoTest,
        description: texts.formMissing,
        variant: "warning",
      });
      return;
    }
    const apiKey =
      apiForm.apiKey
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean) || "";
    const timeoutValue = Number(apiForm.timeout);
    const timeoutMs =
      Number.isFinite(timeoutValue) && timeoutValue > 0
        ? timeoutValue * 1000
        : 8000;
    const maxConcurrencyValue = Number(apiForm.concurrency);
    const maxConcurrency =
      Number.isFinite(maxConcurrencyValue) && maxConcurrencyValue > 0
        ? Math.floor(maxConcurrencyValue)
        : undefined;
    const requestId = ++apiConcurrencySeq.current;
    setApiConcurrency({ status: "testing" });
    try {
      const result = await window.api?.pipelineV2ApiConcurrencyTest?.({
        baseUrl,
        apiKey,
        timeoutMs,
        maxConcurrency,
        model: apiForm.model.trim(),
      });
      if (requestId !== apiConcurrencySeq.current) return;
      if (result?.ok) {
        setApiConcurrency({
          status: "success",
          maxConcurrency: result.maxConcurrency,
          latencyMs: result.latencyMs,
          statusCounts: result.statusCounts,
          url: result.url,
          message: result.message,
        });
      } else {
        setApiConcurrency({
          status: "error",
          message: formatServerError(
            result?.message,
            texts.concurrencyAutoTestFail,
            texts,
          ),
          latencyMs: result?.latencyMs,
          statusCounts: result?.statusCounts,
          url: result?.url,
        });
      }
    } catch (e) {
      if (requestId !== apiConcurrencySeq.current) return;
      setApiConcurrency({ status: "error", message: String(e) });
    }
  };

  const handleFetchModelList = async () => {
    if (kind !== "api") return;
    if (apiForm.apiType === "pool") return;
    if (!supportsModelList) {
      setModelListRequested(true);
      setModelListError(texts.modelListUnsupported);
      return;
    }
    const baseUrl = apiForm.baseUrl.trim();
    if (!baseUrl) {
      emitToast({
        title: texts.saveFail,
        description: texts.formMissing,
        variant: "warning",
      });
      return;
    }
    const requestId = ++modelListSeq.current;
    setModelListRequested(true);
    const apiKey =
      apiForm.apiKey
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean) || "";
    const timeoutValue = Number(apiForm.timeout);
    const timeoutMs =
      Number.isFinite(timeoutValue) && timeoutValue > 0
        ? timeoutValue * 1000
        : 8000;
    setModelListLoading(true);
    setModelListError("");
    try {
      const result = await window.api?.pipelineV2ApiModels?.({
        baseUrl,
        apiKey,
        timeoutMs,
      });
      if (requestId !== modelListSeq.current) return;
      if (result?.ok && Array.isArray(result.models)) {
        const cleaned = result.models.filter((item: any) => Boolean(item));
        setModelList(cleaned);
        if (!cleaned.length) {
          setModelListError(texts.modelListEmpty);
        }
      } else {
        const message = formatServerError(
          result?.message,
          texts.modelListFailFallback,
          texts,
        );
        setModelListError(message);
      }
    } catch (error: any) {
      if (requestId !== modelListSeq.current) return;
      setModelListError(String(error?.message || error));
    } finally {
      if (requestId === modelListSeq.current) {
        setModelListLoading(false);
      }
    }
  };

  const handleSaveCustomTemplate = () => {
    const name = templateDraftName.trim();
    const desc = templateDraftDesc.trim();
    if (!yamlText.trim()) {
      emitToast({
        title: texts.saveFail,
        description: texts.templateMissingYaml,
        variant: "warning",
      });
      return;
    }
    if (!name) {
      emitToast({
        title: texts.saveFail,
        description: texts.templateMissingName,
        variant: "warning",
      });
      return;
    }
    const entry: TemplateEntry = {
      id: `custom_${Date.now()}`,
      yaml: yamlText,
      meta: { title: name, desc },
      custom: true,
    };
    setCustomTemplates((prev) => ({
      ...prev,
      [kind]: [...(prev[kind] || []), entry],
    }));
    setTemplateDraftName("");
    setTemplateDraftDesc("");
  };

  const handleRemoveCustomTemplate = (templateId: string) => {
    setCustomTemplates((prev) => ({
      ...prev,
      [kind]: (prev[kind] || []).filter((item) => item.id !== templateId),
    }));
  };

  const toggleTemplateHidden = (templateId: string) => {
    setHiddenTemplates((prev) => {
      const next = { ...prev };
      const current = new Set(next[kind] || []);
      if (current.has(templateId)) {
        current.delete(templateId);
      } else {
        current.add(templateId);
      }
      next[kind] = Array.from(current);
      return next;
    });
  };

  const resetFormState = (targetKind: ProfileKind) => {
    lastProfileDataRef.current[targetKind] = null;
    if (targetKind === "api") {
      setApiForm(DEFAULT_API_FORM);
      setShowApiSetup(false);
      return;
    }
    if (targetKind === "pipeline") {
      setPipelineComposer(DEFAULT_PIPELINE_COMPOSER);
      return;
    }
    if (targetKind === "prompt") {
      setPromptForm(DEFAULT_PROMPT_FORM);
      setPromptLegacyParts(null);
      setPromptPreview(DEFAULT_PROMPT_PREVIEW);
      return;
    }
    if (targetKind === "parser") {
      setParserForm(createDefaultParserForm());
      setParserSample("");
      setParserPreview(null);
      return;
    }
    if (targetKind === "policy") {
      setPolicyForm(DEFAULT_POLICY_FORM);
      return;
    }
    if (targetKind === "chunk") {
      setChunkForm(DEFAULT_CHUNK_FORM);
    }
  };

  const handleOpenProfilesDir = async () => {
    try {
      const profilesDir = await window.api?.pipelineV2ProfilesPath?.();
      if (!profilesDir) {
        emitToast({
          title: texts.openProfilesDirFail,
          variant: "error",
        });
        return;
      }
      const opened = await window.api?.openFolder?.(profilesDir);
      if (!opened) {
        emitToast({
          title: texts.openProfilesDirFail,
          variant: "error",
        });
      }
    } catch {
      emitToast({
        title: texts.openProfilesDirFail,
        variant: "error",
      });
    }
  };

  const handlePresetSelect = (
    preset: ApiPreset | null,
    channelId?: string,
  ) => {
    lastProfileDataRef.current.api = null;
    if (preset) {
      const option = resolvePresetOption(preset, channelId);
      const id = buildApiPresetProfileId(preset.id, getExistingIds("api"));
      const presetLabel = getPresetLabel(preset);
      const newForm: ApiFormState = {
        ...DEFAULT_API_FORM,
        id: id,
        name: presetLabel,
        baseUrl: option.baseUrl,
        model: option.model,
        apiType: "openai_compat",
      };
      setApiForm(newForm);
      updateYamlFromApiForm(newForm); // sync to yaml
      setActivePresetId(preset.id);
      setActivePresetChannel(option.channelId || "");
      setModelList([]);
      setModelListError("");
      setModelListLoading(false);
      setModelListRequested(false);
    } else {
      // Custom / Empty
      const id = createUniqueProfileId("new_api", getExistingIds("api"));
      const newForm: ApiFormState = {
        ...DEFAULT_API_FORM,
        id,
        name: texts.untitledProfile,
      };
      setApiForm(newForm);
      updateYamlFromApiForm(newForm);
      setActivePresetId(null);
      setActivePresetChannel("");
      setModelList([]);
      setModelListRequested(false);
      setModelListError("");
      setModelListLoading(false);
    }
    setAutoIdEnabled((prev) => ({ ...prev, api: true }));
    setShowApiSetup(false);
    setPendingPipelineLink(true);
    // We don't set selectedId string, we act as 'new' (id=null, but yaml populated)
  };

  const resolveActivePipelineId = () => {
    if (activePipelineId && visiblePipelineIds.includes(activePipelineId)) {
      return activePipelineId;
    }
    return visiblePipelineIds[0] || "";
  };

  const updateActivePipelineProvider = async (providerId: string) => {
    const pipelineId = resolveActivePipelineId();
    if (!pipelineId) return;
    try {
      const result = await window.api?.pipelineV2ProfilesLoad?.(
        "pipeline",
        pipelineId,
      );
      const data =
        result?.data ?? (result?.yaml ? (safeLoadYaml(result.yaml) as any) : null);
      const nextData: any = { ...(data || {}), id: pipelineId };
      nextData.provider = providerId;
      const fallbackPrompt = profileIndex.prompt[0] || "";
      const fallbackParser = profileIndex.parser[0] || "";
      const fallbackChunk = profileIndex.chunk[0] || "";
      if (!nextData.prompt && fallbackPrompt) nextData.prompt = fallbackPrompt;
      if (!nextData.parser && fallbackParser) nextData.parser = fallbackParser;
      if (!nextData.chunk_policy && fallbackChunk)
        nextData.chunk_policy = fallbackChunk;
      const chunkMode = inferChunkType(String(nextData.chunk_policy || ""));
      const hasLinePolicy = Boolean(nextData.line_policy);
      const hasApplyFlag = nextData.apply_line_policy !== undefined;
      if (chunkMode === "line") {
        if (!hasApplyFlag) {
          nextData.apply_line_policy = hasLinePolicy;
        }
        if (nextData.apply_line_policy && !hasLinePolicy) {
          const fallbackPolicy = profileIndex.policy[0] || "";
          if (fallbackPolicy) nextData.line_policy = fallbackPolicy;
        }
      } else {
        if (nextData.line_policy !== undefined) delete nextData.line_policy;
        if (nextData.apply_line_policy !== undefined) delete nextData.apply_line_policy;
      }

      const nextYaml = yaml.dump(nextData);
      await window.api?.pipelineV2ProfilesSave?.(
        "pipeline",
        pipelineId,
        nextYaml,
        { allowOverwrite: true },
      );
      setActivePipelineId(pipelineId);
      if (kind === "pipeline" && selectedId === pipelineId) {
        commitYamlText(nextYaml, { baseline: true });
        syncFormsFromData("pipeline", nextData);
      }
    } catch (e) {
      console.error("Failed to sync pipeline provider:", e);
    }
  };

  const seedPoolEndpointsFromForm = (form: ApiFormState) => {
    const existing = (form.poolEndpoints || []).filter(
      (item) => item.baseUrl.trim() || item.model.trim() || item.apiKeys.trim(),
    );
    if (existing.length) return form.poolEndpoints;
    const baseUrl = form.baseUrl.trim();
    const model = form.model.trim();
    const apiKeys = form.apiKey.trim();
    if (!baseUrl && !model && !apiKeys) {
      return [createPoolEndpoint()];
    }
    return [
      {
        baseUrl,
        model,
        apiKeys,
        weight: "1",
      },
    ];
  };

  const applyApiQuickPreset = (presetId: PresetId, channelId?: string) => {
    const preset = API_PRESETS_DATA.find((item) => item.id === presetId);
    if (!preset) return;
    const option = resolvePresetOption(preset, channelId);
    const presetLabel = getPresetLabel(preset);
    const nextForm: ApiFormState = {
      ...apiForm,
      apiType: "openai_compat",
    };
    if (option.baseUrl) nextForm.baseUrl = option.baseUrl;
    if (option.model) nextForm.model = option.model;
    if (!nextForm.name.trim()) nextForm.name = presetLabel;
    if (!nextForm.id.trim())
      nextForm.id = buildApiPresetProfileId(preset.id, getExistingIds("api"));
    updateYamlFromApiForm(nextForm);
    setActivePresetId(preset.id);
    setActivePresetChannel(option.channelId || "");
    setModelList([]);
    setModelListRequested(false);
    setModelListError("");
  };

  const normalizeChecks = (raw: any) => {
    if (Array.isArray(raw)) {
      return Object.fromEntries(raw.map((item) => [String(item), true]));
    }
    if (raw && typeof raw === "object") {
      return Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [
          String(key),
          Boolean(value),
        ]),
      );
    }
    if (typeof raw === "string") {
      return { [raw]: true };
    }
    return {};
  };

  const normalizeSourceLang = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    const base = trimmed.toLowerCase().split(/[-_]/)[0];
    if (base === "ja" || base === "jp") return base;
    return trimmed;
  };


  const normalizeParserRuleType = (value: string): ParserRuleType => {
    if (parserRuleTypes.includes(value as ParserRuleType))
      return value as ParserRuleType;
    return "plain";
  };

  const parseJsonObject = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, any>;
    } catch {
      return null;
    }
  };

  const extractRegexFlags = (options: any) => {
    const flags = {
      multiline: false,
      dotall: false,
      ignorecase: false,
    };
    const rawFlags = options?.flags;
    const list =
      typeof rawFlags === "string"
        ? rawFlags.split(",").map((item: string) => item.trim())
        : Array.isArray(rawFlags)
          ? rawFlags.map((item) => String(item).trim())
          : [];
    list.forEach((item) => {
      const key = item.toLowerCase();
      if (key === "multiline") flags.multiline = true;
      if (key === "dotall") flags.dotall = true;
      if (key === "ignorecase") flags.ignorecase = true;
    });
    if (options?.multiline) flags.multiline = true;
    if (options?.dotall) flags.dotall = true;
    if (options?.ignorecase) flags.ignorecase = true;
    return flags;
  };

  const stripParserKnownOptions = (options: any, type: ParserRuleType) => {
    const rest = { ...(options || {}) } as Record<string, any>;
    if (type === "line_strict") delete rest.multi_line;
    if (type === "json_object" || type === "jsonl") {
      delete rest.path;
      delete rest.key;
    }
    if (type === "tagged_line") {
      delete rest.pattern;
      delete rest.sort_by_id;
      delete rest.sort_by_line_number;
    }
    if (type === "regex") {
      delete rest.pattern;
      delete rest.group;
      delete rest.flags;
      delete rest.multiline;
      delete rest.dotall;
      delete rest.ignorecase;
    }
    if (type === "python") {
      delete rest.script;
      delete rest.path;
      delete rest.function;
      delete rest.entry;
    }
    return rest;
  };

  const parseParserRule = (raw: any): ParserRuleForm => {
    const type = normalizeParserRuleType(String(raw?.type || "plain"));
    const options = raw?.options || {};
    const rule = createParserRule(type);
    const path = options?.path ?? options?.key;
    const pattern = options?.pattern;
    const scriptPath = options?.script ?? options?.path;
    const functionName = options?.function ?? options?.entry;
    const multiLine = ["join", "first", "error"].includes(
      String(options?.multi_line || "join"),
    )
      ? String(options?.multi_line || "join")
      : "join";
    const flags = extractRegexFlags(options);
    const extra = stripParserKnownOptions(options, type);
    const sortByKey = options?.sort_by_line_number
      ? "line_number"
      : options?.sort_by_id
        ? "id"
        : "";
    return {
      ...rule,
      type,
      path: path !== undefined ? String(path) : rule.path,
      pattern: pattern !== undefined ? String(pattern) : rule.pattern,
      sortById: Boolean(sortByKey),
      sortByKey,
      multiLine: multiLine as ParserRuleForm["multiLine"],
      regexGroup:
        options?.group !== undefined ? String(options?.group) : rule.regexGroup,
      regexFlags: flags,
      scriptPath:
        scriptPath !== undefined ? String(scriptPath) : rule.scriptPath,
      functionName:
        functionName !== undefined
          ? String(functionName)
          : rule.functionName,
      extraOptions: Object.keys(extra).length
        ? JSON.stringify(extra, null, 2)
        : "",
      advancedOpen: false,
    };
  };

  const buildParserOptionsFromRule = (rule: ParserRuleForm) => {
    const options: Record<string, any> = {};
    if (rule.type === "line_strict" && rule.multiLine) {
      options.multi_line = rule.multiLine;
    }
    if (rule.type === "json_object" || rule.type === "jsonl") {
      if (rule.path.trim()) options.path = rule.path.trim();
    }
    if (rule.type === "tagged_line") {
      if (rule.pattern.trim()) options.pattern = rule.pattern.trim();
      if (rule.sortById) {
        if (rule.sortByKey === "line_number") {
          options.sort_by_line_number = true;
        } else {
          options.sort_by_id = true;
        }
      }
    }
    if (rule.type === "python") {
      if (rule.scriptPath.trim()) options.script = rule.scriptPath.trim();
      if (rule.functionName.trim())
        options.function = rule.functionName.trim();
    }
    if (rule.type === "regex") {
      if (rule.pattern.trim()) options.pattern = rule.pattern.trim();
      const groupRaw = rule.regexGroup.trim();
      if (groupRaw) {
        if (/^-?\\d+$/.test(groupRaw)) {
          options.group = parseInt(groupRaw, 10);
        } else {
          options.group = groupRaw;
        }
      }
      if (rule.regexFlags.multiline) options.multiline = true;
      if (rule.regexFlags.dotall) options.dotall = true;
      if (rule.regexFlags.ignorecase) options.ignorecase = true;
    }
    const extra = parseJsonObject(rule.extraOptions);
    if (extra) {
      Object.assign(options, extra);
    }
    return Object.keys(options).length ? options : null;
  };

  const buildParserProfileFromRule = (rule: ParserRuleForm) => {
    const payload: Record<string, any> = { type: rule.type };
    const options = buildParserOptionsFromRule(rule);
    if (options) payload.options = options;
    return payload;
  };

  const applyParserRuleType = (
    rule: ParserRuleForm,
    nextType: ParserRuleType,
  ) => {
    const next = { ...rule, type: nextType };
    if ((nextType === "json_object" || nextType === "jsonl") && !next.path) {
      next.path = "translation";
    }
    if (nextType === "tagged_line" && !next.pattern) {
      next.pattern = DEFAULT_TAGGED_PATTERN;
    }
    if (nextType === "line_strict" && !next.multiLine) {
      next.multiLine = "join";
    }
    if (nextType === "regex" && !next.regexGroup) {
      next.regexGroup = "0";
    }
    if (nextType === "python" && !next.functionName) {
      next.functionName = "parse";
    }
    return next;
  };

  const inferChunkType = (ref?: string) => {
    if (!ref) return "";
    const known = chunkTypeIndex[ref];
    return known || "";
  };

  const syncFormsFromData = (targetKind: ProfileKind, data: any) => {
    if (!data || typeof data !== "object") return;
    lastProfileDataRef.current[targetKind] = data;
    if (targetKind === "api") {
      const rawParams =
        data.params && typeof data.params === "object" ? data.params : {};
      const paramValue = (key: string) =>
        rawParams && rawParams[key] !== undefined && rawParams[key] !== null
          ? String(rawParams[key])
          : "";
      const stopValue = rawParams?.stop;
      const stopText =
        stopValue === undefined
          ? ""
          : typeof stopValue === "string"
            ? stopValue
            : JSON.stringify(stopValue);
      const extractedKeys = new Set([
        "temperature",
        "top_p",
        "max_tokens",
        "presence_penalty",
        "frequency_penalty",
        "seed",
        "stop",
      ]);
      const remainingParams = Object.fromEntries(
        Object.entries(rawParams || {}).filter(
          ([key]) => !extractedKeys.has(key),
        ),
      );
      const paramsText = Object.keys(remainingParams).length
        ? JSON.stringify(remainingParams, null, 2)
        : "";
      const apiHeaders =
        data.headers && typeof data.headers === "object" && !Array.isArray(data.headers)
          ? data.headers
          : {};
      lastValidJsonRef.current.apiHeaders = apiHeaders as Record<string, any>;
      lastValidJsonRef.current.apiParams = remainingParams as Record<string, any>;
      const rawEndpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
      const normalizedEndpoints = rawEndpoints
        .filter((item: any) => item && typeof item === "object")
        .map((item: any) => ({
          baseUrl: String(item.base_url || item.baseUrl || ""),
          apiKeys: Array.isArray(item.api_key)
            ? item.api_key.join("\n")
            : String(item.api_key || ""),
          model: String(item.model || ""),
          weight:
            item.weight !== undefined && item.weight !== null
              ? String(item.weight)
              : "1",
        }))
        .filter(
          (item: PoolEndpointForm) =>
            item.baseUrl.trim() || item.apiKeys.trim(),
        );
      const poolEndpoints =
        normalizedEndpoints.length > 0
          ? normalizedEndpoints
          : [createPoolEndpoint()];
      setApiForm({
        id: data.id || "",
        name: data.name || "",
        apiType: data.type || "openai_compat",
        baseUrl: data.base_url || "",
        apiKey: Array.isArray(data.api_key)
          ? data.api_key.join("\n")
          : data.api_key || "",
        model: data.model || "",
        group: data.group || "",
        poolEndpoints,
        headers: JSON.stringify(apiHeaders, null, 2),
        params: paramsText,
        timeout:
          data.timeout !== undefined && data.timeout !== null
            ? String(data.timeout)
            : "",
        concurrency:
          data.concurrency !== undefined && data.concurrency !== null
            ? String(data.concurrency)
            : "",
        rpm:
          data.rpm !== undefined && data.rpm !== null
            ? String(data.rpm)
            : data.requests_per_minute !== undefined &&
              data.requests_per_minute !== null
              ? String(data.requests_per_minute)
              : data.rate_limit_per_minute !== undefined &&
                data.rate_limit_per_minute !== null
                ? String(data.rate_limit_per_minute)
                : "",
        temperature: paramValue("temperature"),
        topP: paramValue("top_p"),
        maxTokens: paramValue("max_tokens"),
        presencePenalty: paramValue("presence_penalty"),
        frequencyPenalty: paramValue("frequency_penalty"),
        seed: paramValue("seed"),
        stop: stopText,
      });
    }
    if (targetKind === "pipeline") {
      const chunkPolicy = String(data.chunk_policy || "");
      const chunkType = inferChunkType(chunkPolicy);
      const rawLinePolicy = String(data.line_policy || "");
      const rawApplyLinePolicy = Boolean(data.apply_line_policy);
      const linePolicy = chunkType === "line" ? rawLinePolicy : "";
      const applyLinePolicy =
        chunkType === "line" && rawApplyLinePolicy && Boolean(linePolicy);
      const translationMode = resolvePipelineTranslationMode(
        data.translation_mode || data.translationMode || data.mode,
        chunkPolicy,
        linePolicy,
        applyLinePolicy,
        applyLinePolicy ? "line" : "block",
        chunkTypeIndex,
      );
      const pipelineHeaders =
        data.settings?.headers &&
          typeof data.settings.headers === "object" &&
          !Array.isArray(data.settings.headers)
          ? data.settings.headers
          : {};
      const extraParamEntries = data.settings?.params
        ? Object.entries(data.settings.params).filter(
          ([key]) =>
            ![
              "top_p",
              "presence_penalty",
              "frequency_penalty",
              "seed",
              "stop",
            ].includes(key),
        )
        : [];
      const extraParamObject = extraParamEntries.length
        ? Object.fromEntries(extraParamEntries)
        : {};
      lastValidJsonRef.current.pipelineHeaders = pipelineHeaders as Record<string, any>;
      lastValidJsonRef.current.pipelineExtraParams =
        extraParamObject as Record<string, any>;
      setPipelineComposer({
        id: data.id || "",
        name: data.name || "",
        provider: data.provider || "",
        prompt: data.prompt || "",
        parser: data.parser || "",
        translationMode,
        applyLinePolicy,
        linePolicy,
        chunkPolicy,
        temperature:
          data.settings?.temperature !== undefined &&
            data.settings?.temperature !== null
            ? String(data.settings.temperature)
            : "",
        maxRetries:
          data.settings?.max_retries !== undefined &&
            data.settings?.max_retries !== null
            ? String(data.settings.max_retries)
            : "",
        concurrency:
          data.settings?.concurrency !== undefined &&
            data.settings?.concurrency !== null
            ? String(data.settings.concurrency)
            : "",
        maxTokens: String(data.settings?.max_tokens ?? ""),
        modelOverride: String(data.settings?.model ?? ""),
        timeout: String(data.settings?.timeout ?? ""),
        headers: JSON.stringify(pipelineHeaders, null, 2),
        topP: String(data.settings?.params?.top_p ?? ""),
        presencePenalty: String(data.settings?.params?.presence_penalty ?? ""),
        frequencyPenalty: String(
          data.settings?.params?.frequency_penalty ?? "",
        ),
        seed: String(data.settings?.params?.seed ?? ""),
        stop:
          data.settings?.params?.stop !== undefined
            ? JSON.stringify(data.settings.params.stop)
            : "",
        extraParams: extraParamEntries.length
          ? JSON.stringify(extraParamObject, null, 2)
          : "",
      });
    }
    if (targetKind === "prompt") {
      const context = data.context || {};
      const { combined, legacy } = buildPromptLegacyParts(data);
      setPromptLegacyParts(legacy);
      setPromptForm({
        id: data.id || "",
        name: data.name || "",
        systemTemplate: combined,
        userTemplate: data.user_template || "",
        beforeLines: String(context.before_lines ?? "0"),
        afterLines: String(context.after_lines ?? "0"),
        joiner: context.joiner === "\n" ? "\\n" : (context.joiner ?? "\\n"),
        sourceFormat: String(context.source_format || ""),
        sourceLines: String(
          context.source_lines !== undefined && context.source_lines !== null
            ? context.source_lines
            : "",
        ),
      });
    }
    if (targetKind === "parser") {
      if (isParserProfileBlank(data)) {
        setParserForm({
          id: data.id || "",
          name: data.name || "",
          mode: "single",
          rules: [],
        });
      } else {
        const parserType = String(data.type || "plain");
        const mode = parserType === "any" ? "cascade" : "single";
        const candidates =
          parserType === "any"
            ? data.options?.parsers || data.options?.candidates
            : [data];
        const rawRules = Array.isArray(candidates) ? candidates : [];
        const rules = (rawRules.length ? rawRules : [data]).map(parseParserRule);
        setParserForm({
          id: data.id || "",
          name: data.name || "",
          mode,
          rules: rules.length ? rules : [createParserRule("plain")],
        });
      }
    }
    if (targetKind === "policy") {
      const options = data.options || {};
      const checks = normalizeChecks(options.checks);
      const policyType: PolicyFormState["policyType"] = ["strict", "tolerant"].includes(String(data.type)) ? (String(data.type) as PolicyFormState["policyType"]) : "strict";
      const onMismatch = ["retry", "error", "pad", "truncate", "align"].includes(
        String(options.on_mismatch),
      )
        ? String(options.on_mismatch)
        : "retry";
      setPolicyForm({
        id: data.id || "",
        name: data.name || "",
        policyType,
        onMismatch: onMismatch as PolicyFormState["onMismatch"],
        trim: options.trim !== undefined ? Boolean(options.trim) : true,
        emptyLine: Boolean(checks.empty_line),
        similarity: Boolean(checks.similarity),
        kanaTrace: Boolean(checks.kana_trace),
        similarityThreshold: String(
          options.similarity_threshold ?? options.similarity ?? "0.8",
        ),
        sourceLang: normalizeSourceLang(String(options.source_lang || "")),
      });
    }
    if (targetKind === "chunk") {
      const options = data.options || {};
      setChunkForm({
        id: data.id || "",
        name: data.name || "",
        targetChars: String(options.target_chars ?? "1000"),
        maxChars: String(options.max_chars ?? "2000"),
        enableBalance:
          options.enable_balance !== undefined
            ? Boolean(options.enable_balance)
            : true,
        balanceThreshold: String(options.balance_threshold ?? "0.6"),
        balanceCount: String(options.balance_count ?? "3"),
      });
    }
  };

  const syncFormsFromYaml = (
    yamlSource: string,
    targetKind: ProfileKind = kind,
  ) => {
    try {
      const data = safeLoadYaml(yamlSource) as any;
      if (!data || typeof data !== "object") return;
      lastProfileDataRef.current[targetKind] = data;
      syncFormsFromData(targetKind, data);
    } catch { }
  };

  const localizeTemplateName = (templateYaml: string, displayName?: string) => {
    if (!displayName) return templateYaml;
    const safeName = `"${displayName.replace(/\"/g, '\\"')}"`;
    if (/^\s*name:/m.test(templateYaml)) {
      return templateYaml.replace(/^\s*name:.*$/m, `name: ${safeName}`);
    }
    if (/^\s*id:/m.test(templateYaml)) {
      return templateYaml.replace(
        /^\s*id:.*$/m,
        (line) => `${line}\nname: ${safeName}`,
      );
    }
    return `name: ${safeName}\n${templateYaml}`;
  };

  const extractTemplateScalar = (templateYaml: string, key: string) => {
    const match = templateYaml.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
    if (!match) return "";
    const raw = match[1].trim();
    return raw.replace(/^['"]|['"]$/g, "");
  };

  const ensureUniqueTemplateId = (
    templateYaml: string,
    targetKind: ProfileKind,
  ) => {
    const rawId = extractTemplateScalar(templateYaml, "id");
    const rawName = extractTemplateScalar(templateYaml, "name");
    const baseId = rawId
      ? rawId
      : slugifyProfileId(rawName) || `${targetKind}_profile`;
    const nextId = createUniqueProfileId(baseId, getExistingIds(targetKind));
    if (/^\s*id:/m.test(templateYaml)) {
      return templateYaml.replace(/^\s*id:.*$/m, `id: ${nextId}`);
    }
    return `id: ${nextId}\n${templateYaml}`;
  };

  const handleApplyTemplate = (
    templateYaml: string,
    templateId?: string,
  ) => {
    guardUnsaved(() => {
      setSelectedId(null);
      const displayName = templateId
        ? getTemplateMeta(templateId)?.title
        : undefined;
      const localizedYaml = localizeTemplateName(templateYaml, displayName);
      const nextYaml = ensureUniqueTemplateId(localizedYaml, kind);
      commitYamlText(nextYaml);
      setBaselineYaml("");
      syncFormsFromYaml(nextYaml);
    });
  };

  const runParserPreview = () => {
    if (kind !== "parser") return;
    if (!parserSample.trim()) {
      setParserPreview({
        text: "",
        lines: [],
        error: texts.parserPreviewEmpty,
      });
      return;
    }
    if (!parsedResult.data) {
      setParserPreview({
        text: "",
        lines: [],
        error: texts.parserPreviewInvalidProfile,
      });
      return;
    }
    try {
      const parseWithProfile = (
        profile: any,
        rawInput: string,
      ): ParserPreviewResult => {
        const parserType = String(profile?.type || "plain");
        const options = profile?.options || {};
        const cleanedInput = stripThinkTags(rawInput);

        if (parserType === "any") {
          const candidates = options.parsers || options.candidates;
          if (!Array.isArray(candidates) || candidates.length === 0) {
            throw new Error("missing_any_parsers");
          }
          let lastError: any = null;
          for (const candidate of candidates) {
            if (!candidate || typeof candidate !== "object") {
              lastError = new Error("invalid_parser_entry");
              continue;
            }
            try {
              return parseWithProfile(candidate, cleanedInput);
            } catch (err: any) {
              lastError = err;
            }
          }
          throw lastError || new Error("all_parsers_failed");
        }

        if (parserType === "plain") {
          const cleaned = cleanedInput.replace(/\n+$/, "");
          return { text: cleaned, lines: splitLinesKeepEmpty(cleaned) };
        }

        if (parserType === "line_strict") {
          const multiLine = String(options.multi_line || "join");
          const lines = splitLinesKeepEmpty(cleanedInput.replace(/\n+$/, ""));
          if (lines.length <= 1) {
            return { text: lines[0] || "", lines: lines.length ? lines : [""] };
          }
          if (multiLine === "first") {
            return { text: lines[0], lines: [lines[0]] };
          }
          if (multiLine === "error") {
            throw new Error("multiple_lines_detected");
          }
          const joined =
            multiLine === "join"
              ? lines.filter((item) => item.trim()).join(" ")
              : lines.join("\n");
          return { text: joined, lines: [joined] };
        }

        if (parserType === "json_array") {
          const data = parseJsonPreviewValue(cleanedInput);
          if (!Array.isArray(data)) throw new Error("json_array_expected");
          const lines = data.map((item) => String(item));
          return { text: lines.join("\n"), lines };
        }

        if (parserType === "json_object") {
          const data = parseJsonPreviewValue(cleanedInput);
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("json_object_expected");
          }
          const path = options.path || options.key;
          if (!path) throw new Error("missing_path");
          const value = getByPath(data, String(path));
          const cleaned = String(value).replace(/\n+$/, "");
          return { text: cleaned, lines: splitLinesKeepEmpty(cleaned) };
        }

        if (parserType === "jsonl") {
          const path = options.path || options.key;
          const lines = parseJsonlPreviewLines(
            cleanedInput,
            path ? String(path) : undefined,
          );
          return { text: lines.join("\n"), lines };
        }

        if (parserType === "tagged_line") {
          const lines = parseTaggedLinePreviewLines(cleanedInput, {
            pattern: options.pattern || "^@@(?P<id>\\d+)@@(?P<text>.*)$",
            sortById: Boolean(options.sort_by_id),
            sortByLineNumber: Boolean(options.sort_by_line_number),
            flags: options.flags,
            multiline: options.multiline,
            dotall: options.dotall,
            ignorecase: options.ignorecase,
          });
          return { text: lines.join("\n"), lines };
        }

        if (parserType === "regex") {
          const pattern = String(options.pattern || "").trim();
          if (!pattern) throw new Error("missing_pattern");
          const regex = parseWithRegexFlags(pattern, options);
          const match = regex.exec(cleanedInput);
          if (!match) throw new Error("pattern_not_matched");
          const group = options.group ?? 0;
          const extracted =
            typeof group === "number"
              ? match[group]
              : match.groups
                ? match.groups[group]
                : "";
          const cleaned = String(extracted || "").replace(/\n+$/, "");
          return { text: cleaned, lines: splitLinesKeepEmpty(cleaned) };
        }

        throw new Error("unsupported_parser");
      };

      const profile = parsedResult.data as any;
      const result = parseWithProfile(profile, parserSample);
      setParserPreview(result);
    } catch (error: any) {
      setParserPreview({
        text: "",
        lines: [],
        error: texts.parserPreviewParseError.replace(
          "{error}",
          String(error?.message || error),
        ),
      });
    }
  };

  const updateYamlFromApiForm = (newForm: ApiFormState) => {
    setApiForm(newForm);
    // Build YAML
    try {
      const payload: any = {
        id: newForm.id,
        name: newForm.name,
        type: newForm.apiType,
      };
      if (newForm.group) payload.group = newForm.group;
      if (newForm.apiType === "openai_compat") {
        payload.base_url = newForm.baseUrl;
        payload.model = newForm.model;
        const apiKeys = newForm.apiKey
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
        if (apiKeys.length === 1) payload.api_key = apiKeys[0];
        if (apiKeys.length > 1) payload.api_key = apiKeys;
      } else if (newForm.apiType === "pool") {
        const endpoints = (newForm.poolEndpoints || [])
          .map((item) => {
            const baseUrl = item.baseUrl.trim();
            if (!baseUrl) return null;
            const keys = item.apiKeys
              .split(/\r?\n/)
              .map((key) => key.trim())
              .filter(Boolean);
            const weightValue = Number.parseFloat(item.weight);
            const payloadItem: Record<string, any> = {
              base_url: baseUrl,
            };
            if (keys.length === 1) payloadItem.api_key = keys[0];
            if (keys.length > 1) payloadItem.api_key = keys;
            if (item.model && item.model.trim()) {
              payloadItem.model = item.model.trim();
            }
            if (Number.isFinite(weightValue) && weightValue > 0) {
              payloadItem.weight = weightValue;
            }
            return payloadItem;
          })
          .filter(Boolean);
        if (endpoints.length) payload.endpoints = endpoints;
      }

      const headers = resolveCachedJsonField(
        newForm.headers,
        apiForm.headers,
        "apiHeaders",
        texts.formFields.headersLabel,
      );
      if (Object.keys(headers).length) payload.headers = headers;
      const params: Record<string, any> = {};
      const parsedParams = resolveCachedJsonField(
        newForm.params,
        apiForm.params,
        "apiParams",
        texts.formFields.paramsLabel,
      );
      if (Object.keys(parsedParams).length) Object.assign(params, parsedParams);
      const extractedKeys = new Set([
        "temperature",
        "top_p",
        "max_tokens",
        "presence_penalty",
        "frequency_penalty",
        "seed",
        "stop",
      ]);
      for (const key of extractedKeys) {
        if (key in params) delete params[key];
      }
      const applyFloat = (value: string, key: string) => {
        if (value === "") return;
        const num = Number(value);
        if (Number.isFinite(num)) params[key] = num;
      };
      const applyInt = (value: string, key: string) => {
        if (value === "") return;
        const num = Number.parseInt(value, 10);
        if (Number.isFinite(num)) params[key] = num;
      };
      applyFloat(newForm.temperature, "temperature");
      applyFloat(newForm.topP, "top_p");
      applyInt(newForm.maxTokens, "max_tokens");
      applyFloat(newForm.presencePenalty, "presence_penalty");
      applyFloat(newForm.frequencyPenalty, "frequency_penalty");
      applyInt(newForm.seed, "seed");
      if (newForm.stop.trim()) {
        let stopValue: any = newForm.stop.trim();
        try {
          stopValue = JSON.parse(newForm.stop);
        } catch { }
        params.stop = stopValue;
      }
      if (Object.keys(params).length) {
        payload.params = params;
      }

      if (newForm.timeout !== "") payload.timeout = parseInt(newForm.timeout, 10);
      if (newForm.concurrency !== "") {
        const rawConcurrency = Number.parseInt(newForm.concurrency, 10);
        if (Number.isFinite(rawConcurrency)) {
          payload.concurrency = rawConcurrency;
        } else {
          payload.concurrency = newForm.concurrency;
        }
      }
      if (newForm.rpm !== "") {
        const rawRpm = Number.parseInt(newForm.rpm, 10);
        if (Number.isFinite(rawRpm)) {
          payload.rpm = rawRpm;
        } else {
          payload.rpm = newForm.rpm;
        }
      }

      if (kind === "api") {
        const reservedKeys = new Set([
          "id",
          "name",
          "type",
          "provider",
          "group",
          "base_url",
          "model",
          "api_key",
          "endpoints",
          "headers",
          "params",
          "timeout",
          "concurrency",
          "rpm",
          "requests_per_minute",
          "rate_limit_per_minute",
        ]);
        const lastData = lastProfileDataRef.current.api;
        if (lastData && typeof lastData === "object") {
          Object.entries(lastData).forEach(([key, value]) => {
            if (reservedKeys.has(key) || key in payload) return;
            payload[key] = value;
          });
        }
      }

      queueYamlDump(payload);
    } catch { }
  };

  const fillPipelineRefs = (composer: PipelineComposerState) => ({
    ...composer,
  });

  const updateYamlFromPipelineComposer = (
    newComposer: PipelineComposerState,
    options?: { markDirty?: boolean },
  ) => {
    const resolvedComposer = fillPipelineRefs(newComposer);
    setPipelineComposer(resolvedComposer);
    const chunkType = inferChunkType(resolvedComposer.chunkPolicy);
    const isLineChunk = chunkType === "line";
    const applyLinePolicy =
      isLineChunk && resolvedComposer.applyLinePolicy && Boolean(resolvedComposer.linePolicy);
    const payload: any = {
      id: resolvedComposer.id,
      name: resolvedComposer.name,
      provider: resolvedComposer.provider,
      prompt: resolvedComposer.prompt,
      parser: resolvedComposer.parser,
      translation_mode: resolvedComposer.translationMode,
      chunk_policy: resolvedComposer.chunkPolicy,
    };
    if (kind === "pipeline") {
      const reservedKeys = new Set([
        "id",
        "name",
        "provider",
        "prompt",
        "parser",
        "translation_mode",
        "chunk_policy",
        "apply_line_policy",
        "line_policy",
        "settings",
      ]);
      const lastData = lastProfileDataRef.current.pipeline;
      if (lastData && typeof lastData === "object") {
        Object.entries(lastData).forEach(([key, value]) => {
          if (reservedKeys.has(key) || key in payload) return;
          payload[key] = value;
        });
      }
    }
    if (isLineChunk) {
      payload.apply_line_policy = applyLinePolicy;
      if (resolvedComposer.linePolicy) {
        payload.line_policy = resolvedComposer.linePolicy;
      }
    }

    const settings: any = {};
    const applySettingFloat = (value: string, key: string) => {
      if (value === "") return;
      const num = Number(value);
      if (Number.isFinite(num)) settings[key] = num;
    };
    const applySettingInt = (value: string, key: string) => {
      if (value === "") return;
      const num = Number.parseInt(value, 10);
      if (Number.isFinite(num)) settings[key] = num;
    };
    applySettingFloat(resolvedComposer.temperature, "temperature");
    applySettingInt(resolvedComposer.maxTokens, "max_tokens");
    applySettingInt(resolvedComposer.maxRetries, "max_retries");
    if (resolvedComposer.concurrency !== "") {
      const rawConcurrency = Number.parseInt(resolvedComposer.concurrency, 10);
      if (Number.isFinite(rawConcurrency)) {
        settings.concurrency = rawConcurrency;
      } else {
        settings.concurrency = resolvedComposer.concurrency;
      }
    }
    if (resolvedComposer.modelOverride.trim())
      settings.model = resolvedComposer.modelOverride.trim();
    if (resolvedComposer.timeout !== "") {
      const timeoutValue = Number.parseInt(resolvedComposer.timeout, 10);
      if (Number.isFinite(timeoutValue)) {
        settings.timeout = timeoutValue;
      }
    }
    const headers = resolveCachedJsonField(
      resolvedComposer.headers,
      pipelineComposer.headers,
      "pipelineHeaders",
      texts.composer.fields.headersLabel,
    );
    if (Object.keys(headers).length) settings.headers = headers;
    const params: Record<string, any> = {};
    const applyParamFloat = (value: string, key: string) => {
      if (value === "") return;
      const num = Number(value);
      if (Number.isFinite(num)) params[key] = num;
    };
    const applyParamInt = (value: string, key: string) => {
      if (value === "") return;
      const num = Number.parseInt(value, 10);
      if (Number.isFinite(num)) params[key] = num;
    };
    applyParamFloat(resolvedComposer.topP, "top_p");
    applyParamFloat(resolvedComposer.presencePenalty, "presence_penalty");
    applyParamFloat(resolvedComposer.frequencyPenalty, "frequency_penalty");
    applyParamInt(resolvedComposer.seed, "seed");
    if (resolvedComposer.stop) {
      const rawStop = resolvedComposer.stop.trim();
      if (rawStop) {
        try {
          params.stop = JSON.parse(rawStop);
        } catch {
          params.stop = rawStop;
        }
      }
    }
    const extra = resolveCachedJsonField(
      resolvedComposer.extraParams,
      pipelineComposer.extraParams,
      "pipelineExtraParams",
      texts.composer.fields.extraParamsLabel,
    );
    if (Object.keys(extra).length) Object.assign(params, extra);
    if (Object.keys(params).length) settings.params = params;
    payload.settings = settings;
    if (kind === "pipeline") {
      const reservedSettingKeys = new Set([
        "temperature",
        "max_tokens",
        "max_retries",
        "concurrency",
        "model",
        "timeout",
        "headers",
        "params",
      ]);
      const lastSettings = lastProfileDataRef.current.pipeline?.settings;
      if (lastSettings && typeof lastSettings === "object") {
        Object.entries(lastSettings).forEach(([key, value]) => {
          if (reservedSettingKeys.has(key) || key in settings) return;
          settings[key] = value;
        });
      }
    }

    queueYamlDump(payload, { markDirty: options?.markDirty });
  };

  useEffect(() => {
    if (kind !== "pipeline") return;
    const nextMode = resolvePipelineTranslationMode(
      pipelineComposer.translationMode,
      pipelineComposer.chunkPolicy,
      pipelineComposer.linePolicy,
      pipelineComposer.applyLinePolicy,
      pipelineComposer.applyLinePolicy ? "line" : "block",
      chunkTypeIndex,
    );
    if (nextMode === pipelineComposer.translationMode) return;
    updateYamlFromPipelineComposer(
      {
        ...pipelineComposer,
        translationMode: nextMode,
      },
      { markDirty: false },
    );
  }, [
    kind,
    pipelineComposer.chunkPolicy,
    pipelineComposer.linePolicy,
    pipelineComposer.applyLinePolicy,
    pipelineComposer.translationMode,
    chunkTypeIndex,
  ]);

  const updateYamlFromPromptForm = (newForm: PromptFormState) => {
    setPromptForm(newForm);
    const toNumber = (value: string, fallback = 0) => {
      const parsed = parseInt(String(value), 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const resolvedJoiner = newForm.joiner === "\\n" ? "\n" : newForm.joiner;
    const resolvedSourceFormat = String(newForm.sourceFormat || "").trim();
    const resolvedSourceLinesRaw = String(newForm.sourceLines || "").trim();
    const resolvedSourceLines = Number.parseInt(resolvedSourceLinesRaw, 10);
    const payload: any = {
      id: newForm.id,
      name: newForm.name,
      user_template: newForm.userTemplate,
      context: {
        before_lines: toNumber(newForm.beforeLines, 0),
        after_lines: toNumber(newForm.afterLines, 0),
        joiner: resolvedJoiner || "\n",
      },
    };
    const preserveLegacy = shouldPreserveLegacyPromptParts(
      promptLegacyParts,
      newForm.systemTemplate,
    );
    if (preserveLegacy && promptLegacyParts) {
      if (promptLegacyParts.persona) payload.persona = promptLegacyParts.persona;
      if (promptLegacyParts.styleRules)
        payload.style_rules = promptLegacyParts.styleRules;
      if (promptLegacyParts.outputRules)
        payload.output_rules = promptLegacyParts.outputRules;
      payload.system_template = promptLegacyParts.systemTemplate;
    } else {
      payload.system_template = newForm.systemTemplate;
    }
    if (resolvedSourceFormat) {
      payload.context.source_format = resolvedSourceFormat;
    }
    if (
      resolvedSourceLinesRaw !== "" &&
      Number.isFinite(resolvedSourceLines) &&
      resolvedSourceLines >= 0
    ) {
      payload.context.source_lines = resolvedSourceLines;
    }

    queueYamlDump(payload);
  };

  const updateYamlFromPolicyForm = (newForm: PolicyFormState) => {
    const normalizedSourceLang = normalizeSourceLang(newForm.sourceLang);
    const nextForm = { ...newForm, sourceLang: normalizedSourceLang };
    setPolicyForm(nextForm);
    try {
      const payload: any = {
        id: nextForm.id,
        name: nextForm.name,
        type: nextForm.policyType,
      };
      const options: any = {};
      options.on_mismatch = nextForm.onMismatch;
      const checks: string[] = [];
      if (nextForm.emptyLine) checks.push("empty_line");
      if (nextForm.similarity) checks.push("similarity");
      if (nextForm.kanaTrace) checks.push("kana_trace");
      options.trim = nextForm.trim;
      if (checks.length) {
        options.checks = checks;
      }
      if (nextForm.similarity) {
        const threshold = Number(nextForm.similarityThreshold);
        if (Number.isFinite(threshold))
          options.similarity_threshold = threshold;
      }
      if (nextForm.kanaTrace && nextForm.sourceLang.trim()) {
        options.source_lang = nextForm.sourceLang.trim();
      }
      if (Object.keys(options).length) payload.options = options;
      queueYamlDump(payload);
    } catch { }
  };

  const updateYamlFromChunkForm = (newForm: ChunkFormState) => {
    setChunkForm(newForm);
    try {
      const previousChunkTypeRaw =
        lastProfileDataRef.current.chunk?.chunk_type ??
        lastProfileDataRef.current.chunk?.type;
      const resolvedChunkType = normalizeChunkType(previousChunkTypeRaw) || "block";
      const payload: any = {
        id: newForm.id,
        name: newForm.name,
        chunk_type: resolvedChunkType,
      };
      const options: any = {};
      const target = parseInt(newForm.targetChars, 10);
      if (Number.isFinite(target)) options.target_chars = target;
      const maxChars = parseInt(newForm.maxChars, 10);
      if (Number.isFinite(maxChars)) options.max_chars = maxChars;
      options.enable_balance = newForm.enableBalance;
      const balanceThreshold = Number(newForm.balanceThreshold);
      if (Number.isFinite(balanceThreshold))
        options.balance_threshold = balanceThreshold;
      const balanceCount = parseInt(newForm.balanceCount, 10);
      if (Number.isFinite(balanceCount)) options.balance_count = balanceCount;
      if (Object.keys(options).length) payload.options = options;
      queueYamlDump(payload);
    } catch { }
  };

  const updateYamlFromParserForm = (newForm: ParserFormState) => {
    if (!newForm.rules.length) {
      const payload: any = {
        id: newForm.id,
        name: newForm.name,
      };
      setParserForm({ ...newForm, rules: [] });
      queueYamlDump(payload);
      return;
    }
    const baseRules = newForm.rules.length
      ? newForm.rules
      : [createParserRule("plain")];
    const normalizedRules =
      newForm.mode === "single" ? [baseRules[0]] : baseRules;
    const activeRule = normalizedRules[0] || createParserRule("plain");
    const payload: any = {
      id: newForm.id,
      name: newForm.name,
    };
    if (newForm.mode === "cascade") {
      payload.type = "any";
      payload.options = {
        parsers: normalizedRules.map(buildParserProfileFromRule),
      };
    } else {
      payload.type = activeRule.type;
      const options = buildParserOptionsFromRule(activeRule);
      if (options) payload.options = options;
    }
    setParserForm({ ...newForm, rules: normalizedRules });
    queueYamlDump(payload);
  };



  const renderNavigationRail = () => (
    <div className="w-16 shrink-0 flex flex-col items-center py-4 bg-muted/10 border-r border-border/60 z-20 gap-4">
      <div className="flex-1 w-full px-2 space-y-2 flex flex-col items-center">
        {[
          { kind: "pipeline" as const, icon: Workflow, label: texts.kinds.pipeline },
          { kind: "api" as const, icon: Server, label: texts.kinds.api },
          { kind: "prompt" as const, icon: MessageSquare, label: texts.kinds.prompt },
        ].map(({ kind: targetKind, icon: Icon, label }) => (
          <Tooltip key={targetKind} content={label}>
            <button
              onClick={() => {
                if (kind !== targetKind) {
                  guardUnsaved(() => {
                    setSelectedId(null);
                    commitYamlText("", { baseline: true });
                    setKind(targetKind);
                    setSearchTerm("");
                  });
                }
              }}
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-200",
                kind === targetKind
                  ? "bg-muted/60 text-foreground shadow-sm scale-105 dark:bg-primary/30 dark:text-primary-foreground dark:shadow-md"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:scale-105 dark:hover:text-primary"
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          </Tooltip>
        ))}

        <Tooltip content={texts.strategyKindTitle}>
          <button
            onClick={() => {
              if (kind !== "policy" && kind !== "chunk") {
                guardUnsaved(() => {
                  setSelectedId(null);
                  commitYamlText("", { baseline: true });
                  setKind(strategyKind);
                  setSearchTerm("");
                });
              }
            }}
            className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-200",
              kind === "policy" || kind === "chunk"
                ? "bg-muted/60 text-foreground shadow-sm scale-105 dark:bg-primary/30 dark:text-primary-foreground dark:shadow-md"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:scale-105 dark:hover:text-primary",
            )}
          >
            <Scissors className="h-5 w-5" />
          </button>
        </Tooltip>

        <Tooltip content={texts.kinds.parser}>
          <button
            onClick={() => {
              if (kind !== "parser") {
                guardUnsaved(() => {
                  setSelectedId(null);
                  commitYamlText("", { baseline: true });
                  setKind("parser");
                  setSearchTerm("");
                });
              }
            }}
            className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-200",
              kind === "parser"
                ? "bg-muted/60 text-foreground shadow-sm scale-105 dark:bg-primary/30 dark:text-primary-foreground dark:shadow-md"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:scale-105 dark:hover:text-primary",
            )}
          >
            <FileJson className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      <div className="mt-auto space-y-3 flex flex-col items-center pb-2">
        <Tooltip content={texts.openProfilesDir}>
          <button
            className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            onClick={handleOpenProfilesDir}
          >
            <FolderOpen className="h-5 w-5" />
          </button>
        </Tooltip>
        <Tooltip content={texts.refresh}>
          <button
            className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            onClick={() => loadProfiles()}
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );

  const renderSidePanel = () => (
    <aside className="w-72 shrink-0 bg-background/50 border-r border-border/60 flex flex-col h-full min-h-0 backdrop-blur-xl">
      <div className="p-4 pt-6 border-b border-border/40">
        <h2 className="text-xl font-bold tracking-tight mb-1">{getKindLabel(kind)}</h2>
        {isStrategyKind(kind) && (
          <div className="mt-3 flex items-center gap-2">
            {(["policy", "chunk"] as const).map((targetKind) => (
              <button
                key={targetKind}
                type="button"
                onClick={() => {
                  if (kind === targetKind) return;
                  guardUnsaved(() => {
                    setSelectedId(null);
                    commitYamlText("", { baseline: true });
                    setSearchTerm("");
                    setKind(targetKind);
                  });
                }}
                className={cn(
                  "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === targetKind
                    ? "border-border/70 bg-muted/40 text-foreground dark:bg-primary/20 dark:text-primary-foreground dark:border-primary/30"
                    : "border-border/60 bg-background/60 text-muted-foreground hover:border-border dark:hover:text-primary",
                )}
              >
                {texts.kinds[targetKind]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="relative group">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-foreground dark:group-focus-within:text-primary transition-colors" />
          <Input
            placeholder={texts.searchPlaceholder}
            className="pl-9 h-9 bg-muted/40 border-transparent focus:bg-background focus:border-input transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1 scroller-hide">
        {isProfilesLoading || profilesLoadedKind !== kind ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {filteredProfiles.map((p) => {
              const isSelected = selectedId === p.id && kind === p.kind;
              return (
                <button
                  key={`${p.kind}_${p.id}`}
                  onClick={() => handleSelectProfile(p.id, p.kind)}
                  className={cn(
                    "w-full text-left px-4 py-4 rounded-2xl text-sm transition-all flex items-center gap-3 group border border-border/40 bg-background/70",
                    "shadow-[0_1px_0_0_rgba(0,0,0,0.02)] hover:shadow-sm hover:bg-muted/30 hover:border-border/70",
                    isSelected
                      ? "bg-muted/40 text-foreground border-border/70 shadow-sm ring-1 ring-border/40 dark:bg-primary/15 dark:text-primary-foreground dark:border-primary/40 dark:ring-primary/30"
                      : "text-foreground",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-medium truncate transition-colors", isSelected ? "text-foreground dark:text-primary-foreground" : "text-foreground")}>
                      {resolveProfileName(p.id, p.name)}
                    </div>
                    <div
                      className={cn(
                        "text-[10px] text-muted-foreground truncate font-mono mt-0.5 h-4",
                        HIDE_ALL_PROFILE_IDS || HIDE_PROFILE_ID_DISPLAY.has(p.id)
                          ? "opacity-0"
                          : "opacity-70",
                      )}
                    >
                      {p.id}
                    </div>
                  </div>
                  {isSelected && <ChevronRight className="h-4 w-4 opacity-50 text-muted-foreground dark:text-primary animate-in slide-in-from-left-1 duration-200" />}
                </button>
              );
            })}

            {filteredProfiles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2 opacity-60">
                <Search className="h-8 w-8 opacity-20" />
                <p className="text-sm">{texts.listEmpty}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="p-4 border-t border-border/40 bg-background/30 backdrop-blur-md">
        <Button
          className="w-full shadow-sm hover:shadow-md transition-all active:scale-95"
          onClick={handleCreate}
          variant="outline"
        >
          <Plus className="mr-2 h-4 w-4" /> {texts.newProfile}
        </Button>
      </div>
    </aside>
  );

  const renderVisualEditorResult = () => {
    // Only show if selected and we have visual editors for this kind
    if (kind === "api") return renderApiForm();
    if (kind === "pipeline") return renderPipelineForm();
    if (kind === "prompt") return renderPromptForm();
    if (kind === "parser") return renderParserForm();
    if (kind === "policy") return renderPolicyForm();
    if (kind === "chunk") return renderChunkForm();

    // For others, we assume they are simpler -> just YAML or maybe minimal forms later
    // but for now, we just stick to YAML for advanced stuff.
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center h-40 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
          <span className="flex items-center gap-2">
            <Code2 className="h-4 w-4" />
            {texts.editorYamlHint}
          </span>
        </div>
      </div>
    );
  };

  const renderIdToggle = (targetKind: ProfileKind) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs gap-1"
      onClick={() => toggleIdField(targetKind)}
    >
      <Hash className="h-3.5 w-3.5" />
      {showIdField[targetKind] ? texts.idToggleHide : texts.idToggleShow}
    </Button>
  );

  const renderApiForm = () => {
    const endpointCount = apiForm.poolEndpoints.filter((item) =>
      item.baseUrl.trim(),
    ).length;
    const endpointReadyCount = apiForm.poolEndpoints.filter(
      (item) => item.baseUrl.trim() && item.model.trim(),
    ).length;
    const poolReady =
      endpointCount > 0 && endpointReadyCount === endpointCount;
    const requiredItems =
      apiForm.apiType === "openai_compat"
        ? [
          {
            key: "id",
            label: texts.apiSetupItems.id,
            ok: Boolean(apiForm.id.trim()),
          },
          {
            key: "baseUrl",
            label: texts.apiSetupItems.baseUrl,
            ok: Boolean(apiForm.baseUrl.trim()),
          },
          {
            key: "model",
            label: texts.apiSetupItems.model,
            ok: Boolean(apiForm.model.trim()),
          },
        ]
        : [
          {
            key: "id",
            label: texts.apiSetupItems.id,
            ok: Boolean(apiForm.id.trim()),
          },
          {
            key: "endpoints",
            label: texts.apiSetupItems.endpoints,
            ok: poolReady,
          },
        ];
    const requiredDone = requiredItems.filter((item) => item.ok).length;
    const requiredTotal = requiredItems.length;
    const progressText = texts.apiSetupProgress
      .replace("{done}", String(requiredDone))
      .replace("{total}", String(requiredTotal));
    const progressValue =
      requiredTotal > 0
        ? Math.round((requiredDone / requiredTotal) * 100)
        : 0;
    const setupHint =
      apiForm.apiType === "openai_compat"
        ? texts.apiSetupHintOpenAI
        : texts.apiSetupHintPool;

    const applyHeaderPairs = (nextPairs: KeyValuePair[]) => {
      setHeaderPairs(nextPairs);
      updateYamlFromApiForm({
        ...apiForm,
        headers: pairsToJson(nextPairs),
      });
    };

    const applyParamPairs = (nextPairs: KeyValuePair[]) => {
      setParamPairs(nextPairs);
      updateYamlFromApiForm({
        ...apiForm,
        params: pairsToJsonWithTypes(nextPairs),
      });
    };

    const kvStrings = {
      keyLabel: texts.kvEditor.keyLabel,
      valueLabel: texts.kvEditor.valueLabel,
      keyPlaceholder: texts.kvEditor.keyPlaceholder,
      valuePlaceholder: texts.kvEditor.valuePlaceholder,
      add: texts.kvEditor.add,
      remove: texts.kvEditor.remove,
      hint: texts.kvEditor.hint,
      smartPaste: texts.kvEditor.smartPaste,
      smartPasteEmpty: texts.kvEditor.smartPasteEmpty,
      smartPasteJson: texts.kvEditor.smartPasteJson,
      smartPasteLines: texts.kvEditor.smartPasteLines,
      smartPasteFail: texts.kvEditor.smartPasteFail,
    };

    const activeChannels = activePreset ? getPresetChannels(activePreset) : [];
    const showPresetChannels = activePreset ? activeChannels.length > 1 : false;
    const showApiId = showIdField.api;
    const canFetchModelList = supportsModelList;

    return (
      <div className="space-y-5">
        {showApiSetup && (
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">{texts.apiSetupTitle}</span>
              <span
                className={cn(
                  "font-semibold",
                  requiredDone === requiredTotal
                    ? "text-emerald-600"
                    : "text-amber-600",
                )}
              >
                {progressText}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
              {requiredItems.map((item) => (
                <div
                  key={item.key}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1",
                    item.ok
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                      : "border-border/60 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      item.ok ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  requiredDone === requiredTotal
                    ? "bg-emerald-500"
                    : "bg-amber-500",
                )}
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground">{setupHint}</div>
          </div>
        )}

        <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{texts.formTitle}</div>
              <div className="text-xs text-muted-foreground">
                {texts.formDesc}
              </div>
            </div>
            {renderIdToggle("api")}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {showApiId && (
              <div className="space-y-2">
                <Label>{texts.formFields.idLabel}</Label>
                <Input
                  value={apiForm.id}
                  onChange={(e) => {
                    markIdAsCustom("api");
                    updateYamlFromApiForm({ ...apiForm, id: e.target.value });
                  }}
                />
              </div>
            )}
            <div className={cn("space-y-2", showApiId ? "" : "col-span-2")}>
              <Label>{texts.formFields.nameLabel}</Label>
              <Input
                value={apiForm.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const nextId = shouldAutoUpdateId("api", nextName)
                    ? buildAutoProfileId("api", nextName, apiForm.id)
                    : apiForm.id;
                  updateYamlFromApiForm({
                    ...apiForm,
                    name: nextName,
                    id: nextId,
                  });
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{texts.formFields.apiTypeLabel}</Label>
            <div className="flex overflow-hidden rounded-lg border border-border/60 bg-background/60 divide-x divide-border/60">
              {(
                [
                  {
                    key: "openai_compat",
                    label: texts.apiTypeOptions.openai,
                    desc: texts.apiTypeHints.openai,
                  },
                  {
                    key: "pool",
                    label: texts.apiTypeOptions.pool,
                    desc: texts.apiTypeHints.pool,
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={cn(
                    "flex-1 px-4 py-3 text-left transition-all",
                    apiForm.apiType === option.key
                      ? "bg-muted/40 text-foreground dark:bg-primary/20 dark:text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground dark:hover:text-primary",
                  )}
                  onClick={() =>
                    updateYamlFromApiForm({
                      ...apiForm,
                      apiType: option.key,
                      poolEndpoints:
                        option.key === "pool"
                          ? seedPoolEndpointsFromForm(apiForm)
                          : apiForm.poolEndpoints,
                    })
                  }
                >
                  <div className="text-sm font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{texts.formFields.concurrencyLabel}</Label>
            <InputAffix
              type="number"
              value={apiForm.concurrency}
              onChange={(e) =>
                updateYamlFromApiForm({
                  ...apiForm,
                  concurrency: e.target.value,
                })
              }
              placeholder={texts.formPlaceholders.concurrency}
              prefix={<Cpu className="h-3.5 w-3.5" />}
              suffix="x"
            />
            <p className="text-xs text-muted-foreground">
              {texts.formHints.concurrency}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{texts.formFields.rpmLabel}</Label>
            <InputAffix
              type="number"
              value={apiForm.rpm}
              onChange={(e) =>
                updateYamlFromApiForm({
                  ...apiForm,
                  rpm: e.target.value,
                })
              }
              placeholder={texts.formPlaceholders.rpm}
              prefix={<Gauge className="h-3.5 w-3.5" />}
              suffix="rpm"
            />
            <p className="text-xs text-muted-foreground">
              {texts.formHints.rpm}
            </p>
          </div>

        </div>

        {apiForm.apiType === "openai_compat" ? (
          <div className="rounded-xl border bg-muted/20 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            {showPresetChannels && activePreset && (
              <div className="space-y-3 border-b border-border/60 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">
                      {texts.presetMenuTitle.replace(
                        "{name}",
                        getPresetLabel(activePreset),
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {texts.presetMenuDesc}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border/60 bg-muted/30 p-1">
                    {activeChannels.map((channel) => {
                      const channelText = getPresetChannelText(
                        activePreset,
                        channel.id,
                      );
                      const isActive = activePresetChannel
                        ? activePresetChannel === channel.id
                        : activePreset.defaultChannel === channel.id;
                      return (
                        <button
                          key={`${activePreset.id}_${channel.id}`}
                          type="button"
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                            isActive
                              ? "bg-background text-foreground shadow-sm border border-primary/40"
                              : "text-muted-foreground border border-transparent hover:border-primary/30 hover:text-foreground",
                          )}
                          title={channelText.desc || undefined}
                          onClick={() => {
                            setActivePresetChannel(channel.id);
                            applyApiQuickPreset(activePreset.id, channel.id);
                          }}
                        >
                          {channelText.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>{texts.formFields.baseUrlLabel}</Label>
              <Input
                value={apiForm.baseUrl}
                onChange={(e) =>
                  updateYamlFromApiForm({ ...apiForm, baseUrl: e.target.value })
                }
                placeholder={texts.formPlaceholders.baseUrl}
              />
              <p className="text-xs text-muted-foreground">
                {texts.formHints.baseUrl}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{texts.formFields.apiKeyLabel}</Label>
              <textarea
                spellCheck={false}
                className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={apiForm.apiKey}
                onChange={(e) =>
                  updateYamlFromApiForm({ ...apiForm, apiKey: e.target.value })
                }
                placeholder={texts.formPlaceholders.apiKey}
              />
              <p className="text-xs text-muted-foreground">
                {texts.formHints.apiKey}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-muted/20 via-background/70 to-muted/10 p-4 shadow-sm">
              <div className="flex flex-wrap items-start gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {texts.testConnection}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {apiTest.status === "success" && (
                      <span className="text-emerald-600">
                        {texts.testConnectionOk
                          .replace(
                            "{latency}",
                            String(apiTest.latencyMs ?? "-"),
                          )
                          .replace("{status}", String(apiTest.statusCode ?? "-"))}
                      </span>
                    )}
                    {apiTest.status === "error" && (
                      <span className="text-destructive">
                        {texts.testConnectionFail.replace(
                          "{error}",
                          apiTest.message || texts.testConnectionFailFallback,
                        )}
                      </span>
                    )}
                    {apiTest.status === "idle" && (
                      <span>{texts.testConnectionHint}</span>
                    )}
                    {apiTest.status === "testing" && (
                      <span>{texts.testConnectionRunning}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant={apiTest.status === "success" ? "outline" : "secondary"}
                  size="sm"
                  className={cn(
                    "gap-2 min-w-[120px] justify-center ml-auto",
                    apiTest.status === "success" &&
                    "border-green-500/50 text-green-600 dark:text-green-400 bg-green-500/10",
                    apiTest.status === "error" &&
                    "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10",
                  )}
                  onClick={handleTestApi}
                  disabled={apiTest.status === "testing"}
                >
                  {apiTest.status === "testing" ? (
                    <Activity className="h-4 w-4 animate-spin" />
                  ) : apiTest.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {apiTest.status === "testing"
                    ? texts.testConnectionRunning
                    : texts.testConnection}
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-muted/10 via-background/80 to-muted/5 p-4 shadow-sm">
              <div className="flex flex-wrap items-start gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {texts.concurrencyAutoTest}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {apiConcurrency.status === "success" && (
                      <span className="text-emerald-600">
                        {texts.concurrencyAutoTestOk.replace(
                          "{count}",
                          String(apiConcurrency.maxConcurrency ?? "-"),
                        )}
                        {apiConcurrency.latencyMs !== undefined && (
                          <span className="ml-2 text-muted-foreground">
                            {apiConcurrency.latencyMs}ms
                          </span>
                        )}
                      </span>
                    )}
                    {apiConcurrency.status === "error" && (
                      <span className="text-destructive">
                        {apiConcurrency.message || texts.concurrencyAutoTestFail}
                      </span>
                    )}
                    {apiConcurrency.status === "idle" && (
                      <span>{texts.concurrencyAutoTestHint}</span>
                    )}
                    {apiConcurrency.status === "testing" && (
                      <span>{texts.concurrencyAutoTestRunning}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant={
                    apiConcurrency.status === "success" ? "outline" : "secondary"
                  }
                  size="sm"
                  className={cn(
                    "gap-2 min-w-[120px] justify-center ml-auto",
                    apiConcurrency.status === "success" &&
                    "border-green-500/50 text-green-600 dark:text-green-400 bg-green-500/10",
                    apiConcurrency.status === "error" &&
                    "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10",
                  )}
                  onClick={handleTestConcurrency}
                  disabled={
                    apiConcurrency.status === "testing"
                  }
                >
                  {apiConcurrency.status === "testing" ? (
                    <Activity className="h-4 w-4 animate-spin" />
                  ) : apiConcurrency.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Gauge className="h-4 w-4" />
                  )}
                  {apiConcurrency.status === "testing"
                    ? texts.concurrencyAutoTestRunning
                    : texts.concurrencyAutoTest}
                </Button>
              </div>
              {apiConcurrency.statusCounts && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {Object.entries(apiConcurrency.statusCounts)
                    .map(([code, count]) => `${code}×${count}`)
                    .join(" ")}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{texts.formFields.modelLabel}</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleFetchModelList}
                  disabled={modelListLoading || !canFetchModelList}
                >
                  {modelListLoading
                    ? texts.modelListLoading
                    : texts.modelListAction}
                </Button>
              </div>
              <Input
                value={apiForm.model}
                onChange={(e) =>
                  updateYamlFromApiForm({ ...apiForm, model: e.target.value })
                }
                placeholder={texts.formPlaceholders.model}
              />
              {modelList.length > 0 && (
                <div className="grid gap-2 md:grid-cols-[140px,1fr] md:items-center">
                  <span className="text-xs text-muted-foreground">
                    {texts.modelListSelectLabel}
                  </span>
                  <SelectField
                    value={
                      modelList.includes(apiForm.model) ? apiForm.model : ""
                    }
                    onChange={(e) =>
                      updateYamlFromApiForm({
                        ...apiForm,
                        model: e.target.value,
                      })
                    }
                  >
                    <option value="">{texts.modelListSelectPlaceholder}</option>
                    {modelList.map((modelId) => (
                      <option key={modelId} value={modelId}>
                        {modelId}
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}
              <div className="space-y-1 text-xs text-muted-foreground">
                {!canFetchModelList && (
                  <p>{texts.modelListUnsupported}</p>
                )}
                {!modelListRequested && modelList.length === 0 && (
                  <p>{texts.modelHintCombined}</p>
                )}
                {modelListError && (
                  <p className="text-destructive">{modelListError}</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border bg-muted/20 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {texts.poolEndpointsTitle}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {texts.poolEndpointsDesc}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateYamlFromApiForm({
                      ...apiForm,
                      poolEndpoints: [
                        ...(apiForm.poolEndpoints || []),
                        createPoolEndpoint(),
                      ],
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {texts.poolEndpointAdd}
                </Button>
              </div>

              <div className="space-y-3">
                {(apiForm.poolEndpoints || []).map((endpoint, index) => (
                  <div
                    key={`pool-endpoint-${index}`}
                    className="rounded-lg border border-border/60 bg-background/60 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-muted-foreground">
                        {texts.poolEndpointLabel.replace(
                          "{index}",
                          String(index + 1),
                        )}
                      </div>
                      {(apiForm.poolEndpoints || []).length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const next = (apiForm.poolEndpoints || []).filter(
                              (_, idx) => idx !== index,
                            );
                            updateYamlFromApiForm({
                              ...apiForm,
                              poolEndpoints:
                                next.length > 0
                                  ? next
                                  : [createPoolEndpoint()],
                            });
                          }}
                        >
                          {texts.poolEndpointRemove}
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.formFields.baseUrlLabel}</Label>
                      <Input
                        value={endpoint.baseUrl}
                        onChange={(e) => {
                          const next = (apiForm.poolEndpoints || []).map(
                            (item, idx) =>
                              idx === index
                                ? { ...item, baseUrl: e.target.value }
                                : item,
                          );
                          updateYamlFromApiForm({
                            ...apiForm,
                            poolEndpoints: next,
                          });
                        }}
                        placeholder={texts.formPlaceholders.baseUrl}
                      />
                      <p className="text-xs text-muted-foreground">
                        {texts.formHints.baseUrl}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{texts.poolEndpointModelLabel}</Label>
                        <Input
                          value={endpoint.model}
                          onChange={(e) => {
                            const next = (apiForm.poolEndpoints || []).map(
                              (item, idx) =>
                                idx === index
                                  ? { ...item, model: e.target.value }
                                  : item,
                            );
                            updateYamlFromApiForm({
                              ...apiForm,
                              poolEndpoints: next,
                            });
                          }}
                          placeholder={texts.poolEndpointModelPlaceholder}
                        />
                        <p className="text-xs text-muted-foreground">
                          {texts.poolEndpointModelHint}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>{texts.poolEndpointWeightLabel}</Label>
                        <InputAffix
                          type="number"
                          min="1"
                          step="1"
                          value={endpoint.weight}
                          onChange={(e) => {
                            const next = (apiForm.poolEndpoints || []).map(
                              (item, idx) =>
                                idx === index
                                  ? { ...item, weight: e.target.value }
                                  : item,
                            );
                            updateYamlFromApiForm({
                              ...apiForm,
                              poolEndpoints: next,
                            });
                          }}
                          placeholder={texts.poolEndpointWeightPlaceholder}
                          prefix={<Repeat className="h-3.5 w-3.5" />}
                          suffix="x"
                        />
                        <p className="text-xs text-muted-foreground">
                          {texts.poolEndpointWeightHint}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.formFields.apiKeyLabel}</Label>
                      <textarea
                        spellCheck={false}
                        className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={endpoint.apiKeys}
                        onChange={(e) => {
                          const next = (apiForm.poolEndpoints || []).map(
                            (item, idx) =>
                              idx === index
                                ? { ...item, apiKeys: e.target.value }
                                : item,
                          );
                          updateYamlFromApiForm({
                            ...apiForm,
                            poolEndpoints: next,
                          });
                        }}
                        placeholder={texts.formPlaceholders.apiKey}
                      />
                      <p className="text-xs text-muted-foreground">
                        {texts.poolEndpointApiKeyHint}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {texts.poolEndpointHint?.trim() ? (
                <div className="text-xs text-muted-foreground">
                  {texts.poolEndpointHint}
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {texts.formSectionAdvanced}
              </div>
              <div className="text-xs text-muted-foreground">
                {texts.formAdvancedDesc}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setApiAdvancedOpen((prev) => !prev)}
            >
              {apiAdvancedOpen
                ? texts.formAdvancedHide
                : texts.formAdvancedShow}
            </Button>
          </div>

          {apiAdvancedOpen && (
            <div className="space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center rounded-md border bg-muted/30 p-0.5 text-xs">
                {[
                  { key: "sampling", label: texts.apiAdvancedTabs.sampling },
                  { key: "headers", label: texts.apiAdvancedTabs.headers },
                  { key: "extras", label: texts.apiAdvancedTabs.extras },
                ]
                  .map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() =>
                        setApiAdvancedTab(
                          tab.key as "sampling" | "headers" | "extras",
                        )
                      }
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                        apiAdvancedTab === tab.key
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
              </div>

              {apiAdvancedTab === "extras" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{texts.formFields.timeoutLabel}</Label>
                    <InputAffix
                      type="number"
                      value={apiForm.timeout}
                      onChange={(e) =>
                        updateYamlFromApiForm({
                          ...apiForm,
                          timeout: e.target.value,
                        })
                      }
                      placeholder={texts.formPlaceholders.timeout}
                      prefix={<Clock className="h-3.5 w-3.5" />}
                      suffix="s"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{texts.formFields.groupLabel}</Label>
                    <Input
                      value={apiForm.group}
                      onChange={(e) =>
                        updateYamlFromApiForm({
                          ...apiForm,
                          group: e.target.value,
                        })
                      }
                      placeholder={texts.formPlaceholders.group}
                    />
                    <p className="text-xs text-muted-foreground">
                      {texts.formHints.group}
                    </p>
                  </div>
                </div>
              )}

              {apiAdvancedTab === "sampling" && (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">
                      {texts.apiSamplingTitle}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {texts.apiSamplingDesc}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{texts.apiSamplingFields.temperature}</Label>
                      <InputAffix
                        type="number"
                        step="0.1"
                        value={apiForm.temperature}
                        onChange={(e) =>
                          updateYamlFromApiForm({
                            ...apiForm,
                            temperature: e.target.value,
                          })
                        }
                        placeholder={texts.apiSamplingPlaceholders.temperature}
                        prefix={<Thermometer className="h-3.5 w-3.5" />}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.apiSamplingFields.topP}</Label>
                      <InputAffix
                        type="number"
                        step="0.1"
                        value={apiForm.topP}
                        onChange={(e) =>
                          updateYamlFromApiForm({
                            ...apiForm,
                            topP: e.target.value,
                          })
                        }
                        placeholder={texts.apiSamplingPlaceholders.topP}
                        prefix={<Percent className="h-3.5 w-3.5" />}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.apiSamplingFields.maxTokens}</Label>
                      <InputAffix
                        type="number"
                        step="1"
                        value={apiForm.maxTokens}
                        onChange={(e) =>
                          updateYamlFromApiForm({
                            ...apiForm,
                            maxTokens: e.target.value,
                          })
                        }
                        placeholder={texts.apiSamplingPlaceholders.maxTokens}
                        prefix={<Hash className="h-3.5 w-3.5" />}
                        suffix="tok"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.apiSamplingFields.presencePenalty}</Label>
                      <InputAffix
                        type="number"
                        step="0.1"
                        value={apiForm.presencePenalty}
                        onChange={(e) =>
                          updateYamlFromApiForm({
                            ...apiForm,
                            presencePenalty: e.target.value,
                          })
                        }
                        placeholder={
                          texts.apiSamplingPlaceholders.presencePenalty
                        }
                        prefix={<Activity className="h-3.5 w-3.5" />}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.apiSamplingFields.frequencyPenalty}</Label>
                      <InputAffix
                        type="number"
                        step="0.1"
                        value={apiForm.frequencyPenalty}
                        onChange={(e) =>
                          updateYamlFromApiForm({
                            ...apiForm,
                            frequencyPenalty: e.target.value,
                          })
                        }
                        placeholder={
                          texts.apiSamplingPlaceholders.frequencyPenalty
                        }
                        prefix={<Zap className="h-3.5 w-3.5" />}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.apiSamplingFields.seed}</Label>
                      <InputAffix
                        type="number"
                        step="1"
                        value={apiForm.seed}
                        onChange={(e) =>
                          updateYamlFromApiForm({
                            ...apiForm,
                            seed: e.target.value,
                          })
                        }
                        placeholder={texts.apiSamplingPlaceholders.seed}
                        prefix={<Hash className="h-3.5 w-3.5" />}
                        suffix="#"
                      />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>{texts.apiSamplingFields.stop}</Label>
                      <Input
                        value={apiForm.stop}
                        onChange={(e) =>
                          updateYamlFromApiForm({
                            ...apiForm,
                            stop: e.target.value,
                          })
                        }
                        placeholder={texts.apiSamplingPlaceholders.stop}
                      />
                    </div>
                  </div>
                </div>
              )}

              {apiAdvancedTab === "headers" &&
                (
                  <div className="space-y-4">
                    <KVEditor
                      label={texts.formFields.headersLabel}
                      pairs={headerPairs}
                      onChange={applyHeaderPairs}
                      strings={kvStrings}
                      showHint={false}
                    />
                    <KVEditor
                      label={texts.formFields.paramsLabel}
                      pairs={paramPairs}
                      onChange={applyParamPairs}
                      strings={kvStrings}
                    />
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderPromptForm = () => {
    const showPromptId = showIdField.prompt;
    const isJsonlPrompt =
      String(promptForm.sourceFormat || "").trim().toLowerCase() === "jsonl";
    const resolvedSourceFormat = String(promptForm.sourceFormat || "").trim();
    const baseSourceFormatOptions = [
      { value: "", label: texts.promptOptions.sourceFormat.auto },
      { value: "jsonl", label: texts.promptOptions.sourceFormat.jsonl },
      { value: "plain", label: texts.promptOptions.sourceFormat.plain },
    ];
    const hasCustomSourceFormat =
      resolvedSourceFormat &&
      !baseSourceFormatOptions.some((option) => option.value === resolvedSourceFormat);
    const sourceFormatOptions = hasCustomSourceFormat
      ? [
        {
          value: resolvedSourceFormat,
          label: texts.promptOptions.sourceFormat.custom.replace(
            "{value}",
            resolvedSourceFormat,
          ),
        },
        ...baseSourceFormatOptions,
      ]
      : baseSourceFormatOptions;
    return (
      <div className="space-y-5">
        <FormSection
          title={texts.promptSections.templateTitle}
          desc={texts.promptSections.templateDesc}
          actions={renderIdToggle("prompt")}
        >
          <div className="grid grid-cols-2 gap-4">
            {showPromptId && (
              <div className="space-y-2">
                <Label>{texts.promptFields.idLabel}</Label>
                <Input
                  value={promptForm.id}
                  onChange={(e) =>
                    updateYamlFromPromptForm({
                      ...promptForm,
                      id: e.target.value,
                    })
                  }
                  placeholder={texts.promptPlaceholders.id}
                />
              </div>
            )}
            <div className={cn("space-y-2", showPromptId ? "" : "col-span-2")}>
              <Label>{texts.promptFields.nameLabel}</Label>
              <Input
                value={promptForm.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const nextId = shouldAutoUpdateId("prompt", nextName)
                    ? buildAutoProfileId("prompt", nextName, promptForm.id)
                    : promptForm.id;
                  updateYamlFromPromptForm({
                    ...promptForm,
                    name: nextName,
                    id: nextId,
                  });
                }}
                placeholder={texts.promptPlaceholders.name}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>{texts.promptFields.systemTemplateLabel}</Label>
              <textarea
                spellCheck={false}
                className="flex min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                value={promptForm.systemTemplate}
                onChange={(e) =>
                  updateYamlFromPromptForm({
                    ...promptForm,
                    systemTemplate: e.target.value,
                  })
                }
                placeholder={texts.promptPlaceholders.systemTemplate}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>{texts.promptFields.userTemplateLabel}</Label>
              <textarea
                spellCheck={false}
                className="flex min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                value={promptForm.userTemplate}
                onChange={(e) =>
                  updateYamlFromPromptForm({
                    ...promptForm,
                    userTemplate: e.target.value,
                  })
                }
                placeholder={texts.promptPlaceholders.userTemplate}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {texts.promptHints.variables}
          </p>
        </FormSection>

        <FormSection
          title={texts.promptSections.contextTitle}
          desc={texts.promptSections.contextDesc}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{texts.promptFields.beforeLinesLabel}</Label>
              <InputAffix
                type="number"
                min="0"
                step="1"
                value={promptForm.beforeLines}
                onChange={(e) =>
                  updateYamlFromPromptForm({
                    ...promptForm,
                    beforeLines: e.target.value,
                  })
                }
                placeholder={texts.promptPlaceholders.beforeLines}
                prefix={<Hash className="h-3.5 w-3.5" />}
                suffix="ln"
              />
            </div>
            <div className="space-y-2">
              <Label>{texts.promptFields.afterLinesLabel}</Label>
              <InputAffix
                type="number"
                min="0"
                step="1"
                value={promptForm.afterLines}
                onChange={(e) =>
                  updateYamlFromPromptForm({
                    ...promptForm,
                    afterLines: e.target.value,
                  })
                }
                placeholder={texts.promptPlaceholders.afterLines}
                prefix={<Hash className="h-3.5 w-3.5" />}
                suffix="ln"
              />
            </div>
            <div className="space-y-2">
              <Label>{texts.promptFields.sourceLinesLabel}</Label>
              <InputAffix
                type="number"
                min="1"
                step="1"
                value={promptForm.sourceLines}
                onChange={(e) =>
                  updateYamlFromPromptForm({
                    ...promptForm,
                    sourceLines: e.target.value,
                  })
                }
                placeholder={texts.promptPlaceholders.sourceLines}
                prefix={<Hash className="h-3.5 w-3.5" />}
                suffix="ln"
              />
            </div>
            <div className="space-y-2">
              <Label>{texts.promptFields.sourceFormatLabel}</Label>
              <SelectField
                value={promptForm.sourceFormat}
                onChange={(e) =>
                  updateYamlFromPromptForm({
                    ...promptForm,
                    sourceFormat: e.target.value,
                  })
                }
              >
                {sourceFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              <p className="text-xs text-muted-foreground">
                {texts.promptHints.sourceFormat}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{texts.promptFields.joinerLabel}</Label>
              <Input
                value={promptForm.joiner}
                onChange={(e) =>
                  updateYamlFromPromptForm({
                    ...promptForm,
                    joiner: e.target.value,
                  })
                }
                placeholder={texts.promptPlaceholders.joiner}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {texts.promptHints.context}
          </p>
        </FormSection>

        <FormSection
          title={texts.promptPreviewTitle}
          desc={texts.promptPreviewDesc}
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setPromptPreview((prev) => ({
                  ...prev,
                  showContext: !prev.showContext,
                }))
              }
            >
              {promptPreview.showContext
                ? texts.promptPreviewHideContext
                : texts.promptPreviewShowContext}
            </Button>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{texts.promptPreviewSourceLabel}</Label>
                <textarea
                  spellCheck={false}
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={promptPreview.source}
                  onChange={(e) =>
                    setPromptPreview((prev) => ({
                      ...prev,
                      source: e.target.value,
                    }))
                  }
                  placeholder={texts.promptPreviewSourcePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>{texts.promptPreviewGlossaryLabel}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <SelectField
                      value={glossarySelected}
                      onChange={(e) => setGlossarySelected(e.target.value)}
                    >
                      <option value="">
                        {texts.promptPreviewGlossarySelectPlaceholder}
                      </option>
                      {glossaryFiles.map((file) => (
                        <option key={file} value={file}>
                          {file}
                        </option>
                      ))}
                    </SelectField>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleLoadGlossary}
                      disabled={glossaryLoading}
                    >
                      {glossaryLoading
                        ? texts.promptPreviewGlossaryLoading
                        : texts.promptPreviewGlossaryLoad}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={refreshGlossaryFiles}
                      disabled={glossaryLoading}
                    >
                      {texts.promptPreviewGlossaryRefresh}
                    </Button>
                  </div>
                </div>
                <textarea
                  spellCheck={false}
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={promptPreview.glossary}
                  onChange={(e) =>
                    setPromptPreview((prev) => ({
                      ...prev,
                      glossary: e.target.value,
                    }))
                  }
                  placeholder={texts.promptPreviewGlossaryPlaceholder}
                />
                <p className="text-xs text-muted-foreground">
                  {texts.promptPreviewGlossaryHint}
                </p>
                {glossaryLoadError && (
                  <p className="text-xs text-destructive">
                    {glossaryLoadError}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{texts.promptPreviewLineIndexLabel}</Label>
                <InputAffix
                  type="number"
                  min="0"
                  step="1"
                  value={promptPreview.lineIndex}
                  onChange={(e) =>
                    setPromptPreview((prev) => ({
                      ...prev,
                      lineIndex: e.target.value,
                    }))
                  }
                  placeholder={texts.promptPreviewLineIndexPlaceholder}
                  prefix={<Hash className="h-3.5 w-3.5" />}
                  disabled={!isJsonlPrompt}
                />
                <p className="text-xs text-muted-foreground">
                  {isJsonlPrompt
                    ? texts.promptPreviewLineIndexHintLine
                    : texts.promptPreviewLineIndexHintBlock}
                </p>
              </div>
              {promptPreview.showContext && (
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <Label>{texts.promptPreviewContextBeforeLabel}</Label>
                    <textarea
                      spellCheck={false}
                      className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={promptPreview.contextBefore}
                      onChange={(e) =>
                        setPromptPreview((prev) => ({
                          ...prev,
                          contextBefore: e.target.value,
                        }))
                      }
                      placeholder={texts.promptPreviewContextBeforePlaceholder}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{texts.promptPreviewContextAfterLabel}</Label>
                    <textarea
                      spellCheck={false}
                      className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={promptPreview.contextAfter}
                      onChange={(e) =>
                        setPromptPreview((prev) => ({
                          ...prev,
                          contextAfter: e.target.value,
                        }))
                      }
                      placeholder={texts.promptPreviewContextAfterPlaceholder}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{texts.promptPreviewSystemLabel}</Label>
                <div className="min-h-[120px] rounded-md border border-border/60 bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                  {promptPreviewResult.system || (
                    <span className="text-muted-foreground">
                      {texts.promptPreviewEmpty}
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{texts.promptPreviewUserLabel}</Label>
                <div className="min-h-[120px] rounded-md border border-border/60 bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                  {promptPreviewResult.user || (
                    <span className="text-muted-foreground">
                      {texts.promptPreviewEmpty}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </FormSection>
      </div>
    );
  };

  const renderParserForm = () => {
    const showParserId = showIdField.parser;
    const isCascade = parserForm.mode === "cascade";

    const updateParser = (patch: Partial<ParserFormState>) =>
      updateYamlFromParserForm({ ...parserForm, ...patch });

    const updateRuleAt = (
      index: number,
      patch: Partial<ParserRuleForm> | ParserRuleForm,
    ) => {
      const nextRules = parserForm.rules.map((rule, i) =>
        i === index ? { ...rule, ...(patch as Partial<ParserRuleForm>) } : rule,
      );
      updateParser({ rules: nextRules });
    };

    const moveRule = (from: number, to: number) => {
      if (to < 0 || to >= parserForm.rules.length) return;
      const next = [...parserForm.rules];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      updateParser({ rules: next });
    };

    const addRule = () => {
      const nextRules = parserForm.rules.length
        ? [...parserForm.rules, createParserRule("plain")]
        : [createParserRule("plain")];
      updateParser({ rules: nextRules });
    };

    const removeRule = (index: number) => {
      const next = parserForm.rules.filter((_, i) => i !== index);
      updateParser({ rules: next.length ? next : [createParserRule("plain")] });
    };

    const visibleRules =
      parserForm.mode === "single"
        ? parserForm.rules.slice(0, 1)
        : parserForm.rules;
    const canAddRule = isCascade || parserForm.rules.length === 0;

    return (
      <div className="space-y-5">
        <FormSection
          title={texts.parserFormTitle}
          desc={texts.parserFormDesc}
          actions={renderIdToggle("parser")}
        >
          <div className="grid grid-cols-2 gap-4">
            {showParserId && (
              <div className="space-y-2">
                <Label>{texts.parserFields.idLabel}</Label>
                <Input value={parserForm.id} readOnly />
              </div>
            )}
            <div className={cn("space-y-2", showParserId ? "" : "col-span-2")}>
              <Label>{texts.parserFields.nameLabel}</Label>
              <Input
                value={parserForm.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const nextId = shouldAutoUpdateId("parser", nextName)
                    ? buildAutoProfileId("parser", nextName, parserForm.id)
                    : parserForm.id;
                  updateParser({ name: nextName, id: nextId });
                }}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>{texts.parserModeLabel}</Label>
              <SelectField
                value={parserForm.mode}
                onChange={(e) =>
                  updateParser({
                    mode: e.target.value === "cascade" ? "cascade" : "single",
                  })
                }
              >
                <option value="single">{texts.parserModeOptions.single}</option>
                <option value="cascade">{texts.parserModeOptions.cascade}</option>
              </SelectField>
              <p className="text-xs text-muted-foreground">
                {texts.parserModeHint}
              </p>
            </div>
          </div>
        </FormSection>

        <FormSection
          title={texts.parserRulesTitle}
          desc={texts.parserRulesDesc}
        >
          {visibleRules.length === 0 && (
            <div className="text-xs text-muted-foreground">
              {texts.parserRuleEmpty}
            </div>
          )}
          <div className="space-y-4">
            {visibleRules.map((rule) => {
              const globalIndex = parserForm.rules.indexOf(rule);
              const ruleType = rule.type;
              return (
                <div
                  key={rule.id}
                  className="rounded-lg border border-border/60 bg-background/60 p-3 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">
                      {texts.parserRuleTitle.replace(
                        "{index}",
                        String(globalIndex + 1),
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isCascade && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => moveRule(globalIndex, globalIndex - 1)}
                            disabled={globalIndex === 0}
                          >
                            {texts.parserRuleMoveUp}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => moveRule(globalIndex, globalIndex + 1)}
                            disabled={globalIndex === parserForm.rules.length - 1}
                          >
                            {texts.parserRuleMoveDown}
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRule(globalIndex)}
                        disabled={visibleRules.length === 1}
                      >
                        {texts.parserRuleRemove}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{texts.parserRuleTypeLabel}</Label>
                      <SelectField
                        value={ruleType}
                        onChange={(e) =>
                          updateRuleAt(
                            globalIndex,
                            applyParserRuleType(rule, e.target.value as ParserRuleType),
                          )
                        }
                      >
                        {parserRuleTypes.map((type) => (
                          <option key={type} value={type}>
                            {texts.parserRuleTypeOptions[type]}
                          </option>
                        ))}
                      </SelectField>
                    </div>

                    {["json_object", "jsonl"].includes(ruleType) && (
                      <div className="space-y-2">
                        <Label>{texts.parserRulePathLabel}</Label>
                        <Input
                          value={rule.path}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              path: e.target.value,
                            })
                          }
                          placeholder={texts.parserRulePathPlaceholder}
                        />
                      </div>
                    )}

                    {ruleType === "tagged_line" && (
                      <div className="space-y-2">
                        <Label>{texts.parserRulePatternLabel}</Label>
                        <Input
                          value={rule.pattern}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              pattern: e.target.value,
                            })
                          }
                          placeholder={texts.parserRulePatternPlaceholder}
                        />
                      </div>
                    )}

                    {ruleType === "line_strict" && (
                      <div className="space-y-2">
                        <Label>{texts.parserRuleMultiLineLabel}</Label>
                        <SelectField
                          value={rule.multiLine}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              multiLine: e.target.value as ParserRuleForm["multiLine"],
                            })
                          }
                        >
                          <option value="join">
                            {texts.parserRuleMultiLineOptions.join}
                          </option>
                          <option value="first">
                            {texts.parserRuleMultiLineOptions.first}
                          </option>
                          <option value="error">
                            {texts.parserRuleMultiLineOptions.error}
                          </option>
                        </SelectField>
                      </div>
                    )}
                  </div>

                  {ruleType === "tagged_line" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border/60"
                        checked={rule.sortById}
                        onChange={(e) =>
                          updateRuleAt(globalIndex, {
                            sortById: e.target.checked,
                            sortByKey:
                              e.target.checked && !rule.sortByKey
                                ? "id"
                                : rule.sortByKey,
                          })
                        }
                      />
                      <span>{texts.parserRuleSortLabel}</span>
                    </label>
                  )}

                  {ruleType === "regex" && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{texts.parserRulePatternLabel}</Label>
                        <Input
                          value={rule.pattern}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              pattern: e.target.value,
                            })
                          }
                          placeholder={texts.parserRulePatternPlaceholder}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{texts.parserRuleRegexGroupLabel}</Label>
                        <Input
                          value={rule.regexGroup}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              regexGroup: e.target.value,
                            })
                          }
                          placeholder={texts.parserRuleRegexGroupPlaceholder}
                        />
                      </div>
                      <div className="space-y-2 col-span-2">
                        <Label>{texts.parserRuleRegexFlagsLabel}</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              "multiline",
                              "dotall",
                              "ignorecase",
                            ] as const
                          ).map((flag) => (
                            <label
                              key={flag}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-border/60"
                                checked={rule.regexFlags[flag]}
                                onChange={(e) =>
                                  updateRuleAt(globalIndex, {
                                    regexFlags: {
                                      ...rule.regexFlags,
                                      [flag]: e.target.checked,
                                    },
                                  })
                                }
                              />
                              <span>{texts.parserRuleRegexFlags[flag]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {ruleType === "python" && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{texts.parserRuleScriptLabel}</Label>
                        <Input
                          value={rule.scriptPath}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              scriptPath: e.target.value,
                            })
                          }
                          placeholder={texts.parserRuleScriptPlaceholder}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{texts.parserRuleFunctionLabel}</Label>
                        <Input
                          value={rule.functionName}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              functionName: e.target.value,
                            })
                          }
                          placeholder={texts.parserRuleFunctionPlaceholder}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground col-span-2">
                        {texts.parserRulePythonHint}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        updateRuleAt(globalIndex, {
                          advancedOpen: !rule.advancedOpen,
                        })
                      }
                    >
                      {rule.advancedOpen
                        ? texts.parserRuleExtraHide
                        : texts.parserRuleExtraShow}
                    </button>
                    {rule.advancedOpen && (
                      <div className="space-y-2">
                        <Label>{texts.parserRuleExtraLabel}</Label>
                        <textarea
                          spellCheck={false}
                          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                          value={rule.extraOptions}
                          onChange={(e) =>
                            updateRuleAt(globalIndex, {
                              extraOptions: e.target.value,
                            })
                          }
                          placeholder={texts.parserRuleExtraPlaceholder}
                        />
                        <div className="text-xs text-muted-foreground">
                          {texts.parserRuleExtraHint}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {canAddRule && (
            <Button
              variant="outline"
              size="sm"
              className="w-full border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/50"
              onClick={addRule}
            >
              <Plus className="mr-2 h-4 w-4" />
              {texts.parserRuleAdd}
            </Button>
          )}
        </FormSection>
      </div>
    );
  };

  const renderPolicyForm = () => {
    const showPolicyId = showIdField.policy;

    const updatePolicy = (patch: Partial<PolicyFormState>) =>
      updateYamlFromPolicyForm({ ...policyForm, ...patch });

    const sourceLangOptions = new Set(["", "ja"]);
    const customSourceLang =
      policyForm.sourceLang && !sourceLangOptions.has(policyForm.sourceLang)
        ? policyForm.sourceLang
        : "";

    const renderCheckCard = (
      checked: boolean,
      onChange: (next: boolean) => void,
      label: string,
      desc: string,
      children?: React.ReactNode,
    ) => (
      <div
        className={cn(
          "relative flex flex-col rounded-xl border transition-all duration-200",
          checked
            ? "border-primary/40 bg-primary/[0.03]"
            : "border-border/60 bg-card hover:bg-accent/40"
        )}
      >
        <div
          onClick={() => onChange(!checked)}
          className="flex items-start gap-4 p-4 cursor-pointer select-none"
        >
          <div className={cn(
            "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
            checked
              ? "bg-primary border-primary text-white scale-110"
              : "border-muted-foreground/30 bg-transparent"
          )}>
            {checked && <Check className="h-3 w-3 stroke-[3]" />}
          </div>
          <div className="space-y-1 flex-1">
            <div className="text-sm font-medium leading-none text-foreground">
              {label}
            </div>
            <p className="text-xs text-muted-foreground/80 leading-relaxed">
              {desc}
            </p>
          </div>
        </div>

        {checked && children && (
          <div className="px-4 pb-4 pt-0 animate-in fade-in zoom-in-95 duration-200">
            <div className="h-px bg-primary/10 mb-4" />
            {children}
          </div>
        )}
      </div>
    );

    return (
      <div className="w-full px-4 py-8">
        {/* Section 1: Basic Info */}
        <FormSection
          title={texts.policySections.modeTitle}
          desc={texts.policySections.modeDesc}
          actions={renderIdToggle("policy")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {showPolicyId && (
              <div className="space-y-2">
                <Label>{texts.policyFields.idLabel}</Label>
                <Input
                  value={policyForm.id}
                  onChange={(e) => updatePolicy({ id: e.target.value })}
                />
              </div>
            )}
            <div className={cn("space-y-2", showPolicyId ? "" : "col-span-2")}>
              <Label>{texts.policyFields.nameLabel}</Label>
              <Input
                value={policyForm.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const nextId = shouldAutoUpdateId("policy", nextName)
                    ? buildAutoProfileId("policy", nextName, policyForm.id)
                    : policyForm.id;
                  updatePolicy({ name: nextName, id: nextId });
                }}
              />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <Label className="text-base">{texts.policyFields.policyTypeLabel}</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                onClick={() => updatePolicy({ policyType: "strict" })}
                className={cn(
                  "cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md",
                  policyForm.policyType === "strict"
                    ? "border-border/70 bg-muted/40 ring-1 ring-border/40 dark:bg-primary/15 dark:border-primary/40 dark:ring-primary/20"
                    : "border-border/60 bg-card hover:bg-muted/30"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-foreground">{texts.policyOptions.strict}</div>
                  {policyForm.policyType === "strict" && <CheckCircle2 className="w-5 h-5 text-foreground dark:text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {texts.policyHints.strict}
                </p>
              </div>

              <div
                onClick={() => updatePolicy({ policyType: "tolerant" })}
                className={cn(
                  "cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md",
                  policyForm.policyType === "tolerant"
                    ? "border-border/70 bg-muted/40 ring-1 ring-border/40 dark:bg-primary/15 dark:border-primary/40 dark:ring-primary/20"
                    : "border-border/60 bg-card hover:bg-muted/30"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-foreground">{texts.policyOptions.tolerant}</div>
                  {policyForm.policyType === "tolerant" && <CheckCircle2 className="w-5 h-5 text-foreground dark:text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {texts.policyHints.tolerant}
                </p>
              </div>
            </div>
          </div>
          {/* Section 2: Error Handling */}
          <div className="pt-8 border-t border-border/40 dark:border-primary/20 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground/80">
                {texts.policySections.errorTitle}
              </div>
              <p className="text-xs text-muted-foreground">
                {texts.policySections.errorDesc}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-3">
                <Label>{texts.policyFields.onMismatchLabel}</Label>
                <SelectField
                  value={policyForm.onMismatch}
                  onChange={(e) =>
                    updatePolicy({
                      onMismatch: e.target.value as PolicyFormState["onMismatch"],
                    })
                  }
                  className="h-10"
                >
                  <option value="retry">{texts.policyOptions.onMismatchRetry}</option>
                  <option value="error">{texts.policyOptions.onMismatchError}</option>
                  <option value="pad">{texts.policyOptions.onMismatchPad}</option>
                  <option value="truncate">{texts.policyOptions.onMismatchTruncate}</option>
                  <option value="align">{texts.policyOptions.onMismatchAlign}</option>
                </SelectField>
                <p className="text-xs text-muted-foreground">
                  {texts.policyHints.onMismatch}
                </p>
              </div>

              {renderCheckCard(
                policyForm.trim,
                (c) => updatePolicy({ trim: c }),
                texts.policyFields.trimLabel,
                texts.policyHints.trim,
              )}
            </div>
          </div>

          {/* Section 3: Quality Checks (In-Card Expansion) */}
          <div className="pt-8 border-t border-primary/5 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground/80">{texts.policySections.checksTitle}</div>
              <p className="text-xs text-muted-foreground">{texts.policySections.checksDesc}</p>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {/* Empty Line Check - No extra settings */}
              {renderCheckCard(
                policyForm.emptyLine,
                (next) => updatePolicy({ emptyLine: next }),
                texts.policyChecks.emptyLine,
                texts.policyChecksDesc.emptyLine,
              )}

              {/* Similarity Check - Has Threshold Setting */}
              {renderCheckCard(
                policyForm.similarity,
                (next) => updatePolicy({ similarity: next }),
                texts.policyChecks.similarity,
                texts.policyChecksDesc.similarity,
                // In-Card Settings
                <div className="space-y-4 pt-2">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>{texts.policyFields.similarityThresholdLabel}</Label>
                      <span className="text-xs font-mono bg-background border rounded px-1.5 py-0.5 shadow-sm">
                        {policyForm.similarityThreshold}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={policyForm.similarityThreshold}
                      onChange={(e) => updatePolicy({ similarityThreshold: e.target.value })}
                      className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <p className="text-xs text-muted-foreground">
                      {texts.policyHints.similarityThreshold}
                    </p>
                  </div>
                </div>
              )}

              {/* Kana Check - Has Language Setting */}
              {renderCheckCard(
                policyForm.kanaTrace,
                (next) => updatePolicy({ kanaTrace: next }),
                texts.policyChecks.kanaTrace,
                texts.policyChecksDesc.kanaTrace,
                // In-Card Settings
                <div className="space-y-4 pt-2">
                  <div className="space-y-3">
                    <Label>{texts.policyFields.sourceLangLabel}</Label>
                    <SelectField
                      value={policyForm.sourceLang}
                      onChange={(e) => updatePolicy({ sourceLang: e.target.value })}
                    >
                      {customSourceLang && (
                        <option value={customSourceLang}>
                          {texts.policyOptions.sourceLangCustom.replace("{code}", customSourceLang)}
                        </option>
                      )}
                      <option value="">{texts.policyOptions.sourceLangAuto}</option>
                      <option value="ja">{texts.policyOptions.sourceLangJa}</option>
                    </SelectField>
                    <p className="text-xs text-muted-foreground">
                      {texts.policyHints.sourceLang}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </FormSection>
      </div>
    );
  };

  const renderChunkForm = () => {
    const showChunkId = showIdField.chunk;

    const updateChunk = (patch: Partial<ChunkFormState>) =>
      updateYamlFromChunkForm({ ...chunkForm, ...patch });

    const renderSwitchCard = (
      checked: boolean,
      onChange: (next: boolean) => void,
      label: string,
      hint?: string,
      children?: React.ReactNode,
    ) => (
      <div className={cn(
        "relative flex flex-col rounded-xl border transition-all duration-200",
        checked
          ? "border-primary/40 bg-primary/[0.03]"
          : "border-border/60 bg-card hover:bg-accent/40"
      )}>
        <div className="flex items-center justify-between p-4 cursor-pointer select-none" onClick={() => onChange(!checked)}>
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-foreground">{label}</div>
            {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
          </div>
          <Switch
            checked={checked}
            onCheckedChange={onChange}
          />
        </div>

        {checked && children && (
          <div className="px-4 pb-4 pt-0 animate-in fade-in zoom-in-95 duration-200">
            <div className="h-px bg-primary/10 mb-4" />
            {children}
          </div>
        )}
      </div>
    );

    return (
      <div className="w-full px-4 py-8">
        <FormSection
          title={texts.chunkSections.modeTitle}
          desc={texts.chunkSections.modeDesc}
          actions={renderIdToggle("chunk")}
        >
          {/* Section 1: Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {showChunkId && (
              <div className="space-y-2">
                <Label>{texts.chunkFields.idLabel}</Label>
                <Input
                  value={chunkForm.id}
                  onChange={(e) => updateChunk({ id: e.target.value })}
                />
              </div>
            )}
            <div className={cn("space-y-2", showChunkId ? "" : "col-span-2")}>
              <Label>{texts.chunkFields.nameLabel}</Label>
              <Input
                value={chunkForm.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const nextId = shouldAutoUpdateId("chunk", nextName)
                    ? buildAutoProfileId("chunk", nextName, chunkForm.id)
                    : chunkForm.id;
                  updateChunk({ name: nextName, id: nextId });
                }}
              />
            </div>
          </div>

          {/* Section 2: Splitting Rules */}
          <div className="pt-8 border-t border-primary/5 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground/80">
                {texts.chunkSections.rulesTitle}
              </div>
              <p className="text-xs text-muted-foreground">
                {texts.chunkSections.rulesDesc}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <Label>{texts.chunkFields.targetCharsLabel}</Label>
                <Input
                  type="number"
                  className="font-mono"
                  value={chunkForm.targetChars}
                  onChange={(e) => updateChunk({ targetChars: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {texts.chunkHints.targetChars}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{texts.chunkFields.maxCharsLabel}</Label>
                <Input
                  type="number"
                  className="font-mono"
                  value={chunkForm.maxChars}
                  onChange={(e) => updateChunk({ maxChars: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {texts.chunkHints.maxChars}
                </p>
              </div>
            </div>
          </div>

          {/* Section 3: Balance Settings (In-Card Expansion) */}
          <div className="pt-8 border-t border-primary/5 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground/80">
                {texts.chunkSections.balanceTitle}
              </div>
              <p className="text-xs text-muted-foreground">
                {texts.chunkSections.balanceDesc}
              </p>
            </div>
            <div className="space-y-6">
              {renderSwitchCard(
                chunkForm.enableBalance,
                (next) => updateChunk({ enableBalance: next }),
                texts.chunkFields.enableBalanceLabel,
                texts.chunkHints.enableBalance,
                // In-Card Settings
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                  <div className="space-y-2">
                    <Label>{texts.chunkFields.balanceThresholdLabel}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      className="text-lg font-mono"
                      value={chunkForm.balanceThreshold}
                      onChange={(e) =>
                        updateChunk({ balanceThreshold: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {texts.chunkHints.balanceThreshold}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>{texts.chunkFields.balanceCountLabel}</Label>
                    <Input
                      type="number"
                      className="text-lg font-mono"
                      value={chunkForm.balanceCount}
                      onChange={(e) =>
                        updateChunk({ balanceCount: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {texts.chunkHints.balanceCount}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </FormSection>
      </div>
    );
  };


  const renderPipelineForm = () => {
    const applyPipelineChange = (patch: Partial<PipelineComposerState>) => {
      const nextChunkPolicy =
        patch.chunkPolicy !== undefined
          ? patch.chunkPolicy
          : pipelineComposer.chunkPolicy;
      const nextLinePolicy =
        patch.linePolicy !== undefined
          ? patch.linePolicy
          : pipelineComposer.linePolicy;
      const nextApplyLinePolicy =
        patch.applyLinePolicy !== undefined
          ? patch.applyLinePolicy
          : pipelineComposer.applyLinePolicy;
      updateYamlFromPipelineComposer({
        ...pipelineComposer,
        ...patch,
        translationMode: resolvePipelineTranslationMode(
          patch.translationMode,
          nextChunkPolicy,
          nextLinePolicy,
          nextApplyLinePolicy,
          pipelineComposer.translationMode,
          chunkTypeIndex,
        ),
      });
    };

    const encodeStrategyCombo = (lineId: string, chunkId: string) =>
      JSON.stringify({ line: lineId || "", chunk: chunkId || "" });

    const decodeStrategyCombo = (raw: string) => {
      if (!raw) return { linePolicy: "", chunkPolicy: "" };
      try {
        const parsed = JSON.parse(raw) as { line?: string; chunk?: string };
        return {
          linePolicy: String(parsed?.line || ""),
          chunkPolicy: String(parsed?.chunk || ""),
        };
      } catch {
        return { linePolicy: "", chunkPolicy: "" };
      }
    };

    const strategyPolicyIds = orderProfileIds("policy", profileIndex.policy);
    const strategyChunkIds = orderProfileIds("chunk", profileIndex.chunk);

    const resolveLinePolicyFallback = () =>
      pipelineComposer.linePolicy || strategyPolicyIds[0] || "";

    const buildStrategyOptions = () => {
      const options: Array<{ value: string; label: string; disabled?: boolean }> = [];
      const lineCandidates = strategyPolicyIds.length ? strategyPolicyIds : [""];
      const lineFallback = resolveLinePolicyFallback();
      strategyChunkIds.forEach((chunkId) => {
        const chunkType = inferChunkType(chunkId);
        if (chunkType === "line") {
          lineCandidates.forEach((linePolicy) => {
            const resolvedLinePolicy = linePolicy || lineFallback;
            options.push({
              value: encodeStrategyCombo(resolvedLinePolicy, chunkId),
              label: getStrategyLabel(resolvedLinePolicy, chunkId),
              disabled: !resolvedLinePolicy,
            });
          });
        } else {
          options.push({
            value: encodeStrategyCombo("", chunkId),
            label: getStrategyLabel("", chunkId),
          });
        }
      });
      return options;
    };

    const strategyOptions = buildStrategyOptions();
    const strategyChunkType = inferChunkType(pipelineComposer.chunkPolicy);
    const normalizedLinePolicy =
      strategyChunkType === "line" ? pipelineComposer.linePolicy : "";
    const strategyValue = pipelineComposer.chunkPolicy
      ? encodeStrategyCombo(normalizedLinePolicy, pipelineComposer.chunkPolicy)
      : "";
    const hasStrategyValue =
      !strategyValue || strategyOptions.some((item) => item.value === strategyValue);
    const strategyOptionsFinal = hasStrategyValue
      ? strategyOptions
      : [
        {
          value: strategyValue,
          label: getStrategyLabel(
            normalizedLinePolicy,
            pipelineComposer.chunkPolicy,
          ),
        },
        ...strategyOptions,
      ];

    const handleStrategyChange = (value: string) => {
      if (!value) {
        applyPipelineChange({
          linePolicy: "",
          chunkPolicy: "",
          applyLinePolicy: false,
        });
        return;
      }
      const { linePolicy, chunkPolicy } = decodeStrategyCombo(value);
      const chunkType = inferChunkType(chunkPolicy);
      if (chunkType === "line") {
        const nextLinePolicy =
          linePolicy || pipelineComposer.linePolicy || strategyPolicyIds[0] || "";
        applyPipelineChange({
          linePolicy: nextLinePolicy,
          chunkPolicy,
          applyLinePolicy: Boolean(nextLinePolicy),
        });
        return;
      }
      applyPipelineChange({
        linePolicy: "",
        chunkPolicy,
        applyLinePolicy: false,
      });
    };

    return (
      <div className="space-y-6">
        <FormSection title={texts.composer.title} desc={texts.composer.desc}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="col-span-2 space-y-2">
              <Label>{texts.formFields?.nameLabel || "名称"}</Label>
              <Input
                value={pipelineComposer.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const nextId = shouldAutoUpdateId("pipeline", nextName)
                    ? buildAutoProfileId("pipeline", nextName, pipelineComposer.id)
                    : pipelineComposer.id;
                  applyPipelineChange({ name: nextName, id: nextId });
                }}
                placeholder={lang === "en" ? "Give this plan a name..." : "为方案起个名字..."}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{texts.composer.fields.providerLabel}</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-label={texts.quickEdit}
                  onClick={() => {
                    const providerId = pipelineComposer.provider;
                    if (providerId) {
                      handleSelectProfile(providerId, "api");
                      return;
                    }
                    jumpToKindHome("api");
                  }}
                >
                  {texts.quickEdit}
                </button>
              </div>
              <SelectField
                value={pipelineComposer.provider}
                onChange={(e) =>
                  applyPipelineChange({ provider: e.target.value })
                }
              >
                <option value="">{texts.composer.placeholders.provider}</option>
                {visibleProfileIndex.api.map((id) => (
                  <option key={id} value={id}>
                    {formatOptionLabel("api", id)}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{texts.composer.fields.promptLabel}</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-label={texts.quickEdit}
                  onClick={() => {
                    const promptId = pipelineComposer.prompt;
                    if (promptId) {
                      handleSelectProfile(promptId, "prompt");
                      return;
                    }
                    jumpToKindHome("prompt");
                  }}
                >
                  {texts.quickEdit}
                </button>
              </div>
              <SelectField
                value={pipelineComposer.prompt}
                onChange={(e) =>
                  applyPipelineChange({ prompt: e.target.value })
                }
              >
                <option value="">{texts.composer.placeholders.prompt}</option>
                {visibleProfileIndex.prompt.map((id) => (
                  <option key={id} value={id}>
                    {formatOptionLabel("prompt", id)}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{texts.scheme.fields.strategy}</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-label={texts.quickEdit}
                  onClick={() => jumpToKindHome("policy")}
                >
                  {texts.quickEdit}
                </button>
              </div>
              <SelectField
                value={strategyValue}
                onChange={(e) => handleStrategyChange(e.target.value)}
              >
                <option value="">{texts.scheme.placeholders.strategy}</option>
                {strategyOptionsFinal.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{texts.composer.fields.parserLabel}</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-label={texts.quickEdit}
                  onClick={() => {
                    const parserId = pipelineComposer.parser;
                    if (parserId) {
                      handleSelectProfile(parserId, "parser");
                      return;
                    }
                    jumpToKindHome("parser");
                  }}
                >
                  {texts.quickEdit}
                </button>
              </div>
              <SelectField
                value={pipelineComposer.parser}
                onChange={(e) =>
                  applyPipelineChange({ parser: e.target.value })
                }
              >
                <option value="">{texts.composer.placeholders.parser}</option>
                {visibleProfileIndex.parser.map((id) => (
                  <option key={id} value={id}>
                    {formatOptionLabel("parser", id)}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>
        </FormSection>
      </div>
    );
  };

  const renderGenericEmptyState = (title: string, desc: string, icon: ComponentType<{ className?: string }>) => {
    const Icon = icon;
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-background/50 p-4">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-muted/40 to-muted/10 dark:from-primary/30 dark:to-primary/10 flex items-center justify-center mb-8 animate-in zoom-in-50 duration-500 shadow-inner border border-border/60 dark:border-primary/30">
          <Icon className="h-10 w-10 text-muted-foreground dark:text-primary opacity-80" />
        </div>
        <h3 className="text-2xl font-bold text-foreground tracking-tight mb-3">
          {title}
        </h3>
        <p className="text-sm max-w-sm text-center opacity-70 mb-10 leading-relaxed">
          {desc}
        </p>
        <Button onClick={handleCreate} size="lg" className="gap-2 px-8 py-6 rounded-xl shadow-xl hover:shadow-primary/20 hover:-translate-y-0.5 transition-all active:scale-95 bg-primary text-primary-foreground font-semibold">
          <Plus className="h-5 w-5" />
          {texts.newProfile}
        </Button>
      </div>
    );
  };

  const renderPipelineOverviewSkeleton = () => {
    const skeletonItems = Array.from({ length: 6 }, (_, index) => index);
    const detailSlots = [0, 1, 2, 3];

    return (
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-6 lg:p-10 max-w-[1800px] mx-auto space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-4">
              <div className="space-y-2">
                <div className="h-6 w-40 rounded bg-muted/50 animate-pulse" />
                <div className="h-4 w-64 rounded bg-muted/40 animate-pulse" />
              </div>
              <div className="h-8 w-24 rounded-full bg-muted/40 animate-pulse" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-10">
            {skeletonItems.map((index) => (
              <div
                key={`pipeline-skeleton-${index}`}
                className="flex flex-col p-5 rounded-xl border border-border/60 bg-card/60 min-h-[240px]"
              >
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-muted/50 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-2/3 rounded bg-muted/50 animate-pulse" />
                    <div className="h-3 w-1/3 rounded bg-muted/40 animate-pulse" />
                  </div>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-3">
                  {detailSlots.map((slot) => (
                    <div
                      key={`pipeline-skeleton-slot-${index}-${slot}`}
                      className="flex flex-col gap-2 p-2.5 rounded-lg bg-secondary/30 border border-border/50"
                    >
                      <div className="h-2.5 w-10 rounded bg-muted/40 animate-pulse" />
                      <div className="h-3 w-full rounded bg-muted/50 animate-pulse" />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-end">
                  <div className="h-8 w-16 rounded bg-muted/40 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderPipelineOverview = () => {
    const stepTexts = Array.isArray(texts.pipelineEmptySteps)
      ? texts.pipelineEmptySteps
      : [];
    const stepPalette = [
      {
        color:
          "from-muted/40 to-muted/10 border border-border/60 dark:from-primary/30 dark:to-primary/10 dark:border-primary/30",
        iconColor: "text-muted-foreground dark:text-primary",
      },
      {
        color:
          "from-muted/40 to-muted/10 border border-border/60 dark:from-primary/30 dark:to-primary/10 dark:border-primary/30",
        iconColor: "text-muted-foreground dark:text-primary",
      },
      {
        color:
          "from-muted/40 to-muted/10 border border-border/60 dark:from-primary/30 dark:to-primary/10 dark:border-primary/30",
        iconColor: "text-muted-foreground dark:text-primary",
      },
      {
        color:
          "from-muted/40 to-muted/10 border border-border/60 dark:from-primary/30 dark:to-primary/10 dark:border-primary/30",
        iconColor: "text-muted-foreground dark:text-primary",
      },
    ];

    const steps = [
      {
        kind: "api" as const,
        icon: Server,
      },
      {
        kind: "prompt" as const,
        icon: MessageSquare,
      },
      {
        kind: "chunk" as const,
        icon: Scissors,
      },
      {
        kind: "parser" as const,
        icon: FileJson,
      },
    ].map((step, index) => ({
      ...step,
      ...(stepTexts[index] || {}),
      ...(stepPalette[index] || {}),
      index: index + 1,
    }));

    const resolvePipelineCardSummary = (
      pipelineId: string,
      fallbackName?: string,
    ) => {
      if (pipelineId === selectedId) {
        return buildPipelineSummary(pipelineComposer, {
          id: pipelineId,
          name: pipelineComposer.name || fallbackName,
        });
      }
      const cached = pipelineSummaryIndex[pipelineId];
      if (cached) return cached;
      return buildPipelineSummary(null, { id: pipelineId, name: fallbackName });
    };

    const pipelineCardItems = filteredProfiles;

    const handleSelectPipelineCard = (pipelineId: string) => {
      guardUnsaved(() => {
        setActivePipelineId(pipelineId);
        setSelectedId(pipelineId);
        setEditorTab("visual");
        setPipelineView("overview");
      });
    };

    const jumpToKind = (targetKind: ProfileKind) => {
      if (kind === targetKind) return;
      guardUnsaved(() => {
        setSelectedId(null);
        commitYamlText("", { baseline: true });
        setSearchTerm("");
        setKind(targetKind);
      });
    };

    const hasPipelines = pipelineCardItems.length > 0;

    return (
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-6 lg:p-10 max-w-[1800px] mx-auto space-y-6">
          <div className="space-y-4">
            {!showPipelineGuide ? (
              /* Compact Header (ModelView Style) */
              <div className="flex items-center justify-between border-b border-border/40 pb-4 animate-in slide-in-from-top-2 fade-in duration-300">
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold tracking-tight flex items-baseline gap-2">
                    {texts.pipelineOverviewTitle}
                    <span className="text-muted-foreground text-sm font-medium opacity-80">
                      {pipelineCardItems.length}
                    </span>
                  </h2>
                </div>
                <Button
                  onClick={() => setPipelineGuideVisibility(true)}
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-muted-foreground hover:text-foreground dark:hover:text-primary transition-colors h-8 px-3 rounded-lg hover:bg-muted/30 dark:hover:bg-primary/10"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">
                    {texts.pipelineOverviewShowGuide}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 transition-transform duration-300" />
                </Button>
              </div>
            ) : (
              /* Hero Header */
              <div className="flex items-center justify-between animate-in slide-in-from-top-2 fade-in duration-300">
                <div className="space-y-1 text-center md:text-left">
                  <h2 className="text-3xl font-bold tracking-tight text-foreground dark:text-primary">
                    {hasPipelines
                      ? texts.pipelineOverviewManageTitle
                      : texts.pipelineEmptyTitle}
                  </h2>
                  <p className="text-muted-foreground text-lg leading-relaxed">
                    {hasPipelines
                      ? texts.pipelineOverviewManageDesc
                      : texts.pipelineEmptyDesc}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPipelineGuideVisibility(!showPipelineGuide)}
                  className="gap-2 text-muted-foreground hover:text-foreground dark:hover:text-primary transition-colors h-9 px-4 rounded-full bg-secondary/30 hover:bg-muted/40 dark:hover:bg-primary/10 border border-transparent hover:border-border/40 dark:hover:border-primary/20"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {texts.pipelineOverviewHideGuide}
                  </span>
                  <ChevronDown className="h-4 w-4 rotate-180 transition-transform duration-300" />
                </Button>
              </div>
            )}

            {/* Guide Steps - Collapsible */}
            <div
              className={cn(
                "grid gap-4 transition-all duration-500 ease-in-out overflow-hidden",
                showPipelineGuide
                  ? "grid-cols-1 md:grid-cols-4 opacity-100 max-h-[500px] mb-8"
                  : "grid-cols-1 md:grid-cols-4 opacity-0 max-h-0 py-0 margin-0",
              )}
            >
              {steps.map((step) => (
                <div
                  key={step.kind}
                  className="relative group overflow-hidden rounded-xl border border-border/50 bg-card hover:bg-muted/30 hover:border-border/70 dark:hover:bg-primary/10 dark:hover:border-primary/30 hover:shadow-md transition-all duration-300 cursor-pointer p-4"
                  onClick={() => jumpToKind(step.kind)}
                >
                  <div className="flex flex-col items-center text-center gap-3">
                    <div className="absolute top-2 right-3 text-[11px] font-bold text-muted-foreground/30 group-hover:text-foreground/60 dark:group-hover:text-primary/60 transition-colors">
                      0{step.index}
                    </div>
                    <div
                      className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-sm group-hover:scale-110 transition-transform duration-500",
                        step.color,
                      )}
                    >
                      <step.icon className={cn("w-6 h-6", step.iconColor)} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-base group-hover:text-foreground dark:group-hover:text-primary transition-colors">
                        {step.title}
                      </h3>
                      <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed px-1">
                        {step.desc}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            {!showPipelineGuide && (
              <div className="hidden" /> /* Spacer or alternative content when compact header is used, if needed */
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-10">
              {/* Existing Pipelines */}
              {pipelineCardItems.map((item) => {
                const isSelected = activePipelineId === item.id;
                const showSummarySkeleton =
                  isPipelineSummaryLoading &&
                  !pipelineSummaryIndex[item.id] &&
                  item.id !== selectedId;
                const summary = resolvePipelineCardSummary(item.id, item.name);
                const providerLabel = summary.provider
                  ? getProfileLabel("api", summary.provider) || summary.provider
                  : "";
                const promptLabel = summary.prompt
                  ? getProfileLabel("prompt", summary.prompt) || summary.prompt
                  : "";
                const parserLabel = summary.parser
                  ? getProfileLabel("parser", summary.parser) || summary.parser
                  : "";
                const strategyLabel = summary.chunkPolicy
                  ? getStrategyLabel(summary.linePolicy, summary.chunkPolicy)
                  : "";
                const pipelineTitle = resolveProfileName(
                  item.id,
                  summary.name || item.name,
                );
                const fields = [
                  {
                    key: "provider",
                    label: texts.scheme.fields.provider,
                    value: providerLabel,
                    icon: Server,
                    skeletonWidth: "w-24",
                  },
                  {
                    key: "prompt",
                    label: texts.scheme.fields.prompt,
                    value: promptLabel,
                    icon: MessageSquare,
                    skeletonWidth: "w-24",
                  },
                  {
                    key: "strategy",
                    label: texts.scheme.fields.strategy,
                    value: strategyLabel,
                    icon: Scissors,
                    skeletonWidth: "w-20",
                  },
                  {
                    key: "parser",
                    label: texts.scheme.fields.parser,
                    value: parserLabel,
                    icon: FileJson,
                    skeletonWidth: "w-20",
                  },
                ];
                const detailGridCols =
                  fields.length > 1 ? "grid-cols-2" : "grid-cols-1";

                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectPipelineCard(item.id)}
                    className={cn(
                      "group relative flex flex-col p-5 rounded-xl border cursor-pointer transition-all duration-300 ease-out select-none min-h-[240px]",
                      isSelected
                        ? "bg-muted/40 border-border/70 shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-primary/15 dark:border-primary/40"
                        : "bg-card border-border/60 hover:border-border/80 hover:shadow-lg hover:-translate-y-0.5",
                    )}
                  >
                    {/* Checkmark */}
                    <div
                      className={cn(
                        "absolute top-4 right-4 transition-all duration-300 z-10",
                        isSelected ? "opacity-100 scale-100" : "opacity-0 scale-90",
                      )}
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase bg-muted-foreground/80 text-background shadow-sm dark:bg-primary dark:text-primary-foreground">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{t.selected}</span>
                      </div>
                    </div>

                    {/* Header */}
                    <div className="flex items-start gap-4 mb-6">
                      <div
                        className={cn(
                          "p-3 rounded-xl shrink-0 transition-colors duration-300",
                          isSelected
                            ? "bg-muted/70 text-foreground shadow-sm dark:bg-primary/30 dark:text-primary-foreground"
                            : "bg-muted/60 text-muted-foreground group-hover:text-foreground group-hover:bg-muted/80 dark:bg-primary/10 dark:text-primary/80 dark:group-hover:bg-primary/20 dark:group-hover:text-primary",
                        )}
                      >
                        <Workflow className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 pr-12">
                        <h3
                          className={cn(
                            "font-bold text-base truncate transition-colors",
                            isSelected
                              ? "text-foreground dark:text-primary-foreground"
                              : "text-foreground",
                          )}
                        >
                          {pipelineTitle}
                        </h3>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className={cn("mt-auto grid gap-3", detailGridCols)}>
                      {fields.map((field) => (
                        <div
                          key={field.key}
                          className="flex flex-col gap-1 p-2.5 rounded-lg bg-secondary/30 border border-border/50 group-hover:border-border/80 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 uppercase font-bold">
                            <field.icon className="w-3 h-3 opacity-70" />
                            {field.label}
                          </div>
                          {showSummarySkeleton ? (
                            <div
                              className={cn(
                                "h-3 rounded bg-muted/50 dark:bg-primary/20 animate-pulse",
                                field.skeletonWidth,
                              )}
                            />
                          ) : (
                            <div
                              className="text-xs font-medium truncate"
                              title={field.value}
                            >
                              {field.value || "-"}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectProfile(item.id, "pipeline");
                        }}
                      >
                        {texts.pipelineCardEdit}
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* Create New Card */}
              <div
                onClick={handleCreate}
                className="group flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed border-border/60 bg-muted/30 hover:border-border/80 hover:bg-muted/40 cursor-pointer transition-all duration-300 min-h-[240px]"
              >
                <div className="w-14 h-14 rounded-full bg-muted/50 border border-border/60 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-inner text-muted-foreground">
                  <Plus className="w-7 h-7" />
                </div>
                <h3 className="font-bold text-lg text-foreground/80">
                  {getNewCardCopy("pipeline").title}
                </h3>
                <p className="text-sm text-muted-foreground/70 mt-1 text-center max-w-[200px]">
                  {getNewCardCopy("pipeline").desc}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderPromptGrid = () => {
    const items = orderProfileIds(
      "prompt",
      profileIndex.prompt.filter((id) => !isHiddenProfile("prompt", id)),
    );

    return (
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-6 lg:p-10 max-w-[1800px] mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 pb-4 animate-in slide-in-from-top-2 fade-in duration-300">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight flex items-baseline gap-2">
                  {texts.kinds.prompt}
                  <span className="text-muted-foreground text-sm font-medium opacity-80">
                    {items.length}
                  </span>
                </h2>
              </div>
              <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-2xl">
                {texts.promptGridDesc}
              </p>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 pb-10">
            {/* Items */}
            {items.map((id) => {
              const rawName = profileMeta.prompt?.[id] || "";
              const name = resolveProfileName(id, rawName);
              const isSelected = selectedId === id;

              return (
                <div
                  key={id}
                  onClick={() => handleSelectProfile(id, "prompt")}
                  className={cn(
                    "group relative flex flex-col justify-between p-6 rounded-2xl border cursor-pointer transition-all duration-300 ease-out select-none min-h-[180px]",
                    isSelected
                      ? "bg-muted/40 border-border/70 shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-primary/15 dark:border-primary/40"
                      : "bg-card border-border/60 hover:border-border/80 hover:shadow-lg hover:-translate-y-1"
                  )}
                >
                  {/* Selected Badge */}
                  <div
                    className={cn(
                      "absolute top-4 right-4 transition-all duration-300 z-10",
                      isSelected
                        ? "opacity-100 scale-100"
                        : "opacity-0 scale-90"
                    )}
                  >
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase bg-muted-foreground/80 text-background shadow-sm dark:bg-primary dark:text-primary-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t.selected}</span>
                    </div>
                  </div>

                  {/* Header / Content */}
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-muted/50 border border-border/60 flex items-center justify-center text-muted-foreground shrink-0 shadow-sm group-hover:scale-105 transition-transform duration-300 dark:bg-primary/20 dark:text-primary dark:border-primary/30">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-lg leading-tight line-clamp-2 text-foreground/90 group-hover:text-foreground dark:group-hover:text-primary transition-colors">
                        {name || texts.untitledProfile}
                      </h3>
                      {/* Optional: Add a tag or type if available in future */}
                    </div>
                  </div>

                  {/* Footer: ID & Action Hint */}
                  <div className="pt-4 mt-2 flex items-end justify-between border-t border-border/30">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground/50 tracking-wider">
                      {id}
                    </span>
                    <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0 dark:text-primary">
                      <span>{texts.profileCardEdit}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Create New Card (Moved to End) */}
            <div
              onClick={handleCreate}
              className="group flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-border/60 bg-muted/30 hover:border-border/80 hover:bg-muted/40 cursor-pointer transition-all duration-300 min-h-[180px]"
            >
              <div className="w-14 h-14 rounded-full bg-muted/50 border border-border/60 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-inner text-muted-foreground">
                <Plus className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-lg text-foreground/80 group-hover:text-foreground transition-colors">
                {getNewCardCopy("prompt").title}
              </h3>
              <p className="text-xs text-muted-foreground/70 mt-1 text-center max-w-[200px]">
                {getNewCardCopy("prompt").desc}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderApiGrid = () => {
    // 1. Get User's Existing API Profiles
    const items = orderProfileIds(
      "api",
      profileIndex.api.filter((id) => !isHiddenProfile("api", id)),
    );

    // 2. Prepare Presets
    // Show top 11 presets + 1 custom = 12 items
    const visiblePresets = API_PRESETS_DATA.slice(0, 11);

    const renderPresetCard = (preset: ApiPreset) => {
      const presetText =
        texts.presets?.[preset.id] ||
        fallbackTexts.presets?.[preset.id] || {
          label: preset.id,
          desc: "",
        };
      const Icon = preset.icon;
      return (
        <Card
          key={preset.id}
          className="cursor-pointer hover:border-border/80 hover:shadow-md hover:-translate-y-0.5 transition-all group h-full min-h-[80px] flex flex-row items-center p-4 bg-card border-border/60 gap-4"
          onClick={() => handlePresetSelect(preset)}
        >
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors",
              "text-muted-foreground/70 dark:text-primary",
              "bg-muted/50 border border-border/60 dark:bg-primary/15 dark:border-primary/30 group-hover:bg-muted/60 dark:group-hover:bg-primary/25"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex flex-col min-w-0 flex-1 text-left">
            <span className="font-semibold text-sm truncate">
              {presetText.label || preset.id}
            </span>
            <span className="text-xs text-muted-foreground truncate opacity-70">
              {presetText.desc}
            </span>
          </div>
        </Card>
      );
    };

    return (
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-6 lg:p-10 max-w-[1800px] mx-auto space-y-12">

          {/* Section 1: My API Interface */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 border-b border-border/40 pb-4">
              <h2 className="text-2xl font-bold tracking-tight">
                {texts.apiGridMyApisTitle}
              </h2>
              <span className="text-muted-foreground text-sm font-medium opacity-80">
                {items.length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {items.map((id) => {
                const rawName = profileMeta.api?.[id] || "";
                const name = resolveProfileName(id, rawName);
                const isSelected = selectedId === id;

                return (
                  <div
                    key={id}
                    onClick={() => handleSelectProfile(id, "api")}
                    className={cn(
                      "group relative flex flex-col justify-between p-6 rounded-2xl border cursor-pointer transition-all duration-300 ease-out select-none min-h-[160px]",
                      isSelected
                        ? "bg-muted/40 border-border/70 shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-primary/15 dark:border-primary/40"
                        : "bg-card border-border/60 hover:border-border/80 hover:shadow-lg hover:-translate-y-1"
                    )}
                  >
                    {/* Selected Badge */}
                    <div
                      className={cn(
                        "absolute top-4 right-4 transition-all duration-300 z-10",
                        isSelected
                          ? "opacity-100 scale-100"
                          : "opacity-0 scale-90"
                      )}
                    >
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase bg-muted-foreground/80 text-background shadow-sm dark:bg-primary dark:text-primary-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t.selected}</span>
                      </div>
                    </div>

                    {/* Header */}
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-muted/50 border border-border/60 flex items-center justify-center text-muted-foreground shrink-0 shadow-sm group-hover:scale-105 transition-transform duration-300 dark:bg-primary/20 dark:text-primary dark:border-primary/30">
                        <Server className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-bold text-lg leading-tight line-clamp-2 text-foreground/90 group-hover:text-foreground dark:group-hover:text-primary transition-colors">
                          {name}
                        </h3>
                        {/* ID Display */}
                        <p className="text-[10px] uppercase font-mono text-muted-foreground/60 tracking-wider">
                          {id.slice(0, 12)}...
                        </p>
                      </div>
                    </div>

                    {/* Footer / Action */}
                    <div className="pt-4 mt-2 flex items-end justify-end border-t border-border/30">
                      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0 dark:text-primary">
                        <span>{texts.profileCardAction}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Empty State for My Models if none */}
              {items.length === 0 && (
                <div className="col-span-full py-10 flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed border-border/50 rounded-2xl bg-muted/20">
                  <Server className="w-10 h-10 mb-3 opacity-20" />
                  <p>{texts.apiGridEmptyTitle}</p>
                  <p className="text-sm opacity-60">
                    {texts.apiGridEmptyDesc}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Presets (Collapsible) */}
          <div className="space-y-6">
            <div
              className="flex items-center justify-between border-b border-border/40 pb-4 cursor-pointer select-none group"
              onClick={() => setPresetsOpen((prev) => !prev)}
            >
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">
                  {texts.apiGridAddTitle}
                </h2>
              </div>
              <div
                className={cn(
                  "p-2 rounded-lg bg-muted/30 group-hover:bg-muted/60 transition-colors",
                  presetsOpen ? "rotate-180" : ""
                )}
              >
                <ChevronDown className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>

            {presetsOpen && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
                {visiblePresets.map((preset) => renderPresetCard(preset))}

                {/* Custom Entry */}
                <Card
                  className="cursor-pointer hover:border-border/80 hover:shadow-md hover:-translate-y-0.5 transition-all border-dashed flex flex-row items-center p-4 min-h-[80px] h-full bg-card border-border/60 hover:bg-muted/30 gap-4"
                  onClick={() => handlePresetSelect(null)}
                >
                  <div className="w-10 h-10 rounded-lg bg-muted/50 border border-border/60 flex items-center justify-center shrink-0 transition-colors text-muted-foreground">
                    <Plus className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-sm">{texts.customCardTitle}</h3>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const templateItems = useMemo(() => {
    if (!TEMPLATE_LIBRARY_ENABLED[kind]) return [];
    const builtInTemplates = TEMPLATE_LIBRARY[kind] || [];
    const customForKind = customTemplates[kind] || [];
    const hiddenSet = new Set(hiddenTemplates[kind] || []);
    const templates = [...builtInTemplates, ...customForKind];
    const visibleTemplates = templates.filter(
      (item) => !hiddenSet.has(item.id) && !isHiddenProfile(kind, item.id)
    );
    return visibleTemplates.map((item) => {
      const meta = getTemplateMeta(item.id, item.meta);
      return {
        id: item.id,
        title: meta?.title || item.id,
        desc: meta?.desc || "",
        group: getTemplateGroupKey(item.id, kind),
        yaml: item.yaml,
        custom: item.custom,
      };
    });
  }, [kind, customTemplates, hiddenTemplates]);

  const handleCreateBlankParser = () => {
    handleCreateByKind("parser");
  };

  const renderStrategyGrid = () => {
    const policyItems = orderProfileIds(
      "policy",
      profileIndex.policy.filter((id) => !isHiddenProfile("policy", id)),
    );
    const chunkItems = orderProfileIds(
      "chunk",
      profileIndex.chunk.filter((id) => !isHiddenProfile("chunk", id)),
    );
    const renderStrategySection = (
      targetKind: "policy" | "chunk",
      items: string[],
      KindIcon: typeof Scissors,
    ) => (
      <div className="space-y-6">
        <div className="flex items-center gap-2 border-b border-border/40 pb-4">
          <h2 className="text-xl font-bold tracking-tight">
            {texts.kinds[targetKind]}
          </h2>
          <span className="text-muted-foreground text-sm font-medium opacity-80">
            {items.length}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {items.map((id) => {
            const rawName = profileMeta[targetKind]?.[id] || "";
            const name = resolveProfileName(id, rawName);
            const isSelected = selectedId === id;

            return (
              <div
                key={id}
                onClick={() => handleSelectProfile(id, targetKind)}
                className={cn(
                  "group relative flex flex-col justify-between p-5 rounded-xl border cursor-pointer transition-all duration-300 ease-out select-none min-h-[140px]",
                  isSelected
                    ? "bg-muted/40 border-border/70 shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-primary/15 dark:border-primary/40"
                    : "bg-card border-border/60 hover:border-border/80 hover:shadow-lg hover:-translate-y-1",
                )}
              >
                {/* Selected Badge */}
                <div
                  className={cn(
                    "absolute top-3 right-3 transition-all duration-300 z-10",
                    isSelected ? "opacity-100 scale-100" : "opacity-0 scale-90",
                  )}
                >
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase bg-muted-foreground/80 text-background shadow-sm dark:bg-primary dark:text-primary-foreground">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{t.selected}</span>
                  </div>
                </div>

                {/* Header */}
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm border group-hover:scale-105 transition-transform duration-300",
                      "bg-muted/50 text-muted-foreground border border-border/60 dark:bg-primary/20 dark:text-primary dark:border-primary/30",
                    )}
                  >
                    <KindIcon className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground/90 group-hover:text-foreground dark:group-hover:text-primary transition-colors">
                      {name || texts.untitledProfile}
                    </h3>
                    <p className="text-[10px] uppercase font-mono text-muted-foreground/60 tracking-wider">
                      {id.slice(0, 12)}
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="pt-3 mt-2 flex items-end justify-end border-t border-border/30">
                  <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0 dark:text-primary">
                    <span>{texts.profileCardAction}</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              </div>
            );
          })}

          {/* New Strategy Card */}
          <div
            onClick={() => handleCreateByKind(targetKind)}
            className="group flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed border-border/60 bg-muted/30 hover:border-border/80 hover:bg-muted/40 cursor-pointer transition-all duration-300 min-h-[140px]"
          >
            <div className="w-12 h-12 rounded-full bg-muted/50 border border-border/60 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-inner text-muted-foreground">
              <Plus className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base text-foreground/80 group-hover:text-foreground transition-colors">
              {getNewCardCopy(targetKind).title}
            </h3>
            <p className="text-[11px] text-muted-foreground/70 mt-1 text-center max-w-[180px]">
              {getNewCardCopy(targetKind).desc}
            </p>
          </div>
        </div>
      </div>
    );

    return (
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-6 lg:p-10 max-w-[1800px] mx-auto space-y-10">

          {/* Header */}
          <div className="space-y-6 animate-in slide-in-from-top-2 fade-in duration-300">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold tracking-tight">
                  {texts.strategyKindTitle}
                </h2>
                <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-2xl">
                  {texts.strategyGridDesc}
                </p>
              </div>
            </div>
          </div>

          {renderStrategySection("policy", policyItems, Scissors)}
          {renderStrategySection("chunk", chunkItems, Activity)}
        </div>
      </div>
    );
  };

  const renderParserGrid = () => {
    // 1. Get User's Existing Parsers + System Defaults (Show ALL)
    const builtInIds = new Set((TEMPLATE_LIBRARY.parser || []).map(t => t.id));
    const CASCADE_ID = "parser_any_default";

    // items = User Parsers + System Parsers (that are not hidden by user preference)
    // We want to SHOW built-in parsers too, so we removed the !builtInIds.has(id) filter
    const items = orderProfileIds("parser", profileIndex.parser).filter((id) => {
      if (id === CASCADE_ID) return true; // Always show Cascade Parser
      return !isHiddenProfile("parser", id);
    });

    // Sort: Cascade first, then by recommended usage order, user profiles last
    const PARSER_ORDER: string[] = [
      CASCADE_ID,               // 级联解析 (always first)
      "parser_json_object",     // JSON 对象解析
      "parser_json_array",      // JSON 数组解析
      "parser_tagged_line",     // 行号标记解析
      "parser_regex_custom",    // 正则提取解析
      "parser_line_strict",     // 行严格解析
      "parser_plain",           // 纯文本解析 (always last among system)
    ];
    items.sort((a, b) => {
      const ai = PARSER_ORDER.indexOf(a);
      const bi = PARSER_ORDER.indexOf(b);
      // Both in the order list: sort by index
      if (ai !== -1 && bi !== -1) return ai - bi;
      // Only one in the list: it goes first
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      // Neither: user profiles, keep original order
      return 0;
    });

    return (
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-6 lg:p-10 max-w-[1800px] mx-auto space-y-10">
          <div className="space-y-6">
            <div className="flex items-start justify-between border-b border-border/40 pb-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                  <span>{texts.kinds.parser}</span>
                  <span className="text-muted-foreground text-sm font-medium opacity-80">
                    {items.length}
                  </span>
                </h2>
                <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-2xl">
                  {texts.parserGridDesc}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowParserRecommend((prev) => !prev)}
                className="text-xs text-muted-foreground hover:text-foreground dark:hover:text-primary"
              >
                {showParserRecommend ? t.common.collapse : t.common.expand}
              </Button>
            </div>

            {showParserRecommend && (
              <div className="rounded-xl border bg-gradient-to-br from-muted/30 via-muted/20 to-transparent dark:from-primary/20 dark:via-primary/10 p-4 flex flex-col md:flex-row items-start md:items-center justify-between relative overflow-hidden group gap-4">
                <div className="relative z-10 max-w-3xl">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground text-[10px] font-bold uppercase tracking-wider dark:bg-primary/20 dark:text-primary">
                      {texts.parserRecommendBadge}
                    </div>
                  </div>
                  <h3 className="text-lg font-bold mb-1">
                    {texts.parserRecommendTitle}
                  </h3>
                  <p className="text-sm text-muted-foreground/80 leading-relaxed">
                    {texts.parserRecommendDesc}
                  </p>
                </div>

                {/* Decorator */}
                <Workflow className="absolute -right-8 -bottom-8 w-40 h-40 text-muted/50 dark:text-primary/10 group-hover:text-muted/60 dark:group-hover:text-primary/20 transition-colors rotate-12 pointer-events-none" />
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {/* User Parsers */}
              {items.map((id) => {
                const rawName = profileMeta.parser?.[id] || "";
                const name = resolveProfileName(id, rawName);
                const isSelected = selectedId === id;
                const isCascade = id === CASCADE_ID;
                const isSystem = builtInIds.has(id);

                return (
                  <div
                    key={id}
                    onClick={() => handleSelectProfile(id, "parser")}
                    className={cn(
                      "group relative flex flex-col justify-between p-5 rounded-xl border cursor-pointer transition-all duration-300 ease-out select-none min-h-[140px]",
                      isSelected
                        ? "bg-muted/40 border-border/70 shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-primary/15 dark:border-primary/40"
                        : "bg-card border-border/60 hover:border-border/80 hover:shadow-lg hover:-translate-y-1",
                      isCascade && !isSelected && "border-border/70"
                    )}
                  >
                    {/* Selected Badge */}
                    <div
                      className={cn(
                        "absolute top-3 right-3 transition-all duration-300 z-10",
                        isSelected
                          ? "opacity-100 scale-100"
                          : "opacity-0 scale-90"
                      )}
                    >
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase bg-muted-foreground/80 text-background shadow-sm dark:bg-primary dark:text-primary-foreground">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{t.selected}</span>
                      </div>
                    </div>

                    {/* Header */}
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm border group-hover:scale-105 transition-transform duration-300",
                        isCascade
                          ? "bg-muted/60 text-foreground border-border/60 shadow-sm dark:bg-primary/25 dark:text-primary-foreground dark:border-primary/30"
                          : "bg-muted/50 text-muted-foreground border-border/60 dark:bg-primary/15 dark:text-primary/80 dark:border-primary/30"
                      )}>
                        {isCascade ? <Workflow className="w-5 h-5" /> : <FileJson className="w-5 h-5" />}
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground/90 group-hover:text-foreground dark:group-hover:text-primary transition-colors">
                          {name}
                        </h3>
                        <p className="text-[10px] uppercase font-mono text-muted-foreground/60 tracking-wider">
                          {isCascade
                            ? texts.parserCardTags.default
                            : isSystem
                              ? texts.parserCardTags.system
                              : id.slice(0, 8)}
                        </p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="pt-3 mt-2 flex items-end justify-end border-t border-border/30">
                      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0 dark:text-primary">
                        <span>{texts.profileCardAction}</span>
                        <ArrowRight className="w-3 h-3" />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* New Parser Card (Moved to End) */}
              <div
                onClick={handleCreateBlankParser}
                className="group flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed border-border/60 bg-muted/30 hover:border-border/80 hover:bg-muted/40 cursor-pointer transition-all duration-300 min-h-[140px]"
              >
                <div className="w-10 h-10 rounded-full bg-muted/50 border border-border/60 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-inner text-muted-foreground">
                  <Plus className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sm text-foreground">
                  {getNewCardCopy("parser").title}
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5 text-center max-w-[150px] opacity-70">
                  {getNewCardCopy("parser").desc}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLoadingState = () => (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-background/50">
      <Loader2 className="h-8 w-8 animate-spin" />
      <span className="mt-3 text-sm">{t.common.loading}</span>
    </div>
  );

  const renderContent = () => {
    // If no kind selected, shouldn't happen but defensive
    if (!kind) return null;

    if (isProfilesLoading || profilesLoadedKind !== kind) {
      if (kind === "pipeline" && pipelineView === "overview") {
        return renderPipelineOverviewSkeleton();
      }
      return renderLoadingState();
    }

    if (kind === "pipeline" && pipelineView === "editor" && !pipelineIndexReady) {
      return renderLoadingState();
    }

    if (kind === "pipeline" && pipelineView === "overview") {
      return renderPipelineOverview();
    }

    if (kind === "prompt" && !selectedId && !yamlText) {
      return renderPromptGrid();
    }

    if (kind === "parser" && !selectedId && !yamlText) {
      return renderParserGrid();
    }

    if (kind === "api" && !selectedId && !yamlText) {
      return renderApiGrid();
    }

    if (isStrategyKind(kind) && !selectedId && !yamlText) {
      return renderStrategyGrid();
    }

    // If no selection and no YAML text (meaning we are not creating/editing ANY profile)
    if (!selectedId && !yamlText) {
      const emptyConfig: Record<ProfileKind, { title: string; desc: string; icon: any }> = {
        prompt: {
          title: texts.kinds.prompt,
          desc: texts.promptSections.templateDesc,
          icon: MessageSquare,
        },
        parser: {
          title: texts.kinds.parser,
          desc: texts.parserFormDesc,
          icon: FileJson,
        },
        policy: {
          title: texts.kinds.policy,
          desc: texts.policySections.modeDesc,
          icon: Activity,
        },
        chunk: {
          title: texts.kinds.chunk,
          desc: texts.chunkSections.modeDesc,
          icon: Scissors,
        },
        api: {
          title: texts.kinds.api,
          desc: texts.formDesc,
          icon: Server,
        },
        pipeline: {
          title: texts.kinds.pipeline,
          desc: texts.pipelineEmptyDesc,
          icon: Workflow,
        },
      };

      const cfg = emptyConfig[kind] || {
        title: texts.emptySelectionTitle,
        desc: texts.emptySelectionDesc,
        icon: Sparkles,
      };

      return renderGenericEmptyState(cfg.title, cfg.desc, cfg.icon);
    }



    return (
      <main className="flex-1 flex flex-col h-full min-h-0 relative bg-background/30 backdrop-blur-3xl">
        {/* Header / Toolbar */}
        <div className="flex-none h-16 px-6 border-b border-border/40 flex items-center justify-between bg-background/40 backdrop-blur-md sticky top-0 z-10 transition-all">
          <div className="flex items-center gap-4">
            {kind === "pipeline" && pipelineView === "editor" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  guardUnsaved(() => {
                    setPipelineView("overview");
                    setSelectedId(null);
                    commitYamlText("", { baseline: true });
                    resetFormState("pipeline");
                  });
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {texts.backToPipelines}
              </Button>
            )}
            {kind === "prompt" && !!selectedId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  guardUnsaved(() => {
                    setSelectedId(null);
                    commitYamlText("", { baseline: true });
                    resetFormState("prompt");
                  });
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {texts.backToList}
              </Button>
            )}
            {kind === "api" && (!!selectedId || !!yamlText) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  guardUnsaved(() => {
                    setSelectedId(null);
                    commitYamlText("", { baseline: true });
                    resetFormState("api");
                    setShowApiSetup(false);
                  });
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {texts.backToList}
              </Button>
            )}
            {kind === "parser" && (!!selectedId || !!yamlText) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  guardUnsaved(() => {
                    setSelectedId(null);
                    commitYamlText("", { baseline: true });
                    resetFormState("parser");
                  });
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {texts.backToList}
              </Button>
            )}
            {isStrategyKind(kind) && (!!selectedId || !!yamlText) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  guardUnsaved(() => {
                    setSelectedId(null);
                    commitYamlText("", { baseline: true });
                    resetFormState(kind);
                  });
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {texts.backToList}
              </Button>
            )}
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {resolveProfileName(selectedId || undefined, activeProfileName)}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Switcher and Actions */}
            <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg border border-border/50">
              <button
                type="button"
                onClick={() => setEditorTab("visual")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  editorTab === "visual"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {texts.editorTabs.visual}
              </button>
              <button
                type="button"
                onClick={() => {
                  flushYamlUpdate();
                  setEditorTab("yaml");
                }}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  editorTab === "yaml"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {texts.editorTabs.yaml}
              </button>
            </div>

            <div className="h-4 w-px bg-border/60 mx-1" />

            <Tooltip content={texts.actionDelete}>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                onClick={handleDelete}
                disabled={!selectedId}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Tooltip>

            <Button
              onClick={handleSave}
              disabled={isSaving}
              className={cn(
                "gap-2 min-w-[100px] shadow-sm hover:shadow-md transition-all active:scale-95",
                lastValidation?.errors.length
                  ? "opacity-90"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {texts.save}
            </Button>
          </div>
        </div>

        {/* Main Scroll Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Validation Banner */}
          {lastValidation && lastValidation.errors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex gap-3 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{texts.validationError}</p>
                <ul className="list-disc list-inside opacity-90">
                  {lastValidation.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {lastValidation && lastValidation.warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex gap-3 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{texts.validationWarn}</p>
                <ul className="list-disc list-inside opacity-90">
                  {lastValidation.warnings.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {editorTab === "visual" && (
            <>
              {kind === "parser" && (
                <FormSection
                  title={texts.parserPreviewTitle}
                  desc={texts.parserPreviewDesc}
                  className="bg-muted/10"
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={runParserPreview}
                      >
                        {texts.parserPreviewRun}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setParserSample("");
                          setParserPreview(null);
                        }}
                      >
                        {texts.parserPreviewClear}
                      </Button>
                    </>
                  }
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{texts.parserPreviewInputLabel}</Label>
                      <textarea
                        spellCheck={false}
                        className="flex min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                        value={parserSample}
                        onChange={(e) => setParserSample(e.target.value)}
                        placeholder={texts.parserPreviewPlaceholder}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{texts.parserPreviewOutputLabel}</Label>
                      <div className="min-h-[180px] rounded-md border border-border/60 bg-muted/20 p-3 text-sm font-mono whitespace-pre-wrap">
                        {parserPreview?.error ? (
                          <span className="text-destructive">
                            {parserPreview.error}
                          </span>
                        ) : parserPreview?.text ? (
                          parserPreview.text
                        ) : (
                          <span className="text-muted-foreground">
                            {texts.previewEmptyValue}
                          </span>
                        )}
                      </div>
                      {parserPreview?.lines &&
                        parserPreview.lines.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {texts.parserPreviewLineCount.replace(
                              "{count}",
                              String(parserPreview.lines.length),
                            )}
                          </div>
                        )}
                      {parserPreview?.lines &&
                        parserPreview.lines.length > 0 && (
                          <div className="mt-3">
                            <div className="text-xs text-muted-foreground mb-2">
                              {texts.parserPreviewLinesTitle}
                            </div>
                            <div className="max-h-40 overflow-y-auto rounded-md border border-border/60 bg-background/60">
                              {parserPreview.lines.map((line, index) => (
                                <div
                                  key={`${index}-${line}`}
                                  className="px-3 py-2 border-b border-border/40 last:border-b-0"
                                >
                                  <div className="text-[10px] text-muted-foreground mb-1">
                                    {texts.parserPreviewLineIndex.replace(
                                      "{index}",
                                      String(index + 1),
                                    )}
                                  </div>
                                  <div className="text-xs font-mono whitespace-pre-wrap">
                                    {line === ""
                                      ? texts.previewEmptyValue
                                      : line}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                </FormSection>
              )}

              {renderVisualEditorResult()}

              {TEMPLATE_LIBRARY_ENABLED[kind] && (
                <FormSection
                  title={texts.templates.title}
                  desc={texts.templates.desc}
                  className="bg-muted/10"
                  actions={
                    <Button
                      size="sm"
                      onClick={() => setTemplateSelectorOpen(true)}
                    >
                      {texts.templatesOpen}
                    </Button>
                  }
                />
              )}
            </>
          )}
          {editorTab === "yaml" && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">
                {texts.sectionYamlTitle}
              </h3>
              <div className="relative rounded-xl border bg-muted/30 overflow-hidden font-mono text-sm">
                <textarea
                  spellCheck={false}
                  className="w-full h-[360px] bg-transparent p-4 resize-y focus:outline-none"
                  value={yamlText}
                  onChange={(e) => {
                    clearPendingYamlUpdate();
                    setYamlText(e.target.value);
                    markUserEdits();
                  }}
                />
                <div className="absolute top-2 right-2 text-[10px] text-muted-foreground border rounded px-1.5 bg-background/50">
                  {texts.editorYamlBadge}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 opacity-70">
                {texts.editorHint}
              </p>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleSyncFromYaml}
                >
                  <RefreshCw className="h-4 w-4" />
                  {texts.syncFromYaml}
                </Button>
              </div>
            </section>
          )}
          <div className="h-10" /> {/* Spacer */}
        </div>
      </main>
    );
  };

  return (
    <>
      <div className="flex h-full w-full min-h-0 bg-background/95 backdrop-blur-3xl overflow-hidden">
        {renderNavigationRail()}
        {kind !== "pipeline" && kind !== "prompt" && kind !== "api" && kind !== "parser" && !isStrategyKind(kind) && renderSidePanel()}
        {renderContent()}
        <TemplateSelector
          open={templateSelectorOpen}
          onOpenChange={setTemplateSelectorOpen}
          items={templateItems}
          groupOrder={["line", "json", "tagged", "regex", "general"]}
          onSelect={(item) => handleApplyTemplate(item.yaml, item.id)}
          strings={{
            title: texts.templates.title,
            searchPlaceholder: texts.templatesSearchPlaceholder,
            empty: texts.templatesSearchEmpty,
            close: texts.templatesClose,
            customBadge: texts.customTag,
            groups: texts.templateGroups ?? {},
            footerHint: texts.templatesFooterHint,
            manageShow: texts.templatesManageShow,
            manageHide: texts.templatesManageHide,
          }}
          managerOpen={templateManagerOpen}
          onToggleManager={() => setTemplateManagerOpen((prev) => !prev)}
          managerContent={
            (() => {
              // Determine templates for manager view
              const builtInTemplates = TEMPLATE_LIBRARY[kind] || [];
              const customForKind = customTemplates[kind] || [];
              const hiddenSet = new Set(hiddenTemplates[kind] || []);
              const templates = [...builtInTemplates, ...customForKind];

              return (
                <>
                  <div className="text-xs text-muted-foreground">
                    {texts.templatesManageDesc}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {templates.map((item) => {
                      const meta = getTemplateMeta(
                        item.id,
                        item.meta,
                      );
                      const hidden = hiddenSet.has(item.id);
                      return (
                        <label
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!hidden}
                              onChange={() =>
                                toggleTemplateHidden(item.id)
                              }
                            />
                            <span>
                              {meta?.title || item.id}
                              {item.custom
                                ? ` (${texts.customTag})`
                                : ""}
                            </span>
                          </div>
                          {item.custom && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleRemoveCustomTemplate(item.id)
                              }
                            >
                              {texts.templatesRemove}
                            </Button>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium">
                      {texts.templateSaveTitle}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label>{texts.templateSaveNameLabel}</Label>
                        <Input
                          value={templateDraftName}
                          onChange={(e) =>
                            setTemplateDraftName(e.target.value)
                          }
                          placeholder={
                            texts.templateSaveNamePlaceholder
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>{texts.templateSaveDescLabel}</Label>
                        <Input
                          value={templateDraftDesc}
                          onChange={(e) =>
                            setTemplateDraftDesc(e.target.value)
                          }
                          placeholder={
                            texts.templateSaveDescPlaceholder
                          }
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveCustomTemplate}
                      >
                        {texts.templateSaveAction}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {texts.templateSaveHint}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()
          }
        />
      </div>
      <AlertModal {...alertProps} />
    </>
  );
}

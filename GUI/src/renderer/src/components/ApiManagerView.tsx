import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import yaml from "js-yaml";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import {
  Button,
  Input as BaseInput,
  Label,
  Tooltip,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
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
  Code2,
  Zap,
  Cpu,
  Gauge,
  Clock,
  Thermometer,
  Percent,
  Hash,
  Repeat,
  BookOpen,
  Scissors,
} from "lucide-react";
import { cn } from "../lib/utils";
import { createUniqueProfileId, slugifyProfileId } from "../lib/profileId";
import { isParserProfileBlank } from "../lib/parserProfile";
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

type KeyValuePair = { key: string; value: string };

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
        value: String(value),
      }));
    }
  } catch { }
  return [createEmptyPair()];
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
  members: string;
  poolEndpoints: PoolEndpointForm[];
  strategy: "round_robin" | "random";
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

type PipelineComposerState = {
  id: string;
  name: string;
  provider: string;
  prompt: string;
  parser: string;
  translationMode: "line" | "block";
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
  chunkType: "line" | "legacy";
  lineStrict: boolean;
  keepEmpty: boolean;
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
  ]),
};

const DEFAULT_TAGGED_PATTERN = "^@@(?P<id>\\d+)@@(?P<text>.*)$";
const DEFAULT_POLICY_ID = "line_tolerant";
const DEFAULT_CHUNK_ID = "chunk_legacy_doc";
const DEFAULT_LINE_CHUNK_ID = "chunk_line_default";
const HIDE_ALL_PROFILE_IDS = false;
const HIDE_PROFILE_ID_DISPLAY = new Set([DEFAULT_POLICY_ID, DEFAULT_CHUNK_ID, DEFAULT_LINE_CHUNK_ID]);

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
  pipeline_default: ["Default API Scheme", "Default API Pipeline"],
  prompt_default: ["Default Prompt"],
  prompt_tagged_line: ["Tagged Line Prompt"],
  prompt_plain_line: ["Plain Line Prompt"],
  prompt_block_plain: ["Block Prompt", "Block Plain Prompt"],
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
  chunk_legacy_doc: ["默认分块策略", "Default Block Strategy", "Default Chunk Strategy", "Default Doc Chunk"],
  chunk_line_default: ["默认分行策略", "Default Line Strategy", "Default Line Chunk"],
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
line_policy: ""
chunk_policy: ""
apply_line_policy: false
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
chunk_type: legacy
options:
  mode: doc
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
  members: "",
  poolEndpoints: [createPoolEndpoint()],
  strategy: "round_robin",
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
  translationMode: "line",
  linePolicy: "",
  chunkPolicy: "",
  temperature: "0.7",
  maxRetries: "",
  concurrency: "1",
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
  chunkType: "legacy",
  lineStrict: true,
  keepEmpty: true,
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
type TemplateId =
  keyof (typeof translations)["zh"]["apiManager"]["templateItems"];

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
    color: "text-sky-500",
    supportsModelList: true,
  },
  {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    icon: OpenAIFaviconIcon,
    color: "text-green-500",
    supportsModelList: true,
  },
  {
    id: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    icon: AnthropicFaviconIcon,
    color: "text-orange-500",
  },
  {
    id: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    icon: DeepSeekIcon,
    color: "text-blue-500",
    supportsModelList: true,
  },
  {
    id: "grok",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4",
    icon: GrokFaviconIcon,
    color: "text-rose-500",
    supportsModelList: true,
  },
  {
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
    icon: MistralIcon,
    color: "text-slate-600",
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
    color: "text-amber-500",
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
    color: "text-indigo-500",
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
    color: "text-emerald-500",
    supportsModelList: true,
  },
  {
    id: "silicon",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    icon: SiliconFlowIcon,
    color: "text-purple-500",
    supportsModelList: true,
  },
  {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    icon: OpenRouterIcon,
    color: "text-indigo-500",
    supportsModelList: true,
  },
];

const TEMPLATE_LIBRARY: Record<ProfileKind, TemplateEntry[]> = {
  api: [],
  pipeline: [
    {
      id: "pipeline_default",
      yaml: `id: pipeline_default
name: Default API Scheme
provider: ""
prompt: ""
parser: ""
line_policy: ""
chunk_policy: ""
apply_line_policy: false
settings:
  temperature: 0.3
  max_retries: 2`,
    },
  ],
  prompt: [
    {
      id: "prompt_plain_line",
      yaml: `id: prompt_plain_line
name: Plain Line Prompt
system_template: |
  You are a professional translator.
  Translate each line independently.
user_template: |
  {{source}}
context:
  before_lines: 0
  after_lines: 0
  joiner: "\\n"`,
    },
    {
      id: "prompt_block_plain",
      yaml: `id: prompt_block_plain
name: Block Prompt
system_template: |
  You are a professional translator.
  Translate the paragraph as a whole.
user_template: |
  Glossary:{{glossary}}
  Context (no translate):{{context_before}}
  Please translate:
  {{source}}
  Context (no translate):{{context_after}}
context:
  before_lines: 3
  after_lines: 0
  joiner: "\\n"
  source_format: plain`,
    },
    {
      id: "prompt_json_object",
      yaml: `id: prompt_json_object
name: JSON Object Prompt
system_template: |
  You are a professional translator.
  Return JSON with key "translation".
user_template: |
  {{source}}
context:
  before_lines: 0
  after_lines: 0
  joiner: "\\n"`,
    },
    {
      id: "prompt_json_array",
      yaml: `id: prompt_json_array
name: JSON Array Prompt
system_template: |
  You are a professional translator.
  Return a JSON array of translated lines.
user_template: |
  {{source}}
context:
  before_lines: 0
  after_lines: 0
  joiner: "\\n"`,
    },
    {
      id: "prompt_jsonl_line",
      yaml: `id: prompt_jsonl_line
name: JSONL Line Prompt
system_template: |
  Return JSONL. Each line: {\"line\": <line_number>, \"translation\": \"...\"}.
user_template: |
  {{source}}
context:
  before_lines: 0
  after_lines: 0
  joiner: "\\n"`,
    },
    {
      id: "prompt_glossary_focus",
      yaml: `id: prompt_glossary_focus
name: Glossary Focus Prompt
system_template: |
  You are a professional translator.
  Keep terminology consistent with the glossary.
  Output only translated text.
  Prefer glossary terms when provided.
user_template: |
  {{glossary}}
  {{source}}
context:
  before_lines: 0
  after_lines: 0
  joiner: "\\n"`,
    },
  ],
  parser: [
    {
      id: "parser_jsonl_object",
      yaml: `id: parser_jsonl_object
name: JSONL 多行解析
type: jsonl
options:
  path: translation`,
    },
    {
      id: "parser_plain",
      yaml: `id: parser_plain
name: Plain Text Parser
type: plain`,
    },
    {
      id: "parser_any_default",
      yaml: `id: parser_any_default
name: 多解析级联（JSONL优先）
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
name: Custom Regex Parser
type: regex
options:
  pattern: "(?s)TRANSLATION:\\\\s*(?P<content>.*)$"
  group: content
  flags:
    - dotall`,
    },
  ],
  policy: [
    {
      id: "policy_tolerant",
      yaml: `id: line_tolerant
name: 默认分行策略
type: strict
options:
  on_mismatch: retry
  trim: true
  similarity_threshold: 0.8
  checks:
    - similarity`,
    },
  ],
  chunk: [
    {
      id: "chunk_line_default",
      yaml: `id: chunk_line_default
name: 默认分行策略
chunk_type: line
options:
  strict: false
  keep_empty: false`,
    },
    {
      id: "chunk_legacy_doc",
      yaml: `id: chunk_legacy_doc
name: 默认分块策略
chunk_type: legacy
options:
  mode: doc
  target_chars: 1200
  max_chars: 2000`,
    },
  ],
};

const TEMPLATE_CORE_IDS: Record<ProfileKind, TemplateId[]> = {
  api: [],
  pipeline: ["pipeline_default"],
  prompt: ["prompt_plain_line", "prompt_block_plain"],
  parser: [
    "parser_jsonl_object",
    "parser_plain",
    "parser_any_default",
    "parser_regex_custom",
  ],
  policy: ["policy_tolerant"],
  chunk: ["chunk_line_default", "chunk_legacy_doc"],
};

// --- Validation Logic ---

type ValidationResult = { errors: string[]; warnings: string[] };

type ParserPreviewResult = {
  text: string;
  lines: string[];
  error?: string;
};

const splitLinesKeepEmpty = (text: string) => {
  if (text === "") return [""];
  return text.split("\\n");
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
  return new RegExp(pattern, flags);
};

const formatErrorCode = (code: string, texts: any) => {
  if (code === "invalid_yaml") return texts.validationInvalidYaml;
  if (code === "missing_id") return texts.missingId;
  if (code.startsWith("missing_field:")) {
    const field = code.split(":")[1] || "";
    return texts.validationMissingField.replace("{field}", field);
  }
  if (code === "missing_base_url") return texts.validationMissingBaseUrl;
  if (code === "missing_model") return texts.validationMissingModel;
  if (code === "missing_members") return texts.validationMissingMembers;
  if (code === "missing_pool_endpoints")
    return texts.validationMissingPoolEndpoints;
  if (code === "missing_pool_model") return texts.validationMissingPoolModel;
  if (code === "missing_pattern") return texts.validationMissingPattern;
  if (code === "missing_json_path") return texts.validationMissingJsonPath;
  if (code === "missing_any_parsers") return texts.validationMissingParsers;
  if (code === "invalid_concurrency") return texts.validationInvalidConcurrency;
  if (code === "invalid_rpm") return texts.validationInvalidRpm;
  if (code === "concurrency_test_auth")
    return texts.concurrencyAutoTestAuth;
  if (code === "concurrency_test_rate_limited")
    return texts.concurrencyAutoTestRateLimited;
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

const validateProfile = (
  kind: ProfileKind,
  data: any,
  index: Record<ProfileKind, string[]>,
  texts: any,
  chunkTypes: Record<string, string>,
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
  const inferChunkTypeForValidation = (ref: string) => {
    if (!ref) return "";
    const known = chunkTypes[ref];
    if (known) return known;
    const normalized = ref.toLowerCase();
    if (normalized.includes("line")) return "line";
    if (normalized.includes("legacy") || normalized.includes("doc"))
      return "legacy";
    return "";
  };

  if (!data || typeof data !== "object") {
    errors.push(texts.validationInvalidYaml);
    return { errors, warnings };
  }
  if (!data.id) {
    errors.push(texts.missingId);
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
      const hasMembers = Array.isArray(data.members) && data.members.length > 0;
      if (!hasEndpoints && !hasMembers) {
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
        const missing = data.members.filter(
          (member: string) => !index.api.includes(String(member)),
        );
        missing.forEach((member: string) => {
          errors.push(unknownRef("api", String(member)));
        });
      }
      if (
        data.strategy &&
        !["round_robin", "random"].includes(String(data.strategy))
      ) {
        warnings.push(invalidType(String(data.strategy)));
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
    if (parserType === "any") {
      const parsers = data.options?.parsers || data.options?.candidates;
      if (!Array.isArray(parsers) || parsers.length === 0) {
        errors.push(texts.validationMissingParsers);
      }
    }
  }

  if (kind === "policy") {
    const policyType = String(data.type || "");
    if (!policyType) errors.push(missingField("type"));
    if (policyType && !["strict", "tolerant"].includes(policyType)) {
      warnings.push(invalidType(policyType));
    }
  }

  if (kind === "chunk") {
    const chunkType = String(data.chunk_type || data.type || "");
    if (!chunkType) errors.push(missingField("chunk_type"));
    if (chunkType && !["legacy", "line"].includes(chunkType)) {
      warnings.push(invalidType(chunkType));
    }
  }

  if (kind === "pipeline") {
    const required = ["provider", "prompt", "parser", "chunk_policy"];
    required.forEach((field) => {
      if (!data[field])
        errors.push(texts.validationMissingPipeline.replace("{field}", field));
    });
    if (data.apply_line_policy && !data.line_policy) {
      errors.push(
        texts.validationMissingPipeline.replace("{field}", "line_policy"),
      );
    }
    if (data.settings && data.settings.concurrency !== undefined) {
      const raw = Number.parseInt(String(data.settings.concurrency), 10);
      if (!Number.isFinite(raw) || raw < 0) {
        errors.push(texts.validationInvalidConcurrency);
      }
    }
    const chunkMode = inferChunkTypeForValidation(
      String(data.chunk_policy || ""),
    );
    if (data.apply_line_policy && chunkMode === "legacy") {
      errors.push(texts.validationLinePolicyRequiresLineChunk);
    }
    if (chunkMode === "line" && !data.line_policy) {
      errors.push(texts.validationLineChunkNoPolicy);
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

  return { errors, warnings };
};

interface ApiManagerViewProps {
  lang: Language;
}

export function ApiManagerView({ lang }: ApiManagerViewProps) {
  const t = translations[lang];
  const texts = t.apiManager;
  const presetTexts = translations.zh.apiManager;
  const { alertProps, showConfirm } = useAlertModal();

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

  const getKindIcon = (targetKind: ProfileKind) => {
    switch (targetKind) {
      case "api": return Server;
      case "pipeline": return Workflow;
      case "prompt": return MessageSquare;
      case "parser": return FileJson;
      case "policy": return BookOpen;
      case "chunk": return Scissors;
      default: return null;
    }
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

  const persistJson = (key: string, value: unknown) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  };

  const getPresetLabel = (preset: ApiPreset) =>
    presetTexts.presets?.[preset.id]?.label ||
    texts.presets?.[preset.id]?.label ||
    preset.id;

  const getTemplateMeta = (
    templateId: string,
    fallback?: { title?: string; desc?: string },
  ) => {
    const map: Record<string, { title?: string; desc?: string }> | undefined =
      (presetTexts.templateItems as
        | Record<string, { title?: string; desc?: string }>
        | undefined) ??
      (texts.templateItems as
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
      const presetNames = presetTexts.profileNames as
        | Record<string, string>
        | undefined;
      const textNames = texts.profileNames as
        | Record<string, string>
        | undefined;
      const localized = presetNames?.[id] || textNames?.[id];
      const isAliasMatch = aliases.some(
        (alias) => alias.toLowerCase() === trimmed.toLowerCase(),
      );
      if (localized && (!trimmed || isAliasMatch)) return localized;
      return trimmed || id;
    },
    [presetTexts, texts],
  );

  const createParserRuleId = () =>
    `parser_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const createParserRule = (type: ParserRuleType) =>
    createParserRuleTemplate(type, createParserRuleId());

  const getPresetChannelText = (preset: ApiPreset, channelId: string) => {
    const presetText = (presetTexts.presets?.[preset.id] ||
      texts.presets?.[preset.id]) as
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
  const [apiRuntimeIndex, setApiRuntimeIndex] = useState<
    Record<string, { timeout?: number; concurrency?: number }>
  >({});
  const [chunkTypeIndex, setChunkTypeIndex] = useState<
    Record<string, "line" | "legacy" | "">
  >({});
  const [showApiSetup, setShowApiSetup] = useState(false);
  const showIdField: Record<ProfileKind, boolean> = {
    api: false,
    pipeline: false,
    prompt: false,
    parser: false,
    policy: false,
    chunk: false,
  };
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
  const [presetExpanded, setPresetExpanded] = useState(false);
  const [activePresetId, setActivePresetId] = useState<PresetId | null>(null);
  const [activePresetChannel, setActivePresetChannel] = useState("");
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelListError, setModelListError] = useState("");
  const [modelListRequested, setModelListRequested] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    id: string;
    kind: ProfileKind;
  } | null>(null);
  const visiblePipelineIds = useMemo(
    () =>
      profileIndex.pipeline.filter(
        (id) => !isHiddenProfile("pipeline", id),
      ),
    [profileIndex.pipeline, isHiddenProfile],
  );

  // Interaction states
  const [searchTerm, setSearchTerm] = useState("");

  // Operation states
  const [apiForm, setApiForm] = useState<ApiFormState>(DEFAULT_API_FORM);
  const [headerPairs, setHeaderPairs] = useState<KeyValuePair[]>(() =>
    parseKeyValuePairs(DEFAULT_API_FORM.headers),
  );
  const [paramPairs, setParamPairs] = useState<KeyValuePair[]>(() =>
    parseKeyValuePairs(DEFAULT_API_FORM.params),
  );
  const [pipelineComposer, setPipelineComposer] =
    useState<PipelineComposerState>(DEFAULT_PIPELINE_COMPOSER);
  const [promptForm, setPromptForm] =
    useState<PromptFormState>(DEFAULT_PROMPT_FORM);
  const [promptPreview, setPromptPreview] = useState<PromptPreviewState>(
    DEFAULT_PROMPT_PREVIEW,
  );
  const [glossaryFiles, setGlossaryFiles] = useState<string[]>([]);
  const [glossarySelected, setGlossarySelected] = useState("");
  const [glossaryLoadError, setGlossaryLoadError] = useState("");
  const [glossaryLoading, setGlossaryLoading] = useState(false);
  const [parserForm, setParserForm] = useState<ParserFormState>(() => ({
    id: "",
    name: "",
    mode: "single",
    rules: [createParserRule("plain")],
  }));
  const [policyForm, setPolicyForm] =
    useState<PolicyFormState>(DEFAULT_POLICY_FORM);
  const [chunkForm, setChunkForm] =
    useState<ChunkFormState>(DEFAULT_CHUNK_FORM);
  const [apiTest, setApiTest] = useState<ApiTestState>({ status: "idle" });
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
  const loadDetailSeq = useRef(0);

  useEffect(() => {
    persistJson(TEMPLATE_CUSTOM_KEY, customTemplates);
  }, [customTemplates]);

  useEffect(() => {
    persistJson(TEMPLATE_HIDDEN_KEY, hiddenTemplates);
  }, [hiddenTemplates]);

  useEffect(() => {
    setApiTest({ status: "idle" });
  }, [apiForm.baseUrl, apiForm.apiKey, apiForm.timeout, apiForm.apiType]);

  useEffect(() => {
    persistJson(ACTIVE_PIPELINE_KEY, activePipelineId);
  }, [activePipelineId]);

  useEffect(() => {
    if (!visiblePipelineIds.length) return;
    if (!activePipelineId || !visiblePipelineIds.includes(activePipelineId)) {
      setActivePipelineId(visiblePipelineIds[0]);
    }
  }, [visiblePipelineIds, activePipelineId]);

  useEffect(() => {
    if (
      kind === "pipeline" &&
      activePipelineId &&
      !selectedId &&
      !yamlText.trim()
    ) {
      setSelectedId(activePipelineId);
    }
  }, [kind, activePipelineId, selectedId, yamlText]);

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
      (presetTexts.profileNames as Record<string, string> | undefined) ||
      (texts.profileNames as Record<string, string> | undefined);
    const templateItemMap =
      (presetTexts.templateItems as
        | Record<string, { title?: string }>
        | undefined) ||
      (texts.templateItems as
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
    if (!searchTerm) return visibleProfiles;
    const lower = searchTerm.toLowerCase();
    return visibleProfiles.filter(
      (p) =>
        resolveProfileName(p.id, p.name).toLowerCase().includes(lower) ||
        p.id.toLowerCase().includes(lower),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveProfileName only depends on texts (in deps) and presetTexts (constant)
  }, [visibleProfiles, searchTerm, texts]);

  const getProfileLabel = (targetKind: ProfileKind, id?: string) => {
    if (!id) return "";
    const name = profileMeta[targetKind]?.[id];
    return resolveProfileName(id, name);
  };

  const formatOptionLabel = (targetKind: ProfileKind, id: string) => {
    const label = getProfileLabel(targetKind, id);
    return label || texts.untitledProfile;
  };

  const getExistingIds = (targetKind: ProfileKind) =>
    profileIndex[targetKind]?.length
      ? profileIndex[targetKind]
      : profiles.map((item) => item.id);

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

  const normalizePresetUrl = (value: string) =>
    value.trim().replace(/\/+$/, "");

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

  const loadChunkTypeIndex = async (
    chunkIds: string[],
    requestId?: number,
  ) => {
    if (!chunkIds.length) {
      if (!requestId || requestId === loadProfilesSeq.current) {
        setChunkTypeIndex({});
      }
      return;
    }
    try {
      const entries = await Promise.all(
        chunkIds.map(async (id) => {
          try {
            const result = await window.api?.pipelineV2ProfilesLoad?.(
              "chunk",
              id,
            );
            const data =
              result?.data ??
              (result?.yaml ? (yaml.load(result.yaml) as any) : null);
            const raw = String(data?.chunk_type || data?.type || "");
            const normalized = raw === "line" || raw === "legacy" ? raw : "";
            return [id, normalized] as const;
          } catch {
            return [id, ""] as const;
          }
        }),
      );
      if (!requestId || requestId === loadProfilesSeq.current) {
        setChunkTypeIndex(Object.fromEntries(entries));
      }
    } catch {
      if (!requestId || requestId === loadProfilesSeq.current) {
        setChunkTypeIndex({});
      }
    }
  };

  const loadApiRuntimeIndex = async (apiIds: string[], requestId?: number) => {
    if (!apiIds.length) {
      if (!requestId || requestId === loadProfilesSeq.current) {
        setApiRuntimeIndex({});
      }
      return;
    }
    try {
      const entries = await Promise.all(
        apiIds.map(async (id) => {
          try {
            const result = await window.api?.pipelineV2ProfilesLoad?.("api", id);
            const data =
              result?.data ??
              (result?.yaml ? (yaml.load(result.yaml) as any) : null);
            const timeoutRaw = data?.timeout;
            const concurrencyRaw = data?.concurrency;
            const entry: { timeout?: number; concurrency?: number } = {};
            if (timeoutRaw !== undefined && timeoutRaw !== null) {
              const parsed = Number.parseInt(String(timeoutRaw), 10);
              if (Number.isFinite(parsed)) entry.timeout = parsed;
            }
            if (concurrencyRaw !== undefined && concurrencyRaw !== null) {
              const parsed = Number.parseInt(String(concurrencyRaw), 10);
              if (Number.isFinite(parsed)) entry.concurrency = parsed;
            }
            return [id, entry] as const;
          } catch {
            return [id, {} as { timeout?: number; concurrency?: number }] as const;
          }
        }),
      );
      if (!requestId || requestId === loadProfilesSeq.current) {
        setApiRuntimeIndex(Object.fromEntries(entries));
      }
    } catch {
      if (!requestId || requestId === loadProfilesSeq.current) {
        setApiRuntimeIndex({});
      }
    }
  };

  const loadProfileIndex = async (requestId?: number) => {
    const nextIndex: Record<ProfileKind, string[]> = {
      api: [],
      pipeline: [],
      prompt: [],
      parser: [],
      policy: [],
      chunk: [],
    };
    const nextMeta: Record<ProfileKind, Record<string, string>> = {
      api: {},
      pipeline: {},
      prompt: {},
      parser: {},
      policy: {},
      chunk: {},
    };
    try {
      for (const targetKind of PROFILE_KINDS) {
        const list = await window.api?.pipelineV2ProfilesList?.(targetKind);
        if (Array.isArray(list)) {
          nextIndex[targetKind] = list.map((item) => item.id);
          nextMeta[targetKind] = Object.fromEntries(
            list.map((item) => [
              item.id,
              normalizeDefaultProfileName(item.id, item.name || item.id),
            ]),
          );
        }
      }
    } catch {
      // ignore
    }
    if (!requestId || requestId === loadProfilesSeq.current) {
      setProfileIndex(nextIndex);
      setProfileMeta(nextMeta);
    }
    await loadChunkTypeIndex(nextIndex.chunk, requestId);
    await loadApiRuntimeIndex(nextIndex.api, requestId);
  };

  // Load profiles
  const loadProfiles = async () => {
    const requestId = ++loadProfilesSeq.current;
    try {
      if (isStrategyKind(kind)) {
        const [policyList, chunkList] = await Promise.all([
          window.api?.pipelineV2ProfilesList?.("policy"),
          window.api?.pipelineV2ProfilesList?.("chunk"),
        ]);
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
      await loadProfileIndex(requestId);
    } catch (e) {
      console.error("Failed to load profiles:", e);
      if (requestId === loadProfilesSeq.current) {
        setProfiles([]);
      }
    }
  };

  useEffect(() => {
    loadProfiles();
    setEditorTab("visual");
    setPromptPreview(DEFAULT_PROMPT_PREVIEW);
    setPresetExpanded(false);
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
    if (kind === "policy" || kind === "chunk") {
      setStrategyKind(kind);
    }
    if (pendingSelection && pendingSelection.kind === kind) {
      setSelectedId(pendingSelection.id);
      setPendingSelection(null);
    } else {
      setSelectedId(null);
      setYamlText("");
    }
  }, [kind]);

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
        setYamlText(result.yaml || "");
        const data = result.data ?? (yaml.load(result.yaml) as any);
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
  }, [apiForm.baseUrl, apiForm.apiType, kind]);

  useEffect(() => {
    if (kind !== "prompt") return;
    refreshGlossaryFiles();
  }, [kind]);

  // Validation
  const parsedResult = useMemo(() => {
    if (!yamlText.trim()) return { data: null, error: "" };
    try {
      const data = yaml.load(yamlText) as any;
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
  }, [yamlText, texts.validationInvalidYaml]);

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
    if (!yamlText.trim()) {
      emitToast({
        title: texts.syncFromYaml,
        description: texts.emptyYaml,
        variant: "warning",
      });
      return;
    }
    if (!parsedResult.data) {
      emitToast({
        title: texts.syncFromYaml,
        description: parsedResult.error || texts.validationInvalidYaml,
        variant: "error",
      });
      return;
    }
    syncFormsFromData(kind, parsedResult.data);
    setAutoIdEnabled((prev) => ({ ...prev, [kind]: false }));
    setEditorTab("visual");
  };

  const handleSave = async () => {
    if (!yamlText.trim()) {
      emitToast({
        title: texts.saveFail,
        description: texts.emptyYaml,
        variant: "error",
      });
      if (kind === "api") setShowApiSetup(true);
      return;
    }
    if (!parsedResult.data) {
      emitToast({
        title: texts.saveFail,
        description: parsedResult.error || texts.validationInvalidYaml,
        variant: "error",
      });
      if (kind === "api") setShowApiSetup(true);
      return;
    }
    const localValidation = validateProfile(
      kind,
      parsedResult.data,
      profileIndex,
      texts,
      chunkTypeIndex,
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
    const saveId = parsedResult.data?.id || selectedId;
    if (!saveId) {
      emitToast({
        title: texts.saveFail,
        description: texts.missingId,
        variant: "error",
      });
      if (kind === "api") setShowApiSetup(true);
      return;
    }

    try {
      const result = await window.api?.pipelineV2ProfilesSave?.(
        kind,
        saveId,
        yamlText,
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
        await loadProfiles();
        setSelectedId(saveId);
        if (kind === "api" && pendingPipelineLink) {
          await updateActivePipelineProvider(saveId);
          setPendingPipelineLink(false);
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
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
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
            setSelectedId(null);
            setYamlText("");
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

  const handleCreate = () => {
    setAutoIdEnabled((prev) => ({ ...prev, [kind]: true }));
    setSelectedId(null);
    setEditorTab("visual");
    if (kind === "api") setShowApiSetup(false);
    if (kind === "api") {
      handlePresetSelect(null);
      return;
    }
    // For non-API kinds, pre-fill template immediately
    setYamlText("");
    const template = DEFAULT_TEMPLATES[kind];
    const localizedYaml = localizeTemplateName(template, texts.untitledProfile);
    const nextYaml = ensureUniqueTemplateId(localizedYaml, kind);
    setYamlText(nextYaml);
    syncFormsFromYaml(nextYaml);
  };

  const handleSelectProfile = (
    id: string,
    targetKind: ProfileKind = kind,
  ) => {
    if (targetKind !== kind) {
      setPendingSelection({ id, kind: targetKind });
      setSelectedId(id);
      setYamlText("");
      setEditorTab("visual");
      setKind(targetKind);
      setSearchTerm("");
      return;
    }
    setSelectedId(id);
    setEditorTab("visual");
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
    setApiTest({ status: "testing" });
    try {
      const result = await window.api?.pipelineV2ApiTest?.({
        baseUrl,
        apiKey,
        timeoutMs,
        model: apiForm.model.trim(),
      });
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
      setApiTest({ status: "error", message: String(e) });
    }
  };

  const handleFetchModelList = async () => {
    if (kind !== "api") return;
    if (apiForm.apiType === "pool") return;
    const baseUrl = apiForm.baseUrl.trim();
    if (!baseUrl) {
      emitToast({
        title: texts.saveFail,
        description: texts.formMissing,
        variant: "warning",
      });
      return;
    }
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
      setModelListError(String(error?.message || error));
    } finally {
      setModelListLoading(false);
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
    if (preset) {
      const option = resolvePresetOption(preset, channelId);
      const baseId = `${preset.id}_client`;
      const id = createUniqueProfileId(baseId, getExistingIds("api"));
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
        result?.data ?? (result?.yaml ? (yaml.load(result.yaml) as any) : null);
      const nextData: any = { ...(data || {}), id: pipelineId };
      nextData.provider = providerId;
      if (!nextData.prompt) nextData.prompt = profileIndex.prompt[0] || "";
      if (!nextData.parser) nextData.parser = profileIndex.parser[0] || "";
      if (!nextData.chunk_policy)
        nextData.chunk_policy = profileIndex.chunk[0] || "";
      const chunkMode = inferChunkType(String(nextData.chunk_policy || ""));
      if (chunkMode === "line") {
        if (!nextData.line_policy)
          nextData.line_policy = profileIndex.policy[0] || "";
        nextData.apply_line_policy = Boolean(nextData.line_policy);
      } else if (chunkMode === "legacy") {
        nextData.apply_line_policy = false;
      } else if (nextData.line_policy) {
        nextData.apply_line_policy = true;
      }

      const nextYaml = yaml.dump(nextData);
      await window.api?.pipelineV2ProfilesSave?.(
        "pipeline",
        pipelineId,
        nextYaml,
      );
      setActivePipelineId(pipelineId);
      if (kind === "pipeline" && selectedId === pipelineId) {
        setYamlText(nextYaml);
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
    if (!nextForm.id.trim()) nextForm.id = `${preset.id}_client`;
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
    return {
      ...rule,
      type,
      path: path !== undefined ? String(path) : rule.path,
      pattern: pattern !== undefined ? String(pattern) : rule.pattern,
      sortById: Boolean(
        options?.sort_by_id || options?.sort_by_line_number,
      ),
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
      if (rule.sortById) options.sort_by_id = true;
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
    if (known) return known;
    const normalized = ref.toLowerCase();
    if (normalized.includes("line")) return "line";
    if (normalized.includes("legacy") || normalized.includes("doc"))
      return "legacy";
    return "";
  };

  const syncFormsFromData = (targetKind: ProfileKind, data: any) => {
    if (!data || typeof data !== "object") return;
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
        members: data.members ? data.members.join("\n") : "",
        poolEndpoints,
        strategy: data.strategy === "random" ? "random" : "round_robin",
        headers: JSON.stringify(data.headers || {}, null, 2),
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
      const chunkMode = inferChunkType(String(data.chunk_policy || ""));
      const translationMode =
        data.apply_line_policy || data.line_policy
          ? "line"
          : chunkMode === "line"
            ? "line"
            : "block";
      setPipelineComposer({
        id: data.id || "",
        name: data.name || "",
        provider: data.provider || "",
        prompt: data.prompt || "",
        parser: data.parser || "",
        translationMode,
        linePolicy: data.line_policy || "",
        chunkPolicy: data.chunk_policy || "",
        temperature: String(data.settings?.temperature ?? "0.7"),
        maxRetries: String(data.settings?.max_retries ?? "1"),
        concurrency: String(data.settings?.concurrency ?? "1"),
        maxTokens: String(data.settings?.max_tokens ?? ""),
        modelOverride: String(data.settings?.model ?? ""),
        timeout: String(data.settings?.timeout ?? ""),
        headers: JSON.stringify(data.settings?.headers || {}, null, 2),
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
        extraParams: (() => {
          if (!data.settings?.params) return "";
          const entries = Object.entries(data.settings.params).filter(
            ([key]) =>
              ![
                "top_p",
                "presence_penalty",
                "frequency_penalty",
                "seed",
                "stop",
              ].includes(key),
          );
          if (!entries.length) return "";
          return JSON.stringify(Object.fromEntries(entries), null, 2);
        })(),
      });
    }
    if (targetKind === "prompt") {
      const context = data.context || {};
      const systemTemplate = [
        data.persona,
        data.style_rules,
        data.output_rules,
        data.system_template,
      ]
        .map((value) =>
          value === undefined || value === null ? "" : String(value),
        )
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n\n");
      setPromptForm({
        id: data.id || "",
        name: data.name || "",
        systemTemplate,
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
        sourceLang: String(options.source_lang || ""),
      });
    }
    if (targetKind === "chunk") {
      const options = data.options || {};
      const chunkType = data.chunk_type || data.type || "legacy";
      const isLine = chunkType === "line";
      setChunkForm({
        id: data.id || "",
        name: data.name || "",
        chunkType: isLine ? "line" : "legacy",
        lineStrict: Boolean(options.strict),
        keepEmpty:
          options.keep_empty !== undefined
            ? Boolean(options.keep_empty)
            : Boolean(options.strict),
        targetChars: String(options.target_chars ?? "1200"),
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

  const syncFormsFromYaml = (yamlSource: string) => {
    try {
      const data = yaml.load(yamlSource) as any;
      syncFormsFromData(kind, data);
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
    setSelectedId(null);
    const displayName = templateId
      ? getTemplateMeta(templateId)?.title
      : undefined;
    const localizedYaml = localizeTemplateName(templateYaml, displayName);
    const nextYaml = ensureUniqueTemplateId(localizedYaml, kind);
    setYamlText(nextYaml);
    syncFormsFromYaml(nextYaml);
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
              return parseWithProfile(candidate, rawInput);
            } catch (err: any) {
              lastError = err;
            }
          }
          throw lastError || new Error("all_parsers_failed");
        }

        if (parserType === "plain") {
          const cleaned = rawInput.replace(/\n+$/, "");
          return { text: cleaned, lines: splitLinesKeepEmpty(cleaned) };
        }

        if (parserType === "line_strict") {
          const multiLine = String(options.multi_line || "join");
          const lines = splitLinesKeepEmpty(rawInput.replace(/\n+$/, ""));
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
          const data = JSON.parse(rawInput);
          if (!Array.isArray(data)) throw new Error("json_array_expected");
          const lines = data.map((item) => String(item));
          return { text: lines.join("\n"), lines };
        }

        if (parserType === "json_object") {
          const data = JSON.parse(rawInput);
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
          const lines: string[] = [];
          rawInput.split("\n").forEach((line) => {
            if (line.trim() === "") {
              lines.push("");
              return;
            }
            const data = JSON.parse(line);
            const value = path ? getByPath(data, String(path)) : data;
            lines.push(String(value));
          });
          return { text: lines.join("\n"), lines };
        }

        if (parserType === "tagged_line") {
          const pattern = options.pattern || "^@@(?P<id>\\d+)@@(?P<text>.*)$";
          const regex = new RegExp(pattern);
          const lines: string[] = [];
          rawInput.split("\n").forEach((line) => {
            const match = regex.exec(line.trim());
            if (match) {
              const text =
                (match.groups && match.groups.text) || match[2] || "";
              lines.push(text);
            }
          });
          if (!lines.length) throw new Error("no_tagged_lines");
          return { text: lines.join("\n"), lines };
        }

        if (parserType === "regex") {
          const pattern = String(options.pattern || "").trim();
          if (!pattern) throw new Error("missing_pattern");
          const regex = parseWithRegexFlags(pattern, options);
          const match = regex.exec(rawInput);
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
        if (newForm.apiKey) payload.api_key = newForm.apiKey;
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
        if (!endpoints.length) {
          payload.members = newForm.members
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        if (newForm.strategy === "random") payload.strategy = newForm.strategy;
      }

      try {
        payload.headers = JSON.parse(newForm.headers || "{}");
      } catch { }
      const params: Record<string, any> = {};
      try {
        const parsedParams = JSON.parse(newForm.params || "{}");
        const isPlainObject =
          parsedParams &&
          typeof parsedParams === "object" &&
          !Array.isArray(parsedParams);
        if (isPlainObject) Object.assign(params, parsedParams);
      } catch { }
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

      setYamlText(yaml.dump(payload));
    } catch { }
  };

  const updateYamlFromPipelineComposer = (
    newComposer: PipelineComposerState,
  ) => {
    setPipelineComposer(newComposer);
    const isLineMode = newComposer.translationMode === "line";
    const payload: any = {
      id: newComposer.id,
      name: newComposer.name,
      provider: newComposer.provider,
      prompt: newComposer.prompt,
      parser: newComposer.parser,
      chunk_policy: newComposer.chunkPolicy,
      apply_line_policy: isLineMode,
    };
    if (isLineMode) {
      payload.line_policy = newComposer.linePolicy;
    }

    const settings: any = {};
    if (newComposer.temperature !== "")
      settings.temperature = parseFloat(newComposer.temperature);
    if (newComposer.maxTokens !== "")
      settings.max_tokens = parseInt(newComposer.maxTokens);
    if (newComposer.maxRetries !== "")
      settings.max_retries = parseInt(newComposer.maxRetries);
    const apiRuntime = apiRuntimeIndex[newComposer.provider] || {};
    if (apiRuntime.concurrency !== undefined) {
      settings.concurrency = apiRuntime.concurrency;
    } else if (newComposer.concurrency !== "") {
      const rawConcurrency = Number.parseInt(newComposer.concurrency, 10);
      if (Number.isFinite(rawConcurrency)) {
        settings.concurrency = rawConcurrency;
      } else {
        settings.concurrency = newComposer.concurrency;
      }
    }
    if (newComposer.modelOverride.trim())
      settings.model = newComposer.modelOverride.trim();
    if (apiRuntime.timeout !== undefined) {
      settings.timeout = apiRuntime.timeout;
    } else if (newComposer.timeout !== "") {
      settings.timeout = parseInt(newComposer.timeout);
    }
    if (newComposer.headers) {
      try {
        const headers = JSON.parse(newComposer.headers);
        if (headers && typeof headers === "object" && !Array.isArray(headers)) {
          settings.headers = headers;
        }
      } catch { }
    }
    const params: Record<string, any> = {};
    if (newComposer.topP !== "") params.top_p = parseFloat(newComposer.topP);
    if (newComposer.presencePenalty !== "")
      params.presence_penalty = parseFloat(newComposer.presencePenalty);
    if (newComposer.frequencyPenalty !== "")
      params.frequency_penalty = parseFloat(newComposer.frequencyPenalty);
    if (newComposer.seed !== "") params.seed = parseInt(newComposer.seed);
    if (newComposer.stop) {
      const rawStop = newComposer.stop.trim();
      if (rawStop) {
        try {
          params.stop = JSON.parse(rawStop);
        } catch {
          params.stop = rawStop;
        }
      }
    }
    if (newComposer.extraParams) {
      try {
        const extra = JSON.parse(newComposer.extraParams);
        if (extra && typeof extra === "object" && !Array.isArray(extra)) {
          Object.assign(params, extra);
        }
      } catch { }
    }
    if (Object.keys(params).length) settings.params = params;
    payload.settings = settings;

    setYamlText(yaml.dump(payload));
  };

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
      system_template: newForm.systemTemplate,
      user_template: newForm.userTemplate,
      context: {
        before_lines: toNumber(newForm.beforeLines, 0),
        after_lines: toNumber(newForm.afterLines, 0),
        joiner: resolvedJoiner || "\n",
      },
    };
    if (resolvedSourceFormat) {
      payload.context.source_format = resolvedSourceFormat;
    }
    if (
      resolvedSourceLinesRaw !== "" &&
      Number.isFinite(resolvedSourceLines) &&
      resolvedSourceLines > 0
    ) {
      payload.context.source_lines = resolvedSourceLines;
    }

    setYamlText(yaml.dump(payload));
  };

  const updateYamlFromPolicyForm = (newForm: PolicyFormState) => {
    setPolicyForm(newForm);
    try {
      const payload: any = {
        id: newForm.id,
        name: newForm.name,
        type: newForm.policyType,
      };
      const options: any = {};
      options.on_mismatch = newForm.onMismatch;
      const checks: string[] = [];
      if (newForm.emptyLine) checks.push("empty_line");
      if (newForm.similarity) checks.push("similarity");
      if (newForm.kanaTrace) checks.push("kana_trace");
      if (checks.length) {
        options.checks = checks;
        options.trim = newForm.trim;
      }
      if (newForm.similarity) {
        const threshold = Number(newForm.similarityThreshold);
        if (Number.isFinite(threshold))
          options.similarity_threshold = threshold;
      }
      if (newForm.kanaTrace && newForm.sourceLang.trim()) {
        options.source_lang = newForm.sourceLang.trim();
      }
      if (Object.keys(options).length) payload.options = options;
      setYamlText(yaml.dump(payload));
    } catch { }
  };

  const updateYamlFromChunkForm = (newForm: ChunkFormState) => {
    setChunkForm(newForm);
    try {
      const payload: any = {
        id: newForm.id,
        name: newForm.name,
        chunk_type: newForm.chunkType,
      };
      const options: any = {};
      if (newForm.chunkType === "line") {
        options.strict = newForm.lineStrict;
        options.keep_empty = newForm.keepEmpty;
      } else {
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
      }
      if (Object.keys(options).length) payload.options = options;
      setYamlText(yaml.dump(payload));
    } catch { }
  };

  const updateYamlFromParserForm = (newForm: ParserFormState) => {
    if (!newForm.rules.length) {
      const payload: any = {
        id: newForm.id,
        name: newForm.name,
      };
      setParserForm({ ...newForm, rules: [] });
      setYamlText(yaml.dump(payload));
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
    setYamlText(yaml.dump(payload));
  };



  const renderNavigationRail = () => (
    <div className="w-16 shrink-0 flex flex-col items-center py-4 bg-muted/10 border-r border-border/60 z-20 gap-4">
      <div className="flex-1 w-full px-2 space-y-2 flex flex-col items-center">
        {[
          { kind: "pipeline" as const, icon: Workflow, label: texts.kinds.pipeline },
          { kind: "api" as const, icon: Server, label: texts.kinds.api },
          { kind: "prompt" as const, icon: MessageSquare, label: texts.kinds.prompt },
          { kind: "parser" as const, icon: FileJson, label: texts.kinds.parser },
        ].map(({ kind: targetKind, icon: Icon, label }) => (
          <Tooltip key={targetKind} content={label}>
            <button
              onClick={() => {
                if (kind !== targetKind) {
                  setSelectedId(null);
                  setYamlText("");
                  setKind(targetKind);
                  setSearchTerm("");
                }
              }}
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-200",
                kind === targetKind
                  ? "bg-primary text-primary-foreground shadow-md scale-105"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:scale-105"
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
                setSelectedId(null);
                setYamlText("");
                setKind(strategyKind);
                setSearchTerm("");
              }
            }}
            className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-200",
              kind === "policy" || kind === "chunk"
                ? "bg-primary text-primary-foreground shadow-md scale-105"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:scale-105",
            )}
          >
            <Scissors className="h-5 w-5" />
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
                  setSelectedId(null);
                  setYamlText("");
                  setSearchTerm("");
                  setKind(targetKind);
                }}
                className={cn(
                  "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === targetKind
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-background/60 text-muted-foreground hover:border-border",
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
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            placeholder={texts.searchPlaceholder}
            className="pl-9 h-9 bg-muted/40 border-transparent focus:bg-background focus:border-input transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1 scroller-hide">
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
                  ? "bg-primary/10 text-primary border-primary/30 shadow-sm ring-1 ring-primary/10"
                  : "text-foreground",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className={cn("font-medium truncate transition-colors", isSelected ? "text-primary" : "text-foreground")}>
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
              {isSelected && <ChevronRight className="h-4 w-4 opacity-50 text-primary animate-in slide-in-from-left-1 duration-200" />}
            </button>
          );
        })}

        {filteredProfiles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2 opacity-60">
            <Search className="h-8 w-8 opacity-20" />
            <p className="text-sm">{texts.listEmpty}</p>
          </div>
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

  const renderApiForm = () => {
    const memberCount = apiForm.members
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean).length;
    const endpointCount = apiForm.poolEndpoints.filter((item) =>
      item.baseUrl.trim(),
    ).length;
    const endpointReadyCount = apiForm.poolEndpoints.filter(
      (item) => item.baseUrl.trim() && item.model.trim(),
    ).length;
    const poolReady =
      endpointCount > 0 ? endpointReadyCount === endpointCount : memberCount > 0;
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
        params: pairsToJson(nextPairs),
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

    const activePreset = activePresetId
      ? API_PRESETS_DATA.find((preset) => preset.id === activePresetId) || null
      : null;
    const activeChannels = activePreset ? getPresetChannels(activePreset) : [];
    const showPresetChannels = activePreset ? activeChannels.length > 1 : false;
    const showApiId = showIdField.api;

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
          <div className="flex items-start gap-3">
            <div>
              <div className="text-sm font-medium">{texts.formTitle}</div>
              <div className="text-xs text-muted-foreground">
                {texts.formDesc}
              </div>
            </div>
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
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
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
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{texts.formFields.modelLabel}</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleFetchModelList}
                  disabled={modelListLoading}
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
    return (
      <div className="space-y-5">
        <FormSection
          title={texts.promptSections.templateTitle}
          desc={texts.promptSections.templateDesc}
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
                          updateRuleAt(globalIndex, { sortById: e.target.checked })
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

    const renderCheckCard = (
      checked: boolean,
      onChange: (next: boolean) => void,
      label: string,
      desc: string,
    ) => (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-border/60"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
    );

    const sourceLangOptions = new Set(["", "ja"]);
    const customSourceLang =
      policyForm.sourceLang && !sourceLangOptions.has(policyForm.sourceLang)
        ? policyForm.sourceLang
        : "";

    return (
      <div className="space-y-5">
        <FormSection
          title={texts.policySections.modeTitle}
          desc={texts.policySections.modeDesc}
        >
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label>{texts.policyFields.policyTypeLabel}</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    policyForm.policyType === "strict"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-background/60 text-muted-foreground hover:border-border",
                  )}
                  onClick={() => updatePolicy({ policyType: "strict" })}
                >
                  {texts.policyOptions.strict}
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    policyForm.policyType === "tolerant"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-background/60 text-muted-foreground hover:border-border",
                  )}
                  onClick={() => updatePolicy({ policyType: "tolerant" })}
                >
                  {texts.policyOptions.tolerant}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {policyForm.policyType === "strict"
                  ? texts.policyHints.strict
                  : texts.policyHints.tolerant}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{texts.policyFields.onMismatchLabel}</Label>
              <SelectField
                value={policyForm.onMismatch}
                onChange={(e) =>
                  updatePolicy({
                    onMismatch: e.target.value as PolicyFormState["onMismatch"],
                  })
                }
              >
                <option value="retry">{texts.policyOptions.onMismatchRetry}</option>
                <option value="error">{texts.policyOptions.onMismatchError}</option>
                <option value="pad">{texts.policyOptions.onMismatchPad}</option>
                <option value="truncate">
                  {texts.policyOptions.onMismatchTruncate}
                </option>
                <option value="align">{texts.policyOptions.onMismatchAlign}</option>
              </SelectField>
              <p className="text-xs text-muted-foreground">
                {texts.policyHints.onMismatch}
              </p>
            </div>
            <div className="col-span-2 flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2">
              <div>
                <div className="text-sm font-medium">
                  {texts.policyFields.trimLabel}
                </div>
                <div className="text-xs text-muted-foreground">
                  {texts.policyHints.trim}
                </div>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border/60"
                checked={policyForm.trim}
                onChange={(e) => updatePolicy({ trim: e.target.checked })}
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          title={texts.policySections.checksTitle}
          desc={texts.policySections.checksDesc}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {renderCheckCard(
              policyForm.emptyLine,
              (next) => updatePolicy({ emptyLine: next }),
              texts.policyChecks.emptyLine,
              texts.policyChecksDesc.emptyLine,
            )}
            {renderCheckCard(
              policyForm.similarity,
              (next) => updatePolicy({ similarity: next }),
              texts.policyChecks.similarity,
              texts.policyChecksDesc.similarity,
            )}
            {renderCheckCard(
              policyForm.kanaTrace,
              (next) => updatePolicy({ kanaTrace: next }),
              texts.policyChecks.kanaTrace,
              texts.policyChecksDesc.kanaTrace,
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{texts.policyFields.similarityThresholdLabel}</Label>
              <InputAffix
                prefix={<Percent className="h-4 w-4" />}
                value={policyForm.similarityThreshold}
                onChange={(e) =>
                  updatePolicy({ similarityThreshold: e.target.value })
                }
                disabled={!policyForm.similarity}
              />
              <p className="text-xs text-muted-foreground">
                {texts.policyHints.similarityThreshold}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{texts.policyFields.sourceLangLabel}</Label>
              <SelectField
                value={policyForm.sourceLang}
                onChange={(e) => updatePolicy({ sourceLang: e.target.value })}
                disabled={!policyForm.kanaTrace}
              >
                {customSourceLang && (
                  <option value={customSourceLang}>
                    {texts.policyOptions.sourceLangCustom.replace(
                      "{code}",
                      customSourceLang,
                    )}
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
        </FormSection>
      </div>
    );
  };

  const renderChunkForm = () => {
    const showChunkId = showIdField.chunk;
    const isLine = chunkForm.chunkType === "line";

    const updateChunk = (patch: Partial<ChunkFormState>) =>
      updateYamlFromChunkForm({ ...chunkForm, ...patch });

    const renderToggle = (
      checked: boolean,
      onChange: (next: boolean) => void,
      label: string,
      hint?: string,
    ) => (
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2">
        <div>
          <div className="text-sm font-medium">{label}</div>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border/60"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
    );

    return (
      <div className="space-y-5">
        <FormSection
          title={texts.chunkSections.modeTitle}
          desc={texts.chunkSections.modeDesc}
        >
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label>{texts.chunkSections.modeTitle}</Label>
              <SelectField
                value={chunkForm.chunkType}
                onChange={(e) =>
                  updateChunk({
                    chunkType: e.target.value === "line" ? "line" : "legacy",
                  })
                }
              >
                <option value="line">{texts.chunkOptions.line}</option>
                <option value="legacy">{texts.chunkOptions.legacy}</option>
              </SelectField>
              <p className="text-xs text-muted-foreground">
                {isLine ? texts.chunkHints.line : texts.chunkHints.legacy}
              </p>
            </div>
          </div>
        </FormSection>

        {isLine ? (
          <FormSection>
            <div className="grid grid-cols-1 gap-3">
              {renderToggle(
                chunkForm.lineStrict,
                (next) => updateChunk({ lineStrict: next }),
                texts.chunkFields.lineStrictLabel,
                texts.chunkHints.lineStrict,
              )}
              {renderToggle(
                chunkForm.keepEmpty,
                (next) => updateChunk({ keepEmpty: next }),
                texts.chunkFields.keepEmptyLabel,
                texts.chunkHints.keepEmpty,
              )}
            </div>
          </FormSection>
        ) : (
          <FormSection>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{texts.chunkFields.targetCharsLabel}</Label>
                <Input
                  type="number"
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
                  value={chunkForm.maxChars}
                  onChange={(e) => updateChunk({ maxChars: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {texts.chunkHints.maxChars}
                </p>
              </div>
              <div className="space-y-2 col-span-2">
                {renderToggle(
                  chunkForm.enableBalance,
                  (next) => updateChunk({ enableBalance: next }),
                  texts.chunkFields.enableBalanceLabel,
                  texts.chunkHints.enableBalance,
                )}
              </div>
              <div className="space-y-2">
                <Label>{texts.chunkFields.balanceThresholdLabel}</Label>
                <Input
                  type="number"
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
          </FormSection>
        )}
      </div>
    );
  };

  const renderPipelineForm = () => {
    const showPipelineId = showIdField.pipeline;
    const selectedChunkType = inferChunkType(pipelineComposer.chunkPolicy);
    const isLegacyChunk = selectedChunkType === "legacy";

    const resolveTranslationMode = (chunkPolicy: string, linePolicy: string) => {
      const chunkType = inferChunkType(chunkPolicy);
      if (chunkType === "legacy") return "block";
      if (chunkType === "line") return "line";
      if (linePolicy) return "line";
      return pipelineComposer.translationMode;
    };

    const applyPipelineChange = (patch: Partial<PipelineComposerState>) => {
      const nextChunkPolicy =
        patch.chunkPolicy !== undefined
          ? patch.chunkPolicy
          : pipelineComposer.chunkPolicy;
      const nextLinePolicy =
        patch.linePolicy !== undefined
          ? patch.linePolicy
          : pipelineComposer.linePolicy;
      updateYamlFromPipelineComposer({
        ...pipelineComposer,
        ...patch,
        translationMode: resolveTranslationMode(nextChunkPolicy, nextLinePolicy),
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

    const getStrategyLabel = (lineId: string, chunkId: string) => {
      const lineLabel = lineId ? getProfileLabel("policy", lineId) : "";
      const chunkLabel = chunkId ? getProfileLabel("chunk", chunkId) : "";
      if (lineLabel && chunkLabel) return `${lineLabel} · ${chunkLabel}`;
      return lineLabel || chunkLabel || texts.untitledProfile;
    };

    const buildStrategyOptions = () => {
      const options: Array<{ value: string; label: string; disabled?: boolean }> = [];
      const lineIds = visibleProfileIndex.policy;
      const chunkIds = visibleProfileIndex.chunk;
      // 每个 chunk profile 生成一个选项
      // line chunk 自动关联第一个可用 policy；legacy chunk 不关联 policy
      chunkIds.forEach((chunkId) => {
        const chunkType = inferChunkType(chunkId);
        if (chunkType === "line") {
          const autoPolicy = lineIds[0] || "";
          options.push({
            value: encodeStrategyCombo(autoPolicy, chunkId),
            label: getProfileLabel("chunk", chunkId),
            disabled: !autoPolicy,
          });
        } else {
          options.push({
            value: encodeStrategyCombo("", chunkId),
            label: getProfileLabel("chunk", chunkId),
          });
        }
      });
      return options;
    };

    const strategyOptions = buildStrategyOptions();
    const strategyChunkType = inferChunkType(pipelineComposer.chunkPolicy);
    const normalizedLinePolicy =
      strategyChunkType === "legacy" ? "" : pipelineComposer.linePolicy;
    const strategyValue = pipelineComposer.chunkPolicy
      ? encodeStrategyCombo(
        normalizedLinePolicy,
        pipelineComposer.chunkPolicy,
      )
      : "";
    const hasStrategyValue =
      !strategyValue || strategyOptions.some((item) => item.value === strategyValue);
    const allowFallback = strategyChunkType !== "legacy";
    const strategyOptionsFinal = hasStrategyValue || !allowFallback
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
        });
        return;
      }
      const { linePolicy, chunkPolicy } = decodeStrategyCombo(value);
      const chunkType = inferChunkType(chunkPolicy);
      let nextLinePolicy = linePolicy;
      if (chunkType === "line" && !nextLinePolicy) {
        nextLinePolicy = visibleProfileIndex.policy[0] || "";
      }
      if (chunkType === "legacy") {
        nextLinePolicy = "";
      }
      applyPipelineChange({
        linePolicy: nextLinePolicy,
        chunkPolicy,
      });
    };

    const showLinePolicySelect =
      strategyChunkType === "line" && visibleProfileIndex.policy.length > 1;

    const resolveStrategyTarget = () => {
      const chunkType = inferChunkType(pipelineComposer.chunkPolicy);
      const isLineMode =
        chunkType === "line" || pipelineComposer.translationMode === "line";
      if (isLineMode) {
        return {
          kind: "policy" as const,
          id: pipelineComposer.linePolicy,
        };
      }
      return {
        kind: "chunk" as const,
        id: pipelineComposer.chunkPolicy,
      };
    };

    const jumpToKind = (targetKind: ProfileKind, targetId?: string) => {
      if (targetId) {
        handleSelectProfile(targetId, targetKind);
        return;
      }
      if (kind !== targetKind) {
        setSelectedId(null);
        setYamlText("");
        setKind(targetKind);
        setSearchTerm("");
      }
    };

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {showPipelineId && (
            <div className="space-y-2">
              <Label>{texts.composer.fields.idLabel}</Label>
              <Input
                value={pipelineComposer.id}
                onChange={(e) => {
                  markIdAsCustom("pipeline");
                  updateYamlFromPipelineComposer({
                    ...pipelineComposer,
                    id: e.target.value,
                  });
                }}
              />
            </div>
          )}
          <div
            className={cn("space-y-2", showPipelineId ? "" : "col-span-2")}
          >
            <Label>{texts.composer.fields.nameLabel}</Label>
            <Input
              value={pipelineComposer.name}
              onChange={(e) => {
                const nextName = e.target.value;
                const nextId = shouldAutoUpdateId("pipeline", nextName)
                  ? buildAutoProfileId(
                    "pipeline",
                    nextName,
                    pipelineComposer.id,
                  )
                  : pipelineComposer.id;
                updateYamlFromPipelineComposer({
                  ...pipelineComposer,
                  name: nextName,
                  id: nextId,
                });
              }}
            />
          </div>
        </div>

        <FormSection title={texts.scheme.title} desc={texts.scheme.desc}>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{texts.scheme.fields.provider}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => jumpToKind("api", pipelineComposer.provider)}
                >
                  {texts.scheme.actions.editApi}
                </Button>
              </div>
              <SelectField
                value={pipelineComposer.provider}
                onChange={(e) =>
                  applyPipelineChange({ provider: e.target.value })
                }
              >
                <option value="">{texts.scheme.placeholders.provider}</option>
                {visibleProfileIndex.api.map((id) => (
                  <option key={id} value={id}>
                    {formatOptionLabel("api", id)}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{texts.scheme.fields.prompt}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => jumpToKind("prompt", pipelineComposer.prompt)}
                >
                  {texts.scheme.actions.editPrompt}
                </Button>
              </div>
              <SelectField
                value={pipelineComposer.prompt}
                onChange={(e) => applyPipelineChange({ prompt: e.target.value })}
              >
                <option value="">{texts.scheme.placeholders.prompt}</option>
                {visibleProfileIndex.prompt.map((id) => (
                  <option key={id} value={id}>
                    {formatOptionLabel("prompt", id)}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{texts.scheme.fields.parser}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => jumpToKind("parser", pipelineComposer.parser)}
                >
                  {texts.scheme.actions.editParser}
                </Button>
              </div>
              <SelectField
                value={pipelineComposer.parser}
                onChange={(e) => applyPipelineChange({ parser: e.target.value })}
              >
                <option value="">{texts.scheme.placeholders.parser}</option>
                {visibleProfileIndex.parser.map((id) => (
                  <option key={id} value={id}>
                    {formatOptionLabel("parser", id)}
                  </option>
                ))}
              </SelectField>
            </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{texts.scheme.fields.strategy}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    const target = resolveStrategyTarget();
                    jumpToKind(target.kind, target.id);
                  }}
                >
                  {texts.scheme.actions.editStrategy}
                </Button>
              </div>
                <SelectField
                  value={strategyValue}
                  onChange={(e) => handleStrategyChange(e.target.value)}
                >
                  <option value="">{texts.scheme.placeholders.strategy}</option>
                {strategyOptionsFinal.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </SelectField>

              </div>
              {showLinePolicySelect && (
                <div className="space-y-2 col-span-2">
                  <div className="flex items-center justify-between">
                    <Label>{texts.scheme.fields.linePolicy}</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        jumpToKind("policy", pipelineComposer.linePolicy)
                      }
                    >
                      {texts.scheme.actions.editLinePolicy}
                    </Button>
                  </div>
                  <SelectField
                    value={pipelineComposer.linePolicy}
                    onChange={(e) =>
                      applyPipelineChange({ linePolicy: e.target.value })
                    }
                  >
                    <option value="">{texts.scheme.placeholders.linePolicy}</option>
                    {visibleProfileIndex.policy.map((id) => (
                      <option key={id} value={id}>
                        {formatOptionLabel("policy", id)}
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}
            </div>
          </FormSection>
        </div>
      );
  };

  const renderPipelineEmptyState = () => {
    const stepTexts = Array.isArray(texts.pipelineEmptySteps)
      ? texts.pipelineEmptySteps
      : [];
    const steps = [
      { kind: "api" as const, icon: Server },
      { kind: "prompt" as const, icon: MessageSquare },
      { kind: "parser" as const, icon: FileJson },
      { kind: "chunk" as const, icon: Scissors },
    ].map((step, index) => ({
      ...step,
      ...(stepTexts[index] || {}),
      index: index + 1,
    }));

    const jumpToKind = (targetKind: ProfileKind) => {
      if (kind === targetKind) return;
      setSelectedId(null);
      setYamlText("");
      setSearchTerm("");
      setKind(targetKind);
    };

    return (
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-6 pt-12 space-y-8">
          <div className="max-w-3xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {texts.pipelineEmptyBadge}
            </div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              {texts.pipelineEmptyTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {texts.pipelineEmptyDesc}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.kind}
                  className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background via-background/80 to-muted/20 p-4 shadow-sm"
                >
                  <div className="absolute right-4 top-4 h-8 w-8 rounded-full bg-muted/50 text-xs font-semibold text-muted-foreground flex items-center justify-center">
                    {step.index}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="text-sm font-semibold">
                      {step.title || texts.pipelineEmptyFallbackTitle}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground min-h-[36px]">
                    {step.desc || texts.pipelineEmptyFallbackDesc}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => jumpToKind(step.kind)}
                  >
                    {step.action || texts.pipelineEmptyFallbackAction}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    // If no kind selected, shouldn't happen but defensive
    if (!kind) return null;

    const renderPresetCard = (preset: ApiPreset) => {
      const presetText =
        presetTexts.presets?.[preset.id] ||
        texts.presets?.[preset.id] || {
          label: preset.id,
          desc: "",
        };
      const Icon = preset.icon;
      return (
        <Card
          key={preset.id}
          className="cursor-pointer hover:border-primary/50 hover:shadow-lg hover:-translate-y-1 transition-all group h-full min-h-[160px] flex flex-col"
          onClick={() => handlePresetSelect(preset)}
        >
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div
                className={cn(
                  "p-2 rounded-lg bg-muted/30 group-hover:bg-primary/10 transition-colors",
                  preset.color,
                )}
              >
                <Icon className="h-6 w-6" />
              </div>
            </div>
            <CardTitle>{presetText.label || preset.id}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {presetText.desc || ""}
            </CardDescription>
          </CardHeader>
        </Card>
      );
    };

    // If no selection and no YAML text (meaning we are not creating/editing ANY profile)
    // AND we are in API mode, show the presets grid.
    // Or if we specifically designed "Create New" to be this grid.
    // Currently handleCreate clears selectedId and yamlText, so this block handles "Create New" state for API.
    if (!selectedId && !yamlText) {
      if (kind === "api") {
        const primaryPresets = API_PRESETS_DATA.slice(0, 5);
        const secondaryPresets = API_PRESETS_DATA.slice(5);
        const visiblePresets = primaryPresets;
        const showToggle = secondaryPresets.length > 0;
        return (
          <div className="flex-1 overflow-y-auto bg-background/50">
            <div className="p-5 pt-16 space-y-5">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">
                  {texts.presetTitle}
                </h2>
                <p className="text-muted-foreground max-w-lg mx-auto">
                  {texts.presetDesc}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto auto-rows-fr items-stretch">
                {visiblePresets.map((preset) => renderPresetCard(preset))}

                <Card
                  className="cursor-pointer hover:border-primary/50 hover:shadow-lg hover:-translate-y-1 transition-all border-dashed flex flex-col justify-center items-center text-center p-5 min-h-[160px] h-full"
                  onClick={() => handlePresetSelect(null)}
                >
                  <div className="p-3 rounded-full bg-muted/30 mb-4">
                    <Plus className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold">{texts.customCardTitle}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {texts.customCardDesc}
                  </p>
                </Card>
              </div>

              {presetExpanded && secondaryPresets.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <span>{texts.presetMoreTitle}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto auto-rows-fr items-stretch">
                    {secondaryPresets.map((preset) => renderPresetCard(preset))}
                  </div>
                </div>
              )}

              {showToggle && (
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPresetExpanded((prev) => !prev)}
                  >
                    {presetExpanded
                      ? texts.presetToggleHide
                      : texts.presetToggleShow}
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      }

      if (kind === "pipeline") {
        return renderPipelineEmptyState();
      }
      // Default empty state for other kinds if no selection
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-muted/5 p-4">
          <div className="w-24 h-24 rounded-2xl bg-muted/30 flex items-center justify-center mb-6 animate-in zoom-in-50 duration-300">
            <Sparkles className="h-10 w-10 opacity-30" />
          </div>
          <h3 className="text-xl font-semibold text-foreground tracking-tight">
            {texts.emptySelectionTitle}
          </h3>
          <p className="text-sm max-w-sm text-center mt-2 opacity-70 mb-8 leading-relaxed">
            {texts.emptySelectionDesc}
          </p>
          <Button onClick={handleCreate} size="lg" className="gap-2 shadow-lg hover:shadow-xl transition-all active:scale-95">
            <Plus className="h-5 w-5" />
            {texts.newProfile}
          </Button>
        </div>
      );
    }

    return (
      <main className="flex-1 flex flex-col h-full min-h-0 relative bg-background/30 backdrop-blur-3xl">
        {/* Header / Toolbar */}
        <div className="flex-none h-16 px-6 border-b border-border/40 flex items-center justify-between bg-background/40 backdrop-blur-md sticky top-0 z-10 transition-all">
          <div className="flex items-center gap-4">
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
                onClick={() => setEditorTab("yaml")}
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

            {editorTab === "yaml" && (
              <Tooltip content={texts.syncFromYaml}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                  onClick={handleSyncFromYaml}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </Tooltip>
            )}

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
              className={cn(
                "gap-2 min-w-[100px] shadow-sm hover:shadow-md transition-all active:scale-95",
                lastValidation?.errors.length ? "opacity-90" : "bg-primary text-primary-foreground",
              )}
            >
              <Save className="h-4 w-4" /> {texts.save}
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

              {(TEMPLATE_LIBRARY[kind]?.length ||
                (customTemplates[kind] || []).length) > 0 &&
                (() => {
                  const builtInTemplates = TEMPLATE_LIBRARY[kind] || [];
                  const customForKind = customTemplates[kind] || [];
                  const hiddenSet = new Set(hiddenTemplates[kind] || []);
                  const templates = [...builtInTemplates, ...customForKind];
                  const visibleTemplates = templates.filter(
                    (item) =>
                      !hiddenSet.has(item.id) && !isHiddenProfile(kind, item.id),
                  );
                  const coreSet = new Set<string>(
                    (TEMPLATE_CORE_IDS[kind] || []) as string[],
                  );
                  const templateItems = visibleTemplates.map((item) => {
                    const meta = getTemplateMeta(item.id, item.meta);
                    return {
                      id: item.id,
                      title: meta?.title || item.id,
                      desc: meta?.desc || "",
                      group: getTemplateGroupKey(item.id, kind),
                      yaml: item.yaml,
                      isCore: coreSet.has(item.id),
                      custom: item.custom,
                    };
                  });
                  const groupOrder = ["line", "json", "tagged", "regex", "general"];
                  const effectiveGroupOrder =
                    kind === "pipeline" ? ["general"] : groupOrder;
                  return (
                    <>
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

                      <TemplateSelector
                        open={templateSelectorOpen}
                        onOpenChange={setTemplateSelectorOpen}
                        items={templateItems}
                        groupOrder={effectiveGroupOrder}
                        onSelect={(item) =>
                          handleApplyTemplate(item.yaml, item.id)
                        }
                        strings={{
                          title: texts.templates.title,
                          searchPlaceholder: texts.templatesSearchPlaceholder,
                          empty: texts.templatesSearchEmpty,
                          close: texts.templatesClose,
                          coreBadge: texts.templatesCoreBadge,
                          customBadge: texts.customTag,
                          groups: texts.templateGroups ?? {},
                          footerHint: texts.templatesFooterHint,
                          manageShow: texts.templatesManageShow,
                          manageHide: texts.templatesManageHide,
                        }}
                        managerOpen={templateManagerOpen}
                        onToggleManager={() =>
                          setTemplateManagerOpen((prev) => !prev)
                        }
                        managerContent={
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
                        }
                      />
                    </>
                  );
                })()}
            </>
          )}
          {editorTab === "yaml" && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                {texts.sectionYamlTitle}{" "}
                <div className="h-px bg-border flex-1" />
              </h3>
              <div className="relative rounded-xl border bg-muted/30 overflow-hidden font-mono text-sm">
                <textarea
                  spellCheck={false}
                  className="w-full h-[360px] bg-transparent p-4 resize-y focus:outline-none"
                  value={yamlText}
                  onChange={(e) => setYamlText(e.target.value)}
                />
                <div className="absolute top-2 right-2 text-[10px] text-muted-foreground border rounded px-1.5 bg-background/50">
                  {texts.editorYamlBadge}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 opacity-70">
                {texts.editorHint}
              </p>
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
        {renderSidePanel()}
        {renderContent()}
      </div>
      <AlertModal {...alertProps} />
    </>
  );
}

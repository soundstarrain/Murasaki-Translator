import { app, ipcMain } from "electron";

import { join, basename, extname } from "path";

import { existsSync } from "fs";

import {

  copyFile,

  mkdir,

  readdir,

  readFile,

  unlink,

  writeFile,

} from "fs/promises";

import yaml from "js-yaml";

import {

  ensurePipelineV2Server,

  getPipelineV2Status,

  markPipelineV2Local,

  markPipelineV2ServerOk,

  retryPipelineV2Server,

} from "./pipelineV2Server";

import { validateProfileLocal } from "./pipelineV2Validation";
import {

  hasServerProfilesList,

} from "./pipelineV2ProfileHelpers";

const PROFILE_KINDS = [

  "api",

  "prompt",

  "parser",

  "policy",

  "chunk",

  "pipeline",

] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

const PRUNE_PROFILE_IDS: Partial<Record<ProfileKind, Set<string>>> = {

  policy: new Set(["line_strict", "line_quality", "line_strict_pad", "line_strict_align"]),

  chunk: new Set(["chunk_line_strict", "chunk_line_loose", "chunk_line_keep"]),

  pipeline: new Set([

    "pipeline_api_doc",

    "pipeline_api_line_strict",

    "pipeline_api_tagged_line",

  ]),

};

type PatchNameEntry = { name: string; aliases?: string[] };

const PATCH_PROFILE_NAMES: Partial<
  Record<ProfileKind, Record<string, PatchNameEntry>>
> = {
  api: {
    openai_default: { name: "OpenAI 默认接口", aliases: ["OpenAI Default"] },
  },
  prompt: {
    prompt_default: { name: "默认提示词", aliases: ["Default Prompt"] },
    prompt_tagged_line: { name: "行号标记提示词", aliases: ["Tagged Line Prompt"] },
  },
  parser: {
    parser_any_default: { name: "多解析级联", aliases: ["Any Parser"] },
    parser_plain: {
      name: "纯文本解析",
      aliases: ["Plain Parser", "Plain Text Parser"],
    },
    parser_line_strict: { name: "行号严格解析", aliases: ["Line Strict Parser"] },
    parser_tagged_line: { name: "行号标记解析", aliases: ["Tagged Line Parser"] },
    parser_json_array: { name: "JSON 数组解析", aliases: ["JSON Array Parser"] },
    parser_json_object: {
      name: "JSON 对象解析",
      aliases: ["JSON Object Parser", "Json Object Parser"],
    },
    parser_jsonl_object: { name: "JSONL 多行解析", aliases: ["JSONL Parser"] },
    parser_regex_extract: { name: "正则提取解析", aliases: ["Regex Extract Parser"] },
    parser_regex_json_key: {
      name: "正则提取 JSON 字段",
      aliases: ["Regex JSON Key Parser"],
    },
    parser_regex_codeblock: {
      name: "正则提取代码块",
      aliases: ["Regex Codeblock Parser"],
    },
    parser_regex_xml_tag: {
      name: "正则提取 XML 标签",
      aliases: ["Regex XML Tag Parser"],
    },
  },
  policy: {
    line_tolerant: {
      name: "默认行配置",
      aliases: ["Tolerant Line Policy", "Default Line Policy"],
    },
  },
  chunk: {
    chunk_legacy_doc: {
      name: "默认分块策略",
      aliases: ["Legacy Doc Chunk", "Default Doc Chunk"],
    },
  },
};

const PROMPT_DEFAULT_PATCH = {
  id: "prompt_default",
  name: "默认提示词",
  systemTemplate: `你是一位精通二次元文化的资深轻小说翻译家，请将日文翻译成流畅、优美的中文。
1、严格按照输入行数进行输出，不得拆分或合并行。
2、原文中的各类控制代码须在译文中原样保留。
3、完整翻译除控制字符外的所有文本，翻译需符合中文轻小说的阅读习惯。

采用JSONL的输出格式，无需额外解释或说明:jsonline{"<序号>":"<译文文本>"}`,
  userTemplate: `参考术语表:{{glossary}}
参考上文(无需翻译):{{context_before}}
请翻译:{{source}}
参考下文(无需翻译):{{context_after}}`,
  context: {
    before_lines: 3,
    after_lines: 0,
    joiner: "\\n",
    source_format: "jsonl",
    source_lines: 5,
  },
  legacyNames: new Set(["默认提示词", "Default Prompt"]),
  legacyUserTemplates: new Set([
    "{{source}}",
    "{{context_before}}\\n{{source}}\\n{{context_after}}\\n{{glossary}}",
    "参考术语表:{{glossary}}\\n参考上文(无需翻译):{{context_before}}\\n请翻译:{{source}}\\n参考下文(无需翻译):{{context_after}}",
    "参考术语表:{{glossary}}\\n参考上文(无需翻译):{{context_before}}\\n请翻译:{{source}}\\n参考上文(无需翻译):{{context_after}}",
  ]),
};


const API_DEFAULT_PATCH = {
  id: "openai_default",
  model: "gpt-4.1-mini",
  topP: 0.95,
  maxTokens: 4096,
  concurrency: 0,
  rpm: 3600,
  legacyModels: new Set<string>([]),
};

export const getPipelineV2ProfilesDir = () =>
  join(app.getPath("userData"), "pipeline_v2_profiles");

type PythonPath = { type: "python" | "bundle"; path: string };

type ProfileDeps = {

  getPythonPath: () => PythonPath;

  getMiddlewarePath: () => string;

  getProfilesDir?: () => string;

};

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const buildModelsUrl = (baseUrl: string) => {

  const clean = normalizeBaseUrl(baseUrl);

  if (!clean) return "";

  if (clean.endsWith("/models")) return clean;

  if (clean.endsWith("/openai")) return `${clean}/models`;

  if (clean.endsWith("/openapi")) return `${clean}/models`;

  if (/\/v\d+$/i.test(clean)) return `${clean}/models`;

  return `${clean}/v1/models`;

};

const buildChatCompletionsUrl = (baseUrl: string) => {
  const clean = normalizeBaseUrl(baseUrl);
  if (!clean) return "";
  if (clean.endsWith("/chat/completions")) return clean;
  if (clean.endsWith("/openai")) return `${clean}/chat/completions`;
  if (clean.endsWith("/openapi")) return `${clean}/chat/completions`;
  if (/\/v\d+$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
};

const requestWithTimeout = async (

  url: string,

  options: RequestInit,

  timeoutMs: number,

) => {

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {

    const res = await fetch(url, { ...options, signal: controller.signal });

    return res;

  } finally {

    clearTimeout(timer);

  }

};

const testApiConnection = async (

  baseUrl: string,

  apiKey?: string,

  timeoutMs = 8000,
  model?: string,

) => {

  const url = buildChatCompletionsUrl(baseUrl);

  if (!url) return { ok: false, message: "base_url_missing" };
  const resolvedModel = String(model || "").trim();
  if (!resolvedModel) return { ok: false, message: "missing_model" };

  const headers: Record<string, string> = {

    "Content-Type": "application/json",

  };

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const start = Date.now();

  try {

    const res = await requestWithTimeout(

      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: resolvedModel,
          messages: [{ role: "user", content: "你好" }],
          temperature: 0,
          max_tokens: 8,
        }),
      },

      Math.max(1000, timeoutMs),

    );

    const text = await res.text();

    let data: any = null;

    try {

      data = text ? JSON.parse(text) : null;

    } catch {

      data = text;

    }

    if (!res.ok) {

      return {

        ok: false,

        status: res.status,

        latencyMs: Date.now() - start,

        url,

        message:

          data?.error?.message || data?.detail || data || "request_failed",

      };

    }

    return {

      ok: true,

      status: res.status,

      latencyMs: Date.now() - start,

      url,

    };

  } catch (error: any) {

    return {

      ok: false,

      latencyMs: Date.now() - start,

      url,

      message:

        error?.name === "AbortError"

          ? "timeout"

          : error?.message || "request_failed",

    };

  }

};

const listApiModels = async (

  baseUrl: string,

  apiKey?: string,

  timeoutMs = 8000,

) => {

  const url = buildModelsUrl(baseUrl);

  if (!url) return { ok: false, message: "base_url_missing" };

  const headers: Record<string, string> = {

    "Content-Type": "application/json",

  };

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {

    const res = await requestWithTimeout(

      url,

      { method: "GET", headers },

      Math.max(1000, timeoutMs),

    );

    const text = await res.text();

    let data: any = null;

    try {

      data = text ? JSON.parse(text) : null;

    } catch {

      data = text;

    }

    if (!res.ok) {

      return {

        ok: false,

        status: res.status,

        url,

        message:

          data?.error?.message || data?.detail || data || "request_failed",

      };

    }

    const models = Array.isArray(data?.data)

      ? data.data

        .map((item: any) => String(item?.id || item?.model || ""))

        .filter(Boolean)

      : Array.isArray(data?.models)

        ? data.models.map((item: any) => String(item)).filter(Boolean)

        : [];

    return {

      ok: true,

      status: res.status,

      url,

      models,

    };

  } catch (error: any) {

    return {

      ok: false,

      url,

      message:

        error?.name === "AbortError"

          ? "timeout"

          : error?.message || "request_failed",

    };

  }

};

const requestJson = async (

  baseUrl: string,

  path: string,

  options?: RequestInit,

) => {

  const res = await fetch(`${baseUrl}${path}`, {

    headers: {

      "Content-Type": "application/json",

      ...(options?.headers || {}),

    },

    ...options,

  });

  const text = await res.text();

  let data: any = null;

  try {

    data = text ? JSON.parse(text) : null;

  } catch {

    data = text;

  }

  if (!res.ok) {

    const detail = data?.detail || data || "request_failed";

    return { ok: false, error: detail };

  }

  return { ok: true, data };

};

type LocalProfileRef = {

  id: string;

  name: string;

  filename: string;

  path: string;

};

const safeLoadYaml = (raw: string): Record<string, any> | null => {

  try {

    const data = yaml.load(raw);

    if (!data || typeof data !== "object" || Array.isArray(data)) return null;

    return data as Record<string, any>;

  } catch {

    return null;

  }

};

const dumpYaml = (data: Record<string, any>) =>

  yaml.dump(data, { lineWidth: 120, sortKeys: false, noRefs: true });

const patchAndPruneProfiles = async (

  kind: ProfileKind,

  profilesDir: string,

) => {

  const removeIds = PRUNE_PROFILE_IDS[kind];

  const renameMap = PATCH_PROFILE_NAMES[kind];

  if (!removeIds && !renameMap) return;

  const dir = join(profilesDir, kind);

  const files = await readdir(dir).catch(() => []);

  for (const file of files) {

    const ext = extname(file).toLowerCase();

    if (ext !== ".yaml" && ext !== ".yml") continue;

    const fullPath = join(dir, file);

    const raw = await readFile(fullPath, "utf-8").catch(() => null);

    if (!raw) continue;

    const data = safeLoadYaml(raw);

    if (!data) continue;

    const id = String(data.id || basename(file, ext));

    if (removeIds?.has(id)) {

      await unlink(fullPath).catch(() => null);

      continue;

    }

    let nextData: Record<string, any> = data;

    let changed = false;

    const patchEntry = renameMap?.[id];

    if (patchEntry) {

      const currentName = String(nextData.name || "").trim();

      const aliases = patchEntry.aliases || [];

      const shouldRename =

        !currentName ||

        currentName === id ||

        aliases.some(

          (alias) => alias.toLowerCase() === currentName.toLowerCase(),

        );

      if (shouldRename && currentName !== patchEntry.name) {

        nextData = { ...nextData, name: patchEntry.name };

        changed = true;

      }

    }

    if (kind === "policy" && id === "line_tolerant") {

      const currentName = String(nextData.name || "").trim();

      const aliases = renameMap?.[id]?.aliases || [];

      const isDefaultName =

        !currentName ||

        currentName === id ||

        aliases.some(

          (alias) => alias.toLowerCase() === currentName.toLowerCase(),

        );

      const rawOptions =

        nextData.options &&

          typeof nextData.options === "object" &&

          !Array.isArray(nextData.options)

          ? { ...nextData.options }

          : {};

      const rawChecks = rawOptions.checks;

      const checks =

        Array.isArray(rawChecks) && rawChecks.length

          ? rawChecks.map((item: any) => String(item))

          : [];

      let policyChanged = false;

      if (isDefaultName && nextData.type !== "strict") {

        nextData = { ...nextData, type: "strict" };

        policyChanged = true;

      }

      if (isDefaultName) {

        rawOptions.on_mismatch = "retry";

        rawOptions.trim = rawOptions.trim !== undefined ? rawOptions.trim : true;

        if (!checks.includes("similarity")) {

          checks.push("similarity");

        }

        rawOptions.checks = checks;

        if (rawOptions.similarity_threshold === undefined) {

          rawOptions.similarity_threshold = 0.8;

        }

        nextData = { ...nextData, options: rawOptions };

        policyChanged = true;

      }

      if (policyChanged) {

        changed = true;

      }

    }

    if (kind === "api" && id === API_DEFAULT_PATCH.id) {

      const currentModel = String(nextData.model || "").trim();

      if (!currentModel || API_DEFAULT_PATCH.legacyModels.has(currentModel)) {

        nextData = { ...nextData, model: API_DEFAULT_PATCH.model };

        changed = true;

      }

      const rawParams = nextData.params;

      const nextParams =

        rawParams &&

          typeof rawParams === "object" &&

          !Array.isArray(rawParams)

          ? { ...rawParams }

          : {};

      let paramsChanged = false;

      if (nextParams.top_p === undefined) {

        nextParams.top_p = API_DEFAULT_PATCH.topP;

        paramsChanged = true;

      }

      if (nextParams.max_tokens === undefined) {

        nextParams.max_tokens = API_DEFAULT_PATCH.maxTokens;

        paramsChanged = true;

      }

      if (paramsChanged) {

        nextData = { ...nextData, params: nextParams };

        changed = true;

      }

      const currentConcurrency = nextData.concurrency;

      if (

        currentConcurrency === undefined ||

        currentConcurrency === null ||

        currentConcurrency === ""

      ) {

        nextData = { ...nextData, concurrency: API_DEFAULT_PATCH.concurrency };

        changed = true;

      }

      const currentRpm = nextData.rpm;

      if (currentRpm === undefined || currentRpm === null || currentRpm === "") {

        nextData = { ...nextData, rpm: API_DEFAULT_PATCH.rpm };

        changed = true;

      }

    }

    if (kind === "prompt" && id === PROMPT_DEFAULT_PATCH.id) {

      const currentName = String(nextData.name || "").trim();

      const isDefaultName =

        !currentName || PROMPT_DEFAULT_PATCH.legacyNames.has(currentName);

      if (

        isDefaultName &&

        currentName !== PROMPT_DEFAULT_PATCH.name

      ) {

        nextData = { ...nextData, name: PROMPT_DEFAULT_PATCH.name };

        changed = true;

      }

      const currentSystem = String(nextData.system_template || "").trim();

      if (!currentSystem || !currentSystem.includes("jsonline")) {

        nextData = { ...nextData, system_template: PROMPT_DEFAULT_PATCH.systemTemplate };

        changed = true;

      }

      const currentUser = String(nextData.user_template || "").trim();

      const isLegacyUser =

        !currentUser || PROMPT_DEFAULT_PATCH.legacyUserTemplates.has(currentUser);

      if (isLegacyUser) {

        nextData = { ...nextData, user_template: PROMPT_DEFAULT_PATCH.userTemplate };

        changed = true;

      }

      const rawContext =

        nextData.context && typeof nextData.context === "object" && !Array.isArray(nextData.context)

          ? { ...nextData.context }

          : {};

      let contextChanged = false;

      if (isDefaultName && isLegacyUser) {

        if (rawContext.before_lines !== PROMPT_DEFAULT_PATCH.context.before_lines) {

          rawContext.before_lines = PROMPT_DEFAULT_PATCH.context.before_lines;

          contextChanged = true;

        }

        if (rawContext.after_lines !== PROMPT_DEFAULT_PATCH.context.after_lines) {

          rawContext.after_lines = PROMPT_DEFAULT_PATCH.context.after_lines;

          contextChanged = true;

        }

        if (rawContext.joiner === undefined) {

          rawContext.joiner = PROMPT_DEFAULT_PATCH.context.joiner;

          contextChanged = true;

        }

        if (rawContext.source_format === undefined) {

          rawContext.source_format = PROMPT_DEFAULT_PATCH.context.source_format;

          contextChanged = true;

        }

        if (rawContext.source_lines !== PROMPT_DEFAULT_PATCH.context.source_lines) {

          rawContext.source_lines = PROMPT_DEFAULT_PATCH.context.source_lines;

          contextChanged = true;

        }

      } else if (rawContext.before_lines === undefined) {

        rawContext.before_lines = PROMPT_DEFAULT_PATCH.context.before_lines;

        contextChanged = true;

      }

      if (!isDefaultName || !isLegacyUser) {

        if (rawContext.after_lines === undefined) {

          rawContext.after_lines = PROMPT_DEFAULT_PATCH.context.after_lines;

          contextChanged = true;

        }

        if (rawContext.joiner === undefined) {

          rawContext.joiner = PROMPT_DEFAULT_PATCH.context.joiner;

          contextChanged = true;

        }

        if (rawContext.source_format === undefined) {

          rawContext.source_format = PROMPT_DEFAULT_PATCH.context.source_format;

          contextChanged = true;

        }

        if (rawContext.source_lines === undefined) {

          rawContext.source_lines = PROMPT_DEFAULT_PATCH.context.source_lines;

          contextChanged = true;

        }

      } else {

        // already handled in forced branch

      }

      if (contextChanged) {

        nextData = { ...nextData, context: rawContext };

        changed = true;

      }

    }

    if (changed) {

      await writeFile(fullPath, dumpYaml(nextData), "utf-8").catch(() => null);

    }

  }

};

const ensureLocalProfiles = async (

  profilesDir: string,

  middlewarePath: string,

) => {

  for (const kind of PROFILE_KINDS) {

    await mkdir(join(profilesDir, kind), { recursive: true });

  }

  const defaultsRoot = join(middlewarePath, "murasaki_flow_v2", "profiles");

  if (!existsSync(defaultsRoot)) return;

  for (const kind of PROFILE_KINDS) {

    const sourceDir = join(defaultsRoot, kind);

    if (!existsSync(sourceDir)) continue;

    const files = await readdir(sourceDir).catch(() => []);

    for (const file of files) {

      const ext = extname(file).toLowerCase();

      if (ext !== ".yaml" && ext !== ".yml") continue;

      const target = join(profilesDir, kind, file);

      if (existsSync(target)) continue;

      await copyFile(join(sourceDir, file), target);

    }

  }

  await patchAndPruneProfiles("api", profilesDir);

  await patchAndPruneProfiles("prompt", profilesDir);

  await patchAndPruneProfiles("pipeline", profilesDir);

  await patchAndPruneProfiles("policy", profilesDir);

  await patchAndPruneProfiles("chunk", profilesDir);

};

const listProfileRefsLocal = async (

  kind: ProfileKind,

  profilesDir: string,

): Promise<LocalProfileRef[]> => {

  const dir = join(profilesDir, kind);

  const files = (await readdir(dir).catch(() => [])).sort();

  const result: LocalProfileRef[] = [];

  for (const file of files) {

    const ext = extname(file).toLowerCase();

    if (ext !== ".yaml" && ext !== ".yml") continue;

    const fullPath = join(dir, file);

    const fallbackId = basename(file, ext);

    let id = fallbackId;

    let name = fallbackId;

    try {

      const raw = await readFile(fullPath, "utf-8");

      const data = safeLoadYaml(raw);

      if (data?.id) id = String(data.id);

      if (data?.name) name = String(data.name);

    } catch {

      // ignore read errors

    }

    result.push({ id, name, filename: file, path: fullPath });

  }

  return result;

};

const resolveProfilePathLocal = async (

  kind: ProfileKind,

  ref: string,

  profilesDir: string,

): Promise<string | null> => {

  if (!ref) return null;

  if (existsSync(ref)) return ref;

  if (ref.endsWith(".yaml") || ref.endsWith(".yml")) {

    const direct = join(profilesDir, kind, ref);

    if (existsSync(direct)) return direct;

  }

  const directYaml = join(profilesDir, kind, `${ref}.yaml`);

  if (existsSync(directYaml)) return directYaml;

  const directYml = join(profilesDir, kind, `${ref}.yml`);

  if (existsSync(directYml)) return directYml;

  const refs = await listProfileRefsLocal(kind, profilesDir);

  const matched = refs.find((item) => item.id === ref);

  return matched ? matched.path : null;

};

const loadProfileLocal = async (

  kind: ProfileKind,

  ref: string,

  profilesDir: string,

) => {

  const path = await resolveProfilePathLocal(kind, ref, profilesDir);

  if (!path) return null;

  const raw = await readFile(path, "utf-8");

  const data = safeLoadYaml(raw) || {};

  const id = String(data.id || basename(path, extname(path)));

  const name = String(data.name || id);

  return { id, name, yaml: raw, data };

};

const saveProfileLocal = async (

  kind: ProfileKind,

  ref: string,

  yamlText: string,

  profilesDir: string,

) => {

  const parsed = safeLoadYaml(yamlText);

  if (!parsed) return { ok: false, error: "invalid_yaml" };

  if (!parsed.id) parsed.id = ref;

  const validation = await validateProfileLocal(kind, parsed, profilesDir);

  if (!validation.ok) {

    return { ok: false, error: { errors: validation.errors } };

  }

  const target = join(profilesDir, kind, `${parsed.id}.yaml`);

  await writeFile(target, dumpYaml(parsed), "utf-8");

  return {

    ok: true,

    id: String(parsed.id),

    warnings: validation.warnings || [],

  };

};

const summarizeStatusCounts = (statuses: number[]) => {

  const counts: Record<string, number> = {};

  for (const status of statuses) {

    const key = String(status);

    counts[key] = (counts[key] || 0) + 1;

  }

  return counts;

};

const classifyConcurrencyFailure = (statuses: number[]) => {

  if (statuses.some((code) => code === 401 || code === 403)) {

    return "concurrency_test_auth";

  }

  if (statuses.some((code) => code === 429)) {

    return "concurrency_test_rate_limited";

  }

  if (statuses.some((code) => code >= 500)) {

    return "concurrency_test_server_error";

  }

  if (statuses.some((code) => code === 0)) {

    return "concurrency_test_network";

  }

  if (statuses.some((code) => code >= 400)) {

    return "concurrency_test_failed";

  }

  return "concurrency_test_failed";

};

const testApiConcurrency = async (

  baseUrl: string,

  apiKey?: string,

  timeoutMs = 8000,

  maxConcurrency = 16,

) => {

  const url = buildModelsUrl(baseUrl);

  if (!url) return { ok: false, message: "base_url_missing" };

  const headers: Record<string, string> = {

    "Content-Type": "application/json",

  };

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const max = Math.min(Math.max(1, Math.floor(maxConcurrency)), 64);

  const runBatch = async (count: number) => {

    const start = Date.now();

    const tasks = Array.from({ length: count }, () =>

      requestWithTimeout(url, { method: "GET", headers }, Math.max(1000, timeoutMs))

        .then((res) => res.status)

        .catch(() => 0),

    );

    const statuses = await Promise.all(tasks);

    const ok = statuses.every((code) => code >= 200 && code < 300);

    return {

      ok,

      statuses,

      counts: summarizeStatusCounts(statuses),

      latencyMs: Date.now() - start,

      reason: ok ? "" : classifyConcurrencyFailure(statuses),

    };

  };

  let low = 0;

  let high = 1;

  let lastCounts: Record<string, number> | undefined;

  let lastLatencyMs: number | undefined;

  let lastReason: string | undefined;

  while (high <= max) {

    const result = await runBatch(high);

    lastCounts = result.counts;

    lastLatencyMs = result.latencyMs;

    if (result.ok) {

      low = high;

      high *= 2;

    } else {

      lastReason = result.reason || "concurrency_test_failed";

      break;

    }

  }

  if (low === 0) {

    return {

      ok: false,

      message: lastReason || "concurrency_test_failed",

      url,

      statusCounts: lastCounts,

      latencyMs: lastLatencyMs,

    };

  }

  if (high > max) {

    return {

      ok: true,

      maxConcurrency: low,

      url,

      statusCounts: lastCounts,

      latencyMs: lastLatencyMs,

    };

  }

  let left = low + 1;

  let right = Math.min(high - 1, max);

  while (left <= right) {

    const mid = Math.floor((left + right) / 2);

    const result = await runBatch(mid);

    lastCounts = result.counts;

    lastLatencyMs = result.latencyMs;

    if (result.ok) {

      low = mid;

      left = mid + 1;

    } else {

      lastReason = result.reason || "concurrency_test_failed";

      right = mid - 1;

    }

  }

  return {

    ok: true,

    maxConcurrency: low,

    url,

    statusCounts: lastCounts,

    latencyMs: lastLatencyMs,

    message: lastReason,

  };

};

const deleteProfileLocal = async (

  kind: ProfileKind,

  ref: string,

  profilesDir: string,

) => {

  const path = await resolveProfilePathLocal(kind, ref, profilesDir);

  if (path && existsSync(path)) {

    await unlink(path).catch(() => null);

  }

  return { ok: true };

};

export const registerPipelineV2Profiles = (deps: ProfileDeps) => {

  const getProfilesDir = deps.getProfilesDir || getPipelineV2ProfilesDir;

  const ensureServer = async () => {

    const currentStatus = getPipelineV2Status();

    if (currentStatus.mode === "local" && !currentStatus.ok) {

      return null;

    }

    try {

      const localDir = getProfilesDir();

      await ensureLocalProfiles(localDir, deps.getMiddlewarePath());

      const baseUrl = await ensurePipelineV2Server({

        getPythonPath: deps.getPythonPath,

        getMiddlewarePath: deps.getMiddlewarePath,

        getProfilesDir,

      });

      return baseUrl;

    } catch (error: any) {

      markPipelineV2Local(

        "server_unavailable",

        error?.message || "server_unavailable",

      );

      return null;

    }

  };

  const ensureLocalDir = async () => {

    const dir = getProfilesDir();

    await ensureLocalProfiles(dir, deps.getMiddlewarePath());

    return dir;

  };

  ipcMain.handle("pipelinev2-status", async () => getPipelineV2Status());

  ipcMain.handle("pipelinev2-retry", async () =>

    retryPipelineV2Server({

      getPythonPath: deps.getPythonPath,

      getMiddlewarePath: deps.getMiddlewarePath,

      getProfilesDir,

    }),

  );

  ipcMain.handle("pipelinev2-profiles-path", async () => {

    const localDir = await ensureLocalDir();

    const baseUrl = await ensureServer();

    if (baseUrl) {

      try {

        const result = await requestJson(baseUrl, "/profiles/dir");

        if (result.ok) {

          markPipelineV2ServerOk();

        }

      } catch (error: any) {

        markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");

      }

    }

    return localDir;

  });

  ipcMain.handle(

    "pipelinev2-profiles-list",

    async (_event, kind: ProfileKind) => {

      if (!PROFILE_KINDS.includes(kind)) return [];

      const localDir = await ensureLocalDir();

      const baseUrl = await ensureServer();

      if (baseUrl) {

        try {

          const result = await requestJson(baseUrl, `/profiles/${kind}`);

          if (result.ok && hasServerProfilesList(result.data)) {

            markPipelineV2ServerOk();

            return result.data;

          }

        } catch (error: any) {

          markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");

        }

      }

      const refs = await listProfileRefsLocal(kind, localDir);

      return refs.map((item) => ({

        id: item.id,

        name: item.name,

        filename: item.filename,

      }));

    },

  );

  ipcMain.handle(

    "pipelinev2-profiles-load",

    async (_event, kind: ProfileKind, id: string) => {

      if (!PROFILE_KINDS.includes(kind)) return null;

      const baseUrl = await ensureServer();

      if (baseUrl) {

        try {

          const result = await requestJson(baseUrl, `/profiles/${kind}/${id}`);

          if (result.ok) {

            markPipelineV2ServerOk();

            return result.data;

          }

        } catch (error: any) {

          markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");

        }

      }

      const localDir = await ensureLocalDir();

      return await loadProfileLocal(kind, id, localDir);

    },

  );

  ipcMain.handle(

    "pipelinev2-profiles-save",

    async (_event, kind: ProfileKind, id: string, yamlText: string) => {

      if (!PROFILE_KINDS.includes(kind)) return { ok: false };

      const baseUrl = await ensureServer();

      if (baseUrl) {

        try {

          const result = await requestJson(baseUrl, `/profiles/${kind}/${id}`, {

            method: "POST",

            body: JSON.stringify({ yaml: yamlText }),

          });

          if (!result.ok) return { ok: false, error: result.error };

          markPipelineV2ServerOk();

          return {

            ok: true,

            id: result.data?.id,

            warnings: result.data?.warnings,

          };

        } catch (error: any) {

          markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");

        }

      }

      const localDir = await ensureLocalDir();

      return await saveProfileLocal(kind, id, yamlText, localDir);

    },

  );

  ipcMain.handle(

    "pipelinev2-profiles-delete",

    async (_event, kind: ProfileKind, id: string) => {

      if (!PROFILE_KINDS.includes(kind)) return { ok: false };

      const baseUrl = await ensureServer();

      if (baseUrl) {

        try {

          const result = await requestJson(baseUrl, `/profiles/${kind}/${id}`, {

            method: "DELETE",

          });

          if (!result.ok) return { ok: false, error: result.error };

          markPipelineV2ServerOk();

          return result.data;

        } catch (error: any) {

          markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");

        }

      }

      const localDir = await ensureLocalDir();

      return await deleteProfileLocal(kind, id, localDir);

    },

  );

  ipcMain.handle(

    "pipelinev2-api-test",

    async (

      _event,

      payload: {
        baseUrl: string;
        apiKey?: string;
        timeoutMs?: number;
        model?: string;
      },

    ) =>

      testApiConnection(

        payload?.baseUrl || "",

        payload?.apiKey,

        payload?.timeoutMs,
        payload?.model,

      ),

  );

  ipcMain.handle(

    "pipelinev2-api-models",

    async (

      _event,

      payload: { baseUrl: string; apiKey?: string; timeoutMs?: number },

    ) =>

      listApiModels(

        payload?.baseUrl || "",

        payload?.apiKey,

        payload?.timeoutMs,

      ),

  );

  ipcMain.handle(

    "pipelinev2-api-concurrency-test",

    async (

      _event,

      payload: {

        baseUrl: string;

        apiKey?: string;

        timeoutMs?: number;

        maxConcurrency?: number;

      },

    ) =>

      testApiConcurrency(

        payload?.baseUrl || "",

        payload?.apiKey,

        payload?.timeoutMs,

        payload?.maxConcurrency,

      ),

  );

};

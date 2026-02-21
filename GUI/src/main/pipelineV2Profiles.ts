import { app, ipcMain } from "electron";

import { join, basename, extname } from "path";

import { existsSync } from "fs";

import {

  copyFile,

  mkdir,

  readdir,

  readFile,

  stat,

  unlink,

  writeFile,

} from "fs/promises";

import yaml from "js-yaml";

import {

  ensurePipelineV2Server,

  getPipelineV2Status,

  markPipelineV2Local,

  markPipelineV2ServerOk,

} from "./pipelineV2Server";

import { validateProfileLocal } from "./pipelineV2Validation";
import {

  hasServerProfilesList,

} from "./pipelineV2ProfileHelpers";
import {
  isSafeProfileId,
  isSafeYamlFilename,
  isPathWithin,
  safeLoadYaml,
  normalizeChunkType,
} from "./pipelineV2Shared";

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

  chunk: new Set([
    "chunk_line_strict",
    "chunk_line_loose",
    "chunk_line_keep",
  ]),

  pipeline: new Set([

    "pipeline_api_doc",

    "pipeline_api_line_strict",

    "pipeline_api_tagged_line",

  ]),

};

type PatchNameEntry = { name: string; aliases?: string[] };

type ProfileFileMeta = {
  mtimeMs: number;
  id: string;
  name: string;
  chunkType?: "" | "line" | "block";
};

const profileFileMetaCache = new Map<string, ProfileFileMeta>();
const PROFILE_INDEX_FILE = "profiles.index.json";
const PROFILE_INDEX_VERSION = 1;
type ProfileIndexCache = {
  version: number;
  kinds: Partial<Record<ProfileKind, Record<string, ProfileFileMeta>>>;
};
const profileIndexDiskCache: {
  dir: string;
  data: ProfileIndexCache | null;
  dirty: boolean;
} = {
  dir: "",
  data: null,
  dirty: false,
};
const buildNextProfileIndexCache = (
  cache: ProfileIndexCache,
  kind: ProfileKind,
  filename: string,
  meta: ProfileFileMeta | null,
): ProfileIndexCache => {
  const nextKinds = { ...cache.kinds };
  const kindCache = { ...(nextKinds[kind] || {}) };
  if (meta) {
    kindCache[filename] = meta;
  } else {
    delete kindCache[filename];
  }
  nextKinds[kind] = kindCache;
  return { ...cache, kinds: nextKinds };
};

const PATCH_PROFILE_NAMES: Partial<
  Record<ProfileKind, Record<string, PatchNameEntry>>
> = {
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
    parser_line_strict: { name: "行严格解析", aliases: ["Line Strict Parser"] },
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
      name: "正则提取 代码块",
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
      aliases: ["Legacy Chunk", "Default Chunk"],
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

export const getPipelineV2ProfilesDir = () =>
  join(app.getPath("userData"), "pipeline_v2_profiles");

type PythonPath = { type: "python" | "bundle"; path: string };

type ProfileDeps = {

  getPythonPath: () => PythonPath;

  getMiddlewarePath: () => string;

  getProfilesDir?: () => string;

};

import { URL } from "url";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const isRootOrV1Path = (clean: string) => {
  try {
    const urlObj = new URL(clean);
    const path = urlObj.pathname.toLowerCase();
    return !path || path === "/" || path.endsWith("/v1") || /\/v\d+$/.test(path) || path.includes("/openapi");
  } catch {
    return true; // Fallback to appending /v1 if invalid URL
  }
};

const buildModelsUrl = (baseUrl: string) => {
  const clean = normalizeBaseUrl(baseUrl);
  if (!clean) return "";
  if (clean.endsWith("/models")) return clean;
  if (clean.endsWith("/openai")) return `${clean}/models`;

  if (isRootOrV1Path(clean)) {
    if (clean.endsWith("/openapi")) return `${clean}/models`;
    if (/\/v\d+$/i.test(clean)) return `${clean}/models`;
    return `${clean}/v1/models`;
  }
  return `${clean}/models`;
};

const buildChatCompletionsUrl = (baseUrl: string) => {
  const clean = normalizeBaseUrl(baseUrl);
  if (!clean) return "";
  if (clean.endsWith("/chat/completions")) return clean;
  if (clean.endsWith("/openai")) return `${clean}/chat/completions`;

  if (isRootOrV1Path(clean)) {
    if (clean.endsWith("/openapi")) return `${clean}/chat/completions`;
    if (/\/v\d+$/i.test(clean)) return `${clean}/chat/completions`;
    return `${clean}/v1/chat/completions`;
  }
  return `${clean}/chat/completions`;
};

const CONCURRENCY_TEST_MESSAGE = "你好";
const CONCURRENCY_TEST_MESSAGE_COUNT = 32;
const CONCURRENCY_TEST_MAX_TOKENS = 8;

const buildConcurrencyTestMessages = (
  count = CONCURRENCY_TEST_MESSAGE_COUNT,
) =>
  Array.from({ length: Math.max(1, Math.floor(count)) }, () => ({
    role: "user",
    content: CONCURRENCY_TEST_MESSAGE,
  }));

const buildConcurrencyTestPayload = (model: string) => ({
  model,
  messages: buildConcurrencyTestMessages(),
  temperature: 0,
  max_tokens: CONCURRENCY_TEST_MAX_TOKENS,
});

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

  timeoutMs = 60000,
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

  timeoutMs = 60000,

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
  timeoutMs = 8000,

) => {

  const res = await requestWithTimeout(
    `${baseUrl}${path}`,
    {

      headers: {

        "Content-Type": "application/json",

        ...(options?.headers || {}),

      },

      ...options,

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

  chunkType?: "" | "line" | "block";

};

type ProfilesListOptions = {

  preferLocal?: boolean;

};

const normalizeProfilesListOptions = (options?: ProfilesListOptions) => ({

  preferLocal: Boolean(options?.preferLocal),

});

const loadProfileIndexDiskCache = async (
  profilesDir: string,
): Promise<ProfileIndexCache> => {
  if (profileIndexDiskCache.dir === profilesDir && profileIndexDiskCache.data) {
    return profileIndexDiskCache.data;
  }
  const cachePath = join(profilesDir, PROFILE_INDEX_FILE);
  try {
    const raw = await readFile(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as ProfileIndexCache;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === PROFILE_INDEX_VERSION &&
      parsed.kinds &&
      typeof parsed.kinds === "object"
    ) {
      profileIndexDiskCache.dir = profilesDir;
      profileIndexDiskCache.data = parsed;
      profileIndexDiskCache.dirty = false;
      return parsed;
    }
  } catch {
    // ignore
  }
  const empty: ProfileIndexCache = {
    version: PROFILE_INDEX_VERSION,
    kinds: {},
  };
  profileIndexDiskCache.dir = profilesDir;
  profileIndexDiskCache.data = empty;
  profileIndexDiskCache.dirty = false;
  return empty;
};

const persistProfileIndexDiskCache = async (profilesDir: string) => {
  if (
    profileIndexDiskCache.dir !== profilesDir ||
    !profileIndexDiskCache.data ||
    !profileIndexDiskCache.dirty
  ) {
    return;
  }
  const cachePath = join(profilesDir, PROFILE_INDEX_FILE);
  try {
    await writeFile(
      cachePath,
      JSON.stringify(profileIndexDiskCache.data, null, 2),
      "utf-8",
    );
    profileIndexDiskCache.dirty = false;
  } catch {
    // ignore
  }
};

const dumpYaml = (data: Record<string, any>) =>

  yaml.dump(data, { lineWidth: 120, sortKeys: false, noRefs: true });

type DefaultProfileMap = Partial<

  Record<ProfileKind, Record<string, Record<string, any>>>

>;

const normalizeYamlForCompare = (data: Record<string, any>) =>

  dumpYaml(data).trim();

const isSameProfileData = (

  left: Record<string, any>,

  right: Record<string, any>,

) => normalizeYamlForCompare(left) === normalizeYamlForCompare(right);

const loadDefaultProfiles = async (

  defaultsRoot: string,

): Promise<DefaultProfileMap> => {

  const defaults: DefaultProfileMap = {};

  for (const kind of PROFILE_KINDS) {

    const dir = join(defaultsRoot, kind);

    if (!existsSync(dir)) continue;

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

      defaults[kind] = defaults[kind] || {};

      (defaults[kind] as Record<string, Record<string, any>>)[id] = data;

    }

  }

  return defaults;

};

const patchAndPruneProfiles = async (

  kind: ProfileKind,

  profilesDir: string,

  defaults?: DefaultProfileMap,

) => {

  const removeIds = PRUNE_PROFILE_IDS[kind];

  const renameMap = PATCH_PROFILE_NAMES[kind];

  if (!removeIds && !renameMap) return;

  const dir = join(profilesDir, kind);

  const files = await readdir(dir).catch(() => []);
  const seenIds = new Map<string, { path: string; canonical: boolean }>();

  for (const file of files) {

    const ext = extname(file).toLowerCase();

    if (ext !== ".yaml" && ext !== ".yml") continue;

    const fullPath = join(dir, file);

    const raw = await readFile(fullPath, "utf-8").catch(() => null);

    if (!raw) continue;

    const data = safeLoadYaml(raw);

    if (!data) continue;

    const id = String(data.id || basename(file, ext));
    const canonical = basename(file, ext) === id;
    const existing = seenIds.get(id);
    if (existing) {
      if (existing.canonical) {
        await unlink(fullPath).catch(() => null);
        continue;
      }
      if (canonical) {
        await unlink(existing.path).catch(() => null);
        seenIds.set(id, { path: fullPath, canonical });
      } else {
        await unlink(fullPath).catch(() => null);
        continue;
      }
    } else {
      seenIds.set(id, { path: fullPath, canonical });
    }

    const defaultData = defaults?.[kind]?.[id];

    const isDefaultProfile = defaultData

      ? isSameProfileData(defaultData, data)

      : false;

    if (removeIds?.has(id) && isDefaultProfile) {

      await unlink(fullPath).catch(() => null);

      continue;

    }

    let nextData: Record<string, any> = data;

    let changed = false;

    const patchEntry = renameMap?.[id];

    if (patchEntry && isDefaultProfile) {

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

    if (isDefaultProfile && kind === "policy" && id === "line_tolerant") {

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

    if (isDefaultProfile && kind === "prompt" && id === PROMPT_DEFAULT_PATCH.id) {

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

  const defaultProfiles = await loadDefaultProfiles(defaultsRoot);

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

  await patchAndPruneProfiles("api", profilesDir, defaultProfiles);

  await patchAndPruneProfiles("prompt", profilesDir, defaultProfiles);

  await patchAndPruneProfiles("pipeline", profilesDir, defaultProfiles);

  await patchAndPruneProfiles("policy", profilesDir, defaultProfiles);

  await patchAndPruneProfiles("chunk", profilesDir, defaultProfiles);

};

const listProfileRefsLocal = async (

  kind: ProfileKind,

  profilesDir: string,

): Promise<LocalProfileRef[]> => {

  const dir = join(profilesDir, kind);

  const files = (await readdir(dir).catch(() => [])).sort();

  const result: LocalProfileRef[] = [];
  const seenIds = new Set<string>();
  const fileSet = new Set<string>();
  const diskFileSet = new Set<string>();
  const diskCache = await loadProfileIndexDiskCache(profilesDir);
  const kindDiskCache = diskCache.kinds[kind] || {};
  const nextKindDiskCache: Record<string, ProfileFileMeta> = { ...kindDiskCache };
  let diskCacheChanged = false;

  for (const file of files) {

    const ext = extname(file).toLowerCase();

    if (ext !== ".yaml" && ext !== ".yml") continue;

    const fullPath = join(dir, file);
    fileSet.add(fullPath);
    diskFileSet.add(file);

    const fallbackId = basename(file, ext);
    if (!isSafeProfileId(fallbackId)) {
      continue;
    }

    let id = fallbackId;

    let name = fallbackId;
    let chunkType: "" | "line" | "block" = "";

    const metaStat = await stat(fullPath).catch(() => null);
    if (!metaStat) continue;
    const cachedMeta = profileFileMetaCache.get(fullPath);
    const diskMeta = kindDiskCache[file];
    const needsChunkType =
      kind === "chunk" && !cachedMeta?.chunkType && !diskMeta?.chunkType;
    if (cachedMeta && cachedMeta.mtimeMs === metaStat.mtimeMs && !needsChunkType) {
      id = cachedMeta.id;
      name = cachedMeta.name;
      if (kind === "chunk") {
        const normalized = normalizeChunkType(cachedMeta.chunkType);
        if (normalized) chunkType = normalized;
      }
      if (
        !diskMeta ||
        diskMeta.mtimeMs !== metaStat.mtimeMs ||
        diskMeta.id !== id ||
        diskMeta.name !== name
      ) {
        nextKindDiskCache[file] = {
          mtimeMs: metaStat.mtimeMs,
          id,
          name,
          chunkType: kind === "chunk" ? chunkType : undefined,
        };
        diskCacheChanged = true;
      }
    } else if (diskMeta && diskMeta.mtimeMs === metaStat.mtimeMs && !needsChunkType) {
      id = diskMeta.id;
      name = diskMeta.name;
      if (kind === "chunk") {
        const normalized = normalizeChunkType(diskMeta.chunkType);
        if (normalized) chunkType = normalized;
      }
      profileFileMetaCache.set(fullPath, {
        mtimeMs: metaStat.mtimeMs,
        id,
        name,
        chunkType: kind === "chunk" ? chunkType : undefined,
      });
    } else {
      try {

        const raw = await readFile(fullPath, "utf-8");

        const data = safeLoadYaml(raw);

        if (data?.id) {
          const candidate = String(data.id);
          if (isSafeProfileId(candidate)) {
            id = candidate;
          }
        }

        if (data?.name) name = String(data.name);
        if (kind === "chunk") {
          const rawChunkType = String(data?.chunk_type || data?.type || "");
          const normalized = normalizeChunkType(rawChunkType);
          if (normalized) chunkType = normalized;
        }

      } catch {

        // ignore read errors

      }
      profileFileMetaCache.set(fullPath, {
        mtimeMs: metaStat.mtimeMs,
        id,
        name,
        chunkType: kind === "chunk" ? chunkType : undefined,
      });
      nextKindDiskCache[file] = {
        mtimeMs: metaStat.mtimeMs,
        id,
        name,
        chunkType: kind === "chunk" ? chunkType : undefined,
      };
      diskCacheChanged = true;
    }

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    result.push({
      id,
      name,
      filename: file,
      path: fullPath,
      chunkType: kind === "chunk" ? chunkType : undefined,
    });

  }

  for (const key of Array.from(profileFileMetaCache.keys())) {
    if (key.startsWith(dir) && !fileSet.has(key)) {
      profileFileMetaCache.delete(key);
    }
  }
  for (const key of Object.keys(nextKindDiskCache)) {
    if (!diskFileSet.has(key)) {
      delete nextKindDiskCache[key];
      diskCacheChanged = true;
    }
  }
  if (diskCacheChanged) {
    diskCache.kinds[kind] = nextKindDiskCache;
    profileIndexDiskCache.dirty = true;
    await persistProfileIndexDiskCache(profilesDir);
  }

  return result;

};

const resolveProfilePathLocal = async (

  kind: ProfileKind,

  ref: string,

  profilesDir: string,

): Promise<string | null> => {

  const trimmed = String(ref || "").trim();
  if (!trimmed) return null;

  if (existsSync(trimmed)) {
    return isPathWithin(profilesDir, trimmed) ? trimmed : null;
  }

  if (trimmed.endsWith(".yaml") || trimmed.endsWith(".yml")) {
    if (!isSafeYamlFilename(trimmed)) return null;
    const direct = join(profilesDir, kind, trimmed);
    if (existsSync(direct)) return direct;
  }

  if (!isSafeProfileId(trimmed)) return null;

  const directYaml = join(profilesDir, kind, `${trimmed}.yaml`);
  if (existsSync(directYaml)) return directYaml;

  const directYml = join(profilesDir, kind, `${trimmed}.yml`);
  if (existsSync(directYml)) return directYml;

  const refs = await listProfileRefsLocal(kind, profilesDir);

  const matched = refs.find((item) => item.id === trimmed);

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

  const fallbackId = basename(path, extname(path));
  const rawId = String(data.id || "").trim();
  const id = isSafeProfileId(rawId) ? rawId : fallbackId;

  const name = String(data.name || id);

  return { id, name, yaml: raw, data };

};

const saveProfileLocal = async (

  kind: ProfileKind,

  ref: string,

  yamlText: string,

  profilesDir: string,

  options?: { allowOverwrite?: boolean },

) => {

  const allowOverwrite = Boolean(options?.allowOverwrite);

  const parsed = safeLoadYaml(yamlText);

  if (!parsed) return { ok: false, error: "invalid_yaml" };

  const fallbackRef = ref.endsWith(".yaml") || ref.endsWith(".yml")
    ? basename(ref, extname(ref))
    : ref;
  const rawId = String(parsed.id || fallbackRef || "").trim();
  if (!isSafeProfileId(rawId)) {
    return { ok: false, error: "invalid_id" };
  }
  parsed.id = rawId;
  if (kind === "chunk") {
    const normalized = normalizeChunkType(parsed.chunk_type ?? parsed.type ?? "");
    if (normalized) parsed.chunk_type = normalized;
  }

  const validation = await validateProfileLocal(kind, parsed, profilesDir);

  if (!validation.ok) {

    return { ok: false, error: { errors: validation.errors } };

  }

  const target = join(profilesDir, kind, `${parsed.id}.yaml`);

  if (!allowOverwrite) {

    const exists = await stat(target)
      .then(() => true)
      .catch(() => false);

    if (exists) {

      return { ok: false, error: "profile_exists" };

    }

  }

  await writeFile(target, dumpYaml(parsed), "utf-8");
  const metaStat = await stat(target).catch(() => null);
  if (metaStat) {
    const id = String(parsed.id);
    const name = String(parsed.name || parsed.id);
    profileFileMetaCache.set(target, { mtimeMs: metaStat.mtimeMs, id, name });
    const diskCache = await loadProfileIndexDiskCache(profilesDir);
    profileIndexDiskCache.data = buildNextProfileIndexCache(
      diskCache,
      kind,
      basename(target),
      {
        mtimeMs: metaStat.mtimeMs,
        id,
        name,
      },
    );
    profileIndexDiskCache.dirty = true;
    await persistProfileIndexDiskCache(profilesDir);
  }

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

  const hasAny = (codes: number[]) =>
    statuses.some((code) => codes.includes(code));

  if (statuses.some((code) => code === 401 || code === 403)) {

    return "concurrency_test_auth";

  }

  if (statuses.some((code) => code === 429)) {

    return "concurrency_test_rate_limited";

  }

  if (hasAny([404])) {
    return "concurrency_test_not_found";
  }

  if (hasAny([400, 405, 415, 422])) {
    return "concurrency_test_bad_request";
  }

  if (hasAny([408, 504])) {
    return "concurrency_test_timeout";
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

  timeoutMs = 60000,

  maxConcurrency = 128,

  model?: string,

) => {

  const url = buildChatCompletionsUrl(baseUrl);

  if (!url) return { ok: false, message: "base_url_missing" };

  const headers: Record<string, string> = {

    "Content-Type": "application/json",

  };

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const max = Math.min(Math.max(1, Math.floor(maxConcurrency)), 128);
  const resolvedModel = String(model || "").trim();
  const body = JSON.stringify(buildConcurrencyTestPayload(resolvedModel || "test"));

  const runBatch = async (count: number) => {

    const start = Date.now();

    const tasks = Array.from({ length: count }, () =>

      requestWithTimeout(
        url,
        { method: "POST", headers, body },
        Math.max(1000, timeoutMs),
      )

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

  const trimmed = String(ref || "").trim();
  if (!trimmed) return { ok: false, error: "invalid_id" };
  const validRef =
    isSafeProfileId(trimmed) ||
    isSafeYamlFilename(trimmed) ||
    (existsSync(trimmed) && isPathWithin(profilesDir, trimmed));
  if (!validRef) return { ok: false, error: "invalid_id" };

  const path = await resolveProfilePathLocal(kind, trimmed, profilesDir);

  if (path && existsSync(path)) {
    await unlink(path).catch(() => null);
    profileFileMetaCache.delete(path);
    const diskCache = await loadProfileIndexDiskCache(profilesDir);
    profileIndexDiskCache.data = buildNextProfileIndexCache(
      diskCache,
      kind,
      basename(path),
      null,
    );
    profileIndexDiskCache.dirty = true;
    await persistProfileIndexDiskCache(profilesDir);
  } else {
    const diskCache = await loadProfileIndexDiskCache(profilesDir);
    const kindCache = diskCache.kinds[kind] || {};
    const hit = Object.entries(kindCache).find(
      ([, meta]) => meta.id === trimmed,
    );
    if (hit) {
      const [filename] = hit;
      profileIndexDiskCache.data = buildNextProfileIndexCache(
        diskCache,
        kind,
        filename,
        null,
      );
      profileIndexDiskCache.dirty = true;
      await persistProfileIndexDiskCache(profilesDir);
    }
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

    async (_event, kind: ProfileKind, options?: ProfilesListOptions) => {

      if (!PROFILE_KINDS.includes(kind)) return [];

      const { preferLocal } = normalizeProfilesListOptions(options);

      const localDir = await ensureLocalDir();

      if (!preferLocal) {
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
      }

      const refs = await listProfileRefsLocal(kind, localDir);

      return refs.map((item) => ({

        id: item.id,

        name: item.name,

        filename: item.filename,

        ...(kind === "chunk" && item.chunkType
          ? { chunk_type: item.chunkType }
          : {}),

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

    "pipelinev2-profiles-load-batch",

    async (_event, kind: ProfileKind, ids: string[]) => {

      if (!PROFILE_KINDS.includes(kind)) return [];

      const list = Array.isArray(ids)
        ? ids.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const uniqueIds = Array.from(new Set(list));
      if (!uniqueIds.length) return [];

      const baseUrl = await ensureServer();
      let localDir: string | null = null;
      const ensureLocalDirOnce = async () => {
        if (!localDir) localDir = await ensureLocalDir();
        return localDir;
      };
      let serverOk = false;
      let errorMessage: string | null = null;

      const entries = await Promise.all(
        uniqueIds.map(async (id) => {
          if (baseUrl) {
            try {
              const result = await requestJson(
                baseUrl,
                `/profiles/${kind}/${id}`,
              );
              if (result.ok) {
                serverOk = true;
                return { id, result: result.data };
              }
            } catch (error: any) {
              if (!errorMessage) {
                errorMessage = error?.message || "fetch_failed";
              }
            }
          }
          const dir = await ensureLocalDirOnce();
          return { id, result: await loadProfileLocal(kind, id, dir) };
        }),
      );

      if (baseUrl) {
        if (serverOk) {
          markPipelineV2ServerOk();
        } else if (errorMessage) {
          markPipelineV2Local("fetch_failed", errorMessage);
        }
      }

      return entries;

    },

  );

  ipcMain.handle(

    "pipelinev2-profiles-save",

    async (

      _event,

      kind: ProfileKind,

      id: string,

      yamlText: string,

      options?: { allowOverwrite?: boolean },

    ) => {

      if (!PROFILE_KINDS.includes(kind)) return { ok: false };

      const allowOverwrite = Boolean(options?.allowOverwrite);

      const baseUrl = await ensureServer();

      if (baseUrl) {

        try {

          const result = await requestJson(baseUrl, `/profiles/${kind}/${id}`, {

            method: "POST",

            body: JSON.stringify({

              yaml: yamlText,

              allow_overwrite: allowOverwrite,

            }),

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

      return await saveProfileLocal(kind, id, yamlText, localDir, {

        allowOverwrite,

      });

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

        model?: string;

      },

    ) =>

      testApiConcurrency(

        payload?.baseUrl || "",

        payload?.apiKey,

        payload?.timeoutMs,

        payload?.maxConcurrency,

        payload?.model,

      ),

  );

  ipcMain.handle(
    "pipelinev2-sandbox-test",
    async (
      _event,
      payload: {
        text: string;
        pipeline: Record<string, any>;
      },
    ) => {
      const baseUrl = await ensureServer();
      if (!baseUrl) {
        return { ok: false, error: "Server not ready" };
      }
      try {
        const res = await requestJson(
          baseUrl,
          "/sandbox",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          60000,
        );
        if (res.ok) {
          return { ok: true, data: res.data };
        }
        return { ok: false, error: res.error };
      } catch (error: any) {
        return { ok: false, error: error?.message || "sandbox_request_failed" };
      }
    },
  );

};

export const __testOnly = {
  buildNextProfileIndexCache,
  buildConcurrencyTestPayload,
  classifyConcurrencyFailure,
  normalizeProfilesListOptions,
};

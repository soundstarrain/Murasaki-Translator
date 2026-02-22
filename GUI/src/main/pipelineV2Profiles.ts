import { app, ipcMain } from "electron";

import { join, basename, extname } from "path";

import { existsSync } from "fs";

import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
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
import { hasServerProfilesList } from "./pipelineV2ProfileHelpers";
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

const fileWriteLocks = new Map<string, Promise<void>>();

const withFileWriteLock = async <T>(
  target: string,
  task: () => Promise<T>,
): Promise<T> => {
  const previous = fileWriteLocks.get(target) || Promise.resolve();
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  fileWriteLocks.set(target, tail);

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseGate?.();
    if (fileWriteLocks.get(target) === tail) {
      fileWriteLocks.delete(target);
    }
  }
};

const writeFileAtomic = async (target: string, content: string) => {
  const token = `${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  const tempPath = `${target}.tmp-${token}`;
  await writeFile(tempPath, content, "utf-8");
  try {
    await rename(tempPath, target);
  } catch {
    try {
      await writeFile(target, content, "utf-8");
    } finally {
      await unlink(tempPath).catch(() => null);
    }
  }
};

const writeFileSafely = (target: string, content: string) =>
  withFileWriteLock(target, () => writeFileAtomic(target, content));

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
    return (
      !path ||
      path === "/" ||
      path.endsWith("/v1") ||
      /\/v\d+$/.test(path) ||
      path.includes("/openapi")
    );
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
const CONCURRENCY_TEST_INITIAL_PROBE = 64;
const CONCURRENCY_TEST_MIN_SUCCESS_RATE = 0.96;
const CONCURRENCY_TEST_ALLOWED_FAILURE_RATIO = 0.04;

const buildConcurrencyTestMessages = (count = CONCURRENCY_TEST_MESSAGE_COUNT) =>
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
    await writeFileSafely(
      cachePath,
      JSON.stringify(profileIndexDiskCache.data, null, 2),
    );
    profileIndexDiskCache.dirty = false;
  } catch {
    // ignore
  }
};

const dumpYaml = (data: Record<string, any>) =>
  yaml.dump(data, { lineWidth: 120, sortKeys: false, noRefs: true });

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
  const nextKindDiskCache: Record<string, ProfileFileMeta> = {
    ...kindDiskCache,
  };
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
    if (
      cachedMeta &&
      cachedMeta.mtimeMs === metaStat.mtimeMs &&
      !needsChunkType
    ) {
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
    } else if (
      diskMeta &&
      diskMeta.mtimeMs === metaStat.mtimeMs &&
      !needsChunkType
    ) {
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

  const fallbackRef =
    ref.endsWith(".yaml") || ref.endsWith(".yml")
      ? basename(ref, extname(ref))
      : ref;
  const rawId = String(parsed.id || fallbackRef || "").trim();
  if (!isSafeProfileId(rawId)) {
    return { ok: false, error: "invalid_id" };
  }
  parsed.id = rawId;
  if (kind === "chunk") {
    const normalized = normalizeChunkType(
      parsed.chunk_type ?? parsed.type ?? "",
    );
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

  await writeFileSafely(target, dumpYaml(parsed));
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

const isHardConcurrencyFailureStatus = (status: number) =>
  status === 401 ||
  status === 403 ||
  status === 404 ||
  status === 400 ||
  status === 405 ||
  status === 415 ||
  status === 422;

const resolveConcurrencyProbeStart = (maxConcurrency: number) =>
  Math.max(
    1,
    Math.min(Math.floor(maxConcurrency), CONCURRENCY_TEST_INITIAL_PROBE),
  );

const assessConcurrencyBatch = (statuses: number[]) => {
  const total = Math.max(1, statuses.length);
  const successCount = statuses.filter(
    (code) => code >= 200 && code < 300,
  ).length;
  const failedCount = total - successCount;
  const successRate = successCount / total;
  const hardFailure = statuses.some((status) =>
    isHardConcurrencyFailureStatus(status),
  );
  const toleratedFailures = Math.max(
    1,
    Math.floor(total * CONCURRENCY_TEST_ALLOWED_FAILURE_RATIO),
  );

  const ok =
    !hardFailure &&
    (failedCount === 0 ||
      (failedCount <= toleratedFailures &&
        successRate >= CONCURRENCY_TEST_MIN_SUCCESS_RATE));

  return {
    ok,
    hardFailure,
    successRate,
    reason: ok ? "" : classifyConcurrencyFailure(statuses),
  };
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
  const body = JSON.stringify(
    buildConcurrencyTestPayload(resolvedModel || "test"),
  );

  const runBatchOnce = async (count: number) => {
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
    return {
      statuses,
      latencyMs: Date.now() - start,
    };
  };

  const runBatch = async (count: number) => {
    const firstRun = await runBatchOnce(count);
    let mergedStatuses = firstRun.statuses;
    let latencyMs = firstRun.latencyMs;
    let assessment = assessConcurrencyBatch(mergedStatuses);

    if (!assessment.ok && !assessment.hardFailure) {
      const retryRun = await runBatchOnce(count);
      mergedStatuses = [...firstRun.statuses, ...retryRun.statuses];
      latencyMs = Math.round((firstRun.latencyMs + retryRun.latencyMs) / 2);
      assessment = assessConcurrencyBatch(mergedStatuses);
    }

    return {
      ok: assessment.ok,
      statuses: mergedStatuses,
      counts: summarizeStatusCounts(mergedStatuses),
      latencyMs,
      reason: assessment.ok
        ? ""
        : assessment.reason || "concurrency_test_failed",
    };
  };

  let low = 0;
  let high = resolveConcurrencyProbeStart(max);

  let lastCounts: Record<string, number> | undefined;

  let lastLatencyMs: number | undefined;

  let lastReason: string | undefined;

  const updateLastMetrics = (result: {
    counts: Record<string, number>;
    latencyMs: number;
    reason: string;
  }) => {
    lastCounts = result.counts;
    lastLatencyMs = result.latencyMs;
    if (result.reason) {
      lastReason = result.reason;
    }
  };

  const initialResult = await runBatch(high);
  updateLastMetrics(initialResult);

  if (!initialResult.ok) {
    let left = 1;
    let right = high - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const result = await runBatch(mid);
      updateLastMetrics(result);
      if (result.ok) {
        low = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
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

    return {
      ok: true,
      maxConcurrency: low,
      url,
      statusCounts: lastCounts,
      latencyMs: lastLatencyMs,
      message: lastReason,
    };
  }

  low = high;
  if (low >= max) {
    return {
      ok: true,
      maxConcurrency: low,
      url,
      statusCounts: lastCounts,
      latencyMs: lastLatencyMs,
    };
  }

  let failAt = 0;
  while (high < max) {
    const next = Math.min(max, high * 2);
    if (next <= high) break;
    const result = await runBatch(next);
    updateLastMetrics(result);
    if (result.ok) {
      low = next;
      high = next;
      if (low >= max) break;
      continue;
    }

    failAt = next;
    break;
  }

  if (failAt > 0) {
    let left = low + 1;
    let right = Math.min(failAt - 1, max);

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const result = await runBatch(mid);
      updateLastMetrics(result);
      if (result.ok) {
        low = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
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
            markPipelineV2Local(
              "fetch_failed",
              error?.message || "fetch_failed",
            );
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
  resolveConcurrencyProbeStart,
  assessConcurrencyBatch,
  normalizeProfilesListOptions,
};

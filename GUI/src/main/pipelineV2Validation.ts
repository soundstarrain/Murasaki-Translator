import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { basename, extname, join, resolve, sep } from "path";
import yaml from "js-yaml";

export type ProfileKind =
  | "api"
  | "prompt"
  | "parser"
  | "policy"
  | "chunk"
  | "pipeline";

type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const SAFE_PROFILE_ID = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

const isSafeProfileId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("..")) return false;
  if (/[\\/]/.test(trimmed)) return false;
  return SAFE_PROFILE_ID.test(trimmed);
};

const isSafeYamlFilename = (value: string) => {
  if (/[\\/]/.test(value)) return false;
  const base = basename(value, extname(value));
  return isSafeProfileId(base);
};

const normalizePath = (value: string) => resolve(value);

const isPathWithin = (baseDir: string, target: string) => {
  const base = normalizePath(baseDir);
  const resolvedTarget = normalizePath(target);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  if (process.platform === "win32") {
    const baseLower = base.toLowerCase();
    const prefixLower = prefix.toLowerCase();
    const targetLower = resolvedTarget.toLowerCase();
    return targetLower === baseLower || targetLower.startsWith(prefixLower);
  }
  return resolvedTarget === base || resolvedTarget.startsWith(prefix);
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

const normalizeChunkType = (value: unknown): "block" | "line" | "" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "line") return "line";
  if (normalized === "block" || normalized === "legacy") return "block";
  return "";
};

const listProfileFiles = async (dir: string) =>
  (await readdir(dir).catch(() => [])).filter(
    (name) =>
      name.toLowerCase().endsWith(".yaml") ||
      name.toLowerCase().endsWith(".yml"),
  );

const resolveProfilePath = async (
  profilesDir: string,
  kind: ProfileKind,
  ref: string,
) => {
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
  const dir = join(profilesDir, kind);
  const files = await listProfileFiles(dir);
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf-8").catch(() => "");
    const data = safeLoadYaml(raw);
    if (data?.id && String(data.id) === trimmed) {
      return join(dir, file);
    }
  }
  return null;
};

const loadProfile = async (
  profilesDir: string,
  kind: ProfileKind,
  ref: string,
) => {
  const path = await resolveProfilePath(profilesDir, kind, ref);
  if (!path) return null;
  const raw = await readFile(path, "utf-8").catch(() => "");
  const data = safeLoadYaml(raw);
  if (!data) return null;
  const id = String(data.id || basename(path, extname(path)));
  const name = String(data.name || id);
  return { id, name, data };
};

const collectPromptText = (prompt: Record<string, any>) => {
  const parts = [
    prompt.persona,
    prompt.style_rules,
    prompt.output_rules,
    prompt.system_template,
    prompt.user_template,
  ];
  return parts
    .filter((item) => typeof item === "string")
    .join("\n")
    .toLowerCase();
};

const hasSourcePlaceholder = (prompt: Record<string, any>) => {
  const userTemplate = String(prompt.user_template || "");
  if (!userTemplate.trim()) return true;
  return userTemplate.includes("{{source}}");
};

const validatePromptParserPair = (
  prompt: Record<string, any>,
  parser: Record<string, any>,
  result: ValidationResult,
) => {
  const parserType = String(parser.type || "");
  const promptText = collectPromptText(prompt);
  if (parserType === "tagged_line") {
    if (!promptText.includes("@@") && !promptText.includes("[[")) {
      result.errors.push("parser_requires_tagged_prompt");
    }
  }
  if (parserType === "json_object" || parserType === "json_array") {
    if (!promptText.includes("json")) {
      result.errors.push("parser_requires_json_prompt");
    }
  }
  if (parserType === "jsonl") {
    if (!promptText.includes("jsonl") && !promptText.includes("json lines") && !promptText.includes("jsonline")) {
      result.errors.push("parser_requires_jsonl_prompt");
    }
  }
};

export const validateProfileLocal = async (
  kind: ProfileKind,
  data: Record<string, any>,
  profilesDir: string,
): Promise<ValidationResult> => {
  const result: ValidationResult = { ok: false, errors: [], warnings: [] };
  if (!data || typeof data !== "object") {
    result.errors.push("invalid_yaml");
    return result;
  }

  if (!data.id) {
    result.errors.push("missing_id");
  } else if (!isSafeProfileId(String(data.id))) {
    result.errors.push("invalid_id");
  }

  if (kind === "prompt") {
    if (!hasSourcePlaceholder(data)) {
      result.errors.push("prompt_missing_source");
    }
  }

  if (kind === "api") {
    const apiType = String(data.type || data.provider || "openai_compat");
    if (apiType === "openai_compat") {
      if (!data.base_url) result.errors.push("missing_base_url");
      if (!data.model) result.errors.push("missing_model");
    } else if (apiType === "pool") {
      const endpoints = data.endpoints;
      let hasEndpoints = false;
      let missingModel = false;
      if (Array.isArray(endpoints)) {
        for (const item of endpoints) {
          if (!item || typeof item !== "object") continue;
          if (item.base_url || item.baseUrl) {
            hasEndpoints = true;
            if (!item.model) missingModel = true;
          }
        }
      }
      const hasMembers = Boolean(
        (Array.isArray(data.members) && data.members.length > 0) ||
          (data.members !== undefined &&
            data.members !== null &&
            !Array.isArray(data.members) &&
            String(data.members).trim()),
      );
      if (!hasEndpoints) {
        result.errors.push("missing_pool_endpoints");
      }
      if (hasEndpoints && missingModel) {
        result.errors.push("missing_pool_model");
      }
      if (hasMembers) {
        result.errors.push("pool_members_unsupported");
      }
    } else {
      result.warnings.push(`unsupported_type:${apiType}`);
    }
    if (data.rpm !== undefined && data.rpm !== null && data.rpm !== "") {
      const rpmValue = Number.parseInt(String(data.rpm), 10);
      if (!Number.isFinite(rpmValue) || rpmValue < 1) {
        result.errors.push("invalid_rpm");
      }
    }
    if (data.timeout !== undefined && data.timeout !== null && data.timeout !== "") {
      const timeoutValue = Number(data.timeout);
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        result.errors.push("invalid_timeout");
      }
    }
  }

  if (kind === "parser") {
    const parserType = String(data.type || "");
    if (!parserType) result.errors.push("missing_field:type");
    if (parserType === "regex") {
      if (!data.options?.pattern) result.errors.push("missing_pattern");
    }
    if (parserType === "json_object") {
      if (!data.options?.path && !data.options?.key) {
        result.errors.push("missing_json_path");
      }
    }
    if (parserType === "jsonl") {
      if (data.options && !data.options.path && !data.options.key) {
        result.warnings.push("missing_json_path");
      }
    }
    if (parserType === "any") {
      const parsers = data.options?.parsers || data.options?.candidates;
      if (!Array.isArray(parsers) || !parsers.length) {
        result.errors.push("missing_any_parsers");
      }
    }
    if (parserType === "python") {
      if (!data.options?.script && !data.options?.path) {
        result.errors.push("missing_script");
      }
    }
  }

  if (kind === "policy") {
    const policyType = String(data.type || "");
    if (!policyType) result.errors.push("missing_field:type");
    if (policyType && !["strict", "tolerant"].includes(policyType)) {
      result.warnings.push(`unsupported_type:${policyType}`);
    }
    const options = data.options || {};
    const similarityRaw =
      options.similarity_threshold ?? options.similarity ?? options.similarityThreshold;
    if (similarityRaw !== undefined && similarityRaw !== null && similarityRaw !== "") {
      const similarityValue = Number(similarityRaw);
      if (!Number.isFinite(similarityValue) || similarityValue <= 0 || similarityValue > 1) {
        result.errors.push("invalid_similarity_threshold");
      }
    }
  }

  if (kind === "chunk") {
    const rawChunkType = String(data.chunk_type || data.type || "");
    const chunkType = normalizeChunkType(rawChunkType);
    if (!rawChunkType.trim()) result.errors.push("missing_field:chunk_type");
    if (rawChunkType.trim() && !chunkType) {
      result.warnings.push(`unsupported_type:${rawChunkType}`);
    }
    const options = data.options || {};
    const targetRaw = options.target_chars ?? options.targetChars;
    if (targetRaw !== undefined && targetRaw !== null && targetRaw !== "") {
      const targetValue = Number(targetRaw);
      if (!Number.isFinite(targetValue) || targetValue <= 0) {
        result.errors.push("invalid_target_chars");
      }
    }
    const maxRaw = options.max_chars ?? options.maxChars;
    if (maxRaw !== undefined && maxRaw !== null && maxRaw !== "") {
      const maxValue = Number(maxRaw);
      if (!Number.isFinite(maxValue) || maxValue <= 0) {
        result.errors.push("invalid_max_chars");
      } else if (
        targetRaw !== undefined &&
        targetRaw !== null &&
        targetRaw !== "" &&
        Number.isFinite(Number(targetRaw)) &&
        maxValue < Number(targetRaw)
      ) {
        result.errors.push("invalid_max_chars");
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
        result.errors.push("invalid_balance_threshold");
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
        result.errors.push("invalid_balance_count");
      }
    }
  }

  if (kind === "pipeline") {
    for (const field of ["provider", "prompt", "parser", "chunk_policy"]) {
      if (!data[field]) {
        result.errors.push(`missing_field:${field}`);
      }
    }
    if (data.apply_line_policy && !data.line_policy) {
      result.errors.push("missing_field:line_policy");
    }

    const refs: Array<[string, ProfileKind]> = [
      ["provider", "api"],
      ["prompt", "prompt"],
      ["parser", "parser"],
      ["line_policy", "policy"],
      ["chunk_policy", "chunk"],
    ];
    for (const [field, refKind] of refs) {
      const refId = String(data[field] || "");
      if (!refId) continue;
      const exists = await resolveProfilePath(profilesDir, refKind, refId);
      if (!exists) {
        result.errors.push(`missing_reference:${refKind}:${refId}`);
      }
    }

    const chunkRef = String(data.chunk_policy || "");
    if (chunkRef) {
    const chunkProfile = await loadProfile(profilesDir, "chunk", chunkRef);
    const chunkType = normalizeChunkType(
      chunkProfile?.data?.chunk_type || chunkProfile?.data?.type || "",
    );
      if (data.apply_line_policy && chunkType && chunkType !== "line") {
        result.errors.push("line_policy_requires_line_chunk");
      }
      if (chunkType === "line" && !data.line_policy) {
        result.errors.push("line_chunk_missing_line_policy");
      }
    }

    const promptRef = String(data.prompt || "");
    const parserRef = String(data.parser || "");
    if (promptRef && parserRef) {
      const promptProfile = await loadProfile(profilesDir, "prompt", promptRef);
      const parserProfile = await loadProfile(profilesDir, "parser", parserRef);
      if (promptProfile?.data && parserProfile?.data) {
        if (!hasSourcePlaceholder(promptProfile.data)) {
          result.errors.push("prompt_missing_source");
        }
        validatePromptParserPair(
          promptProfile.data,
          parserProfile.data,
          result,
        );
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
};

export const validatePipelineRun = async (
  profilesDir: string,
  pipelineId: string,
): Promise<ValidationResult> => {
  const pipelineProfile = await loadProfile(
    profilesDir,
    "pipeline",
    pipelineId,
  );
  if (!pipelineProfile?.data) {
    return {
      ok: false,
      errors: [`missing_reference:pipeline:${pipelineId}`],
      warnings: [],
    };
  }
  return await validateProfileLocal(
    "pipeline",
    pipelineProfile.data,
    profilesDir,
  );
};

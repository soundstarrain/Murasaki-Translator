/**
 * Shared utility functions for Pipeline V2 modules.
 * Extracted from pipelineV2Validation.ts and pipelineV2Profiles.ts
 * to avoid code duplication.
 */

import { basename, extname, resolve, sep } from "path";
import yaml from "js-yaml";

const SAFE_PROFILE_ID = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

export const isSafeProfileId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("..")) return false;
  if (/[\\/]/.test(trimmed)) return false;
  return SAFE_PROFILE_ID.test(trimmed);
};

export const isSafeYamlFilename = (value: string) => {
  if (/[\\/]/.test(value)) return false;
  const base = basename(value, extname(value));
  return isSafeProfileId(base);
};

export const normalizePath = (value: string) => resolve(value);

export const isPathWithin = (baseDir: string, target: string) => {
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

export const safeLoadYaml = (raw: string): Record<string, any> | null => {
  try {
    const data = yaml.load(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as Record<string, any>;
  } catch {
    return null;
  }
};

export const normalizeChunkType = (value: unknown): "" | "line" | "block" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "line") return "line";
  if (normalized === "block") return "block";
  return "";
};

export const parseBooleanFlag = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return Boolean(value);
};

export const normalizeProfileCompatibility = (
  kind: string,
  data: Record<string, any>,
): boolean => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  let changed = false;

  if (kind === "api" && "strict_concurrency" in data) {
    const normalizedStrict = parseBooleanFlag(data.strict_concurrency);
    if (data.strict_concurrency !== normalizedStrict) {
      data.strict_concurrency = normalizedStrict;
      changed = true;
    }
  }

  return changed;
};

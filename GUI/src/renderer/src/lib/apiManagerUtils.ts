import { createUniqueProfileId } from "./profileId";

export const normalizePresetUrl = (value: string) => {
  const cleaned = value.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (cleaned.endsWith("/v1/chat/completions")) {
    return cleaned.replace(/\/chat\/completions$/, "");
  }
  let path = "";
  try {
    path = new URL(cleaned).pathname.toLowerCase();
  } catch {
    path = cleaned.toLowerCase();
  }
  if (/\/v\d+(?:\/|$)/.test(path) || path.includes("/openapi")) {
    return cleaned;
  }
  return `${cleaned}/v1`;
};

export const buildApiPresetProfileId = (
  presetId: string,
  existingIds: string[],
) => {
  const trimmed = presetId.trim();
  const baseId = trimmed ? `${trimmed}_client` : "new_api";
  return createUniqueProfileId(baseId, existingIds);
};

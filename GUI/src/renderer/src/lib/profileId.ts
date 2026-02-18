export const slugifyProfileId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

export const createUniqueProfileId = (
  baseId: string,
  existingIds: string[],
  currentId?: string,
) => {
  const fallback = baseId.trim() || "profile";
  const taken = new Set(existingIds);
  if (currentId) taken.delete(currentId);
  if (!taken.has(fallback)) return fallback;
  let index = 2;
  let candidate = `${fallback}_${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${fallback}_${index}`;
  }
  return candidate;
};

export type WatchFolderConfigInput = {
  id: string;
  path: string;
  includeSubdirs?: boolean;
  fileTypes?: string[];
  enabled?: boolean;
  createdAt?: string;
};

export type WatchFolderConfig = {
  id: string;
  path: string;
  includeSubdirs: boolean;
  fileTypes: string[];
  enabled: boolean;
  createdAt?: string;
};

export const normalizeWatchFileTypes = (types?: string[]) =>
  (types || [])
    .map((type) => type.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

export const normalizeWatchFolderConfig = (
  entry: WatchFolderConfigInput,
): WatchFolderConfig => ({
  id: entry.id,
  path: String(entry.path || "").trim(),
  includeSubdirs: Boolean(entry.includeSubdirs),
  enabled: entry.enabled !== false,
  fileTypes: normalizeWatchFileTypes(entry.fileTypes),
  createdAt: entry.createdAt,
});

export const filterWatchFilesByTypes = (
  paths: string[],
  types: string[],
  supportedExtensions: string[],
) => {
  const normalizedTypes = normalizeWatchFileTypes(types);
  const allowed = new Set(normalizedTypes);
  const supported = new Set(
    (supportedExtensions || []).map((ext) => ext.toLowerCase()),
  );
  return (paths || []).filter((path) => {
    const ext = "." + (path.split(".").pop() || "").toLowerCase();
    if (!supported.has(ext)) return false;
    if (allowed.size === 0) return true;
    return allowed.has(ext.slice(1));
  });
};

export const isLikelyTranslatedOutput = (
  filePath: string,
  modelNames: string[],
  supportedExtensions: string[],
) => {
  const fileName = (filePath || "").split(/[/\\]/).pop() || "";
  const lowerName = fileName.toLowerCase();
  const extIndex = lowerName.lastIndexOf(".");
  const ext = extIndex >= 0 ? lowerName.slice(extIndex) : "";
  if (!supportedExtensions.map((e) => e.toLowerCase()).includes(ext)) {
    return false;
  }
  const baseName =
    extIndex >= 0 ? fileName.slice(0, fileName.length - ext.length) : fileName;
  const baseLower = baseName.toLowerCase();
  if (baseLower.endsWith("_translated")) return true;
  for (const model of modelNames || []) {
    const normalized = String(model || "")
      .trim()
      .replace(/\.gguf$/i, "")
      .toLowerCase();
    if (!normalized) continue;
    if (baseLower.endsWith(`_${normalized}`)) return true;
  }
  return false;
};

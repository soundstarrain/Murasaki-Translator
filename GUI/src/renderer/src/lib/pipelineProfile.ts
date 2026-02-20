export type PipelineSummary = {
  id: string;
  name: string;
  provider: string;
  prompt: string;
  parser: string;
  linePolicy: string;
  chunkPolicy: string;
};

export type PipelineTranslationMode = "line" | "block";

export type PipelineChunkTypeIndex = Record<
  string,
  PipelineTranslationMode | ""
>;

const toSafeString = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

const normalizeTranslationMode = (
  value: unknown,
): PipelineTranslationMode | "" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "line" || normalized === "block") return normalized;
  return "";
};

const inferChunkType = (
  ref: string,
  chunkTypeIndex: PipelineChunkTypeIndex,
) => {
  if (!ref) return "";
  const known = chunkTypeIndex[ref];
  return known || "";
};

export const buildPipelineSummary = (
  data: unknown,
  fallback?: { id?: string; name?: string },
): PipelineSummary => {
  const raw =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const applyLinePolicy = Boolean(
    raw.apply_line_policy ?? raw.applyLinePolicy ?? false,
  );
  const linePolicy = applyLinePolicy
    ? toSafeString(raw.line_policy ?? raw.linePolicy ?? "")
    : "";

  return {
    id: toSafeString(raw.id ?? fallback?.id ?? ""),
    name: toSafeString(raw.name ?? fallback?.name ?? ""),
    provider: toSafeString(raw.provider ?? ""),
    prompt: toSafeString(raw.prompt ?? ""),
    parser: toSafeString(raw.parser ?? ""),
    linePolicy,
    chunkPolicy: toSafeString(raw.chunk_policy ?? raw.chunkPolicy ?? ""),
  };
};

export const prunePipelineSummaryIndex = (
  prev: Record<string, PipelineSummary>,
  visibleIds: string[],
): Record<string, PipelineSummary> => {
  const prevKeys = Object.keys(prev);
  if (!visibleIds.length) {
    return prevKeys.length ? {} : prev;
  }
  const visibleSet = new Set(visibleIds);
  const nextEntries = prevKeys
    .filter((id) => visibleSet.has(id))
    .map((id) => [id, prev[id]] as const);
  return nextEntries.length === prevKeys.length
    ? prev
    : Object.fromEntries(nextEntries);
};

export const resolvePipelineTranslationMode = (
  mode: unknown,
  chunkPolicy: string,
  linePolicy: string,
  applyLinePolicy: boolean,
  fallback: PipelineTranslationMode,
  chunkTypeIndex: PipelineChunkTypeIndex,
): PipelineTranslationMode => {
  const normalized = normalizeTranslationMode(mode);
  if (normalized) return normalized;
  const chunkType = inferChunkType(chunkPolicy, chunkTypeIndex);
  if (chunkType === "line") return "line";
  if (chunkType === "block") return "block";
  if (applyLinePolicy && linePolicy) return "line";
  return fallback;
};

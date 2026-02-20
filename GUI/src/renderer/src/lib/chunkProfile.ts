export type ChunkType = "legacy" | "line";

export const normalizeChunkType = (value: unknown): ChunkType => {
  if (typeof value !== "string") return "legacy";
  const normalized = value.trim().toLowerCase();
  if (normalized === "line") return "line";
  return "legacy";
};

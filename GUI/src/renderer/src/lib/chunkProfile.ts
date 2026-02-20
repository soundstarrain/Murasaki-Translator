export type ChunkType = "block" | "line";

export const normalizeChunkType = (value: unknown): ChunkType | "" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "line") return "line";
  if (normalized === "block" || normalized === "legacy") return "block";
  return "";
};

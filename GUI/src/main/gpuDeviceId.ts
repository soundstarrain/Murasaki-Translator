const CUDA_DEVICE_TOKEN_PATTERN =
  /^(?:-1|\d+|GPU-[A-Za-z0-9-]+|MIG-[A-Za-z0-9/-]+)$/i;

/**
 * Normalize user-provided GPU device selectors for CUDA_VISIBLE_DEVICES.
 * Supports:
 * - Index list: 0 / 0,1 / 0 1
 * - GPU UUID: GPU-xxxxxxxx
 * - MIG UUID: MIG-xxxxxxxx
 */
export const normalizeCudaVisibleDevices = (
  rawValue: unknown,
): string | undefined => {
  if (rawValue === undefined || rawValue === null) return undefined;
  const raw = String(rawValue).trim();
  if (!raw) return undefined;

  const tokens = raw
    .split(/[,\s;，；]+/)
    .map((token) => token.trim())
    .filter((token) => Boolean(token));

  if (tokens.length === 0) return undefined;

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const token of tokens) {
    if (!CUDA_DEVICE_TOKEN_PATTERN.test(token)) continue;
    const canonical = /^\d+$/.test(token)
      ? String(Number.parseInt(token, 10))
      : token;
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    normalized.push(canonical);
  }

  if (normalized.length === 0) return undefined;
  return normalized.join(",");
};

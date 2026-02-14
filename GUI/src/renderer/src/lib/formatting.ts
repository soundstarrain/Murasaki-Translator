export function formatGlobalValue(
  value: string | number | null | undefined,
  fallback: string,
  maxLength = 20,
) {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }
  const text = String(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `...${text.slice(-maxLength)}`;
}

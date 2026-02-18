export const isParserProfileBlank = (data: any): boolean => {
  if (!data || typeof data !== "object") return true;
  const rawType = data.type;
  const typeValue =
    typeof rawType === "string" ? rawType.trim() : rawType ?? "";
  if (String(typeValue).trim()) return false;
  const options = data.options;
  if (options && typeof options === "object") {
    return Object.keys(options).length === 0;
  }
  return true;
};

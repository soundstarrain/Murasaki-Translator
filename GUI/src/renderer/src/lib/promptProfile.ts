const normalizePromptPart = (value: unknown) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

export const hasPromptSourcePlaceholder = (data: any) => {
  const userTemplate = normalizePromptPart(data?.user_template);
  if (!userTemplate) return true;
  return userTemplate.includes("{{source}}");
};

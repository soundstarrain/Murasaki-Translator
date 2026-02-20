export type PromptLegacyParts = {
  persona: string;
  styleRules: string;
  outputRules: string;
  systemTemplate: string;
  combined: string;
};

const normalizePromptPart = (value: any) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

export const buildPromptLegacyParts = (data: any) => {
  const persona = normalizePromptPart(data?.persona);
  const styleRules = normalizePromptPart(data?.style_rules);
  const outputRules = normalizePromptPart(data?.output_rules);
  const systemTemplate = normalizePromptPart(data?.system_template);
  const hasLegacyParts = Boolean(persona || styleRules || outputRules);
  const combined = [persona, styleRules, outputRules, systemTemplate]
    .filter(Boolean)
    .join("\n\n");

  return {
    combined: hasLegacyParts ? combined : systemTemplate,
    legacy: hasLegacyParts
      ? {
          persona,
          styleRules,
          outputRules,
          systemTemplate,
          combined,
        }
      : null,
  };
};

export const shouldPreserveLegacyPromptParts = (
  legacy: PromptLegacyParts | null,
  currentSystemTemplate: string,
) => {
  if (!legacy) return false;
  return (
    normalizePromptPart(currentSystemTemplate) ===
    normalizePromptPart(legacy.combined)
  );
};

export const hasPromptSourcePlaceholder = (data: any) => {
  const userTemplate = String(data?.user_template || "");
  if (!userTemplate.trim()) return true;
  return userTemplate.includes("{{source}}");
};

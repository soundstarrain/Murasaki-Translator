import { describe, it, expect } from "vitest";
import {
  buildPromptLegacyParts,
  hasPromptSourcePlaceholder,
  shouldPreserveLegacyPromptParts,
} from "../promptProfile";

describe("promptProfile helpers", () => {
  it("builds legacy parts when persona/style/output exist", () => {
    const data = {
      persona: "Persona",
      style_rules: "Style",
      output_rules: "Output",
      system_template: "System",
    };
    const result = buildPromptLegacyParts(data);
    expect(result.legacy).not.toBeNull();
    expect(result.combined).toBe("Persona\n\nStyle\n\nOutput\n\nSystem");
  });

  it("skips legacy when only system_template exists", () => {
    const data = {
      system_template: "System only",
    };
    const result = buildPromptLegacyParts(data);
    expect(result.legacy).toBeNull();
    expect(result.combined).toBe("System only");
  });

  it("preserves legacy when combined template is unchanged", () => {
    const data = {
      persona: "Persona",
      style_rules: "Style",
      output_rules: "Output",
      system_template: "System",
    };
    const result = buildPromptLegacyParts(data);
    expect(
      shouldPreserveLegacyPromptParts(result.legacy, result.combined),
    ).toBe(true);
    expect(
      shouldPreserveLegacyPromptParts(result.legacy, "Changed"),
    ).toBe(false);
  });

  it("detects source placeholder in user_template", () => {
    expect(hasPromptSourcePlaceholder({ user_template: "" })).toBe(true);
    expect(hasPromptSourcePlaceholder({ user_template: "No source" })).toBe(false);
    expect(
      hasPromptSourcePlaceholder({ user_template: "Use {{source}} here" }),
    ).toBe(true);
  });
});

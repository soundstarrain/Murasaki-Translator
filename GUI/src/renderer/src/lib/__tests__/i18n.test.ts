import { describe, it, expect } from "vitest";
import { translations } from "../i18n";

const quickStartKeys = [
  "quickStartTitle",
  "quickStartDesc",
  "quickStartStep",
  "quickStartDismiss",
  "quickStartModel",
  "quickStartGoModel",
  "quickStartModelDesc",
  "quickStartQueue",
  "quickStartGoQueue",
  "quickStartQueueDesc",
  "quickStartStart",
  "quickStartRun",
  "quickStartStartDesc",
] as const;

describe("i18n", () => {
  it("does not include quick start strings in dashboard translations", () => {
    for (const lang of Object.values(translations)) {
      const dashboard = (lang as { dashboard?: Record<string, unknown> }).dashboard;
      expect(dashboard).toBeTruthy();
      for (const key of quickStartKeys) {
        expect(Object.prototype.hasOwnProperty.call(dashboard, key)).toBe(false);
      }
    }
  });

  it("includes python example in placeholders", () => {
    for (const lang of Object.values(translations)) {
      const ruleEditor = (lang as { ruleEditor?: { python?: { placeholder?: string } } })
        .ruleEditor;
      const placeholder = ruleEditor?.python?.placeholder;
      expect(placeholder).toBeTruthy();
      expect(placeholder).toContain("import re");
      expect(placeholder).toContain("def transform");
      expect(placeholder).toContain("\n");
    }
  });
});

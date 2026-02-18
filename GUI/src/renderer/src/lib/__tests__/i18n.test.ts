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

function collectStrings(value: unknown, results: string[]): void {
  if (typeof value === "string") {
    results.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, results);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, results);
    }
  }
}

describe("i18n", () => {
  it("does not include quick start strings in dashboard translations", () => {
    for (const lang of Object.values(translations)) {
      const dashboard = (lang as { dashboard?: Record<string, unknown> })
        .dashboard;
      expect(dashboard).toBeTruthy();
      for (const key of quickStartKeys) {
        expect(Object.prototype.hasOwnProperty.call(dashboard, key)).toBe(
          false,
        );
      }
    }
  });

  it("does not include garbled placeholder strings", () => {
    const texts: string[] = [];
    for (const lang of Object.values(translations)) {
      collectStrings(lang, texts);
    }
    for (const text of texts) {
      expect(text).not.toContain("�");
      expect(text).not.toMatch(/\?{2,}/);
    }
  });

  it("includes python example in placeholders", () => {
    for (const lang of Object.values(translations)) {
      const ruleEditor = (
        lang as { ruleEditor?: { python?: { placeholder?: string } } }
      ).ruleEditor;
      const placeholder = ruleEditor?.python?.placeholder;
      expect(placeholder).toBeTruthy();
      expect(placeholder).toContain("import re");
      expect(placeholder).toContain("def transform");
      expect(placeholder).toContain("\n");
    }
  });

  it("keeps dashboard terminal label free of count placeholders", () => {
    for (const lang of Object.values(translations)) {
      const dashboard = (lang as { dashboard?: { terminal?: string } })
        .dashboard;
      const terminalLabel = dashboard?.terminal;
      expect(terminalLabel).toBeTruthy();
      expect(terminalLabel).not.toContain("{count}");
    }
  });
});

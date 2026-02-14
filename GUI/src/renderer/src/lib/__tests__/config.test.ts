import { describe, it, expect } from "vitest";
import { APP_CONFIG, DEFAULT_POST_RULES } from "../config";

describe("config", () => {
  it("exposes app config metadata", () => {
    expect(APP_CONFIG.name).toBeTruthy();
    expect(APP_CONFIG.version).toMatch(/\d+\.\d+\.\d+/);
    expect(APP_CONFIG.docsUrl).toContain("github.com");
  });

  it("provides default post rules", () => {
    expect(DEFAULT_POST_RULES.length).toBeGreaterThan(0);
    const first = DEFAULT_POST_RULES[0];
    expect(first).toHaveProperty("type");
    expect(first).toHaveProperty("active");
  });
});

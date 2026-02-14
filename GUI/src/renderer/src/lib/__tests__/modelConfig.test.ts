import { describe, it, expect } from "vitest";
import { identifyModel } from "../modelConfig";

describe("modelConfig", () => {
  it("identifies murasaki model", () => {
    const config = identifyModel("C:/models/Murasaki-8B-v0.2-IQ4_XS.gguf");
    expect(config).not.toBeNull();
    expect(config?.displayName).toContain("Murasaki");
    expect(config?.displayName).toContain("8B");
    expect(config?.displayName).toContain("v0.2");
    expect(config?.displayName).toContain("IQ4_XS");
  });

  it("identifies non-murasaki model", () => {
    const config = identifyModel("/tmp/Foo-7B-Q4_K_M.gguf");
    expect(config).not.toBeNull();
    expect(config?.displayName).toBe("Foo-7B-Q4_K_M");
  });
});

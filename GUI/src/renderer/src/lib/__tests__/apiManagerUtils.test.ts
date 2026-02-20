import { describe, it, expect } from "vitest";
import { buildApiPresetProfileId, normalizePresetUrl } from "../apiManagerUtils";

describe("normalizePresetUrl", () => {
  it("appends /v1 when no version segment is present", () => {
    expect(normalizePresetUrl("https://api.example.com")).toBe(
      "https://api.example.com/v1",
    );
  });

  it("keeps existing versioned base urls", () => {
    expect(normalizePresetUrl("https://api.example.com/v2")).toBe(
      "https://api.example.com/v2",
    );
    expect(normalizePresetUrl("api.example.com/v3/")).toBe(
      "api.example.com/v3",
    );
  });

  it("keeps openapi endpoints", () => {
    expect(normalizePresetUrl("https://api.example.com/openapi")).toBe(
      "https://api.example.com/openapi",
    );
    expect(normalizePresetUrl("https://api.example.com/openapi.json")).toBe(
      "https://api.example.com/openapi.json",
    );
  });

  it("strips chat/completions suffix for openai-compatible urls", () => {
    expect(
      normalizePresetUrl("https://api.openai.com/v1/chat/completions"),
    ).toBe("https://api.openai.com/v1");
  });
});

describe("buildApiPresetProfileId", () => {
  it("uses the preset base id when available", () => {
    expect(buildApiPresetProfileId("openai", [])).toBe("openai_client");
  });

  it("increments suffix when conflicts exist", () => {
    expect(buildApiPresetProfileId("openai", ["openai_client"])).toBe(
      "openai_client_2",
    );
  });

  it("skips used suffixes", () => {
    expect(
      buildApiPresetProfileId("openai", [
        "openai_client",
        "openai_client_2",
      ]),
    ).toBe("openai_client_3");
  });
});

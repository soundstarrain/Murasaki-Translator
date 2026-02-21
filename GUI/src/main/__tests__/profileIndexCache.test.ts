import { describe, expect, it } from "vitest";
import { __testOnly } from "../pipelineV2Profiles";

describe("profile index cache helpers", () => {
  it("buildNextProfileIndexCache upserts and removes entries", () => {
    const { buildNextProfileIndexCache } = __testOnly;
    const base = {
      version: 1,
      kinds: {
        api: {
          "a.yaml": { mtimeMs: 10, id: "a", name: "A" },
        },
      },
    };

    const added = buildNextProfileIndexCache(base, "api", "b.yaml", {
      mtimeMs: 20,
      id: "b",
      name: "B",
    });

    expect(added).not.toBe(base);
    expect(added.kinds.api).not.toBe(base.kinds.api);
    expect(added.kinds.api?.["a.yaml"]).toEqual(base.kinds.api?.["a.yaml"]);
    expect(added.kinds.api?.["b.yaml"]).toEqual({
      mtimeMs: 20,
      id: "b",
      name: "B",
    });
    expect((base.kinds.api as any)?.["b.yaml"]).toBeUndefined();

    const removed = buildNextProfileIndexCache(added, "api", "a.yaml", null);
    expect(removed.kinds.api?.["a.yaml"]).toBeUndefined();
    expect(removed.kinds.api?.["b.yaml"]).toEqual({
      mtimeMs: 20,
      id: "b",
      name: "B",
    });
  });

  it("normalizeProfilesListOptions coerces preferLocal flag", () => {
    const { normalizeProfilesListOptions } = __testOnly;
    expect(normalizeProfilesListOptions()).toEqual({ preferLocal: false });
    expect(normalizeProfilesListOptions({ preferLocal: true })).toEqual({
      preferLocal: true,
    });
    expect(normalizeProfilesListOptions({ preferLocal: false })).toEqual({
      preferLocal: false,
    });
  });
});

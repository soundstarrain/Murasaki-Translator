import { describe, expect, it } from "vitest";
import {
  canUseServerProfilesPath,
  hasServerProfilesList,
} from "../pipelineV2ProfileHelpers";

describe("pipelineV2ProfileHelpers", () => {
  it("canUseServerProfilesPath checks path readability", () => {
    const exists = (value: string) => value === "C:/ok/path";

    expect(canUseServerProfilesPath("C:/ok/path", exists)).toBe(true);
    expect(canUseServerProfilesPath("", exists)).toBe(false);
    expect(canUseServerProfilesPath("   ", exists)).toBe(false);
    expect(canUseServerProfilesPath(null, exists)).toBe(false);
    expect(canUseServerProfilesPath(undefined, exists)).toBe(false);
    expect(canUseServerProfilesPath(123, exists)).toBe(false);
  });

  it("hasServerProfilesList checks array payloads", () => {
    expect(hasServerProfilesList([{ id: "a" }])).toBe(true);
    expect(hasServerProfilesList([{}])).toBe(true);
    expect(hasServerProfilesList([])).toBe(true);
    expect(hasServerProfilesList(null)).toBe(false);
    expect(hasServerProfilesList({})).toBe(false);
  });
});

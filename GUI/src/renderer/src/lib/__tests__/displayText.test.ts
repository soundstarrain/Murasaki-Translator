import { describe, it, expect } from "vitest";
import { stripSystemMarkersForDisplay } from "../displayText";

describe("displayText", () => {
  it("strips system markers", () => {
    const input = "@id=1@ hello @end=1@";
    expect(stripSystemMarkersForDisplay(input)).toBe("hello");
  });

  it("strips inline system markers", () => {
    const input = "a @id=2@ b @end=2@ c";
    expect(stripSystemMarkersForDisplay(input)).toBe("a  b  c");
  });

  it("keeps normal @ tokens", () => {
    const input = "contact me at a@b.com";
    expect(stripSystemMarkersForDisplay(input)).toBe(input);
  });
});

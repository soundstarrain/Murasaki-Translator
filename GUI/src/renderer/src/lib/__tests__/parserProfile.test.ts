import { describe, it, expect } from "vitest";
import { isParserProfileBlank } from "../parserProfile";

describe("isParserProfileBlank", () => {
  it("treats id/name only as blank", () => {
    expect(isParserProfileBlank({ id: "new_parser", name: "New Parser" })).toBe(
      true,
    );
  });

  it("treats empty type as blank", () => {
    expect(isParserProfileBlank({ type: "" })).toBe(true);
  });

  it("treats typed parser as not blank", () => {
    expect(isParserProfileBlank({ type: "plain" })).toBe(false);
  });

  it("treats options presence as not blank", () => {
    expect(isParserProfileBlank({ options: { path: "translation" } })).toBe(
      false,
    );
  });
});

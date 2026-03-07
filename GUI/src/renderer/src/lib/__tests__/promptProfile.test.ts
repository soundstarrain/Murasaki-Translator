import { describe, expect, it } from "vitest";

import { hasPromptSourcePlaceholder } from "../promptProfile";

describe("promptProfile helpers", () => {
  it("detects source placeholder in user_template", () => {
    expect(hasPromptSourcePlaceholder({ user_template: "" })).toBe(true);
    expect(hasPromptSourcePlaceholder({ user_template: "No source" })).toBe(
      false,
    );
    expect(
      hasPromptSourcePlaceholder({ user_template: "Use {{source}} here" }),
    ).toBe(true);
  });
});

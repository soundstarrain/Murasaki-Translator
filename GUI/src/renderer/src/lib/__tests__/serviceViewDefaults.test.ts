import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("service view defaults", () => {
  it("should default auto-connect-remote-after-daemon-start to disabled", () => {
    const source = readSource("src/renderer/src/components/ServiceView.tsx");
    expect(
      source.includes(
        "parseBooleanStorage(LOCAL_DAEMON_AUTO_REMOTE_STORAGE_KEY, false)",
      ),
    ).toBe(true);
  });
});

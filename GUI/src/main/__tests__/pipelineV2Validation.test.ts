import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { validateProfileLocal } from "../pipelineV2Validation";

const createProfilesDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipelinev2-"));
  await Promise.all(
    ["api", "prompt", "parser", "policy", "chunk", "pipeline"].map((kind) =>
      mkdir(join(dir, kind), { recursive: true }),
    ),
  );
  return dir;
};

describe("pipelineV2Validation", () => {
  it("rejects unsafe profile ids", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "api",
      {
        id: "../bad",
        type: "openai_compat",
        base_url: "http://localhost:1234",
        model: "test-model",
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid_id");
  });

  it("requires python parser script or path", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "parser",
      { id: "parser_py", type: "python", options: {} },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_script");
  });
});

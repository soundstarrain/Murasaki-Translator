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

  it("ignores invalid max_retries in pipeline settings", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "pipeline",
      {
        id: "pipeline_bad_retries",
        provider: "api_demo",
        prompt: "prompt_demo",
        parser: "parser_demo",
        chunk_policy: "chunk_demo",
        settings: { max_retries: -1 },
      },
      profilesDir,
    );
    expect(result.ok).toBe(true);
    expect(result.errors).not.toContain("invalid_max_retries");
  });

  it("rejects invalid chunk options", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "chunk",
      {
        id: "chunk_bad",
        chunk_type: "block",
        options: { target_chars: 0, max_chars: -1, balance_threshold: 2 },
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid_target_chars");
    expect(result.errors).toContain("invalid_max_chars");
    expect(result.errors).toContain("invalid_balance_threshold");
  });

  it("rejects invalid similarity threshold", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "policy",
      {
        id: "policy_bad",
        type: "tolerant",
        options: { similarity_threshold: 1.5 },
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid_similarity_threshold");
  });
});

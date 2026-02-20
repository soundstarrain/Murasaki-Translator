import { describe, expect, it } from "vitest";
import { __testOnly } from "../pipelineV2Profiles";

describe("pipelineV2Profiles concurrency helpers", () => {
  const { classifyConcurrencyFailure, buildConcurrencyTestPayload } = __testOnly;

  it("classifies auth errors before others", () => {
    const result = classifyConcurrencyFailure([429, 401, 500]);
    expect(result).toBe("concurrency_test_auth");
  });

  it("classifies rate limiting", () => {
    const result = classifyConcurrencyFailure([429]);
    expect(result).toBe("concurrency_test_rate_limited");
  });

  it("classifies not found", () => {
    const result = classifyConcurrencyFailure([404]);
    expect(result).toBe("concurrency_test_not_found");
  });

  it("classifies bad request", () => {
    const result = classifyConcurrencyFailure([400]);
    expect(result).toBe("concurrency_test_bad_request");
  });

  it("classifies timeout", () => {
    const result = classifyConcurrencyFailure([504]);
    expect(result).toBe("concurrency_test_timeout");
  });

  it("classifies server error", () => {
    const result = classifyConcurrencyFailure([500]);
    expect(result).toBe("concurrency_test_server_error");
  });

  it("classifies network failure", () => {
    const result = classifyConcurrencyFailure([0]);
    expect(result).toBe("concurrency_test_network");
  });

  it("builds concurrency test payload with hello messages", () => {
    const payload = buildConcurrencyTestPayload("demo-model");
    expect(payload.model).toBe("demo-model");
    expect(Array.isArray(payload.messages)).toBe(true);
    expect(payload.messages.length).toBe(32);
    expect(payload.messages.every((item) => item.content === "你好")).toBe(true);
  });
});

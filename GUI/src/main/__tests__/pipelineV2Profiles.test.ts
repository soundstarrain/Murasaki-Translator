import { describe, expect, it } from "vitest";
import { __testOnly } from "../pipelineV2Profiles";

describe("pipelineV2Profiles concurrency helpers", () => {
  const {
    classifyConcurrencyFailure,
    buildConcurrencyTestPayload,
    resolveConcurrencyProbeStart,
    assessConcurrencyBatch,
  } = __testOnly;

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
    expect(payload.messages.every((item) => item.content === "你好")).toBe(
      true,
    );
    expect(payload.max_tokens).toBe(8);
  });

  it("starts concurrency probe from 64 when max allows", () => {
    expect(resolveConcurrencyProbeStart(128)).toBe(64);
    expect(resolveConcurrencyProbeStart(80)).toBe(64);
    expect(resolveConcurrencyProbeStart(32)).toBe(32);
    expect(resolveConcurrencyProbeStart(0)).toBe(1);
  });

  it("accepts small transient failures in large batches", () => {
    const statuses = [...Array.from({ length: 62 }, () => 200), 500, 500];
    const result = assessConcurrencyBatch(statuses);
    expect(result.ok).toBe(true);
    expect(result.hardFailure).toBe(false);
  });

  it("rejects hard failures even if success rate is high", () => {
    const statuses = [...Array.from({ length: 63 }, () => 200), 401];
    const result = assessConcurrencyBatch(statuses);
    expect(result.ok).toBe(false);
    expect(result.hardFailure).toBe(true);
    expect(result.reason).toBe("concurrency_test_auth");
  });

  it("rejects too many transient failures", () => {
    const statuses = [
      ...Array.from({ length: 60 }, () => 200),
      500,
      500,
      500,
      500,
    ];
    const result = assessConcurrencyBatch(statuses);
    expect(result.ok).toBe(false);
    expect(result.hardFailure).toBe(false);
    expect(result.reason).toBe("concurrency_test_server_error");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeCudaVisibleDevices } from "../gpuDeviceId";

describe("normalizeCudaVisibleDevices", () => {
  it("normalizes multi-gpu index input", () => {
    expect(normalizeCudaVisibleDevices("0, 1,1")).toBe("0,1");
    expect(normalizeCudaVisibleDevices("0 2")).toBe("0,2");
    expect(normalizeCudaVisibleDevices("0；2")).toBe("0,2");
    expect(normalizeCudaVisibleDevices("-1")).toBe("-1");
  });

  it("accepts uuid-like selectors", () => {
    expect(normalizeCudaVisibleDevices("GPU-aaaaaaaa-bbbb-cccc-dddd")).toBe(
      "GPU-aaaaaaaa-bbbb-cccc-dddd",
    );
    expect(normalizeCudaVisibleDevices("MIG-GPU-aaaa/1/2")).toBe(
      "MIG-GPU-aaaa/1/2",
    );
  });

  it("returns undefined for invalid input", () => {
    expect(normalizeCudaVisibleDevices("abc,@@")).toBeUndefined();
    expect(normalizeCudaVisibleDevices("")).toBeUndefined();
    expect(normalizeCudaVisibleDevices(undefined)).toBeUndefined();
  });
});

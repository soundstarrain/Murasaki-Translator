import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteClient } from "../remoteClient";

describe("RemoteClient GPU device id normalization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes gpu_device_id before sending translate request", async () => {
    const client = new RemoteClient({ url: "http://127.0.0.1:8000" });
    const fetchSpy = vi.spyOn(client as any, "fetch").mockResolvedValue({
      task_id: "task_1",
      status: "pending",
    });

    await client.createTranslation({
      text: "hello",
      gpuDeviceId: "0, 1,1",
    });

    const requestInit = fetchSpy.mock.calls[0]?.[1] as { body?: string };
    const payload = JSON.parse(requestInit.body || "{}");
    expect(payload.gpu_device_id).toBe("0,1");
  });

  it("drops invalid gpu_device_id values", async () => {
    const client = new RemoteClient({ url: "http://127.0.0.1:8000" });
    const fetchSpy = vi.spyOn(client as any, "fetch").mockResolvedValue({
      task_id: "task_2",
      status: "pending",
    });

    await client.createTranslation({
      text: "hello",
      gpuDeviceId: "abc,@@",
    });

    const requestInit = fetchSpy.mock.calls[0]?.[1] as { body?: string };
    const payload = JSON.parse(requestInit.body || "{}");
    expect(payload.gpu_device_id).toBeUndefined();
  });
});

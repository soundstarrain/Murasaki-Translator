import { beforeEach, describe, expect, it } from "vitest";
import { delimiter } from "path";
import {
  __testOnly,
  getPipelineV2Status,
  markPipelineV2Local,
  markPipelineV2ServerOk,
} from "../pipelineV2Server";

describe("pipelineV2Server status", () => {
  beforeEach(() => {
    markPipelineV2ServerOk();
  });

  it("updates status when marking local failures and recovery", () => {
    markPipelineV2Local("spawn_error", "detail");
    const local = getPipelineV2Status();
    expect(local.mode).toBe("local");
    expect(local.ok).toBe(false);
    expect(local.error).toBe("spawn_error");
    expect(local.detail).toBe("detail");

    markPipelineV2ServerOk();
    const recovered = getPipelineV2Status();
    expect(recovered.mode).toBe("server");
    expect(recovered.ok).toBe(true);
    expect(recovered.error).toBeUndefined();
    expect(recovered.detail).toBeUndefined();
  });

  it("returns a snapshot copy", () => {
    const snapshot = getPipelineV2Status();
    snapshot.mode = "local";
    const next = getPipelineV2Status();
    expect(next.mode).toBe("server");
  });
});

describe("pipelineV2Server bundle args", () => {
  it("keeps script path when bundle path points to python interpreter", () => {
    const args = ["api_server.py", "--port", "48321"];
    expect(__testOnly.resolveBundleArgs("python3", args)).toEqual(args);
    expect(__testOnly.resolveBundleArgs("python.exe", args)).toEqual(args);
  });

  it("drops script path for packaged bundle executable", () => {
    const args = ["api_server.py", "--port", "48321"];
    expect(__testOnly.resolveBundleArgs("murasaki-server", args)).toEqual([
      "--port",
      "48321",
    ]);
  });
});

describe("pipelineV2Server execution args", () => {
  it("uses script args directly for python runtime", () => {
    const args = ["api_server.py", "--port", "48321"];
    expect(
      __testOnly.resolveExecutionArgs(
        { type: "python", path: "python.exe" },
        args,
      ),
    ).toEqual(args);
  });

  it("uses bundle resolver for bundled runtime", () => {
    const args = ["api_server.py", "--port", "48321"];
    expect(
      __testOnly.resolveExecutionArgs(
        { type: "bundle", path: "murasaki-server" },
        args,
      ),
    ).toEqual(["--port", "48321"]);
  });
});

describe("pipelineV2Server python path env", () => {
  it("prepends middleware path to PYTHONPATH", () => {
    const middlewarePath = "middleware_path";
    const existingPath = "existing_pkg_path";
    const env = __testOnly.withMiddlewarePythonPath(
      { PYTHONPATH: existingPath },
      middlewarePath,
    );
    expect(env.PYTHONPATH).toBe(`${middlewarePath}${delimiter}${existingPath}`);
    expect(env.PYTHONIOENCODING).toBe("utf-8");
  });

  it("does not duplicate middleware path when already present", () => {
    const middlewarePath = "middleware_path";
    const existingPath = "existing_pkg_path";
    const originalPythonPath = `${middlewarePath}${delimiter}${existingPath}`;
    const env = __testOnly.withMiddlewarePythonPath(
      { PYTHONPATH: originalPythonPath },
      middlewarePath,
    );
    expect(env.PYTHONPATH).toBe(originalPythonPath);
  });
});

import { describe, expect, it } from "vitest";
import { delimiter } from "path";
import { __testOnly } from "../pipelineV2Runner";

describe("pipelineV2Runner buffered output", () => {
  it("flushes complete lines and preserves tail", () => {
    const lines: string[] = [];
    const remaining = __testOnly.flushBufferedLines(
      "first\n\nsecond\r\npartial",
      (line) => lines.push(line),
    );

    expect(lines).toEqual(["first", "second"]);
    expect(remaining).toBe("partial");
  });

  it("clears buffer when input ends with newline", () => {
    const lines: string[] = [];
    const remaining = __testOnly.flushBufferedLines("alpha\nbeta\n", (line) =>
      lines.push(line),
    );

    expect(lines).toEqual(["alpha", "beta"]);
    expect(remaining).toBe("");
  });
});

describe("pipelineV2Runner bundle args", () => {
  it("uses script path when bundle path points to plain python interpreter", () => {
    const args = ["main.py", "--file", "demo.txt"];
    expect(__testOnly.resolveBundleArgs("python3", args)).toEqual(args);
    expect(__testOnly.resolveBundleArgs("python.exe", args)).toEqual(args);
  });

  it("drops script path when using packaged bundle executable", () => {
    const args = ["main.py", "--file", "demo.txt"];
    expect(__testOnly.resolveBundleArgs("murasaki-engine", args)).toEqual([
      "--file",
      "demo.txt",
    ]);
  });
});

describe("pipelineV2Runner execution args", () => {
  it("uses script args directly for python runtime", () => {
    const args = ["main.py", "--file", "demo.txt"];
    expect(
      __testOnly.resolveExecutionArgs(
        { type: "python", path: "python.exe" },
        args,
      ),
    ).toEqual(args);
  });

  it("uses bundle resolver for bundled runtime", () => {
    const args = ["main.py", "--file", "demo.txt"];
    expect(
      __testOnly.resolveExecutionArgs(
        { type: "bundle", path: "murasaki-engine" },
        args,
      ),
    ).toEqual(["--file", "demo.txt"]);
  });
});

describe("pipelineV2Runner python path env", () => {
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

describe("pipelineV2Runner api stats event parser", () => {
  it("parses valid prefixed json object line", () => {
    const event = __testOnly.parseApiStatsEventLine(
      'JSON_API_STATS_EVENT:{"phase":"request_end","requestId":"req_1","statusCode":200}',
    );
    expect(event).toEqual({
      phase: "request_end",
      requestId: "req_1",
      statusCode: 200,
    });
  });

  it("returns null for non-prefixed line", () => {
    const event = __testOnly.parseApiStatsEventLine(
      '{"phase":"request_end","requestId":"req_1"}',
    );
    expect(event).toBeNull();
  });

  it("returns null for invalid json or non-object payload", () => {
    expect(
      __testOnly.parseApiStatsEventLine("JSON_API_STATS_EVENT:{invalid-json"),
    ).toBeNull();
    expect(
      __testOnly.parseApiStatsEventLine("JSON_API_STATS_EVENT:[1,2,3]"),
    ).toBeNull();
    expect(
      __testOnly.parseApiStatsEventLine('JSON_API_STATS_EVENT:"string"'),
    ).toBeNull();
  });
});

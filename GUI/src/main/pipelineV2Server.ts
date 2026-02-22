import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { basename, delimiter, join } from "path";
import net from "net";

type PythonPath = { type: "python" | "bundle"; path: string };

type ServerDeps = {
  getPythonPath: () => PythonPath;
  getMiddlewarePath: () => string;
  getProfilesDir: () => string;
};

type ServerState = {
  proc?: ChildProcessWithoutNullStreams;
  baseUrl?: string;
  starting?: Promise<string>;
};

const state: ServerState = {};
const PYTHON_INTERPRETER_NAME_RE = /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i;

export type PipelineV2Status = {
  mode: "server" | "local";
  ok: boolean;
  error?: string;
  detail?: string;
};

const status: PipelineV2Status = {
  mode: "server",
  ok: true,
};

const setStatus = (next: Partial<PipelineV2Status>) => {
  Object.assign(status, next);
};

export const getPipelineV2Status = (): PipelineV2Status => ({ ...status });

const markServerOk = () => {
  setStatus({ mode: "server", ok: true, error: undefined, detail: undefined });
};

const markLocalFail = (error: string, detail?: string) => {
  setStatus({ mode: "local", ok: false, error, detail });
};

export const markPipelineV2ServerOk = () => {
  markServerOk();
};

export const markPipelineV2Local = (error: string, detail?: string) => {
  markLocalFail(error, detail);
};

const terminateProcessTree = (proc: ChildProcessWithoutNullStreams) => {
  if (process.platform === "win32" && proc.pid) {
    try {
      spawn("taskkill", ["/pid", proc.pid.toString(), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // fallback below
    }
  }
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
};

const resetServerState = () => {
  if (state.proc && !state.proc.killed) {
    terminateProcessTree(state.proc);
  }
  state.proc = undefined;
  state.baseUrl = undefined;
  state.starting = undefined;
};

export const stopPipelineV2Server = () => {
  resetServerState();
};

const resolveBundleArgs = (
  executablePath: string,
  scriptArgs: string[],
): string[] => {
  const executableName = basename(executablePath);
  if (PYTHON_INTERPRETER_NAME_RE.test(executableName)) {
    // Misconfigured environments may point "bundle" to a plain interpreter.
    return scriptArgs;
  }
  return scriptArgs.slice(1);
};

const resolveExecutionArgs = (
  python: PythonPath,
  scriptArgs: string[],
): string[] => {
  if (python.type === "bundle") {
    return resolveBundleArgs(python.path, scriptArgs);
  }
  // Python embeddable runtime on Windows may fail to resolve package modules with -m.
  return scriptArgs;
};

const withMiddlewarePythonPath = (
  env: NodeJS.ProcessEnv,
  middlewarePath: string,
): NodeJS.ProcessEnv => {
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    PYTHONIOENCODING: "utf-8",
  };
  const existingRaw = String(nextEnv.PYTHONPATH || "");
  const existingEntries = existingRaw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!existingEntries.includes(middlewarePath)) {
    existingEntries.unshift(middlewarePath);
  }
  nextEnv.PYTHONPATH = existingEntries.join(delimiter);
  return nextEnv;
};

const pickFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to acquire port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });

const fetchWithTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const waitForHealth = async (baseUrl: string, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const perAttemptTimeout = Math.min(2000, Math.max(500, timeoutMs));
      const res = await fetchWithTimeout(
        `${baseUrl}/health`,
        perAttemptTimeout,
      );
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Pipeline V2 server health check failed");
};

export const ensurePipelineV2Server = async (
  deps: ServerDeps,
): Promise<string> => {
  if (state.baseUrl) return state.baseUrl;
  if (state.starting) return state.starting;

  state.starting = (async () => {
    const python = deps.getPythonPath();
    const middlewarePath = deps.getMiddlewarePath();
    const profilesDir = deps.getProfilesDir();
    const scriptPath = join(
      middlewarePath,
      "murasaki_flow_v2",
      "api_server.py",
    );
    const port = await pickFreePort();
    const host = "127.0.0.1";
    const baseUrl = `http://${host}:${port}`;

    const scriptArgs = [
      scriptPath,
      "--profiles-dir",
      profilesDir,
      "--host",
      host,
      "--port",
      String(port),
    ];

    let stderrBuffer = "";
    const child = spawn(python.path, resolveExecutionArgs(python, scriptArgs), {
      cwd: middlewarePath,
      env: withMiddlewarePythonPath(process.env, middlewarePath),
    });

    state.proc = child;
    state.baseUrl = baseUrl;

    if (child.stderr) {
      child.stderr.on("data", (buf) => {
        stderrBuffer += buf.toString();
        if (stderrBuffer.length > 8000) {
          stderrBuffer = stderrBuffer.slice(-8000);
        }
      });
    }

    child.on("error", (err) => {
      markLocalFail("spawn_error", err.message || "spawn_error");
    });

    child.on("exit", (code) => {
      state.proc = undefined;
      state.baseUrl = undefined;
      state.starting = undefined;
      if (code !== 0) {
        markLocalFail("exit", `Pipeline V2 server exited with code ${code}`);
      }
    });

    try {
      await waitForHealth(baseUrl);
      markServerOk();
      return baseUrl;
    } catch (error: any) {
      resetServerState();
      markLocalFail(
        "health_timeout",
        stderrBuffer ? stderrBuffer.trim() : error?.message || "health_timeout",
      );
      throw error;
    }
  })();

  return state.starting;
};

export const __testOnly = {
  resolveBundleArgs,
  resolveExecutionArgs,
  withMiddlewarePythonPath,
};

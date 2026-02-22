import { ipcMain, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { basename, delimiter, extname, join } from "path";
import { validatePipelineRun } from "./pipelineV2Validation";
import type { ApiStatsEventInput } from "./apiStatsStore";

type PythonPath = { type: "python" | "bundle"; path: string };

type RunnerDeps = {
  getPythonPath: () => PythonPath;
  getMiddlewarePath: () => string;
  getMainWindow: () => BrowserWindow | null;
  recordApiStatsEvent?: (event: ApiStatsEventInput) => void | Promise<void>;
  sendLog: (payload: {
    runId: string;
    message: string;
    level?: string;
  }) => void;
};

// --- 模块级状态：活动子进程 + stop 标记 ---
let activeChild: ChildProcess | null = null;
let stopRequested = false;
let activeStopFlagPath: string | null = null;
let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
const FORCE_KILL_TIMEOUT_MS = 15000;
const PYTHON_INTERPRETER_NAME_RE = /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i;

const clearForceKillTimer = () => {
  if (!forceKillTimer) return;
  clearTimeout(forceKillTimer);
  forceKillTimer = null;
};

const cleanupStopFlag = () => {
  if (!activeStopFlagPath) return;
  try {
    if (existsSync(activeStopFlagPath)) {
      unlinkSync(activeStopFlagPath);
    }
  } catch (e) {
    console.warn("[FlowV2] Failed to cleanup stop flag:", e);
  } finally {
    activeStopFlagPath = null;
  }
};

const stopActivePipelineChild = () => {
  if (!activeChild) return;
  if (stopRequested) return;
  stopRequested = true;
  console.log(
    "[FlowV2] Stop requested, waiting child for graceful shutdown...",
  );
  try {
    if (activeStopFlagPath) {
      writeFileSync(activeStopFlagPath, `${Date.now()}`, "utf8");
    }
  } catch (e) {
    console.error("[FlowV2] Failed to write stop flag:", e);
  }

  clearForceKillTimer();
  forceKillTimer = setTimeout(() => {
    if (!activeChild) return;
    const pid = activeChild.pid;
    console.warn("[FlowV2] Graceful stop timed out, forcing child exit...");
    try {
      if (process.platform === "win32" && pid) {
        spawn("taskkill", ["/pid", pid.toString(), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        activeChild.kill("SIGKILL");
      }
    } catch (err) {
      console.error("[FlowV2] Error force-killing child:", err);
    }
  }, FORCE_KILL_TIMEOUT_MS);
};

export const stopPipelineV2Runner = () => {
  stopActivePipelineChild();
};

/**
 * 将缓冲区按行分割，返回未完成的残余行。
 * 复用 V1 index.ts 的 flushBufferedLines 模式。
 */
const flushBufferedLines = (
  buffer: string,
  onLine: (line: string) => void,
): string => {
  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    onLine(line);
  }
  return remaining;
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

const API_STATS_EVENT_PREFIX = "JSON_API_STATS_EVENT:";

const parseApiStatsEventLine = (line: string): ApiStatsEventInput | null => {
  if (!line.startsWith(API_STATS_EVENT_PREFIX)) return null;
  const raw = line.slice(API_STATS_EVENT_PREFIX.length);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ApiStatsEventInput;
  } catch {
    return null;
  }
};

export const registerPipelineV2Runner = (deps: RunnerDeps) => {
  // --- Stop handler ---
  ipcMain.on("stop-pipelinev2", () => {
    stopActivePipelineChild();
  });

  ipcMain.handle(
    "pipelinev2-run",
    async (
      _event,
      {
        filePath,
        pipelineId,
        profilesDir,
        outputPath,
        outputDir,
        rulesPrePath,
        rulesPostPath,
        rulesPre,
        rulesPost,
        glossaryPath,
        sourceLang,
        enableQuality,
        textProtect,
        resume,
        cacheDir,
        saveCache,
        runId: payloadRunId,
      }: any,
    ) => {
      const reqRunId = String(payloadRunId || "").trim();
      const runId = reqRunId || Date.now().toString();

      // 如果已有活动的 V2 进程，拒绝
      if (activeChild) {
        const message = "V2 pipeline already running";
        const win = deps.getMainWindow();
        if (win) {
          win.webContents.send("process-exit", {
            code: 1,
            signal: null,
            stopRequested: false,
            runId,
          });
        }
        return {
          ok: false,
          runId,
          code: 1,
          error: { errors: [message] },
        };
      }

      const python = deps.getPythonPath();
      const middlewarePath = deps.getMiddlewarePath();
      const scriptPath = join(middlewarePath, "murasaki_flow_v2", "main.py");

      const precheck = await validatePipelineRun(profilesDir, pipelineId);
      if (!precheck.ok) {
        const message = `[FlowV2] Precheck failed: ${precheck.errors.join(", ")}`;
        deps.sendLog({ runId, message, level: "error" });
        const win = deps.getMainWindow();
        if (win) {
          win.webContents.send("process-exit", {
            code: 1,
            signal: null,
            stopRequested: false,
            runId,
          });
        }
        return {
          ok: false,
          runId,
          code: 1,
          error: { errors: precheck.errors },
        };
      }

      const scriptArgs = [
        scriptPath,
        "--file",
        filePath,
        "--pipeline",
        pipelineId,
        "--profiles-dir",
        profilesDir,
        "--run-id",
        runId,
      ];
      const stopFlagPath = join(
        middlewarePath,
        `temp_flowv2_stop_${runId}.flag`,
      );
      try {
        if (existsSync(stopFlagPath)) {
          unlinkSync(stopFlagPath);
        }
      } catch (e) {
        console.warn("[FlowV2] Failed to clear stale stop flag:", e);
      }
      scriptArgs.push("--stop-flag", stopFlagPath);
      let resolvedOutputPath = outputPath;
      if (!resolvedOutputPath && outputDir && existsSync(outputDir)) {
        const ext = extname(filePath);
        const baseName = ext ? basename(filePath, ext) : basename(filePath);
        const outFilename = ext
          ? `${baseName}_translated${ext}`
          : `${baseName}_translated`;
        resolvedOutputPath = join(outputDir, outFilename);
      }
      if (resolvedOutputPath) {
        scriptArgs.push("--output", resolvedOutputPath);
      }

      const temporaryRulePaths: string[] = [];
      const cleanupTemporaryRulePaths = () => {
        for (const path of temporaryRulePaths) {
          try {
            if (existsSync(path)) {
              unlinkSync(path);
            }
          } catch (e) {
            console.warn(
              "[FlowV2] Failed to cleanup temp rules file:",
              path,
              e,
            );
          }
        }
        temporaryRulePaths.length = 0;
      };

      let activeRulesPrePath = rulesPrePath;
      if (
        !activeRulesPrePath &&
        rulesPre &&
        Array.isArray(rulesPre) &&
        rulesPre.length > 0
      ) {
        const uid = require("crypto").randomUUID().slice(0, 8);
        activeRulesPrePath = join(middlewarePath, `temp_rules_pre_${uid}.json`);
        require("fs").writeFileSync(
          activeRulesPrePath,
          JSON.stringify(rulesPre),
          "utf8",
        );
        temporaryRulePaths.push(activeRulesPrePath);
      }
      if (activeRulesPrePath) {
        scriptArgs.push("--rules-pre", activeRulesPrePath);
      }

      let activeRulesPostPath = rulesPostPath;
      if (
        !activeRulesPostPath &&
        rulesPost &&
        Array.isArray(rulesPost) &&
        rulesPost.length > 0
      ) {
        const uid = require("crypto").randomUUID().slice(0, 8);
        activeRulesPostPath = join(
          middlewarePath,
          `temp_rules_post_${uid}.json`,
        );
        require("fs").writeFileSync(
          activeRulesPostPath,
          JSON.stringify(rulesPost),
          "utf8",
        );
        temporaryRulePaths.push(activeRulesPostPath);
      }
      if (activeRulesPostPath) {
        scriptArgs.push("--rules-post", activeRulesPostPath);
      }
      if (glossaryPath) {
        scriptArgs.push("--glossary", glossaryPath);
      }
      if (sourceLang) {
        scriptArgs.push("--source-lang", sourceLang);
      }
      if (enableQuality === true) {
        scriptArgs.push("--enable-quality");
      } else if (enableQuality === false) {
        scriptArgs.push("--disable-quality");
      }
      if (textProtect === true) {
        scriptArgs.push("--text-protect");
      } else if (textProtect === false) {
        scriptArgs.push("--no-text-protect");
      }
      if (resume) {
        scriptArgs.push("--resume");
      }
      if (cacheDir && existsSync(cacheDir)) {
        scriptArgs.push("--cache-dir", cacheDir);
      }
      if (saveCache === false) {
        scriptArgs.push("--no-cache");
      }

      stopRequested = false;
      clearForceKillTimer();
      cleanupStopFlag();
      activeStopFlagPath = stopFlagPath;

      return await new Promise<{
        ok: boolean;
        runId: string;
        code?: number;
      }>((resolve) => {
        let settled = false;
        const finalize = (result: {
          ok: boolean;
          runId: string;
          code?: number;
        }) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        let child: ChildProcess;
        try {
          child = spawn(python.path, resolveExecutionArgs(python, scriptArgs), {
            cwd: middlewarePath,
            env: withMiddlewarePythonPath(process.env, middlewarePath),
          });
        } catch (err) {
          console.error("[FlowV2] Spawn failed:", err);
          const win = deps.getMainWindow();
          if (win) {
            const payload = {
              title: "Pipeline V2 Error",
              message: String((err as Error)?.message || err),
            };
            win.webContents.send(
              "log-update",
              `JSON_ERROR:${JSON.stringify(payload)}\n`,
            );
            win.webContents.send("process-exit", {
              code: 1,
              signal: null,
              stopRequested: false,
              runId,
            });
          }
          activeChild = null;
          stopRequested = false;
          clearForceKillTimer();
          cleanupStopFlag();
          cleanupTemporaryRulePaths();
          finalize({ ok: false, runId, code: 1 });
          return;
        }
        activeChild = child;

        let stdoutBuffer = "";

        const handleStdoutLine = (line: string) => {
          const statsEvent = parseApiStatsEventLine(line);
          if (statsEvent) {
            if (deps.recordApiStatsEvent) {
              const enrichedEvent: ApiStatsEventInput = {
                ...statsEvent,
                runId:
                  typeof statsEvent.runId === "string" &&
                  statsEvent.runId.trim()
                    ? statsEvent.runId
                    : runId,
                source:
                  typeof statsEvent.source === "string" &&
                  statsEvent.source.trim()
                    ? statsEvent.source
                    : "translation_run",
                origin:
                  typeof statsEvent.origin === "string" &&
                  statsEvent.origin.trim()
                    ? statsEvent.origin
                    : "pipeline_v2_runner",
              };
              void Promise.resolve(
                deps.recordApiStatsEvent(enrichedEvent),
              ).catch(() => null);
            }
            return;
          }
          const win = deps.getMainWindow();
          if (!win) return;
          win.webContents.send("log-update", `${line}\n`);
          deps.sendLog({ runId, message: line, level: "info" });
        };

        child.stdout?.on("data", (buf) => {
          stdoutBuffer += buf.toString();
          stdoutBuffer = flushBufferedLines(stdoutBuffer, handleStdoutLine);
        });

        child.stderr?.on("data", (buf) => {
          const str = buf.toString();
          // stderr 仅发到 pipelinev2-log 调试通道
          deps.sendLog({ runId, message: str, level: "error" });
          const win = deps.getMainWindow();
          if (win && str.trim()) {
            const payload = {
              title: "Pipeline V2 Error (Stderr)",
              message: str.trim(),
            };
            // Remove newlines in str to avoid breaking the JSON line parser
            const safeStr = JSON.stringify(payload);
            win.webContents.send("log-update", `JSON_ERROR:${safeStr}\n`);
          }
        });

        child.on("error", (err) => {
          console.error("[FlowV2] Spawn error:", err);
          const win = deps.getMainWindow();
          if (win) {
            const payload = {
              title: "Pipeline V2 Error",
              message: String(err?.message || err),
            };
            win.webContents.send(
              "log-update",
              `JSON_ERROR:${JSON.stringify(payload)}\n`,
            );
            win.webContents.send("process-exit", {
              code: 1,
              signal: null,
              stopRequested: false,
              runId,
            });
          }
          activeChild = null;
          stopRequested = false;
          clearForceKillTimer();
          cleanupStopFlag();
          cleanupTemporaryRulePaths();
          finalize({ ok: false, runId, code: 1 });
        });

        child.on("close", (code, signal) => {
          // 刷新剩余 stdout 缓冲
          if (stdoutBuffer.trim()) {
            flushBufferedLines(`${stdoutBuffer}\n`, handleStdoutLine);
          }

          const wasStopRequested = stopRequested;
          stopRequested = false;
          activeChild = null;
          clearForceKillTimer();
          cleanupStopFlag();
          cleanupTemporaryRulePaths();

          console.log(
            `[FlowV2] Process exited (code=${String(code)}, signal=${String(signal)}, stopRequested=${wasStopRequested})`,
          );

          // 发送 process-exit 到 Dashboard（格式与 V1 完全一致）
          const win = deps.getMainWindow();
          if (win) {
            win.webContents.send("process-exit", {
              code,
              signal,
              stopRequested: wasStopRequested,
              runId,
            });
          }

          finalize({ ok: code === 0, runId, code: code ?? undefined });
        });
      });
    },
  );
};

export const __testOnly = {
  flushBufferedLines,
  resolveBundleArgs,
  resolveExecutionArgs,
  withMiddlewarePythonPath,
  parseApiStatsEventLine,
};

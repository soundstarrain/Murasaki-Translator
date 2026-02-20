import { ipcMain, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { validatePipelineRun } from "./pipelineV2Validation";

type PythonPath = { type: "python" | "bundle"; path: string };

type RunnerDeps = {
  getPythonPath: () => PythonPath;
  getMiddlewarePath: () => string;
  getMainWindow: () => BrowserWindow | null;
  sendLog: (payload: {
    runId: string;
    message: string;
    level?: string;
  }) => void;
};

// --- 模块级状态：活动子进程 + stop 标记 ---
let activeChild: ChildProcess | null = null;
let stopRequested = false;

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

export const registerPipelineV2Runner = (deps: RunnerDeps) => {
  // --- Stop handler ---
  ipcMain.on("stop-pipelinev2", () => {
    if (activeChild) {
      stopRequested = true;
      console.log("[FlowV2] Stop requested, killing child process...");
      try {
        activeChild.kill("SIGTERM");
        // Windows fallback: SIGTERM may not work, use taskkill
        if (process.platform === "win32" && activeChild.pid) {
          spawn("taskkill", [
            "/pid",
            activeChild.pid.toString(),
            "/f",
            "/t",
          ]);
        }
      } catch (e) {
        console.error("[FlowV2] Error killing child:", e);
      }
    }
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
        rulesPrePath,
        rulesPostPath,
        glossaryPath,
        sourceLang,
        enableQuality,
        textProtect,
      },
    ) => {
      // 如果已有活动的 V2 进程，拒绝
      if (activeChild) {
        return { ok: false, runId: "", code: 1, error: { errors: ["V2 pipeline already running"] } };
      }

      const runId = Date.now().toString();
      const python = deps.getPythonPath();
      const middlewarePath = deps.getMiddlewarePath();
      const scriptPath = join(middlewarePath, "murasaki_flow_v2", "main.py");

      const precheck = await validatePipelineRun(profilesDir, pipelineId);
      if (!precheck.ok) {
        const message = `[FlowV2] Precheck failed: ${precheck.errors.join(", ")}`;
        deps.sendLog({ runId, message, level: "error" });
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
      ];
      const moduleArgs = [
        "-m",
        "murasaki_flow_v2.main",
        "--file",
        filePath,
        "--pipeline",
        pipelineId,
        "--profiles-dir",
        profilesDir,
      ];
      if (outputPath) {
        scriptArgs.push("--output", outputPath);
        moduleArgs.push("--output", outputPath);
      }
      if (rulesPrePath) {
        scriptArgs.push("--rules-pre", rulesPrePath);
        moduleArgs.push("--rules-pre", rulesPrePath);
      }
      if (rulesPostPath) {
        scriptArgs.push("--rules-post", rulesPostPath);
        moduleArgs.push("--rules-post", rulesPostPath);
      }
      if (glossaryPath) {
        scriptArgs.push("--glossary", glossaryPath);
        moduleArgs.push("--glossary", glossaryPath);
      }
      if (sourceLang) {
        scriptArgs.push("--source-lang", sourceLang);
        moduleArgs.push("--source-lang", sourceLang);
      }
      if (enableQuality === true) {
        scriptArgs.push("--enable-quality");
        moduleArgs.push("--enable-quality");
      } else if (enableQuality === false) {
        scriptArgs.push("--disable-quality");
        moduleArgs.push("--disable-quality");
      }
      if (textProtect === true) {
        scriptArgs.push("--text-protect");
        moduleArgs.push("--text-protect");
      } else if (textProtect === false) {
        scriptArgs.push("--no-text-protect");
        moduleArgs.push("--no-text-protect");
      }

      stopRequested = false;

      return await new Promise<{ ok: boolean; runId: string; code?: number }>(
        (resolve) => {
          const child =
            python.type === "bundle"
              ? spawn(python.path, scriptArgs.slice(1))
              : spawn(python.path, moduleArgs, {
                cwd: middlewarePath,
                env: {
                  ...process.env,
                  PYTHONIOENCODING: "utf-8",
                },
              });
          activeChild = child;

          let stdoutBuffer = "";

          const handleStdoutLine = (line: string) => {
            const win = deps.getMainWindow();
            if (!win) return;
            // 直接发送到 log-update 通道，复用 V1 的日志解析器
            win.webContents.send("log-update", `${line}\n`);
            // 同时保留 pipelinev2-log 用于调试
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
          });

          child.on("close", (code, signal) => {
            // 刷新剩余 stdout 缓冲
            if (stdoutBuffer.trim()) {
              flushBufferedLines(`${stdoutBuffer}\n`, handleStdoutLine);
            }

            const wasStopRequested = stopRequested;
            stopRequested = false;
            activeChild = null;

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

            resolve({ ok: code === 0, runId, code: code ?? undefined });
          });
        },
      );
    },
  );
};

import { ipcMain } from "electron";
import { spawn } from "child_process";
import { join } from "path";
import { validatePipelineRun } from "./pipelineV2Validation";

type PythonPath = { type: "python" | "bundle"; path: string };

type RunnerDeps = {
  getPythonPath: () => PythonPath;
  getMiddlewarePath: () => string;
  sendLog: (payload: {
    runId: string;
    message: string;
    level?: string;
  }) => void;
};

export const registerPipelineV2Runner = (deps: RunnerDeps) => {
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

      return await new Promise<{ ok: boolean; runId: string; code?: number }>(
        (resolve) => {
          const child =
            python.type === "bundle"
              ? spawn(python.path, scriptArgs.slice(1))
              : spawn(python.path, moduleArgs, { cwd: middlewarePath });

          child.stdout?.on("data", (buf) => {
            deps.sendLog({ runId, message: buf.toString(), level: "info" });
          });
          child.stderr?.on("data", (buf) => {
            deps.sendLog({ runId, message: buf.toString(), level: "error" });
          });
          child.on("close", (code) => {
            resolve({ ok: code === 0, runId, code: code ?? undefined });
          });
        },
      );
    },
  );
};

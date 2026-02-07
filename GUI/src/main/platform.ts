import { platform, arch } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { is } from "@electron-toolkit/utils";

const execAsync = promisify(exec);

export type PlatformOS = "win32" | "darwin" | "linux";
export type Backend = "cuda" | "vulkan" | "metal" | "cpu";

export interface PlatformInfo {
  os: PlatformOS;
  arch: "x64" | "arm64";
  backend: Backend;
  binaryName: string;
  binaryDir: string;
  subdir: string;
}

// 缓存 GPU 检测结果，避免重复执行
let cachedHasNvidiaGpu: boolean | null = null;

/**
 * 清除 GPU 检测缓存，允许重新检测
 * 用于热插拔 eGPU 或驱动更新后重新检测
 */
export function clearGpuCache(): void {
  cachedHasNvidiaGpu = null;
  console.log('[Platform] GPU cache cleared, will re-detect on next request');
}

/**
 * 异步检测 NVIDIA GPU (通过执行 nvidia-smi 命令)
 * 使用异步执行避免阻塞 Electron 主线程
 */
export async function hasNvidiaGpuAsync(): Promise<boolean> {
  if (cachedHasNvidiaGpu !== null) {
    return cachedHasNvidiaGpu;
  }

  // Windows 上 nvidia-smi 可能不在 PATH 中，尝试多个路径
  const commands = process.platform === 'win32'
    ? [
      'nvidia-smi --query-gpu=name --format=csv,noheader',
      '"C:\\Windows\\System32\\nvidia-smi.exe" --query-gpu=name --format=csv,noheader',
      '"C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe" --query-gpu=name --format=csv,noheader'
    ]
    : ['nvidia-smi --query-gpu=name --format=csv,noheader'];

  for (const cmd of commands) {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: 5000,
        windowsHide: true,
      });
      if (stdout.trim().length > 0) {
        cachedHasNvidiaGpu = true;
        console.log(`[Platform] NVIDIA GPU detected (async): ${stdout.trim()}`);
        return true;
      }
    } catch {
      // 尝试下一个路径
    }
  }

  cachedHasNvidiaGpu = false;
  console.log('[Platform] No NVIDIA GPU detected (async), using Vulkan/Metal fallback');
  return false;
}


/**
 * 同步检测 NVIDIA GPU - 仅用于必须同步的场景
 * 增加超时到 3000ms，并尝试多个可能的 nvidia-smi 路径
 */
function hasNvidiaGpuSync(): boolean {
  if (cachedHasNvidiaGpu !== null) {
    return cachedHasNvidiaGpu;
  }

  const { execSync } = require("child_process");

  // Windows 上 nvidia-smi 可能不在 PATH 中，尝试多个路径
  const commands = process.platform === 'win32'
    ? [
      'nvidia-smi --query-gpu=name --format=csv,noheader',
      '"C:\\Windows\\System32\\nvidia-smi.exe" --query-gpu=name --format=csv,noheader',
      '"C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe" --query-gpu=name --format=csv,noheader'
    ]
    : ['nvidia-smi --query-gpu=name --format=csv,noheader'];

  for (const cmd of commands) {
    try {
      const result = execSync(cmd, {
        encoding: "utf8",
        timeout: 3000, // 增加超时到 3 秒
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      if (result.trim().length > 0) {
        cachedHasNvidiaGpu = true;
        console.log(`[Platform] NVIDIA GPU detected: ${result.trim()}`);
        return true;
      }
    } catch {
      // 尝试下一个路径
    }
  }

  cachedHasNvidiaGpu = false;
  console.log('[Platform] No NVIDIA GPU detected, using Vulkan/Metal fallback');
  return false;
}


/**
 * 获取 middleware 目录路径
 */
export function getMiddlewarePath(): string {
  if (is.dev) {
    return join(__dirname, "../../../middleware");
  }
  return join(process.resourcesPath, "middleware");
}

/**
 * 检测当前平台并返回对应的二进制配置
 */
export function detectPlatform(): PlatformInfo {
  const os = platform() as PlatformOS;
  const cpuArch = arch() as "x64" | "arm64";

  let backend: Backend;
  let subdir: string;

  switch (os) {
    case "win32":
      // Windows: 优先 CUDA，回退 Vulkan
      if (hasNvidiaGpuSync()) {
        backend = "cuda";
        subdir = "win-cuda";
      } else {
        backend = "vulkan";
        subdir = "win-vulkan";
      }
      break;

    case "darwin":
      // macOS: ARM64 用 Metal，x64 用 CPU
      if (cpuArch === "arm64") {
        backend = "metal";
        subdir = "darwin-metal";
      } else {
        backend = "cpu";
        subdir = "darwin-x64";
      }
      break;

    case "linux":
      // Linux: 优先 CUDA（如果有 NVIDIA GPU），回退 Vulkan
      if (hasNvidiaGpuSync()) {
        backend = "cuda";
        subdir = "linux-cuda";
      } else {
        backend = "vulkan";
        subdir = "linux-vulkan";
      }
      break;

    default:
      throw new Error(`Unsupported platform: ${os}`);
  }

  const middlewareDir = getMiddlewarePath();
  const binaryDir = join(middlewareDir, "bin", subdir);
  const binaryName = os === "win32" ? "llama-server.exe" : "llama-server";

  return { os, arch: cpuArch, backend, binaryName, binaryDir, subdir };
}

/**
 * 获取 llama-server 可执行文件的完整路径
 * 首先尝试新的 bin/ 目录结构，回退到旧的目录结构
 */
export function getLlamaServerPath(): string {
  const middlewareDir = getMiddlewarePath();
  const info = detectPlatform();

  // 1. 尝试新的 bin/{platform}/ 目录
  const newPath = join(info.binaryDir, info.binaryName);
  if (existsSync(newPath)) {
    return newPath;
  }

  // 2. 回退：扫描 middleware 目录下的旧结构
  const fs = require("fs");
  if (existsSync(middlewareDir)) {
    for (const subdir of fs.readdirSync(middlewareDir)) {
      const candidate = join(middlewareDir, subdir, info.binaryName);
      if (existsSync(candidate)) {
        console.log(`[platform] Using legacy path: ${candidate}`);
        return candidate;
      }
    }
  }

  throw new Error(`llama-server not found. Checked: ${newPath}`);
}

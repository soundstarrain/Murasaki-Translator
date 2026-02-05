import { platform, arch } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { is } from '@electron-toolkit/utils'

const execAsync = promisify(exec)

export type PlatformOS = 'win32' | 'darwin' | 'linux'
export type Backend = 'cuda' | 'vulkan' | 'metal' | 'cpu'

export interface PlatformInfo {
    os: PlatformOS
    arch: 'x64' | 'arm64'
    backend: Backend
    binaryName: string
    binaryDir: string
    subdir: string
}

// 缓存 GPU 检测结果，避免重复执行
let cachedHasNvidiaGpu: boolean | null = null

/**
 * 异步检测 NVIDIA GPU (通过执行 nvidia-smi 命令)
 * 使用异步执行避免阻塞 Electron 主线程
 */
export async function hasNvidiaGpuAsync(): Promise<boolean> {
    if (cachedHasNvidiaGpu !== null) {
        return cachedHasNvidiaGpu
    }

    try {
        const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', {
            timeout: 2000,  // 降低超时时间，避免长时间等待
            windowsHide: true
        })
        cachedHasNvidiaGpu = stdout.trim().length > 0
        return cachedHasNvidiaGpu
    } catch {
        cachedHasNvidiaGpu = false
        return false
    }
}

/**
 * 同步检测 NVIDIA GPU - 仅用于必须同步的场景
 * 警告：会阻塞主线程，超时设为 500ms 最小化影响
 */
function hasNvidiaGpuSync(): boolean {
    if (cachedHasNvidiaGpu !== null) {
        return cachedHasNvidiaGpu
    }

    try {
        const { execSync } = require('child_process')
        const result = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', {
            encoding: 'utf8',
            timeout: 500,  // 极短超时，最小化阻塞
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        })
        cachedHasNvidiaGpu = result.trim().length > 0
        return cachedHasNvidiaGpu
    } catch {
        cachedHasNvidiaGpu = false
        return false
    }
}

/**
 * 获取 middleware 目录路径
 */
export function getMiddlewarePath(): string {
    if (is.dev) {
        return join(__dirname, '../../../middleware')
    }
    return join(process.resourcesPath, 'middleware')
}

/**
 * 检测当前平台并返回对应的二进制配置
 */
export function detectPlatform(): PlatformInfo {
    const os = platform() as PlatformOS
    const cpuArch = arch() as 'x64' | 'arm64'

    let backend: Backend
    let subdir: string

    switch (os) {
        case 'win32':
            // Windows: 优先 CUDA，回退 Vulkan
            if (hasNvidiaGpuSync()) {
                backend = 'cuda'
                subdir = 'win-cuda'
            } else {
                backend = 'vulkan'
                subdir = 'win-vulkan'
            }
            break

        case 'darwin':
            // macOS: ARM64 用 Metal，x64 用 CPU
            if (cpuArch === 'arm64') {
                backend = 'metal'
                subdir = 'darwin-metal'
            } else {
                backend = 'cpu'
                subdir = 'darwin-x64'
            }
            break

        case 'linux':
            // Linux: 优先 CUDA（如果有 NVIDIA GPU），回退 Vulkan
            if (hasNvidiaGpuSync()) {
                backend = 'cuda'
                subdir = 'linux-cuda'
            } else {
                backend = 'vulkan'
                subdir = 'linux-vulkan'
            }
            break

        default:
            throw new Error(`Unsupported platform: ${os}`)
    }

    const middlewareDir = getMiddlewarePath()
    const binaryDir = join(middlewareDir, 'bin', subdir)
    const binaryName = os === 'win32' ? 'llama-server.exe' : 'llama-server'

    return { os, arch: cpuArch, backend, binaryName, binaryDir, subdir }
}

/**
 * 获取 llama-server 可执行文件的完整路径
 * 首先尝试新的 bin/ 目录结构，回退到旧的目录结构
 */
export function getLlamaServerPath(): string {
    const middlewareDir = getMiddlewarePath()
    const info = detectPlatform()

    // 1. 尝试新的 bin/{platform}/ 目录
    const newPath = join(info.binaryDir, info.binaryName)
    if (existsSync(newPath)) {
        return newPath
    }

    // 2. 回退：扫描 middleware 目录下的旧结构
    const fs = require('fs')
    if (existsSync(middlewareDir)) {
        for (const subdir of fs.readdirSync(middlewareDir)) {
            const candidate = join(middlewareDir, subdir, info.binaryName)
            if (existsSync(candidate)) {
                console.log(`[platform] Using legacy path: ${candidate}`)
                return candidate
            }
        }
    }

    throw new Error(`llama-server not found. Checked: ${newPath}`)
}

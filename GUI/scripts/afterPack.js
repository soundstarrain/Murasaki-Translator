const fs = require('fs')
const path = require('path')

/**
 * electron-builder afterPack 钩子
 * 用于创建必要的空目录和设置可执行权限
 */
exports.default = async function (context) {
    const { appOutDir, packager } = context
    const platformName = packager.platform.name

    console.log(`[afterPack] Running for platform: ${platformName}`)

    // 确定 resources 目录位置
    let resourceDir
    if (platformName === 'mac') {
        resourceDir = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'middleware')
    } else {
        resourceDir = path.join(appOutDir, 'resources', 'middleware')
    }

    // 1. 创建必要的空目录
    const dirs = ['models', 'glossaries', 'cache']

    for (const dir of dirs) {
        const fullPath = path.join(resourceDir, dir)
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true })
            console.log(`[afterPack] Created directory: ${fullPath}`)
        }
    }

    // 2. Linux/macOS: 确保二进制文件有可执行权限
    if (platformName === 'linux' || platformName === 'mac') {
        const binDir = path.join(resourceDir, 'bin')
        if (fs.existsSync(binDir)) {
            const subdirs = fs.readdirSync(binDir)
            for (const subdir of subdirs) {
                const subdirPath = path.join(binDir, subdir)
                if (fs.statSync(subdirPath).isDirectory()) {
                    const files = fs.readdirSync(subdirPath)
                    for (const file of files) {
                        // 设置所有可执行文件权限
                        if (!file.includes('.')) {
                            const filePath = path.join(subdirPath, file)
                            fs.chmodSync(filePath, 0o755)
                            console.log(`[afterPack] Set executable: ${filePath}`)
                        }
                    }
                }
            }
        }

        // 旧目录结构兼容：检查直接在 middleware 下的二进制目录
        if (fs.existsSync(resourceDir)) {
            const entries = fs.readdirSync(resourceDir)
            for (const entry of entries) {
                const entryPath = path.join(resourceDir, entry)
                if (fs.statSync(entryPath).isDirectory() && entry.includes('llama')) {
                    const serverPath = path.join(entryPath, 'llama-server')
                    if (fs.existsSync(serverPath)) {
                        fs.chmodSync(serverPath, 0o755)
                        console.log(`[afterPack] Set executable (legacy): ${serverPath}`)
                    }
                }
            }
        }
    }

    console.log('[afterPack] Complete')
}

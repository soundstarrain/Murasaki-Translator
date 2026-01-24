/**
 * useBackup - 数据备份 Hook
 * 提供翻译过程中的自动备份和缓存完整性验证功能
 */

import { useCallback, useRef } from 'react'

// 备份配置
const BACKUP_INTERVAL_MS = 60000 // 每分钟自动备份
const MAX_BACKUPS = 5 // 最多保留5个备份

// 备份元数据
interface BackupMeta {
    timestamp: number
    blockCount: number
    checksum: string
}

/**
 * 计算简单校验和 (用于检测数据损坏)
 */
function calculateChecksum(data: string): string {
    let hash = 0
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash // 转换为32位整数
    }
    return hash.toString(16)
}

/**
 * 验证 JSON 数据完整性
 */
function validateCacheData(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!data) {
        errors.push('数据为空')
        return { valid: false, errors }
    }

    if (!Array.isArray(data.blocks)) {
        errors.push('blocks 字段不是数组')
    } else {
        // 检查每个 block 的必需字段
        data.blocks.forEach((block: any, index: number) => {
            if (typeof block.index !== 'number') {
                errors.push(`Block ${index}: 缺少 index 字段`)
            }
            if (typeof block.src !== 'string') {
                errors.push(`Block ${index}: src 字段类型错误`)
            }
            if (typeof block.dst !== 'string') {
                errors.push(`Block ${index}: dst 字段类型错误`)
            }
        })
    }

    return { valid: errors.length === 0, errors }
}

/**
 * 数据备份 Hook
 */
export function useBackup(cacheKey: string) {
    const backupTimerRef = useRef<NodeJS.Timeout | null>(null)

    /**
     * 获取备份存储键
     */
    const getBackupKey = useCallback((index: number) => {
        return `murasaki-backup-${cacheKey}-${index}`
    }, [cacheKey])

    /**
     * 获取所有备份的元数据
     */
    const getBackupList = useCallback((): BackupMeta[] => {
        const backups: BackupMeta[] = []
        for (let i = 0; i < MAX_BACKUPS; i++) {
            const key = getBackupKey(i)
            const metaKey = `${key}-meta`
            const meta = localStorage.getItem(metaKey)
            if (meta) {
                try {
                    backups.push(JSON.parse(meta))
                } catch (e) {
                    // 损坏的元数据
                }
            }
        }
        return backups.sort((a, b) => b.timestamp - a.timestamp)
    }, [getBackupKey])

    /**
     * 创建备份
     */
    const createBackup = useCallback((data: any) => {
        const dataStr = JSON.stringify(data)
        const checksum = calculateChecksum(dataStr)
        const timestamp = Date.now()

        // 找到最旧的备份槽位
        let oldestIndex = 0
        let oldestTime = Infinity

        for (let i = 0; i < MAX_BACKUPS; i++) {
            const metaKey = `${getBackupKey(i)}-meta`
            const meta = localStorage.getItem(metaKey)
            if (!meta) {
                oldestIndex = i
                break
            }
            try {
                const parsed = JSON.parse(meta)
                if (parsed.timestamp < oldestTime) {
                    oldestTime = parsed.timestamp
                    oldestIndex = i
                }
            } catch (e) {
                oldestIndex = i
                break
            }
        }

        // 保存备份
        const key = getBackupKey(oldestIndex)
        const meta: BackupMeta = {
            timestamp,
            blockCount: data.blocks?.length || 0,
            checksum
        }

        try {
            localStorage.setItem(key, dataStr)
            localStorage.setItem(`${key}-meta`, JSON.stringify(meta))
            console.log(`[Backup] Created backup ${oldestIndex} at ${new Date(timestamp).toLocaleTimeString()}`)
            return true
        } catch (e) {
            console.error('[Backup] Failed to create backup:', e)
            return false
        }
    }, [getBackupKey])

    /**
     * 恢复备份
     */
    const restoreBackup = useCallback((index: number): any | null => {
        const key = getBackupKey(index)
        const data = localStorage.getItem(key)
        const meta = localStorage.getItem(`${key}-meta`)

        if (!data || !meta) {
            console.error('[Backup] Backup not found:', index)
            return null
        }

        try {
            const parsedMeta: BackupMeta = JSON.parse(meta)
            const parsedData = JSON.parse(data)

            // 验证校验和
            const currentChecksum = calculateChecksum(data)
            if (currentChecksum !== parsedMeta.checksum) {
                console.error('[Backup] Checksum mismatch, backup may be corrupted')
                return null
            }

            // 验证数据完整性
            const validation = validateCacheData(parsedData)
            if (!validation.valid) {
                console.error('[Backup] Validation failed:', validation.errors)
                return null
            }

            console.log(`[Backup] Restored backup from ${new Date(parsedMeta.timestamp).toLocaleString()}`)
            return parsedData
        } catch (e) {
            console.error('[Backup] Failed to restore backup:', e)
            return null
        }
    }, [getBackupKey])

    /**
     * 启动自动备份
     */
    const startAutoBackup = useCallback((getData: () => any) => {
        if (backupTimerRef.current) {
            clearInterval(backupTimerRef.current)
        }

        backupTimerRef.current = setInterval(() => {
            const data = getData()
            if (data) {
                createBackup(data)
            }
        }, BACKUP_INTERVAL_MS)

        console.log('[Backup] Auto backup started')
    }, [createBackup])

    /**
     * 停止自动备份
     */
    const stopAutoBackup = useCallback(() => {
        if (backupTimerRef.current) {
            clearInterval(backupTimerRef.current)
            backupTimerRef.current = null
            console.log('[Backup] Auto backup stopped')
        }
    }, [])

    /**
     * 验证缓存数据
     */
    const validateData = useCallback((data: any) => {
        return validateCacheData(data)
    }, [])

    /**
     * 清理所有备份
     */
    const clearBackups = useCallback(() => {
        for (let i = 0; i < MAX_BACKUPS; i++) {
            const key = getBackupKey(i)
            localStorage.removeItem(key)
            localStorage.removeItem(`${key}-meta`)
        }
        console.log('[Backup] All backups cleared')
    }, [getBackupKey])

    return {
        createBackup,
        restoreBackup,
        getBackupList,
        startAutoBackup,
        stopAutoBackup,
        validateData,
        clearBackups
    }
}

export default useBackup

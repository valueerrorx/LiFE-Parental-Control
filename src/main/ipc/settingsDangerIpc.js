import fs from 'fs'
import path from 'path'
import { DEFAULT_SCHEDULE, persistSchedule } from './schedulesIpc.js'
import { replaceQuotaEntries } from './quotaIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'
import { persistWebFilterEntries } from './webFilterIpc.js'
import { replaceProcessWhitelistFromBackup } from './processWhitelistIpc.js'
import { readKioskLockdownSummary, persistKioskConfigText } from './systemIpc.js'
import { appendActivity } from './activityLog.js'

const USAGE_OR_QUOTA_LOG_RE = /^(usage|quota-usage|app-usage)-\d{4}-\d{2}-\d{2}\.json$/

function unlinkAllUsageAndQuotaLogs(configDir) {
    let removed = 0
    let names
    try {
        names = fs.readdirSync(configDir)
    } catch {
        return { removed: 0 }
    }
    for (const name of names) {
        if (!USAGE_OR_QUOTA_LOG_RE.test(name)) continue
        try {
            fs.unlinkSync(path.join(configDir, name))
            removed++
        } catch {
            // unreadable or race; skip
        }
    }
    return { removed }
}

export function registerSettingsDangerIpc(ipcMain, configDir) {
    ipcMain.handle('settings:stopAllProtections', () => {
        try {
            persistSchedule(configDir, { ...DEFAULT_SCHEDULE })
            replaceQuotaEntries(configDir, [])
            replaceBlockedDesktopIds(configDir, [])
            persistWebFilterEntries(configDir, [], {}, [])
            replaceProcessWhitelistFromBackup(configDir, { enabled: false, allowedIds: [] })
            const kiosk = readKioskLockdownSummary()
            if (kiosk.active) persistKioskConfigText(configDir, '')
            appendActivity(configDir, { action: 'protections_stop_all' })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('settings:deleteAllUsageHistory', () => {
        try {
            const { removed } = unlinkAllUsageAndQuotaLogs(configDir)
            appendActivity(configDir, { action: 'usage_history_wiped_all', removed })
            return { ok: true, removed }
        } catch (e) {
            return { error: e.message }
        }
    })
}

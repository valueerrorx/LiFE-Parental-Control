import { DEFAULT_SCHEDULE, persistSchedule } from './schedulesIpc.js'
import { replaceQuotaEntries } from './quotaIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'
import { persistWebFilterEntries } from './webFilterIpc.js'
import { replaceProcessWhitelistFromBackup } from './processWhitelistIpc.js'
import { readKioskLockdownSummary, persistKioskConfigText } from './systemIpc.js'
import { appendActivity } from './activityLog.js'
import { daemonWipeUsageHistory } from '../daemonPrivilegedOps.js'
import { executeUnlock } from '../LockdownService.js'

export function registerSettingsDangerIpc(ipcMain, configDir) {
    ipcMain.handle('settings:stopAllProtections', async () => {
        try {
            persistSchedule(configDir, { ...DEFAULT_SCHEDULE })
            replaceQuotaEntries(configDir, [])
            replaceBlockedDesktopIds(configDir, [])
            await persistWebFilterEntries(configDir, [], {}, [], {
                enabled: false,
                dohIptablesEnabled: false,
                dnsMode: 'dhcp'
            })
            replaceProcessWhitelistFromBackup(configDir, { enabled: false, allowedIds: [] })
            const kiosk = readKioskLockdownSummary()
            if (kiosk.active) persistKioskConfigText(configDir, '')
            appendActivity(configDir, { action: 'protections_stop_all' })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('settings:undoChildLockdown', async (_, targetUser) => {
        if (typeof targetUser !== 'string' || !targetUser.trim()) {
            return { ok: false, error: 'Invalid target user' }
        }
        const user = targetUser.trim()
        try {
            const result = await executeUnlock(user)
            if (result.ok) {
                appendActivity(configDir, { action: 'lockdown_undone', targetUser: user })
            }
            return result
        } catch (e) {
            return { ok: false, error: e.message || String(e) }
        }
    })

    ipcMain.handle('settings:deleteAllUsageHistory', async () => {
        try {
            const result = await daemonWipeUsageHistory()
            if (!result.ok) return { error: result.error }
            appendActivity(configDir, { action: 'usage_history_wiped_all', removed: result.removed })
            return { ok: true, removed: result.removed }
        } catch (e) {
            return { error: e.message }
        }
    })
}

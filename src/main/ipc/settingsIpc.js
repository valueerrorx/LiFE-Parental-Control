import { normalizedLockIdleMinutesOrUndefined } from '@shared/lockIdleMinutes.js'
import { normalizeQuotaLinuxUser } from '@shared/quotaUsageKey.js'
import { appendActivity } from './activityLog.js'
import { readDefaultJson, patchDefaultJson, invalidateDefaultJsonCache } from '../defaultProfileStore.js'
import { daemonPruneArchives, daemonAuthIsSet, daemonAuthCheck, daemonAuthSet, daemonAuthChange } from '../daemonPrivilegedOps.js'

export function readPreferencesForBackup(configDir) {
    const prefs = readDefaultJson(configDir)?.preferences || {}
    const out = {}
    const m = normalizedLockIdleMinutesOrUndefined(prefs.lockIdleMinutes)
    if (m !== undefined) out.lockIdleMinutes = m
    const qv = typeof prefs.quotaViewLinuxUser === 'string' ? normalizeQuotaLinuxUser(prefs.quotaViewLinuxUser) : ''
    if (qv) out.quotaViewLinuxUser = qv
    return out
}

export function mergePreferencesFromBackup(configDir, prefs) {
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return
    patchDefaultJson(configDir, (d) => {
        const nextPrefs = { ...(d.preferences || {}) }
        if (prefs.lockIdleMinutes != null) {
            const m = normalizedLockIdleMinutesOrUndefined(prefs.lockIdleMinutes)
            if (m !== undefined) nextPrefs.lockIdleMinutes = m
        }
        if (Object.hasOwn(prefs, 'quotaViewLinuxUser')) {
            const v = normalizeQuotaLinuxUser(prefs.quotaViewLinuxUser)
            nextPrefs.quotaViewLinuxUser = v || ''
        }
        d.preferences = nextPrefs
        return d
    })
}

export function clearSessionLockPreference(configDir) {
    patchDefaultJson(configDir, (d) => {
        const nextPrefs = { ...(d.preferences || {}) }
        delete nextPrefs.lockIdleMinutes
        d.preferences = nextPrefs
        return d
    })
}


export function registerSettingsIpc(ipcMain, configDir) {
    // Returns { ok, isSet, error? } so the renderer can wait for a real answer (no false = "no password" on daemon errors).
    ipcMain.handle('settings:isPasswordSet', async () => {
        try {
            const r = await daemonAuthIsSet()
            if (!r.ok) return { ok: false, isSet: false, error: r.error || 'Daemon nicht verbunden.' }
            return { ok: true, isSet: r.isSet === true }
        } catch (e) {
            return { ok: false, isSet: false, error: e?.message || 'Unbekannter Fehler.' }
        }
    })

    ipcMain.handle('settings:checkPassword', async (_, password) => {
        try {
            const r = await daemonAuthCheck(password)
            // If daemon not connected, allow through (fail-open for session lock)
            if (!r.ok && r.error?.includes('nicht verbunden')) return true
            return r.valid === true
        } catch {
            return true
        }
    })

    ipcMain.handle('settings:setPassword', async (_, password) => {
        const r = await daemonAuthSet(password)
        if (r.ok) appendActivity(configDir, { action: 'parent_password_set' })
        return r.ok ? undefined : { error: r.error }
    })

    ipcMain.handle('settings:changePassword', async (_, oldPassword, newPassword) => {
        const r = await daemonAuthChange(oldPassword, newPassword)
        if (r.ok) appendActivity(configDir, { action: 'parent_password_changed' })
        return r.ok ? { ok: true } : { error: r.error || 'Current password is incorrect' }
    })

    ipcMain.handle('settings:getConfig', () => {
        const prefs = readDefaultJson(configDir)?.preferences || {}
        // Never spread full cfg into IPC — only prefs the renderer understands.
        const safe = {}
        if (Object.hasOwn(prefs, 'lockIdleMinutes')) {
            const m = normalizedLockIdleMinutesOrUndefined(prefs.lockIdleMinutes)
            if (m !== undefined) safe.lockIdleMinutes = m
        }
        const qv = typeof prefs.quotaViewLinuxUser === 'string' ? normalizeQuotaLinuxUser(prefs.quotaViewLinuxUser) : ''
        if (qv) safe.quotaViewLinuxUser = qv
        return safe
    })

    ipcMain.handle('settings:saveConfig', (_, data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return
        const logFields = {}
        patchDefaultJson(configDir, (d) => {
            const nextPrefs = { ...(d.preferences || {}) }
            if (Object.hasOwn(data, 'lockIdleMinutes')) {
                const m = normalizedLockIdleMinutesOrUndefined(data.lockIdleMinutes)
                if (m !== undefined) { nextPrefs.lockIdleMinutes = m; logFields.lockIdleMinutes = m }
                else delete nextPrefs.lockIdleMinutes
            }
            if (Object.hasOwn(data, 'quotaViewLinuxUser')) {
                const raw = data.quotaViewLinuxUser
                const v = raw === '' || raw == null ? '' : normalizeQuotaLinuxUser(String(raw))
                nextPrefs.quotaViewLinuxUser = v || ''
                logFields.quotaViewLinuxUser = nextPrefs.quotaViewLinuxUser
            }
            d.preferences = nextPrefs
            return d
        })
        appendActivity(configDir, { action: 'settings_config_saved', ...logFields })
    })


    ipcMain.handle('settings:queueDaemonWarningTest', () => {
        try {
            patchDefaultJson(configDir, (d) => {
                d.requestDaemonWarningTest = true
                return d
            })
            invalidateDefaultJsonCache()
            appendActivity(configDir, { action: 'daemon_warning_test_queued' })
            return { ok: true }
        } catch (e) {
            return { error: e.message || String(e) }
        }
    })

    ipcMain.handle('settings:pruneUsageArchives', async () => {
        try {
            const result = await daemonPruneArchives()
            if (!result.ok) return { error: result.error }
            appendActivity(configDir, { action: 'usage_archives_pruned', removed: result.removed })
            return { ok: true, removed: result.removed }
        } catch (e) {
            return { error: e.message }
        }
    })
}

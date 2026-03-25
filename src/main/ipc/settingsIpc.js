import crypto from 'crypto'
import { normalizedLockIdleMinutesOrUndefined } from '@shared/lockIdleMinutes.js'
import { normalizeQuotaLinuxUser } from '@shared/quotaUsageKey.js'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { appendActivity } from './activityLog.js'
import { readDefaultJson, patchDefaultJson } from '../defaultProfileStore.js'

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + salt).digest('hex')
}

function readPasswordSecurity(configDir) {
    const def = readDefaultJson(configDir)
    if (def?.security?.passwordHash && def?.security?.salt) return def.security
    return { passwordHash: '', salt: '' }
}

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

export function repairInvalidLockIdleInConfig(configDir) {
    const prefs = readDefaultJson(configDir)?.preferences || {}
    if (!Object.hasOwn(prefs, 'lockIdleMinutes')) return
    if (normalizedLockIdleMinutesOrUndefined(prefs.lockIdleMinutes) !== undefined) return
    clearSessionLockPreference(configDir)
}

// Parent gate for privileged actions (screen-time bonus); unrelated to unlock-screen "no password" bypass.
export function checkParentPassword(configDir, plain) {
    const sec = readPasswordSecurity(configDir)
    if (!sec.passwordHash) return { ok: false, reason: 'no_password' }
    if (typeof plain !== 'string' || plain.length === 0) return { ok: false, reason: 'invalid' }
    if (hashPassword(plain, sec.salt) !== sec.passwordHash) return { ok: false, reason: 'invalid' }
    return { ok: true }
}

export function registerSettingsIpc(ipcMain, configDir) {
    ipcMain.handle('settings:isPasswordSet', () => {
        try {
            const sec = readPasswordSecurity(configDir)
            return !!sec.passwordHash
        } catch {
            return false
        }
    })

    ipcMain.handle('settings:checkPassword', (_, password) => {
        try {
            const sec = readPasswordSecurity(configDir)
            if (!sec.passwordHash) return true  // no password set → allow through
            return hashPassword(password, sec.salt) === sec.passwordHash
        } catch {
            return true
        }
    })

    ipcMain.handle('settings:setPassword', (_, password) => {
        const salt = crypto.randomBytes(16).toString('hex')
        patchDefaultJson(configDir, (d) => {
            d.security = { passwordHash: hashPassword(password, salt), salt }
            return d
        })
        appendActivity(configDir, { action: 'parent_password_set' })
    })

    ipcMain.handle('settings:changePassword', (_, oldPassword, newPassword) => {
        const sec = readPasswordSecurity(configDir)
        if (sec?.passwordHash && hashPassword(oldPassword, sec.salt) !== sec.passwordHash) {
            return { error: 'Current password is incorrect' }
        }
        const salt = crypto.randomBytes(16).toString('hex')
        patchDefaultJson(configDir, (d) => {
            d.security = { passwordHash: hashPassword(newPassword, salt), salt }
            return d
        })
        appendActivity(configDir, { action: 'parent_password_changed' })
        return { ok: true }
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
            appendActivity(configDir, { action: 'daemon_warning_test_queued' })
            return { ok: true }
        } catch (e) {
            return { error: e.message || String(e) }
        }
    })

    ipcMain.handle('settings:pruneUsageArchives', () => {
        try {
            const { removed } = pruneUsageArchives(configDir)
            appendActivity(configDir, { action: 'usage_archives_pruned', removed })
            return { ok: true, removed }
        } catch (e) {
            return { error: e.message }
        }
    })
}

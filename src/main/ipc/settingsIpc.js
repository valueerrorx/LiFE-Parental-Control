import crypto from 'crypto'
import { app } from 'electron'
import { normalizedLockIdleMinutesOrUndefined } from '@shared/lockIdleMinutes.js'
import { normalizeQuotaLinuxUser } from '@shared/quotaUsageKey.js'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { appendActivity } from './activityLog.js'
import { readDefaultJson, patchDefaultJson } from '../defaultProfileStore.js'
import {
    writeSystemAutostartDesktop,
    removeSystemAutostartDesktop,
    systemAutostartDesktopPresent
} from './autostartLinux.js'

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
    if (prefs.autostartEnabled === true) out.autostartEnabled = true
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
        if (Object.hasOwn(prefs, 'autostartEnabled')) nextPrefs.autostartEnabled = prefs.autostartEnabled === true
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
        const sec = readPasswordSecurity(configDir)
        const isFirstSetup = !sec?.passwordHash
        const salt = crypto.randomBytes(16).toString('hex')
        patchDefaultJson(configDir, (d) => {
            d.security = { passwordHash: hashPassword(password, salt), salt }
            return d
        })
        appendActivity(configDir, { action: 'parent_password_set' })
        if (isFirstSetup && app.isPackaged && typeof process.getuid === 'function' && process.getuid() === 0) {
            try {
                writeSystemAutostartDesktop()
                patchDefaultJson(configDir, (d) => {
                    d.preferences = { ...(d.preferences || {}), autostartEnabled: true }
                    return d
                })
                appendActivity(configDir, { action: 'autostart_enabled', reason: 'first_password' })
            } catch (e) {
                console.warn('[LiFE Parental Control] autostart after first setup:', e.message)
            }
        }
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
        safe.autostartEnabled = prefs.autostartEnabled === true
        safe.autostartFilePresent = systemAutostartDesktopPresent()
        const qv = typeof prefs.quotaViewLinuxUser === 'string' ? normalizeQuotaLinuxUser(prefs.quotaViewLinuxUser) : ''
        if (qv) safe.quotaViewLinuxUser = qv
        return safe
    })

    ipcMain.handle('settings:saveConfig', (_, data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return
        patchDefaultJson(configDir, (d) => {
            const nextPrefs = { ...(d.preferences || {}) }
            if (Object.hasOwn(data, 'lockIdleMinutes')) {
                const m = normalizedLockIdleMinutesOrUndefined(data.lockIdleMinutes)
                if (m !== undefined) nextPrefs.lockIdleMinutes = m
                else delete nextPrefs.lockIdleMinutes
            }
            if (Object.hasOwn(data, 'autostartEnabled')) nextPrefs.autostartEnabled = data.autostartEnabled === true
            if (Object.hasOwn(data, 'quotaViewLinuxUser')) {
                const raw = data.quotaViewLinuxUser
                const v = raw === '' || raw == null ? '' : normalizeQuotaLinuxUser(String(raw))
                nextPrefs.quotaViewLinuxUser = v || ''
            }
            d.preferences = nextPrefs
            return d
        })
    })


    ipcMain.handle('settings:setAutostart', (_, enabled) => {
        const want = Boolean(enabled)
        if (!app.isPackaged) {
            return { error: 'Autostart is only available for the packaged app (deb or AppImage).' }
        }
        if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
            return { error: 'Administrator rights are required to change system autostart (/etc/xdg/autostart).' }
        }
        try {
            if (want) writeSystemAutostartDesktop()
            else removeSystemAutostartDesktop()
            patchDefaultJson(configDir, (d) => {
                d.preferences = { ...(d.preferences || {}), autostartEnabled: want === true }
                return d
            })
            appendActivity(configDir, { action: want ? 'autostart_enabled' : 'autostart_disabled' })
            return { ok: true, autostartFilePresent: systemAutostartDesktopPresent() }
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

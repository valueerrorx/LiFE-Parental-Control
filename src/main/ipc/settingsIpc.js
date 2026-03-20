import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import { normalizedLockIdleMinutesOrUndefined } from '@shared/lockIdleMinutes.js'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { appendActivity } from './activityLog.js'
import {
    writeSystemAutostartDesktop,
    removeSystemAutostartDesktop,
    systemAutostartDesktopPresent
} from './autostartLinux.js'

const CONFIG_FILE = 'config.json'

function readConfig(configDir) {
    const file = path.join(configDir, CONFIG_FILE)
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

function saveConfig(configDir, data) {
    const file = path.join(configDir, CONFIG_FILE)
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
}

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + salt).digest('hex')
}

export function readPreferencesForBackup(configDir) {
    const cfg = readConfig(configDir)
    const out = {}
    const m = normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes)
    if (m !== undefined) out.lockIdleMinutes = m
    if (cfg.autostartEnabled === true) out.autostartEnabled = true
    return out
}

export function mergePreferencesFromBackup(configDir, prefs) {
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return
    const cfg = readConfig(configDir)
    const next = { ...cfg }
    if (prefs.lockIdleMinutes != null) {
        const m = normalizedLockIdleMinutesOrUndefined(prefs.lockIdleMinutes)
        if (m !== undefined) next.lockIdleMinutes = m
    }
    if (Object.hasOwn(prefs, 'autostartEnabled')) {
        if (prefs.autostartEnabled === true) next.autostartEnabled = true
        else delete next.autostartEnabled
    }
    saveConfig(configDir, next)
}

export function clearSessionLockPreference(configDir) {
    const cfg = readConfig(configDir)
    const next = { ...cfg }
    delete next.lockIdleMinutes
    saveConfig(configDir, next)
}

export function repairInvalidLockIdleInConfig(configDir) {
    const cfg = readConfig(configDir)
    if (!Object.hasOwn(cfg, 'lockIdleMinutes')) return
    if (normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes) !== undefined) return
    const next = { ...cfg }
    delete next.lockIdleMinutes
    saveConfig(configDir, next)
}

// Parent gate for privileged actions (screen-time bonus); unrelated to unlock-screen "no password" bypass.
export function checkParentPassword(configDir, plain) {
    const cfg = readConfig(configDir)
    if (!cfg.passwordHash) return { ok: false, reason: 'no_password' }
    if (typeof plain !== 'string' || plain.length === 0) return { ok: false, reason: 'invalid' }
    if (hashPassword(plain, cfg.salt) !== cfg.passwordHash) return { ok: false, reason: 'invalid' }
    return { ok: true }
}

export function registerSettingsIpc(ipcMain, configDir) {
    ipcMain.handle('settings:isPasswordSet', () => {
        const cfg = readConfig(configDir)
        return !!(cfg.passwordHash)
    })

    ipcMain.handle('settings:checkPassword', (_, password) => {
        const cfg = readConfig(configDir)
        if (!cfg.passwordHash) return true  // no password set → allow through
        return hashPassword(password, cfg.salt) === cfg.passwordHash
    })

    ipcMain.handle('settings:setPassword', (_, password) => {
        const cfg = readConfig(configDir)
        const isFirstSetup = !cfg.passwordHash
        const salt = crypto.randomBytes(16).toString('hex')
        cfg.passwordHash = hashPassword(password, salt)
        cfg.salt = salt
        saveConfig(configDir, cfg)
        appendActivity(configDir, { action: 'parent_password_set' })
        if (isFirstSetup && app.isPackaged && typeof process.getuid === 'function' && process.getuid() === 0) {
            try {
                writeSystemAutostartDesktop()
                const next = readConfig(configDir)
                next.autostartEnabled = true
                saveConfig(configDir, next)
                appendActivity(configDir, { action: 'autostart_enabled', reason: 'first_password' })
            } catch (e) {
                console.warn('[LiFE Parental Control] autostart after first setup:', e.message)
            }
        }
    })

    ipcMain.handle('settings:changePassword', (_, oldPassword, newPassword) => {
        const cfg = readConfig(configDir)
        if (cfg.passwordHash && hashPassword(oldPassword, cfg.salt) !== cfg.passwordHash) {
            return { error: 'Current password is incorrect' }
        }
        const salt = crypto.randomBytes(16).toString('hex')
        cfg.passwordHash = hashPassword(newPassword, salt)
        cfg.salt = salt
        saveConfig(configDir, cfg)
        appendActivity(configDir, { action: 'parent_password_changed' })
        return { ok: true }
    })

    ipcMain.handle('settings:getConfig', () => {
        const cfg = readConfig(configDir)
        // Never spread full cfg into IPC — only prefs the renderer understands (password lives in cfg too).
        const safe = {}
        if (Object.hasOwn(cfg, 'lockIdleMinutes')) {
            const m = normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes)
            if (m !== undefined) safe.lockIdleMinutes = m
        }
        safe.autostartEnabled = cfg.autostartEnabled === true
        safe.autostartFilePresent = systemAutostartDesktopPresent()
        return safe
    })

    ipcMain.handle('settings:saveConfig', (_, data) => {
        const cfg = readConfig(configDir)
        if (!data || typeof data !== 'object' || Array.isArray(data)) return
        const next = { ...cfg }
        // Only merge known preference keys so stray renderer/IPC fields cannot pollute config.json.
        if (Object.hasOwn(data, 'lockIdleMinutes')) {
            const m = normalizedLockIdleMinutesOrUndefined(data.lockIdleMinutes)
            if (m !== undefined) next.lockIdleMinutes = m
            else delete next.lockIdleMinutes
        }
        if (Object.hasOwn(data, 'autostartEnabled')) {
            if (data.autostartEnabled === true) next.autostartEnabled = true
            else delete next.autostartEnabled
        }
        saveConfig(configDir, next)
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
            const cfg = readConfig(configDir)
            const next = { ...cfg }
            if (want) next.autostartEnabled = true
            else delete next.autostartEnabled
            saveConfig(configDir, next)
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

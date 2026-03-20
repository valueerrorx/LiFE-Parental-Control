import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { normalizedLockIdleMinutesOrUndefined } from '@shared/lockIdleMinutes.js'
import { pruneUsageArchives } from './usageArchivePrune.js'

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
    const m = normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes)
    if (m === undefined) return {}
    return { lockIdleMinutes: m }
}

export function mergePreferencesFromBackup(configDir, prefs) {
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return
    const cfg = readConfig(configDir)
    const next = { ...cfg }
    if (prefs.lockIdleMinutes != null) {
        const m = normalizedLockIdleMinutesOrUndefined(prefs.lockIdleMinutes)
        if (m !== undefined) next.lockIdleMinutes = m
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
        const salt = crypto.randomBytes(16).toString('hex')
        const cfg = readConfig(configDir)
        cfg.passwordHash = hashPassword(password, salt)
        cfg.salt = salt
        saveConfig(configDir, cfg)
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
        saveConfig(configDir, next)
    })

    ipcMain.handle('settings:pruneUsageArchives', () => {
        try {
            const { removed } = pruneUsageArchives(configDir)
            return { ok: true, removed }
        } catch (e) {
            return { error: e.message }
        }
    })
}

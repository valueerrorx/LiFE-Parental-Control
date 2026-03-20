import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

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
        const safe = { ...cfg }
        delete safe.passwordHash
        delete safe.salt
        return safe
    })

    ipcMain.handle('settings:saveConfig', (_, data) => {
        const cfg = readConfig(configDir)
        const incoming = { ...data }
        delete incoming.passwordHash
        delete incoming.salt
        saveConfig(configDir, { ...cfg, ...incoming })
    })
}

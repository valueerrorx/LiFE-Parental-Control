import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { redeployQuotaFromDisk } from './quotaIpc.js'
import { appendActivity } from './activityLog.js'

const WHITELIST_FILE = 'process-whitelist.json'
// Legacy kill enforcement (removed); clean up on save so old installs drop the extra cron.
const LEGACY_KILL_SCRIPT = '/usr/local/bin/life-parental-kill'
const LEGACY_KILL_CRON = '/etc/cron.d/life-parental-kill'

function readConfig(configDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(configDir, WHITELIST_FILE), 'utf8'))
        return {
            enabled: Boolean(raw.enabled),
            allowedIds: Array.isArray(raw.allowedIds) ? raw.allowedIds : []
        }
    } catch {
        return { enabled: false, allowedIds: [] }
    }
}

function saveConfig(configDir, config) {
    fs.writeFileSync(path.join(configDir, WHITELIST_FILE), JSON.stringify(config, null, 2), 'utf8')
}

export function removeLegacyProcessKillCronArtifacts() {
    try {
        if (fs.existsSync(LEGACY_KILL_CRON)) fs.unlinkSync(LEGACY_KILL_CRON)
    } catch {
        // best-effort
    }
    try {
        if (fs.existsSync(LEGACY_KILL_SCRIPT)) fs.unlinkSync(LEGACY_KILL_SCRIPT)
    } catch {
        // best-effort
    }
    try {
        execFile('systemctl', ['reload', 'cron'], { timeout: 3000 }, () => {})
        execFile('systemctl', ['reload', 'crond'], { timeout: 3000 }, () => {})
    } catch {
        // best-effort
    }
}

export function readProcessWhitelistConfig(configDir) {
    return readConfig(configDir)
}

export function replaceProcessWhitelistFromBackup(configDir, payload) {
    const enabled = payload != null && typeof payload === 'object' && payload.enabled === true
    const allowedIds = payload != null && typeof payload === 'object' && Array.isArray(payload.allowedIds)
        ? payload.allowedIds.filter(s => typeof s === 'string')
        : []
    const config = { enabled, allowedIds }
    fs.mkdirSync(configDir, { recursive: true })
    saveConfig(configDir, config)
    removeLegacyProcessKillCronArtifacts()
    redeployQuotaFromDisk(configDir)
}

export function registerProcessWhitelistIpc(ipcMain, configDir) {
    ipcMain.handle('processWhitelist:get', () => readConfig(configDir))

    ipcMain.handle('processWhitelist:save', (_, payload) => {
        try {
            const enabled = payload.enabled === true
            const allowedIds = Array.isArray(payload.allowedIds)
                ? payload.allowedIds.filter(s => typeof s === 'string')
                : []
            const config = { enabled, allowedIds }
            saveConfig(configDir, config)
            removeLegacyProcessKillCronArtifacts()
            redeployQuotaFromDisk(configDir)
            appendActivity(configDir, {
                action: 'process_whitelist_save',
                enabled: config.enabled,
                allowedIds: config.allowedIds.length
            })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('processWhitelist:redeploy', () => {
        try {
            removeLegacyProcessKillCronArtifacts()
            redeployQuotaFromDisk(configDir)
            appendActivity(configDir, { action: 'process_whitelist_redeploy' })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })
}

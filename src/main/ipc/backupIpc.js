import fs from 'fs'
import path from 'path'
import { app, dialog } from 'electron'
import { DEFAULT_SCHEDULE, persistSchedule } from './schedulesIpc.js'
import { readWebFilterEntries, persistWebFilterEntries } from './webFilterIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'
import { readQuotaEntries, replaceQuotaEntries } from './quotaIpc.js'
import { readPreferencesForBackup, mergePreferencesFromBackup, clearSessionLockPreference } from './settingsIpc.js'
import { appendActivity } from './activityLog.js'

// Single-file bundle: no password hash, no usage history, no /etc/hosts aside from apply step below.
const BUNDLE_VERSION = 1
const SCHED_FILE = 'schedules.json'
const BLOCKED_FILE = 'blocked-apps.json'
const LIFE_MODES_FILE = 'life-modes.json'

function readScheduleFromDisk(configDir) {
    try {
        return { ...DEFAULT_SCHEDULE, ...JSON.parse(fs.readFileSync(path.join(configDir, SCHED_FILE), 'utf8')) }
    } catch {
        return { ...DEFAULT_SCHEDULE }
    }
}

function readBlockedFromDisk(configDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(configDir, BLOCKED_FILE), 'utf8'))
        if (!Array.isArray(raw)) return []
        return raw.map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean)
    } catch {
        return []
    }
}

function readLifeModesFromDisk(configDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(configDir, LIFE_MODES_FILE), 'utf8'))
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
        return raw
    } catch {
        return null
    }
}

export function registerBackupIpc(ipcMain, configDir, getWindow) {
    ipcMain.handle('backup:export', async () => {
        const win = getWindow()
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: 'Export LiFE settings (password not included)',
            defaultPath: path.join(app.getPath('documents'), `life-parental-backup-${stamp}.json`),
            filters: [{ name: 'JSON', extensions: ['json'] }]
        })
        if (canceled || !filePath) return { canceled: true }
        try {
            const bundle = {
                version: BUNDLE_VERSION,
                exportedAt: new Date().toISOString(),
                schedules: readScheduleFromDisk(configDir),
                webFilter: { entries: readWebFilterEntries(configDir) },
                blockedApps: readBlockedFromDisk(configDir),
                lifeModes: readLifeModesFromDisk(configDir),
                quotas: readQuotaEntries(configDir),
                preferences: readPreferencesForBackup(configDir)
            }
            fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8')
            appendActivity(configDir, { action: 'backup_export', file: path.basename(filePath) })
            return { ok: true, path: filePath }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('backup:import', async () => {
        const win = getWindow()
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: 'Import LiFE settings',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile']
        })
        if (canceled || !filePaths?.[0]) return { canceled: true }
        try {
            const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))
            if (raw == null || typeof raw !== 'object') return { error: 'Invalid file' }
            if (raw.version !== BUNDLE_VERSION) return { error: `Unsupported backup version (expected ${BUNDLE_VERSION})` }

            if (Object.hasOwn(raw, 'schedules')) {
                const patch = raw.schedules != null && typeof raw.schedules === 'object' && !Array.isArray(raw.schedules)
                    ? raw.schedules
                    : {}
                persistSchedule(configDir, { ...DEFAULT_SCHEDULE, ...patch })
            }
            if (Object.hasOwn(raw, 'webFilter')) {
                const rawEntries = raw.webFilter?.entries
                const entries = Array.isArray(rawEntries)
                    ? rawEntries
                        .filter(e => e && typeof e.domain === 'string')
                        .map(e => ({ domain: e.domain, enabled: e.enabled !== false }))
                    : []
                persistWebFilterEntries(configDir, entries)
            }
            if (Object.hasOwn(raw, 'blockedApps')) {
                const src = Array.isArray(raw.blockedApps) ? raw.blockedApps : []
                const ids = src
                    .map(x => (typeof x === 'string' ? x : x?.id))
                    .filter(id => typeof id === 'string' && id.endsWith('.desktop'))
                replaceBlockedDesktopIds(configDir, ids)
            }
            if (Object.hasOwn(raw, 'lifeModes')) {
                fs.mkdirSync(configDir, { recursive: true })
                const lmPath = path.join(configDir, LIFE_MODES_FILE)
                const lm = raw.lifeModes
                if (lm != null && typeof lm === 'object' && !Array.isArray(lm)) {
                    fs.writeFileSync(lmPath, JSON.stringify(lm, null, 2), 'utf8')
                } else {
                    try {
                        fs.unlinkSync(lmPath)
                    } catch {
                        // missing file or unreadable
                    }
                }
            }
            if (Object.hasOwn(raw, 'quotas')) {
                const list = Array.isArray(raw.quotas) ? raw.quotas : []
                replaceQuotaEntries(configDir, list)
            }
            if (Object.hasOwn(raw, 'preferences')) {
                const p = raw.preferences
                if (p != null && typeof p === 'object' && !Array.isArray(p)) mergePreferencesFromBackup(configDir, p)
                else clearSessionLockPreference(configDir)
            }
            appendActivity(configDir, { action: 'backup_import', file: path.basename(filePaths[0]) })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })
}

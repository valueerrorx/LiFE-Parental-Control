import fs from 'fs'
import path from 'path'
import { app, dialog } from 'electron'
import { DEFAULT_SCHEDULE, persistSchedule } from './schedulesIpc.js'
import { readWebFilterEntries, persistWebFilterEntries } from './webFilterIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'
import { readQuotaEntries, replaceQuotaEntries } from './quotaIpc.js'

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
                quotas: readQuotaEntries(configDir)
            }
            fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8')
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

            if (raw.schedules && typeof raw.schedules === 'object') {
                persistSchedule(configDir, { ...DEFAULT_SCHEDULE, ...raw.schedules })
            }
            if (raw.webFilter?.entries && Array.isArray(raw.webFilter.entries)) {
                const entries = raw.webFilter.entries
                    .filter(e => e && typeof e.domain === 'string')
                    .map(e => ({ domain: e.domain, enabled: e.enabled !== false }))
                persistWebFilterEntries(configDir, entries)
            }
            if (Array.isArray(raw.blockedApps)) {
                const ids = raw.blockedApps
                    .map(x => (typeof x === 'string' ? x : x?.id))
                    .filter(id => typeof id === 'string' && id.endsWith('.desktop'))
                replaceBlockedDesktopIds(configDir, ids)
            }
            if (raw.lifeModes != null && typeof raw.lifeModes === 'object' && !Array.isArray(raw.lifeModes)) {
                fs.mkdirSync(configDir, { recursive: true })
                fs.writeFileSync(path.join(configDir, LIFE_MODES_FILE), JSON.stringify(raw.lifeModes, null, 2), 'utf8')
            }
            if (Array.isArray(raw.quotas)) replaceQuotaEntries(configDir, raw.quotas)
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })
}

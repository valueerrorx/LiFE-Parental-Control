import fs from 'fs'
import path from 'path'
import { app, dialog } from 'electron'
import { DEFAULT_SCHEDULE, persistSchedule } from './schedulesIpc.js'
import { persistWebFilterEntries } from './webFilterIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'
import { readQuotaEntries, replaceQuotaEntries } from './quotaIpc.js'
import { readProcessWhitelistConfig, replaceProcessWhitelistFromBackup } from './processWhitelistIpc.js'
import { readPreferencesForBackup, mergePreferencesFromBackup, clearSessionLockPreference } from './settingsIpc.js'
import { appendActivity } from './activityLog.js'
import { readDefaultJson } from '../defaultProfileStore.js'

// Single-file bundle: no password hash, no usage history, no /etc/hosts aside from apply step below.
const BUNDLE_VERSION = 1

function readScheduleFromDisk(configDir) {
    const def = readDefaultJson(configDir)
    return { ...DEFAULT_SCHEDULE, ...(def?.schedule || {}) }
}

function readBlockedFromDisk(configDir) {
    const def = readDefaultJson(configDir)
    const raw = Array.isArray(def?.blockedDesktopIds) ? def.blockedDesktopIds : []
    return raw.map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean)
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
                webFilter: (({ entries, feedState, listAllowlist }) => ({ entries, feedState, listAllowlist }))(readDefaultJson(configDir)?.webfilter || {}),
                blockedApps: readBlockedFromDisk(configDir),
                quotas: readQuotaEntries(configDir),
                processWhitelist: readProcessWhitelistConfig(configDir),
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
                const wf = raw.webFilter
                const rawEntries = wf?.entries
                const entries = Array.isArray(rawEntries)
                    ? rawEntries
                        .filter(e => e && typeof e.domain === 'string')
                        .map(e => ({ domain: e.domain, enabled: e.enabled !== false }))
                    : []
                const feedState = wf?.feedState != null && typeof wf.feedState === 'object' && !Array.isArray(wf.feedState)
                    ? { ...wf.feedState }
                    : {}
                const listAllowlist = Object.hasOwn(wf || {}, 'listAllowlist') && Array.isArray(wf.listAllowlist)
                    ? wf.listAllowlist
                    : undefined
                await persistWebFilterEntries(configDir, entries, feedState, listAllowlist)
            }
            if (Object.hasOwn(raw, 'blockedApps')) {
                const src = Array.isArray(raw.blockedApps) ? raw.blockedApps : []
                const ids = src
                    .map(x => (typeof x === 'string' ? x : x?.id))
                    .filter(id => typeof id === 'string' && id.endsWith('.desktop'))
                replaceBlockedDesktopIds(configDir, ids)
            }
            if (Object.hasOwn(raw, 'quotas')) {
                const list = Array.isArray(raw.quotas) ? raw.quotas : []
                replaceQuotaEntries(configDir, list)
            }
            if (Object.hasOwn(raw, 'processWhitelist')) {
                const pw = raw.processWhitelist
                if (pw != null && typeof pw === 'object' && !Array.isArray(pw)) {
                    replaceProcessWhitelistFromBackup(configDir, pw)
                }
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

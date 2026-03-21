import fs from 'fs'
import path from 'path'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { localIsoDate } from './localCalendarDay.js'
import { appendActivity } from './activityLog.js'
import { checkParentPassword } from './settingsIpc.js'

const QUOTA_FILE = 'quota.json'
const BONUS_MIN = 5
const BONUS_MAX = 180
const BONUS_DEFAULT = 30

function readQuotas(configDir) {
    try { return JSON.parse(fs.readFileSync(path.join(configDir, QUOTA_FILE), 'utf8')) } catch { return [] }
}

function saveQuotas(configDir, quotas) {
    fs.writeFileSync(path.join(configDir, QUOTA_FILE), JSON.stringify(quotas, null, 2), 'utf8')
}

/** Full quota usage file shape for enforcement + IPC. */
export function readQuotaUsageState(configDir) {
    const today = localIsoDate()
    const file = path.join(configDir, `quota-usage-${today}.json`)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (data.date !== today) return { date: today, usage: {}, appExtra: {} }
        return {
            date: today,
            usage: typeof data.usage === 'object' && data.usage ? { ...data.usage } : {},
            appExtra: typeof data.appExtra === 'object' && data.appExtra ? { ...data.appExtra } : {}
        }
    } catch {
        return { date: today, usage: {}, appExtra: {} }
    }
}

export function writeQuotaUsageState(configDir, state) {
    const file = path.join(configDir, `quota-usage-${localIsoDate()}.json`)
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
}

/** IPC: { usage: { appId: minutes }, appExtra: { appId: bonus } } */
export function readQuotaUsageForIpc(configDir) {
    const st = readQuotaUsageState(configDir)
    return { usage: st.usage, appExtra: st.appExtra }
}

export function readAppMonitorUsage(configDir) {
    const today = localIsoDate()
    const file = path.join(configDir, `app-usage-${today}.json`)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        return data.date === today ? (data.usage ?? {}) : {}
    } catch { return {} }
}

function monitorLabelsFromCatalog(configDir) {
    try {
        const c = JSON.parse(fs.readFileSync(path.join(configDir, 'app-monitor-catalog.json'), 'utf8'))
        const apps = Array.isArray(c.apps) ? c.apps : []
        const names = {}
        for (const a of apps) {
            const id = a?.appId
            if (!id) continue
            names[id] = typeof a.appName === 'string' && a.appName.length ? a.appName : (a.processName || id)
        }
        return names
    } catch {
        return {}
    }
}

export function readMonitorCatalogEntries(configDir) {
    try {
        const c = JSON.parse(fs.readFileSync(path.join(configDir, 'app-monitor-catalog.json'), 'utf8'))
        return Array.isArray(c.apps) ? c.apps : []
    } catch {
        return []
    }
}

export function writeAppMonitorUsage(configDir, usageMap) {
    const today = localIsoDate()
    const file = path.join(configDir, `app-usage-${today}.json`)
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ date: today, usage: usageMap }, null, 2), 'utf8')
}

export function loadQuotaExemptAppIds(configDir) {
    try {
        const wl = JSON.parse(fs.readFileSync(path.join(configDir, 'process-whitelist.json'), 'utf8'))
        if (!wl?.enabled) return new Set()
        const ids = wl?.allowedIds
        return Array.isArray(ids) ? new Set(ids) : new Set()
    } catch {
        return new Set()
    }
}

export function readQuotaEntries(configDir) {
    const raw = readQuotas(configDir)
    return Array.isArray(raw) ? raw : []
}

export function redeployQuotaFromDisk(configDir) {
    try {
        pruneUsageArchives(configDir)
    } catch {
        // best-effort
    }
}

export function replaceQuotaEntries(configDir, entries) {
    const list = Array.isArray(entries)
        ? entries.filter(e =>
            e && typeof e.appId === 'string' && e.appId.endsWith('.desktop')
                && typeof e.processName === 'string' && e.processName.length > 0
                && Number.isFinite(Number(e.minutesPerDay)))
        : []
    const normalized = list.map(e => ({
        appId: e.appId,
        appName: typeof e.appName === 'string' && e.appName.length ? e.appName : e.processName,
        processName: e.processName,
        minutesPerDay: Math.max(1, Math.min(24 * 60, Math.floor(Number(e.minutesPerDay))))
    }))
    saveQuotas(configDir, normalized)
    try {
        pruneUsageArchives(configDir)
    } catch {
        // best-effort
    }
}

export function registerQuotaIpc(ipcMain, configDir) {
    ipcMain.handle('quota:getList', () => readQuotaEntries(configDir))

    ipcMain.handle('quota:getUsage', () => readQuotaUsageForIpc(configDir))

    ipcMain.handle('quota:getAppMonitorUsage', () => ({
        usage: readAppMonitorUsage(configDir),
        labels: monitorLabelsFromCatalog(configDir)
    }))

    ipcMain.handle('quota:resetTodayUsage', () => {
        try {
            const file = path.join(configDir, `quota-usage-${localIsoDate()}.json`)
            if (fs.existsSync(file)) fs.unlinkSync(file)
            appendActivity(configDir, { action: 'quota_reset_today' })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('quota:redeploy', () => ({ ok: true }))

    ipcMain.handle('quota:grantAppBonus', (_, payload) => {
        try {
            const gate = checkParentPassword(configDir, payload?.password)
            if (!gate.ok) {
                if (gate.reason === 'no_password') return { error: 'Set a parent password in Settings first.' }
                return { error: 'Invalid password.' }
            }
            const appId = typeof payload?.appId === 'string' ? payload.appId : ''
            if (!appId) return { error: 'Missing app id.' }
            const raw = Number(payload?.minutes)
            const bonus = Number.isFinite(raw) && raw > 0
                ? Math.min(BONUS_MAX, Math.max(BONUS_MIN, Math.floor(raw)))
                : BONUS_DEFAULT
            const st = readQuotaUsageState(configDir)
            const prev = Math.max(0, Number(st.appExtra[appId]) || 0)
            st.appExtra[appId] = prev + bonus
            writeQuotaUsageState(configDir, st)
            appendActivity(configDir, { action: 'quota_app_bonus', appId, granted: bonus })
            return { ok: true, appExtra: st.appExtra[appId] }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('quota:setEntry', (_, { appId, appName, processName, minutesPerDay }) => {
        try {
            const quotas = readQuotaEntries(configDir)
            const idx = quotas.findIndex(q => q.appId === appId)
            const entry = { appId, appName, processName, minutesPerDay }
            if (idx >= 0) quotas[idx] = entry
            else quotas.push(entry)
            saveQuotas(configDir, quotas)
            try {
                pruneUsageArchives(configDir)
            } catch { /* ignore */ }
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('quota:removeEntry', (_, appId) => {
        try {
            const quotas = readQuotaEntries(configDir).filter(q => q.appId !== appId)
            saveQuotas(configDir, quotas)
            try {
                pruneUsageArchives(configDir)
            } catch { /* ignore */ }
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })
}

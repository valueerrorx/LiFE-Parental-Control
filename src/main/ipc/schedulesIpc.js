import fs from 'fs'
import path from 'path'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { localIsoDate } from './localCalendarDay.js'
import { appendActivity } from './activityLog.js'
import { effectiveScreenMinutes, effectiveScreenMinutesFromFileData } from '@shared/screenTimeUsage.js'
import { normalizeQuotaLinuxUser } from '@shared/quotaUsageKey.js'
import { patchDefaultJson, readDefaultJson } from '../defaultProfileStore.js'
import { daemonRequest, isDaemonConnected } from '../daemonClient.js'
import { daemonResetTodayUsage, daemonClearTodayOverrides } from '../daemonPrivilegedOps.js'
const BONUS_MIN = 5
const BONUS_MAX = 180
const BONUS_DEFAULT = 30

export const DEFAULT_SCHEDULE_PERIOD = {
    dailyLimitEnabled: false,
    dailyLimitMinutes: 120,
    allowedHoursEnabled: false,
    allowedHoursStart: '07:00',
    allowedHoursEnd: '22:00'
}

export const DEFAULT_SCHEDULE = {
    enabled: false,
    screenTimeLinuxUser: '',
    weekday: { ...DEFAULT_SCHEDULE_PERIOD },
    weekend: { ...DEFAULT_SCHEDULE_PERIOD, dailyLimitMinutes: 180 }
}

function normalizePeriod(p, def) {
    const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {}
    return {
        dailyLimitEnabled: src.dailyLimitEnabled === true,
        dailyLimitMinutes: Number.isFinite(Number(src.dailyLimitMinutes)) ? Number(src.dailyLimitMinutes) : def.dailyLimitMinutes,
        allowedHoursEnabled: src.allowedHoursEnabled === true,
        allowedHoursStart: typeof src.allowedHoursStart === 'string' ? src.allowedHoursStart : def.allowedHoursStart,
        allowedHoursEnd: typeof src.allowedHoursEnd === 'string' ? src.allowedHoursEnd : def.allowedHoursEnd
    }
}

export function readSchedule(configDir) {
    const def = readDefaultJson(configDir)
    const s = def?.schedule && typeof def.schedule === 'object' && !Array.isArray(def.schedule) ? def.schedule : {}
    // Backward compat: migrate old flat format to weekday/weekend
    const hasOldFormat = (s.dailyLimitEnabled != null || s.allowedHoursEnabled != null) && !s.weekday
    const legacyFlat = hasOldFormat ? {
        dailyLimitEnabled: s.dailyLimitEnabled === true,
        dailyLimitMinutes: s.dailyLimitMinutes ?? DEFAULT_SCHEDULE_PERIOD.dailyLimitMinutes,
        allowedHoursEnabled: s.allowedHoursEnabled === true,
        allowedHoursStart: s.allowedHoursStart ?? DEFAULT_SCHEDULE_PERIOD.allowedHoursStart,
        allowedHoursEnd: s.allowedHoursEnd ?? DEFAULT_SCHEDULE_PERIOD.allowedHoursEnd
    } : null
    return {
        enabled: s.enabled === true,
        screenTimeLinuxUser: typeof s.screenTimeLinuxUser === 'string' ? s.screenTimeLinuxUser : '',
        allowedDays: Array.isArray(s.allowedDays) ? s.allowedDays : DEFAULT_SCHEDULE.allowedDays,
        weekday: normalizePeriod(s.weekday ?? legacyFlat, DEFAULT_SCHEDULE_PERIOD),
        weekend: normalizePeriod(s.weekend ?? legacyFlat, { ...DEFAULT_SCHEDULE_PERIOD, dailyLimitMinutes: 180 })
    }
}

function emptyUsage(today) {
    return {
        date: today,
        users: {},
        extraAllowanceMinutes: 0,
        warnedScreenTimeExhausted: false,
        allowedHoursExtraMinutes: 0,
        allowedHoursOverrideEnd: ''
    }
}

/** Sum of all per-user minutes in a usage object (ignores pool key ''). Falls back to pool key if no named users exist. */
function totalMinutesFromUsage(usage) {
    const users = usage && typeof usage.users === 'object' && usage.users ? usage.users : {}
    const named = Object.entries(users).filter(([k]) => k !== '')
    if (named.length > 0) return named.reduce((sum, [, v]) => sum + Math.max(0, Number(v?.minutes) || 0), 0)
    // legacy pool key fallback
    return Math.max(0, Number(users['']?.minutes) || 0)
}

/** Raw today usage (users map); does not include legacy top-level minutes. */
export function readUsage(configDir) {
    const today = localIsoDate()
    const file = path.join(configDir, `usage-${today}.json`)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (data.date !== today) return emptyUsage(today)
        /** @type {Record<string, { minutes: number }>} */
        let users = {}
        if (data.users && typeof data.users === 'object') {
            for (const [k, v] of Object.entries(data.users)) {
                users[k] = { minutes: Math.max(0, Number(v?.minutes) || 0) }
            }
        } else if (data.minutes != null) {
            users[''] = { minutes: Math.max(0, Number(data.minutes) || 0) }
        }
        return {
            date: today,
            users,
            extraAllowanceMinutes: Math.max(0, Number(data.extraAllowanceMinutes) || 0),
            warnedScreenTimeExhausted: data.warnedScreenTimeExhausted === true,
            allowedHoursExtraMinutes: Math.max(0, Number(data.allowedHoursExtraMinutes) || 0),
            allowedHoursOverrideEnd: typeof data.allowedHoursOverrideEnd === 'string' ? data.allowedHoursOverrideEnd.trim() : ''
        }
    } catch {
        return emptyUsage(today)
    }
}

export function writeUsage(configDir, usage) {
    const today = localIsoDate()
    const file = path.join(configDir, `usage-${today}.json`)
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(usage, null, 2), 'utf8')
}

function readUsageHistory(configDir, maxDays, linuxUser) {
    const re = /^usage-(\d{4}-\d{2}-\d{2})\.json$/
    const entries = []
    for (const name of fs.readdirSync(configDir)) {
        const m = name.match(re)
        if (!m) continue
        const dateStr = m[1]
        try {
            const data = JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'))
            const minutes = linuxUser !== undefined
                ? effectiveScreenMinutesFromFileData(data, dateStr, linuxUser)
                : (data.date === dateStr ? totalMinutesFromUsage(data) : 0)
            entries.push({ date: dateStr, minutes })
        } catch {
            entries.push({ date: dateStr, minutes: 0 })
        }
    }
    entries.sort((a, b) => b.date.localeCompare(a.date))
    return entries.slice(0, maxDays)
}

export async function persistSchedule(configDir, schedule) {
    const s = { ...schedule, screenTimeLinuxUser: normalizeQuotaLinuxUser(schedule?.screenTimeLinuxUser) }

    // Parent saved the schedule → reset all temporary overrides and warning flags for today.
    // Must go through the daemon because /etc/life-parental/ is root-owned.
    await daemonClearTodayOverrides().catch(() => { /* best-effort */ })

    patchDefaultJson(configDir, (d) => {
        d.schedule = s
        return d
    })
    try {
        pruneUsageArchives(configDir)
    } catch {
        // best-effort
    }
}

/** Kept for embeddedEnforcementSync; cron deployment removed — enforcement runs in Electron. */
export function redeployScheduleCron(configDir) {
    try {
        pruneUsageArchives(configDir)
    } catch {
        // best-effort
    }
}

export function registerSchedulesIpc(ipcMain, configDir) {
    ipcMain.handle('schedules:get', () => readSchedule(configDir))

    ipcMain.handle('schedules:getUsage', (_, linuxUser) => {
        const usage = readUsage(configDir)
        const lu = typeof linuxUser === 'string' && linuxUser.trim() ? linuxUser.trim() : null
        const minutes = lu ? effectiveScreenMinutes(usage, lu) : totalMinutesFromUsage(usage)
        return { ...usage, minutes }
    })

    ipcMain.handle('schedules:getUsageHistory', (_, rawMax, linuxUser) => {
        try {
            const maxDays = Math.min(90, Math.max(1, Number(rawMax) || 14))
            const lu = typeof linuxUser === 'string' && linuxUser.trim() ? linuxUser.trim() : undefined
            return { days: readUsageHistory(configDir, maxDays, lu) }
        } catch (e) {
            return { days: [], error: e.message }
        }
    })

    ipcMain.handle('schedules:save', async (_, schedule) => {
        try {
            await persistSchedule(configDir, schedule)
            appendActivity(configDir, { action: 'schedule_saved', enabled: schedule?.enabled ?? false })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'schedule_save_error', error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('schedules:redeploy', () => {
        try {
            const { removed } = pruneUsageArchives(configDir)
            appendActivity(configDir, { action: 'schedule_cron_redeploy' })
            return { ok: true, removed }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('schedules:resetTodayUsage', async () => {
        try {
            const result = await daemonResetTodayUsage()
            if (!result.ok) return { error: result.error }
            appendActivity(configDir, { action: 'screen_time_reset_today' })
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('schedules:grantBonusMinutes', async (_, payload) => {
        if (!isDaemonConnected()) return { error: 'Daemon nicht verbunden.' }
        try {
            const raw = Number(payload?.minutes)
            const bonus = Number.isFinite(raw) && raw > 0
                ? Math.min(BONUS_MAX, Math.max(BONUS_MIN, Math.floor(raw)))
                : BONUS_DEFAULT
            const result = await daemonRequest({ type: 'extend', minutes: bonus, password: payload?.password }, 'extend-result', 15_000)
            if (!result.ok) return { error: result.error }
            // Re-read usage after daemon wrote the updated file (file is 0644, readable by frontend)
            const updatedUsage = readUsage(configDir)
            const minutesLogged = totalMinutesFromUsage(updatedUsage)
            const nextExtra = Math.max(0, Number(updatedUsage.extraAllowanceMinutes) || 0)
            appendActivity(configDir, {
                action: 'screen_time_bonus',
                granted: bonus,
                extraAllowanceAfter: nextExtra
            })
            return { ok: true, minutes: minutesLogged, extraAllowanceMinutes: nextExtra, granted: bonus }
        } catch (e) {
            return { error: e.message }
        }
    })
}

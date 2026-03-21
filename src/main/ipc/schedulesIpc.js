import fs from 'fs'
import path from 'path'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { localIsoDate } from './localCalendarDay.js'
import { checkParentPassword } from './settingsIpc.js'
import { appendActivity } from './activityLog.js'
import { effectiveScreenMinutes, effectiveScreenMinutesFromFileData } from '@shared/screenTimeUsage.js'
import { normalizeQuotaLinuxUser } from '@shared/quotaUsageKey.js'

const CONFIG_FILE = 'schedules.json'
const BONUS_MIN = 5
const BONUS_MAX = 180
const BONUS_DEFAULT = 30

export const DEFAULT_SCHEDULE = {
    enabled: false,
    dailyLimitEnabled: false,
    dailyLimitMinutes: 120,
    /** Empty = legacy pool (any graphical session adds to one counter); set to child’s Linux login for per-user tally + limit. */
    screenTimeLinuxUser: '',
    allowedHoursEnabled: false,
    allowedHoursStart: '07:00',
    allowedHoursEnd: '22:00',
    allowedDays: [1, 2, 3, 4, 5, 6, 7] // 1=Mon, 7=Sun
}

export function readSchedule(configDir) {
    try { return { ...DEFAULT_SCHEDULE, ...JSON.parse(fs.readFileSync(path.join(configDir, CONFIG_FILE), 'utf8')) } } catch { return { ...DEFAULT_SCHEDULE } }
}

function emptyUsage(today) {
    return {
        date: today,
        users: {},
        extraAllowanceMinutes: 0,
        warnedLowScreenTime: false,
        warnedScreenTimeExhausted: false
    }
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
            warnedLowScreenTime: data.warnedLowScreenTime === true,
            warnSnapLimit: data.warnSnapLimit != null ? Number(data.warnSnapLimit) : undefined,
            warnedScreenTimeExhausted: data.warnedScreenTimeExhausted === true
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

function readUsageHistory(configDir, maxDays, screenTimeLinuxUser) {
    const re = /^usage-(\d{4}-\d{2}-\d{2})\.json$/
    const entries = []
    for (const name of fs.readdirSync(configDir)) {
        const m = name.match(re)
        if (!m) continue
        const dateStr = m[1]
        try {
            const data = JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'))
            const minutes = effectiveScreenMinutesFromFileData(data, dateStr, screenTimeLinuxUser)
            entries.push({ date: dateStr, minutes })
        } catch {
            entries.push({ date: dateStr, minutes: 0 })
        }
    }
    entries.sort((a, b) => b.date.localeCompare(a.date))
    return entries.slice(0, maxDays)
}

export function persistSchedule(configDir, schedule) {
    const s = { ...schedule, screenTimeLinuxUser: normalizeQuotaLinuxUser(schedule?.screenTimeLinuxUser) }
    fs.writeFileSync(path.join(configDir, CONFIG_FILE), JSON.stringify(s, null, 2), 'utf8')
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

    ipcMain.handle('schedules:getUsage', () => {
        const schedule = readSchedule(configDir)
        const usage = readUsage(configDir)
        const minutes = effectiveScreenMinutes(usage, schedule.screenTimeLinuxUser)
        return { ...usage, minutes }
    })

    ipcMain.handle('schedules:getUsageHistory', (_, rawMax) => {
        try {
            const maxDays = Math.min(90, Math.max(1, Number(rawMax) || 14))
            const schedule = readSchedule(configDir)
            return { days: readUsageHistory(configDir, maxDays, schedule.screenTimeLinuxUser) }
        } catch (e) {
            return { days: [], error: e.message }
        }
    })

    ipcMain.handle('schedules:save', (_, schedule) => {
        try {
            persistSchedule(configDir, schedule)
            appendActivity(configDir, { action: 'schedule_saved', enabled: schedule?.enabled ?? false })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'schedule_save_error', error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('schedules:redeploy', () => ({ ok: true }))

    ipcMain.handle('schedules:resetTodayUsage', () => {
        try {
            const file = path.join(configDir, `usage-${localIsoDate()}.json`)
            if (fs.existsSync(file)) fs.unlinkSync(file)
            appendActivity(configDir, { action: 'screen_time_reset_today' })
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('schedules:grantBonusMinutes', (_, payload) => {
        try {
            const gate = checkParentPassword(configDir, payload?.password)
            if (!gate.ok) {
                if (gate.reason === 'no_password') return { error: 'Set a parent password in Settings first.' }
                return { error: 'Invalid password.' }
            }
            const raw = Number(payload?.minutes)
            const bonus = Number.isFinite(raw) && raw > 0
                ? Math.min(BONUS_MAX, Math.max(BONUS_MIN, Math.floor(raw)))
                : BONUS_DEFAULT
            const today = localIsoDate()
            const data = readUsage(configDir)
            const prevExtra = Math.max(0, Number(data.extraAllowanceMinutes) || 0)
            const nextExtra = prevExtra + bonus
            const out = {
                date: today,
                users: data.users && typeof data.users === 'object' ? data.users : {},
                extraAllowanceMinutes: nextExtra,
                warnedLowScreenTime: false,
                warnedScreenTimeExhausted: false
            }
            writeUsage(configDir, out)
            const schedule = readSchedule(configDir)
            const minutesLogged = effectiveScreenMinutes(out, schedule.screenTimeLinuxUser)
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

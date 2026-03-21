import fs from 'fs'
import path from 'path'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { localIsoDate } from './localCalendarDay.js'
import { checkParentPassword } from './settingsIpc.js'
import { appendActivity } from './activityLog.js'

const CONFIG_FILE = 'schedules.json'
const BONUS_MIN = 5
const BONUS_MAX = 180
const BONUS_DEFAULT = 30

export const DEFAULT_SCHEDULE = {
    enabled: false,
    dailyLimitEnabled: false,
    dailyLimitMinutes: 120,
    allowedHoursEnabled: false,
    allowedHoursStart: '07:00',
    allowedHoursEnd: '22:00',
    allowedDays: [1, 2, 3, 4, 5, 6, 7] // 1=Mon, 7=Sun
}

export function readSchedule(configDir) {
    try { return { ...DEFAULT_SCHEDULE, ...JSON.parse(fs.readFileSync(path.join(configDir, CONFIG_FILE), 'utf8')) } } catch { return { ...DEFAULT_SCHEDULE } }
}

export function readUsage(configDir) {
    const today = localIsoDate()
    const file = path.join(configDir, `usage-${today}.json`)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (data.date !== today) return { date: today, minutes: 0, extraAllowanceMinutes: 0 }
        return {
            date: today,
            minutes: Math.max(0, Number(data.minutes) || 0),
            extraAllowanceMinutes: Math.max(0, Number(data.extraAllowanceMinutes) || 0),
            warnedLowScreenTime: data.warnedLowScreenTime === true,
            warnSnapLimit: data.warnSnapLimit != null ? Number(data.warnSnapLimit) : undefined,
            warnedScreenTimeExhausted: data.warnedScreenTimeExhausted === true
        }
    } catch {
        return { date: today, minutes: 0, extraAllowanceMinutes: 0 }
    }
}

export function writeUsage(configDir, usage) {
    const today = localIsoDate()
    const file = path.join(configDir, `usage-${today}.json`)
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(usage, null, 2), 'utf8')
}

function readUsageHistory(configDir, maxDays) {
    const re = /^usage-(\d{4}-\d{2}-\d{2})\.json$/
    const entries = []
    for (const name of fs.readdirSync(configDir)) {
        const m = name.match(re)
        if (!m) continue
        const dateStr = m[1]
        try {
            const data = JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'))
            const minutes = data.date === dateStr ? (data.minutes ?? 0) : 0
            entries.push({ date: dateStr, minutes })
        } catch {
            entries.push({ date: dateStr, minutes: 0 })
        }
    }
    entries.sort((a, b) => b.date.localeCompare(a.date))
    return entries.slice(0, maxDays)
}

export function persistSchedule(configDir, schedule) {
    fs.writeFileSync(path.join(configDir, CONFIG_FILE), JSON.stringify(schedule, null, 2), 'utf8')
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

    ipcMain.handle('schedules:getUsage', () => readUsage(configDir))

    ipcMain.handle('schedules:getUsageHistory', (_, rawMax) => {
        try {
            const maxDays = Math.min(90, Math.max(1, Number(rawMax) || 14))
            return { days: readUsageHistory(configDir, maxDays) }
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
            const minutesLogged = Math.max(0, Number(data.minutes) || 0)
            const prevExtra = Math.max(0, Number(data.extraAllowanceMinutes) || 0)
            const nextExtra = prevExtra + bonus
            const out = {
                date: today,
                minutes: minutesLogged,
                extraAllowanceMinutes: nextExtra,
                warnedLowScreenTime: false,
                warnedScreenTimeExhausted: false
            }
            writeUsage(configDir, out)
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

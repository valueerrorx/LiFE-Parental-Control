import { execFile } from 'child_process'
import { promisify } from 'util'
import { localIsoDate } from './ipc/localCalendarDay.js'
import { readSchedule, readUsage, writeUsage } from './ipc/schedulesIpc.js'
import {
    readQuotaEntries,
    readQuotaUsageState,
    writeQuotaUsageState,
    loadQuotaExemptAppIds,
    readMonitorCatalogEntries,
    writeAppMonitorUsage,
    readAppMonitorUsage
} from './ipc/quotaIpc.js'

const execFileAsync = promisify(execFile)

const TICK_MS = 60_000
const ALLOWED_HOURS_WARN_INTERVAL_MS = 5 * 60 * 1000

let timerId = null
let quotaWarnDate = ''
const appQuotaWarnOnce = new Set()
let lastAllowedHoursWarnAt = 0

function parseLoginctlSession(text) {
    const props = {}
    for (const line of String(text || '').trim().split('\n')) {
        const eq = line.indexOf('=')
        if (eq === -1) continue
        props[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    return props
}

async function getActiveGraphicalSessions() {
    try {
        const { stdout } = await execFileAsync('loginctl', ['list-sessions', '--no-legend'], { timeout: 5000 })
        const sessions = []
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
            const parts = line.trim().split(/\s+/)
            if (parts.length < 3) continue
            const sid = parts[0]
            const user = parts[2]
            try {
                const { stdout: out2 } = await execFileAsync(
                    'loginctl',
                    ['show-session', sid, '-p', 'Type', '-p', 'State', '-p', 'Class'],
                    { timeout: 3000 }
                )
                const p = parseLoginctlSession(out2)
                if (p.Class === 'greeter' || p.Class === 'background') continue
                const live = p.State === 'active' || p.State === 'online'
                if ((p.Type === 'x11' || p.Type === 'wayland') && live) sessions.push({ user, sid })
            } catch {
                /* skip session */
            }
        }
        return sessions
    } catch {
        return []
    }
}

function uniqueUsers(sessions) {
    const seen = new Set()
    const out = []
    for (const { user } of sessions) {
        if (!seen.has(user)) {
            seen.add(user)
            out.push(user)
        }
    }
    return out
}

async function pgrepUserProcess(user, processName) {
    try {
        const { stdout } = await execFileAsync('pgrep', ['-u', user, '-x', '-i', processName], { timeout: 3000 })
        return String(stdout || '').trim().length > 0
    } catch {
        return false
    }
}

async function anyUserRunningProcess(users, processName) {
    for (const u of users) {
        if (await pgrepUserProcess(u, processName)) return true
    }
    return false
}

async function pkillAllUsers(users, processName) {
    for (const u of users) {
        try {
            await execFileAsync('pkill', ['-u', u, '-x', '-i', processName], { timeout: 3000 })
        } catch {
            /* ignore */
        }
    }
}

async function lockSessions() {
    try {
        await execFileAsync('loginctl', ['lock-sessions'], { timeout: 5000 })
    } catch {
        /* ignore */
    }
}

function isoWeekday(d) {
    const n = d.getDay()
    return n === 0 ? 7 : n
}

function isWithinAllowedHours(s, now) {
    const [sh, sm] = String(s.allowedHoursStart || '07:00').split(':').map(Number)
    const [eh, em] = String(s.allowedHoursEnd || '22:00').split(':').map(Number)
    const start = sh * 60 + sm
    const end = eh * 60 + em
    const nowT = now.getHours() * 60 + now.getMinutes()
    if (start <= end) return nowT >= start && nowT <= end
    return nowT >= start || nowT <= end
}

async function tickScreenTime(configDir, { onScreenTimeWarn }) {
    const s = readSchedule(configDir)
    const now = new Date()
    const today = localIsoDate(now)
    const weekday = isoWeekday(now)

    const sessions = await getActiveGraphicalSessions()
    const hasSession = sessions.length > 0

    let usage = readUsage(configDir)
    if (usage.date !== today) {
        usage = {
            date: today,
            minutes: 0,
            extraAllowanceMinutes: 0,
            warnedLowScreenTime: false,
            warnedScreenTimeExhausted: false
        }
    }

    let minutes = Math.max(0, Number(usage.minutes) || 0)
    if (hasSession) minutes += 1
    usage.minutes = minutes
    usage.date = today

    const limitBase = Math.max(0, Number(s.dailyLimitMinutes) || 0)
    const extra = Math.max(0, Number(usage.extraAllowanceMinutes) || 0)
    const limit = limitBase + extra

    // Logged screen time runs whenever the enforcement app ticks; restrictions below only when the schedule is on.
    if (!s.enabled) {
        writeUsage(configDir, usage)
        return
    }

    if (s.allowedHoursEnabled && Array.isArray(s.allowedDays) && s.allowedDays.includes(weekday)) {
        if (!isWithinAllowedHours(s, now)) {
            writeUsage(configDir, usage)
            await lockSessions()
            if (Date.now() - lastAllowedHoursWarnAt >= ALLOWED_HOURS_WARN_INTERVAL_MS) {
                lastAllowedHoursWarnAt = Date.now()
                onScreenTimeWarn({
                    type: 'allowed-hours',
                    heading: 'Computer use not allowed now',
                    message: 'Computer use is not allowed at this time.',
                    effectiveLimit: 0,
                    usedMinutes: 0,
                    remaining: 0
                })
            }
            return
        }
    }

    if (!s.dailyLimitEnabled) {
        writeUsage(configDir, usage)
        return
    }

    if (usage.warnedLowScreenTime) {
        const remainingCheck = limit - minutes
        let stale = remainingCheck > 5
        if (!stale) {
            try {
                const snap = usage.warnSnapLimit
                if (snap == null || Number(snap) !== Number(limit)) stale = true
            } catch {
                stale = true
            }
        }
        if (stale) {
            usage.warnedLowScreenTime = false
            delete usage.warnSnapLimit
        }
    }

    const remaining = limit - minutes

    if (remaining <= 0) {
        await lockSessions()
        if (!usage.warnedScreenTimeExhausted) {
            usage.warnedScreenTimeExhausted = true
            onScreenTimeWarn({
                type: 'exhausted',
                effectiveLimit: limit,
                usedMinutes: minutes,
                remaining: 0
            })
        }
    } else {
        if (usage.warnedScreenTimeExhausted) usage.warnedScreenTimeExhausted = false
        if (remaining >= 1 && remaining <= 5 && !usage.warnedLowScreenTime && hasSession) {
            usage.warnedLowScreenTime = true
            usage.warnSnapLimit = limit
            onScreenTimeWarn({
                type: 'low',
                effectiveLimit: limit,
                usedMinutes: minutes,
                remaining
            })
        }
    }

    writeUsage(configDir, usage)
}

function resetAppQuotaWarnIfNewDay() {
    const t = localIsoDate()
    if (t !== quotaWarnDate) {
        quotaWarnDate = t
        appQuotaWarnOnce.clear()
    }
}

async function tickAppQuotas(configDir, { onAppQuotaWarn }) {
    resetAppQuotaWarnIfNewDay()
    const quotas = readQuotaEntries(configDir)
    const exempt = loadQuotaExemptAppIds(configDir)
    const sessions = await getActiveGraphicalSessions()
    const activeUsers = uniqueUsers(sessions)
    if (activeUsers.length === 0) return

    const state = readQuotaUsageState(configDir)
    const today = localIsoDate()
    if (state.date !== today) {
        state.date = today
        state.usage = {}
        state.appExtra = {}
    }
    const appUsage = state.usage
    const appExtra = state.appExtra

    for (const q of quotas) {
        const appId = q.appId || ''
        const proc = String(q.processName || '').trim()
        const baseLimit = Math.max(1, Math.floor(Number(q.minutesPerDay) || 60))
        const name = q.appName || proc
        if (!proc || !appId) continue

        const isRunning = await anyUserRunningProcess(activeUsers, proc)
        const bonus = Math.max(0, Number(appExtra[appId]) || 0)
        const limit = baseLimit + bonus
        const usedBefore = Math.max(0, Number(appUsage[appId]) || 0)

        if (isRunning) {
            if (!exempt.has(appId) && usedBefore >= limit) {
                const key = `${appId}:kill`
                if (!appQuotaWarnOnce.has(key)) {
                    appQuotaWarnOnce.add(key)
                    onAppQuotaWarn({
                        type: 'app-exhausted',
                        appId,
                        appName: name,
                        processName: proc,
                        effectiveLimit: limit,
                        usedMinutes: usedBefore
                    })
                }
                await pkillAllUsers(activeUsers, proc)
            } else if (!exempt.has(appId) && usedBefore === limit - 1) {
                appUsage[appId] = limit
                const k = `${appId}:final`
                if (!appQuotaWarnOnce.has(k)) {
                    appQuotaWarnOnce.add(k)
                    onAppQuotaWarn({
                        type: 'app-final',
                        appId,
                        appName: name,
                        processName: proc,
                        effectiveLimit: limit,
                        usedMinutes: usedBefore
                    })
                }
            } else {
                appUsage[appId] = usedBefore + 1
            }
        }

        const used = Math.max(0, Number(appUsage[appId]) || 0)
        const remaining = limit - used

        if (
            remaining === 2
            && isRunning
            && !exempt.has(appId)
            && limit >= 3
        ) {
            const k = `${appId}:2`
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k)
                onAppQuotaWarn({
                    type: 'app-low',
                    appId,
                    appName: name,
                    processName: proc,
                    effectiveLimit: limit,
                    usedMinutes: used,
                    remaining: 2
                })
            }
        } else if (remaining === 5 && isRunning) {
            const k = `${appId}:5`
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k)
                onAppQuotaWarn({
                    type: 'app-five',
                    appId,
                    appName: name,
                    processName: proc,
                    effectiveLimit: limit,
                    usedMinutes: used,
                    remaining: 5
                })
            }
        }
    }

    state.usage = appUsage
    state.appExtra = appExtra
    writeQuotaUsageState(configDir, state)
}

async function tickAppMonitor(configDir) {
    const entries = readMonitorCatalogEntries(configDir)
    if (!Array.isArray(entries) || entries.length === 0) return

    const sessions = await getActiveGraphicalSessions()
    const activeUsers = uniqueUsers(sessions)
    if (activeUsers.length === 0) return

    let track = readAppMonitorUsage(configDir)
    if (typeof track !== 'object' || track === null) track = {}

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const appId = entry.appId || entry.id || ''
        const proc = String(entry.processName || '').trim()
        if (!appId || !proc) continue
        const running = await anyUserRunningProcess(activeUsers, proc)
        if (running) track[appId] = (track[appId] || 0) + 1
    }

    writeAppMonitorUsage(configDir, track)
}

async function tick(configDir, callbacks) {
    try {
        await tickScreenTime(configDir, callbacks)
    } catch (e) {
        console.error('[LiFE Parental Control] enforcement tick (screen time):', e)
    }
    try {
        await tickAppQuotas(configDir, callbacks)
    } catch (e) {
        console.error('[LiFE Parental Control] enforcement tick (quotas):', e)
    }
    try {
        await tickAppMonitor(configDir)
    } catch (e) {
        console.error('[LiFE Parental Control] enforcement tick (app monitor):', e)
    }
}

/**
 * Starts periodic enforcement (screen time + app quotas). Requires root for pkill/lock.
 * @param {object} options
 * @param {string} options.configDir
 * @param {(p: object) => void} options.onScreenTimeWarn
 * @param {(p: object) => void} options.onAppQuotaWarn
 */
export function startEnforcementScheduler(options) {
    stopEnforcementScheduler()
    const { configDir, onScreenTimeWarn, onAppQuotaWarn } = options
    const callbacks = {
        onScreenTimeWarn: onScreenTimeWarn ?? (() => {}),
        onAppQuotaWarn: onAppQuotaWarn ?? (() => {})
    }
    void tick(configDir, callbacks)
    timerId = globalThis.setInterval(() => void tick(configDir, callbacks), TICK_MS)
}

export function stopEnforcementScheduler() {
    if (timerId != null) {
        globalThis.clearInterval(timerId)
        timerId = null
    }
}

import { execFile } from 'child_process'
import { promisify } from 'util'
import { localIsoDate } from './ipc/localCalendarDay.js'
import { getActiveGraphicalSessions } from './graphicalSessionDetect.js'
import { readSchedule, readUsage, writeUsage } from './ipc/schedulesIpc.js'
import { normalizeScreenTimeLinuxUser, effectiveScreenMinutes } from '@shared/screenTimeUsage.js'
import {
    readQuotaEntries,
    readQuotaUsageState,
    writeQuotaUsageState,
    loadQuotaExemptAppIds,
    readMonitorCatalogEntries,
    writeAppMonitorUsage,
    readAppMonitorUsage
} from './ipc/quotaIpc.js'
import { normalizeQuotaLinuxUser, quotaUsageKey, quotaUsedMinutes, quotaBonusMinutes } from '@shared/quotaUsageKey.js'

const execFileAsync = promisify(execFile)

/** Enforcement interval (pgrep, kill, lock); 60_000 % TICK_MS must be 0 so usage minutes match real minutes. */
const TICK_MS = 10_000
const TICKS_PER_LOGGED_MINUTE = 60_000 / TICK_MS
const ALLOWED_HOURS_WARN_INTERVAL_MS = 5 * 60 * 1000

let timerId = null
/** 0..TICKS_PER_LOGGED_MINUTE-1; when advance returns true, one real minute elapsed for usage tallies. */
let tickInMinute = 0
let quotaWarnDate = ''
const appQuotaWarnOnce = new Set()
let lastAllowedHoursWarnAt = 0

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

/** When targetUser is set, only lock that login’s graphical sessions; otherwise lock all (legacy). */
async function lockSessionsForPolicy(sessions, targetUser) {
    if (!targetUser) {
        await lockSessions()
        return
    }
    for (const { user, sid } of sessions) {
        if (user !== targetUser) continue
        try {
            await execFileAsync('loginctl', ['lock-session', String(sid)], { timeout: 5000 })
        } catch {
            /* ignore */
        }
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

function atLoggedMinuteBoundary() {
    tickInMinute = (tickInMinute + 1) % TICKS_PER_LOGGED_MINUTE
    return tickInMinute === 0
}

function ensureUserMinutes(usage, key) {
    if (!usage.users || typeof usage.users !== 'object') usage.users = {}
    if (!usage.users[key]) usage.users[key] = { minutes: 0 }
}

async function tickScreenTime(configDir, { onScreenTimeWarn }, logMinute) {
    const s = readSchedule(configDir)
    const now = new Date()
    const today = localIsoDate(now)
    const weekday = isoWeekday(now)

    const sessions = await getActiveGraphicalSessions()
    const activeUsers = uniqueUsers(sessions)
    const limitLu = normalizeScreenTimeLinuxUser(s.screenTimeLinuxUser)
    const hasSessionForLimit = limitLu ? activeUsers.includes(limitLu) : activeUsers.length > 0

    let usage = readUsage(configDir)
    if (usage.date !== today) {
        usage = {
            date: today,
            users: {},
            extraAllowanceMinutes: 0,
            warnedLowScreenTime: false,
            warnedScreenTimeExhausted: false
        }
    }

    if (limitLu) {
        if (logMinute && activeUsers.includes(limitLu)) {
            ensureUserMinutes(usage, limitLu)
            usage.users[limitLu].minutes = Math.max(0, Number(usage.users[limitLu].minutes) || 0) + 1
        }
    } else if (logMinute && activeUsers.length > 0) {
        ensureUserMinutes(usage, '')
        usage.users[''].minutes = Math.max(0, Number(usage.users[''].minutes) || 0) + 1
    }
    usage.date = today

    const minutes = effectiveScreenMinutes(usage, s.screenTimeLinuxUser)

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
            await lockSessionsForPolicy(sessions, limitLu)
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
        await lockSessionsForPolicy(sessions, limitLu)
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
        if (remaining >= 1 && remaining <= 5 && !usage.warnedLowScreenTime && hasSessionForLimit) {
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

async function tickAppQuotas(configDir, { onAppQuotaWarn }, logMinute) {
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
        const lu = normalizeQuotaLinuxUser(q.linuxUser)
        if (!proc || !appId) continue

        const usersForQuota = lu ? activeUsers.filter(u => u === lu) : activeUsers
        const isRunning = usersForQuota.length > 0 && await anyUserRunningProcess(usersForQuota, proc)
        const uk = quotaUsageKey(appId, lu)
        const bonus = quotaBonusMinutes(appExtra, appId, lu)
        const limit = baseLimit + bonus
        const usedBefore = quotaUsedMinutes(appUsage, appId, lu)

        if (isRunning) {
            if (!exempt.has(appId) && usedBefore >= limit) {
                const key = `${uk}:kill`
                if (!appQuotaWarnOnce.has(key)) {
                    appQuotaWarnOnce.add(key)
                    onAppQuotaWarn({
                        type: 'app-exhausted',
                        appId,
                        appName: name,
                        processName: proc,
                        effectiveLimit: limit,
                        usedMinutes: usedBefore,
                        linuxUser: lu || undefined
                    })
                }
                await pkillAllUsers(usersForQuota, proc)
            } else if (!exempt.has(appId) && usedBefore === limit - 1) {
                if (logMinute) {
                    appUsage[uk] = limit
                    const k = `${uk}:final`
                    if (!appQuotaWarnOnce.has(k)) {
                        appQuotaWarnOnce.add(k)
                        onAppQuotaWarn({
                            type: 'app-final',
                            appId,
                            appName: name,
                            processName: proc,
                            effectiveLimit: limit,
                            usedMinutes: usedBefore,
                            linuxUser: lu || undefined
                        })
                    }
                }
            } else if (logMinute) {
                appUsage[uk] = usedBefore + 1
            }
        }

        const used = quotaUsedMinutes(appUsage, appId, lu)
        const remaining = limit - used

        if (
            remaining === 2
            && isRunning
            && !exempt.has(appId)
            && limit >= 3
        ) {
            const k = `${uk}:2`
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k)
                onAppQuotaWarn({
                    type: 'app-low',
                    appId,
                    appName: name,
                    processName: proc,
                    effectiveLimit: limit,
                    usedMinutes: used,
                    remaining: 2,
                    linuxUser: lu || undefined
                })
            }
        } else if (remaining === 5 && isRunning) {
            const k = `${uk}:5`
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k)
                onAppQuotaWarn({
                    type: 'app-five',
                    appId,
                    appName: name,
                    processName: proc,
                    effectiveLimit: limit,
                    usedMinutes: used,
                    remaining: 5,
                    linuxUser: lu || undefined
                })
            }
        }
    }

    state.usage = appUsage
    state.appExtra = appExtra
    writeQuotaUsageState(configDir, state)
}

async function tickAppMonitor(configDir, logMinute) {
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
        if (running && logMinute) track[appId] = (track[appId] || 0) + 1
    }

    writeAppMonitorUsage(configDir, track)
}

async function tick(configDir, callbacks) {
    const logMinute = atLoggedMinuteBoundary()
    try {
        await tickScreenTime(configDir, callbacks, logMinute)
    } catch (e) {
        console.error('[LiFE Parental Control] enforcement tick (screen time):', e)
    }
    try {
        await tickAppQuotas(configDir, callbacks, logMinute)
    } catch (e) {
        console.error('[LiFE Parental Control] enforcement tick (quotas):', e)
    }
    try {
        await tickAppMonitor(configDir, logMinute)
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
    tickInMinute = 0
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

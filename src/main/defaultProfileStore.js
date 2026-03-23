import fs from 'fs'
import path from 'path'

const DEFAULT_JSON_FILE = 'default.json'

const EMPTY_DEFAULT = {
    label: 'Default',
    schedule: {
        enabled: false,
        dailyLimitEnabled: false,
        dailyLimitMinutes: 120,
        screenTimeLinuxUser: '',
        allowedHoursEnabled: false,
        allowedHoursStart: '07:00',
        allowedHoursEnd: '22:00',
        allowedDays: [1, 2, 3, 4, 5, 6, 7]
    },
    webfilter: {
        feedState: {},
        entries: [],
        listAllowlist: []
    },
    appControl: {
        enabled: true
    },
    preferences: {
        lockIdleMinutes: null,
        autostartEnabled: false,
        quotaViewLinuxUser: ''
    },
    blockedDesktopIds: [],
    security: {
        passwordHash: '',
        salt: ''
    },
    quotaExemptions: {
        enabled: false,
        allowedIds: []
    },
    quota: []
}

function defaultJsonPath(configDir) {
    return path.join(configDir, DEFAULT_JSON_FILE)
}

function normalizeSchedule(schedule) {
    const s = schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {}
    return {
        enabled: s.enabled === true,
        dailyLimitEnabled: s.dailyLimitEnabled === true,
        dailyLimitMinutes: Number.isFinite(Number(s.dailyLimitMinutes)) ? Number(s.dailyLimitMinutes) : 120,
        screenTimeLinuxUser: typeof s.screenTimeLinuxUser === 'string' ? s.screenTimeLinuxUser : '',
        allowedHoursEnabled: s.allowedHoursEnabled === true,
        allowedHoursStart: typeof s.allowedHoursStart === 'string' ? s.allowedHoursStart : '07:00',
        allowedHoursEnd: typeof s.allowedHoursEnd === 'string' ? s.allowedHoursEnd : '22:00',
        allowedDays: Array.isArray(s.allowedDays)
            ? s.allowedDays.map(n => Number(n)).filter(n => Number.isFinite(n)).map(n => Math.trunc(n))
            : [1, 2, 3, 4, 5, 6, 7]
    }
}

function readJsonSafe(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function ensureDefaultJsonExists(configDir) {
    const p = defaultJsonPath(configDir)
    try {
        if (fs.existsSync(p)) return false
        fs.mkdirSync(configDir, { recursive: true })
        fs.writeFileSync(p, JSON.stringify(EMPTY_DEFAULT, null, 2), { encoding: 'utf8', mode: 0o600 })
        return true
    } catch { /* best-effort */ }
}

export function readDefaultJson(configDir) {
    ensureDefaultJsonExists(configDir)
    const p = defaultJsonPath(configDir)
    const raw = readJsonSafe(p)
    if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(EMPTY_DEFAULT))
    const next = JSON.parse(JSON.stringify(EMPTY_DEFAULT))
    if (raw.security && typeof raw.security === 'object' && !Array.isArray(raw.security)) {
        const sec = raw.security
        if (typeof sec.passwordHash === 'string') next.security.passwordHash = sec.passwordHash
        if (typeof sec.salt === 'string') next.security.salt = sec.salt
    }
    if (raw.label && typeof raw.label === 'string') next.label = raw.label
    if (raw.schedule) next.schedule = normalizeSchedule(raw.schedule)
    if (raw.webfilter && typeof raw.webfilter === 'object' && !Array.isArray(raw.webfilter)) {
        const wf = raw.webfilter
        if (wf.feedState && typeof wf.feedState === 'object' && !Array.isArray(wf.feedState)) next.webfilter.feedState = { ...wf.feedState }
        if (Array.isArray(wf.entries)) next.webfilter.entries = wf.entries
            .filter(e => e && typeof e.domain === 'string')
            .map(e => ({ domain: String(e.domain).toLowerCase(), enabled: e.enabled !== false }))
        if (Array.isArray(wf.listAllowlist)) next.webfilter.listAllowlist = wf.listAllowlist.filter(d => typeof d === 'string')
    }
    if (raw.appControl && typeof raw.appControl === 'object' && !Array.isArray(raw.appControl)) {
        next.appControl.enabled = raw.appControl.enabled !== false
    }
    if (raw.preferences && typeof raw.preferences === 'object' && !Array.isArray(raw.preferences)) {
        const p = raw.preferences
        if (Object.hasOwn(p, 'lockIdleMinutes')) next.preferences.lockIdleMinutes = p.lockIdleMinutes
        next.preferences.autostartEnabled = p.autostartEnabled === true
        next.preferences.quotaViewLinuxUser = typeof p.quotaViewLinuxUser === 'string' ? p.quotaViewLinuxUser : ''
    }
    if (Array.isArray(raw.blockedDesktopIds)) next.blockedDesktopIds = raw.blockedDesktopIds.filter(s => typeof s === 'string')
    if (raw.quotaExemptions && typeof raw.quotaExemptions === 'object' && !Array.isArray(raw.quotaExemptions)) {
        const q = raw.quotaExemptions
        next.quotaExemptions.enabled = q.enabled === true
        next.quotaExemptions.allowedIds = Array.isArray(q.allowedIds) ? q.allowedIds.filter(s => typeof s === 'string') : []
    }
    if (Array.isArray(raw.quota)) next.quota = raw.quota
    return next
}

function atomicWriteJson(configDir, obj) {
    const p = defaultJsonPath(configDir)
    const tmp = path.join(configDir, `.default.json.tmp-${process.pid}-${Date.now()}`)
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(tmp, p)
}

export function patchDefaultJson(configDir, patcher) {
    const cur = readDefaultJson(configDir)
    const next = patcher(cur) || cur
    atomicWriteJson(configDir, next)
    return next
}

export function ensureDefaultJsonExistsForUi(configDir) {
    ensureDefaultJsonExists(configDir)
}


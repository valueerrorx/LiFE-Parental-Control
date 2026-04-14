import fs from 'fs'
import path from 'path'
import { daemonWriteConfigAsync } from './daemonPrivilegedOps.js'

const DEFAULT_JSON_FILE = 'default.json'

const EMPTY_DEFAULT = {
    label: 'Default',
    schedule: {
        enabled: false,
        screenTimeLinuxUser: '',
    },
    webfilter: {
        enabled: false,
        feedState: {},
        entries: [],
        listAllowlist: [],
        dnsMode: 'dhcp',
        dohIptablesEnabled: false
    },
    appControl: {
        enabled: false
    },
    preferences: {
        lockIdleMinutes: null,
        quotaViewLinuxUser: ''
    },
    blockedDesktopIds: [],
    quotaExemptions: {
        enabled: false,
        allowedIds: []
    },
    quota: [],
    requestDaemonWarningTest: false
}

function defaultJsonPath(configDir) {
    return path.join(configDir, DEFAULT_JSON_FILE)
}

function normalizeSchedule(schedule) {
    const s = schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {}
    const result = {
        enabled: s.enabled === true,
        screenTimeLinuxUser: typeof s.screenTimeLinuxUser === 'string' ? s.screenTimeLinuxUser : '',
    }
    if (s.weekday && typeof s.weekday === 'object') result.weekday = s.weekday
    if (s.weekend && typeof s.weekend === 'object') result.weekend = s.weekend
    // preserve legacy flat fields if present (backward compat for readSchedule migration)
    if (s.dailyLimitEnabled != null) result.dailyLimitEnabled = s.dailyLimitEnabled === true
    if (s.dailyLimitMinutes != null) result.dailyLimitMinutes = Number.isFinite(Number(s.dailyLimitMinutes)) ? Number(s.dailyLimitMinutes) : 120
    if (s.allowedHoursEnabled != null) result.allowedHoursEnabled = s.allowedHoursEnabled === true
    if (s.allowedHoursStart != null) result.allowedHoursStart = typeof s.allowedHoursStart === 'string' ? s.allowedHoursStart : '07:00'
    if (s.allowedHoursEnd != null) result.allowedHoursEnd = typeof s.allowedHoursEnd === 'string' ? s.allowedHoursEnd : '22:00'
    return result
}

function readJsonSafe(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

// In-memory cache: prevents race condition when multiple patchDefaultJson calls happen before the
// async daemon write completes. Without this, a read after a write returns the stale disk value
// and a subsequent patch overwrites the first change (e.g. toggling app control off then reading list).
let _cache = null

function buildFromRaw(raw) {
    if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(EMPTY_DEFAULT))
    const next = JSON.parse(JSON.stringify(EMPTY_DEFAULT))
    if (raw.label && typeof raw.label === 'string') next.label = raw.label
    if (raw.schedule) next.schedule = normalizeSchedule(raw.schedule)
    if (raw.webfilter && typeof raw.webfilter === 'object' && !Array.isArray(raw.webfilter)) {
        const wf = raw.webfilter
        if (wf.feedState && typeof wf.feedState === 'object' && !Array.isArray(wf.feedState)) next.webfilter.feedState = { ...wf.feedState }
        if (Array.isArray(wf.entries)) next.webfilter.entries = wf.entries
            .filter(e => e && typeof e.domain === 'string')
            .map(e => ({ domain: String(e.domain).toLowerCase(), enabled: e.enabled !== false }))
        if (Array.isArray(wf.listAllowlist)) next.webfilter.listAllowlist = wf.listAllowlist.filter(d => typeof d === 'string')
        next.webfilter.enabled = wf.enabled === true
        next.webfilter.dohIptablesEnabled = wf.dohIptablesEnabled === true
        const n = wf.cachedHostRuleCount
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) next.webfilter.cachedHostRuleCount = Math.floor(n)
        const VALID_DNS_MODES = ['dns4eu_protective', 'dns4eu_child', 'dns4eu_ads', 'dns4eu_child_ads', 'dhcp']
        if (VALID_DNS_MODES.includes(wf.dnsMode)) next.webfilter.dnsMode = wf.dnsMode
        if (typeof wf.dhcpFallbackDns === 'string') next.webfilter.dhcpFallbackDns = wf.dhcpFallbackDns
    }
    if (raw.appControl && typeof raw.appControl === 'object' && !Array.isArray(raw.appControl)) {
        next.appControl.enabled = raw.appControl.enabled === true
    }
    if (raw.preferences && typeof raw.preferences === 'object' && !Array.isArray(raw.preferences)) {
        const p = raw.preferences
        if (Object.hasOwn(p, 'lockIdleMinutes')) next.preferences.lockIdleMinutes = p.lockIdleMinutes
        next.preferences.quotaViewLinuxUser = typeof p.quotaViewLinuxUser === 'string' ? p.quotaViewLinuxUser : ''
    }
    if (Array.isArray(raw.blockedDesktopIds)) next.blockedDesktopIds = raw.blockedDesktopIds.filter(s => typeof s === 'string')
    if (raw.quotaExemptions && typeof raw.quotaExemptions === 'object' && !Array.isArray(raw.quotaExemptions)) {
        const q = raw.quotaExemptions
        const qeOn = q.enabled === true
        next.quotaExemptions.enabled = qeOn
        // When exemptions are off, ignore stale IDs on disk (match app-control semantics; next persist writes clean JSON).
        next.quotaExemptions.allowedIds = qeOn && Array.isArray(q.allowedIds) ? q.allowedIds.filter(s => typeof s === 'string') : []
    }
    if (Array.isArray(raw.quota)) next.quota = raw.quota
    if (raw.finishedLockdownWizard === true) next.finishedLockdownWizard = true
    return next
}

export function readDefaultJson(configDir) {
    if (_cache) return JSON.parse(JSON.stringify(_cache))
    const raw = readJsonSafe(defaultJsonPath(configDir))
    _cache = buildFromRaw(raw)
    return JSON.parse(JSON.stringify(_cache))
}

/** Invalidate the in-memory cache (call after daemon confirms write, or on reconnect). */
export function invalidateDefaultJsonCache() {
    _cache = null
}

function atomicWriteJson(configDir, obj) {
    void configDir
    daemonWriteConfigAsync(JSON.stringify(obj, null, 2))
}

export function patchDefaultJson(configDir, patcher) {
    const cur = readDefaultJson(configDir)
    const next = patcher(cur) || cur
    // Update cache immediately so concurrent reads see the new state before the async daemon write completes.
    _cache = JSON.parse(JSON.stringify(next))
    atomicWriteJson(configDir, next)
    return next
}



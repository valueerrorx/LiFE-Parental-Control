/** POSIX-like Linux login name; empty = quota applies to all local sessions (legacy). */
export function normalizeQuotaLinuxUser(raw) {
    if (raw == null || typeof raw !== 'string') return ''
    const s = raw.trim()
    if (!s) return ''
    if (s.length > 32 || s.includes(':') || /\s/.test(s)) return ''
    if (!/^[a-zA-Z0-9._-]+$/.test(s)) return ''
    return s
}

/** Storage key in quota-usage-*.json: legacy global uses appId only; per-user uses "user:appId". */
export function quotaUsageKey(appId, linuxUser) {
    const u = normalizeQuotaLinuxUser(linuxUser)
    return u ? `${u}:${appId}` : appId
}

/** Minutes used for this quota row (handles legacy keys). */
export function quotaUsedMinutes(usageMap, appId, linuxUser) {
    const u = normalizeQuotaLinuxUser(linuxUser)
    const key = quotaUsageKey(appId, u)
    const n = Number(usageMap[key])
    if (Number.isFinite(n)) return Math.max(0, n)
    if (!u) return Math.max(0, Number(usageMap[appId]) || 0)
    return 0
}

/** Bonus minutes for this quota row (legacy global bonus used appId-only keys). */
export function quotaBonusMinutes(extraMap, appId, linuxUser) {
    const u = normalizeQuotaLinuxUser(linuxUser)
    const key = quotaUsageKey(appId, u)
    const n = Number(extraMap[key])
    if (Number.isFinite(n)) return Math.max(0, n)
    if (!u) return Math.max(0, Number(extraMap[appId]) || 0)
    return 0
}


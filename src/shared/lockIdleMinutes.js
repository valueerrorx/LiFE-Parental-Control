// Single source for session auto-lock durations (settings IPC + renderer).

// Fallback when preferences.lockIdleMinutes is missing or not in the allowlist (see App.vue idleMsFromConfig).
export const DEFAULT_LOCK_IDLE_MINUTES = 2

export const LOCK_IDLE_MINUTES = Object.freeze([0, 2, 5, 15, 30, 60])

const IDLE_LABEL = Object.freeze({
    0: 'Off',
    2: '2 minutes',
    5: '5 minutes',
    15: '15 minutes',
    30: '30 minutes',
    60: '60 minutes'
})

export const LOCK_IDLE_OPTIONS = Object.freeze(
    LOCK_IDLE_MINUTES.map(value => ({ value, label: IDLE_LABEL[value] }))
)

export const LOCK_IDLE_ALLOWED = new Set(LOCK_IDLE_MINUTES)

export function isLockIdleMinutesAllowed(m) {
    const n = Number(m)
    return Number.isFinite(n) && LOCK_IDLE_ALLOWED.has(n)
}

export function normalizedLockIdleMinutesOrUndefined(raw) {
    // Reject null/'' so Number(null) cannot map JSON null to 0 (off); unset prefs use DEFAULT_LOCK_IDLE_MINUTES.
    if (raw == null || raw === '') return undefined
    if (!isLockIdleMinutesAllowed(raw)) return undefined
    return Number(raw)
}

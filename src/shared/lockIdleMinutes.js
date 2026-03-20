// Single source for session auto-lock durations (settings IPC + renderer).

export const LOCK_IDLE_MINUTES = Object.freeze([0, 5, 15, 30, 60])

const IDLE_LABEL = Object.freeze({
    0: 'Off',
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
    if (!isLockIdleMinutesAllowed(raw)) return undefined
    return Number(raw)
}

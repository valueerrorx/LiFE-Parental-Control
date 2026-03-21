import { normalizeQuotaLinuxUser } from './quotaUsageKey.js'

/** Same rules as quota linux user: POSIX login name or empty. */
export { normalizeQuotaLinuxUser as normalizeScreenTimeLinuxUser }

/** Pool key when no per-user limit is configured (legacy single counter). */
export const SCREEN_TIME_POOL_KEY = ''

/**
 * Effective logged minutes for the daily limit from persisted usage (today file shape).
 * @param {{ users?: Record<string, { minutes?: number }>, minutes?: number }} usage
 * @param {string} [screenTimeLinuxUser]
 */
export function effectiveScreenMinutes(usage, screenTimeLinuxUser) {
    const lu = normalizeQuotaLinuxUser(screenTimeLinuxUser)
    const users = usage && typeof usage.users === 'object' && usage.users ? usage.users : {}
    if (lu) {
        return Math.max(0, Number(users[lu]?.minutes) || 0)
    }
    if (users[SCREEN_TIME_POOL_KEY] != null) {
        return Math.max(0, Number(users[SCREEN_TIME_POOL_KEY].minutes) || 0)
    }
    return Math.max(0, Number(usage?.minutes) || 0)
}

/**
 * Effective minutes from a raw usage file JSON (any day) for history rows.
 * @param {object} data parsed JSON
 * @param {string} dateStr YYYY-MM-DD from filename
 * @param {string} [screenTimeLinuxUser] current schedule field (historical rows use today’s setting)
 */
export function effectiveScreenMinutesFromFileData(data, dateStr, screenTimeLinuxUser) {
    if (!data || data.date !== dateStr) return 0
    return effectiveScreenMinutes(data, screenTimeLinuxUser)
}

/** Weekday keys stored under default.json `schoolTimes` (Mon–Fri only). */
export const SCHOOL_TIME_WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri']

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** Default window for each weekday (school day). */
export function defaultSchoolTimes() {
    const slot = { from: '07:50', to: '13:10' }
    return {
        mon: { ...slot },
        tue: { ...slot },
        wed: { ...slot },
        thu: { ...slot },
        fri: { ...slot }
    }
}

/** Single 24h clock value as HH:MM; invalid or empty strings yield fallback. */
export function normalizeTimeHHMM(s, fallback) {
    if (typeof s !== 'string') return fallback
    const t = s.trim()
    if (!HHMM_RE.test(t)) return fallback
    const [h, m] = t.split(':').map(Number)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Merge disk/UI payload into a full Mon–Fri object with valid HH:MM strings. */
export function normalizeSchoolTimes(raw) {
    const base = defaultSchoolTimes()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
    const out = { ...base }
    for (const k of SCHOOL_TIME_WEEKDAY_KEYS) {
        const d = raw[k]
        if (d && typeof d === 'object' && !Array.isArray(d)) {
            out[k] = {
                from: normalizeTimeHHMM(d.from, base[k].from),
                to: normalizeTimeHHMM(d.to, base[k].to)
            }
        }
    }
    return out
}

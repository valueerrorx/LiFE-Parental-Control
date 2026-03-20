import fs from 'fs'
import path from 'path'

// Drop screen-time and quota daily JSON logs older than this (filename date, ISO).
const RETENTION_DAYS = 120

const FILE_RES = [
    /^usage-(\d{4}-\d{2}-\d{2})\.json$/,
    /^quota-usage-(\d{4}-\d{2}-\d{2})\.json$/
]

function cutoffIsoDate() {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - RETENTION_DAYS)
    return d.toISOString().slice(0, 10)
}

export function pruneUsageArchives(configDir) {
    let removed = 0
    let names
    try {
        names = fs.readdirSync(configDir)
    } catch {
        return { removed: 0 }
    }
    const cutoff = cutoffIsoDate()
    for (const name of names) {
        let isoDay = null
        for (const re of FILE_RES) {
            const m = name.match(re)
            if (m) {
                isoDay = m[1]
                break
            }
        }
        if (!isoDay || isoDay >= cutoff) continue
        try {
            fs.unlinkSync(path.join(configDir, name))
            removed++
        } catch {
            // unreadable or race with cron; skip
        }
    }
    return { removed }
}

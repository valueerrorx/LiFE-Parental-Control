import fs from 'fs'
import { daemonAppendActivity } from '../daemonPrivilegedOps.js'

const ACTIVITY_LOG_FILE = '/var/log/life-parental/activity.json'

// Ring buffer of recent parent-facing events (survives restarts; not in backup bundle).
// Writes are delegated to the daemon (root) via fire-and-forget; reads are direct (file is 0644).
export function appendActivity(configDir, entry) {
    daemonAppendActivity(entry)
}

export function readActivityLog(configDir, limit = 80) {
    try {
        const data = JSON.parse(fs.readFileSync(ACTIVITY_LOG_FILE, 'utf8'))
        const list = Array.isArray(data) ? data : []
        const n = Math.min(200, Math.max(1, Number(limit) || 80))
        return list.slice(-n).reverse()
    } catch {
        return []
    }
}

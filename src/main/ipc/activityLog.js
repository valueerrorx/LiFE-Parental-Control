import fs from 'fs'
import path from 'path'

const FILE = 'activity-log.json'
const MAX_ENTRIES = 400

// Ring buffer of recent parent-facing events (config dir, survives restarts; not in backup bundle).
export function appendActivity(configDir, entry) {
    const file = path.join(configDir, FILE)
    let list = []
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        list = Array.isArray(data) ? data : []
    } catch {
        list = []
    }
    list.push({ t: new Date().toISOString(), ...entry })
    if (list.length > MAX_ENTRIES) list = list.slice(-MAX_ENTRIES)
    try {
        fs.writeFileSync(file, JSON.stringify(list), 'utf8')
    } catch {
        // best-effort
    }
}

export function readActivityLog(configDir, limit = 80) {
    const file = path.join(configDir, FILE)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        const list = Array.isArray(data) ? data : []
        const n = Math.min(200, Math.max(1, Number(limit) || 80))
        return list.slice(-n).reverse()
    } catch {
        return []
    }
}

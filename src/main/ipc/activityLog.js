import fs from 'fs'
import path from 'path'

const NEW_ABS_FILE = '/var/log/life-parental.json'
const OLD_FILE = 'activity-log.json'
const MAX_ENTRIES = 400

function migrateLegacyActivityLog(configDir) {
    try {
        if (fs.existsSync(NEW_ABS_FILE)) return
        const oldPath = path.join(configDir, OLD_FILE)
        if (!fs.existsSync(oldPath)) return
        fs.renameSync(oldPath, NEW_ABS_FILE)
    } catch {
        // best-effort
    }
}

// Ring buffer of recent parent-facing events (config dir, survives restarts; not in backup bundle).
export function appendActivity(configDir, entry) {
    migrateLegacyActivityLog(configDir)
    const file = NEW_ABS_FILE
    let list
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
    migrateLegacyActivityLog(configDir)
    const file = NEW_ABS_FILE
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        const list = Array.isArray(data) ? data : []
        const n = Math.min(200, Math.max(1, Number(limit) || 80))
        return list.slice(-n).reverse()
    } catch {
        return []
    }
}

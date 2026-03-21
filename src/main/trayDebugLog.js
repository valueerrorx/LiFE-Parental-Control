import fs from 'fs'

const LOG_PATH = '/tmp/life-parental-tray-debug.log'

// Append-only tray diagnostics (no tokens); delete file to reset; LIFE_TRAY_DEBUG=1 mirrors to stderr.
export function trayDebugLog(phase, message, extra) {
    let line = `${new Date().toISOString()} [${phase}] ${message}`
    if (extra !== undefined) {
        try {
            line += ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
        } catch {
            line += ' [extra not serializable]'
        }
    }
    line += '\n'
    try {
        fs.appendFileSync(LOG_PATH, line, 'utf8')
    } catch {
        /* ignore */
    }
    if (process.env.LIFE_TRAY_DEBUG === '1' || process.env.LIFE_TRAY_DEBUG === 'true') {
        console.warn(`[LiFE tray debug] ${line.trim()}`)
    }
}
